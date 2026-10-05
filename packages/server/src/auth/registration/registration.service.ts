import {
  BadRequestException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
} from '@nestjs/common';
import type { RegisterRequest, RegisterResponse } from '@silencewatch/shared';
import { AuditService } from '../../audit/audit.service';
import { hashPassword } from '../../common/crypto.util';
import { uniqueSlug } from '../../common/slug.util';
import { AppConfig, CONFIG } from '../../config/config';
import { ProjectsRepository } from '../../projects/projects.repository';
import { QuotaService } from '../../quotas/quota.service';
import { maskEmail } from '../masking';
import { auditActorOf, type SessionContext } from '../session-context';
import { SessionService } from '../sessions/session.service';
import { UsersRepository, type UserRecord } from '../users/users.repository';
import { AlreadyRegisteredNoticeService } from './email-verification/already-registered-notice.service';
import { EmailVerificationService } from './email-verification/email-verification.service';
import { SignupChallengeService } from './signup-challenge.service';
import { SignupGuardService } from './signup-guard.service';

/** Creating an account, and the checks that stand in front of it. */
@Injectable()
export class RegistrationService {
  private readonly logger = new Logger(RegistrationService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly users: UsersRepository,
    private readonly projects: ProjectsRepository,
    private readonly sessions: SessionService,
    private readonly verification: EmailVerificationService,
    private readonly notice: AlreadyRegisteredNoticeService,
    private readonly challenge: SignupChallengeService,
    private readonly signupGuard: SignupGuardService,
    private readonly quotas: QuotaService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Creates an account plus a first project, so a fresh self-hosted instance is
   * usable immediately. The very first account is always allowed — otherwise a
   * server started with SIGNUP_ENABLED=false could never be bootstrapped.
   *
   * Two shapes of answer, decided by EMAIL_VERIFICATION_REQUIRED:
   *
   *  - **off** (the self-hosted default): the account is created and signed in
   *    at once, and a duplicate address is reported as such. There is no way to
   *    hide it — a response that opens a session cannot also be ambiguous about
   *    whether it created one.
   *  - **on**: the answer is always "we sent you an email", whether the address
   *    was new, already registered, or already registered and verified. The
   *    truth is delivered to the inbox, which is the only party entitled to it.
   */
  async register(input: RegisterRequest, context: SessionContext): Promise<RegisterResponse> {
    const bootstrapping = await this.users.isEmpty();

    if (!this.config.SIGNUP_ENABLED && !bootstrapping) {
      throw new ForbiddenException('Sign-up is disabled on this instance');
    }

    // The very first account is created before anyone could have configured a
    // mail transport or read the difficulty setting; gating it would make a
    // fresh instance impossible to bootstrap.
    if (!bootstrapping) await this.assertSignupAllowed(input, context);

    if (!this.verification.required || bootstrapping) {
      return this.registerAndSignIn(input, context);
    }
    return this.registerWithVerification(input, context);
  }

  private async registerAndSignIn(
    input: RegisterRequest,
    context: SessionContext,
  ): Promise<RegisterResponse> {
    const user = await this.createUser(input, context);
    await this.signupGuard.record(networkOf(context), true);
    this.logger.log(`Account created for ${maskEmail(user.email)}`);
    this.audit.record({ action: 'account.registered', actor: auditActorOf(user, context) });
    return { status: 'active', ...(await this.sessions.start(user, context)) };
  }

  /**
   * The enumeration-safe path. Every branch ends in the same response, and the
   * branches differ only in which message lands in the mailbox.
   */
  private async registerWithVerification(
    input: RegisterRequest,
    context: SessionContext,
  ): Promise<RegisterResponse> {
    const answer: RegisterResponse = { status: 'verification_sent', email: input.email };
    const existing = await this.users.findIdentityByEmail(input.email);

    if (existing !== null) {
      // Deliberately not re-checked against the submitted password: confirming
      // a guess would turn this into the credential oracle the whole branch
      // exists to avoid.
      if (existing.emailVerifiedAt === null) await this.verification.sendVerification(existing);
      else await this.notice.send(existing.email);
      return answer;
    }

    const user = await this.createUser(input, context).catch((error: unknown) => {
      // Lost a race with a concurrent registration for the same address. The
      // observable outcome is the one above, so answer as if we had seen it.
      if (isUniqueViolation(error)) return null;
      throw error;
    });

    if (user === null) return answer;

    await this.verification.sendVerification(user);
    await this.signupGuard.record(networkOf(context), true);
    this.logger.log(`Account created for ${maskEmail(user.email)}, pending verification`);
    this.audit.record({
      action: 'account.registered',
      actor: auditActorOf(user, context),
      detail: { pendingVerification: true },
    });
    return answer;
  }

  /**
   * The gate in front of registration: proof of work, address policy, then
   * per-network volume. Ordered cheapest-first, and every rejection is recorded
   * so a flood is visible in the data rather than only in the logs.
   */
  private async assertSignupAllowed(input: RegisterRequest, context: SessionContext): Promise<void> {
    const network = networkOf(context);

    const solved = this.challenge.verify(input.powSolution, network);
    if (!solved.ok) {
      await this.signupGuard.record(network, false);
      throw new HttpException(
        {
          message:
            solved.reason === 'expired'
              ? 'The sign-up challenge expired. Please try again.'
              : 'This sign-up could not be verified. Please reload the page and try again.',
          details: { challengeRequired: true },
        },
        HttpStatus.BAD_REQUEST,
      );
    }

    if (!this.signupGuard.isEmailAllowed(input.email)) {
      await this.signupGuard.record(network, false);
      throw new BadRequestException(
        'This email provider is not accepted. Use an address you can receive mail at.',
      );
    }

    if (!(await this.signupGuard.isAddressWithinQuota(this.signupGuard.signupNetworkOf(context.ip)))) {
      await this.signupGuard.record(network, false);
      throw new HttpException(
        {
          message:
            'An account already exists from this network. Sign in to it, or contact us if this connection is shared.',
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (!(await this.signupGuard.isNetworkWithinQuota(network))) {
      await this.signupGuard.record(network, false);
      throw new HttpException(
        { message: 'Too many accounts created from this network. Try again later.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  private async createUser(input: RegisterRequest, context: SessionContext): Promise<UserRecord> {
    const passwordHash = await hashPassword(input.password);
    const projectName = input.name === undefined ? 'My project' : `${input.name}'s project`;
    const projectSlug = await uniqueSlug(projectName, (candidate) =>
      this.projects.isSlugTaken(candidate),
    );

    return this.users
      .createWithFirstProject({
        email: input.email,
        passwordHash,
        name: input.name ?? null,
        // Null when quotas are off, which is every self-hosted install and
        // therefore the unlimited plan.
        plan: this.quotas.defaultPlan,
        signupNetwork: this.signupGuard.signupNetworkOf(context.ip),
        projectName,
        projectSlug,
      })
      .catch((error: unknown) => {
        // Unique violation on email. Only reachable when verification is off;
        // the verified path catches this itself and answers ambiguously.
        if (isUniqueViolation(error)) throw new ForbiddenException('Email already registered');
        throw error;
      });
  }
}

function isUniqueViolation(error: unknown): boolean {
  return (error as { code?: string }).code === 'P2002';
}

/** The network prefix a request came from, for the volume rules. */
function networkOf(context: SessionContext): string {
  return SignupChallengeService.networkOf(context.ip);
}
