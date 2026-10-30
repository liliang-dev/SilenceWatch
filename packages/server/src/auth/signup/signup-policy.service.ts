import { Inject, Injectable, Logger } from '@nestjs/common';
import { uniqueSlug } from '../../common/slug.util';
import { AppConfig, CONFIG } from '../../config/config';
import { ProjectsRepository } from '../../projects/projects.repository';
import { QuotaService } from '../../quotas/quota.service';
import { AuditService } from '../../audit/audit.service';
import { maskEmail } from '../masking';
import { UsersRepository } from '../users/users.repository';
import { networkOf } from './network';
import { SetupLinkService } from './setup-link.service';
import { SignupGuardService } from './signup-guard.service';

/** Why an account was refused, in the words Better Auth's error codes use. */
export type SignupRefusalStatus = 'FORBIDDEN' | 'BAD_REQUEST' | 'TOO_MANY_REQUESTS';

export type SignupDecision =
  | { ok: true; plan: string | null; signupNetwork: string | null }
  | { ok: false; status: SignupRefusalStatus; message: string };

export interface SignupRequest {
  email: string;
  ip: string | null;
  userAgent: string | null;
  /** The token of a setup link, if the request carried one. */
  setupToken: string | null;
}

/**
 * Who may create an account, whichever way they sign in.
 *
 * Every method ends in the same place — Better Auth creating a user row — so the
 * rules live in one hook on that row rather than in each method's endpoint. A new
 * way to sign in therefore cannot become a way around them.
 */
@Injectable()
export class SignupPolicyService {
  private readonly logger = new Logger(SignupPolicyService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly users: UsersRepository,
    private readonly projects: ProjectsRepository,
    private readonly quotas: QuotaService,
    private readonly guard: SignupGuardService,
    private readonly links: SetupLinkService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Decides before the account exists. Two rules, whichever way the person signs in:
   *
   *  - **The administrator's address** (ADMIN_EMAIL) is created with the one-time
   *    link printed in the server log, and in no other way, whether sign-up is open
   *    or not. Nothing else proves that an address typed into a form is its
   *    owner's, and this account sees what no other does. The link is the
   *    operator's own word, so it also skips the abuse rules.
   *  - **Any other address** is created only while SIGNUP_ENABLED is on, and goes
   *    through the abuse rules.
   */
  async decide(request: SignupRequest): Promise<SignupDecision> {
    const email = request.email.toLowerCase();
    const network = networkOf(request.ip);

    if (email === this.config.ADMIN_EMAIL) {
      if (await this.links.accepts(request.setupToken, email)) {
        return {
          ok: true,
          plan: this.quotas.defaultPlan,
          signupNetwork: this.guard.signupNetworkOf(request.ip),
        };
      }
      return {
        ok: false,
        status: 'FORBIDDEN',
        message: 'This account can only be created with the setup link printed in the server log.',
      };
    }

    if (!this.config.SIGNUP_ENABLED) {
      return { ok: false, status: 'FORBIDDEN', message: 'Sign-up is disabled on this instance' };
    }

    const refusal = await this.checkAbuseRules(email, request.ip, network);
    if (refusal !== null) return refusal;

    return {
      ok: true,
      plan: this.quotas.defaultPlan,
      signupNetwork: this.guard.signupNetworkOf(request.ip),
    };
  }

  /** After the account exists: its first project, the sign-up record, the audit entry. */
  async created(
    user: { id: string; email: string; name?: string | null },
    request: Pick<SignupRequest, 'ip' | 'userAgent' | 'setupToken'>,
  ): Promise<void> {
    // Spent whether or not it was the reason this account was allowed: a token
    // that was never valid has nothing to spend, and one that was must not be
    // usable twice.
    if (request.setupToken !== null) await this.links.spend(request.setupToken);

    await this.guard.record(networkOf(request.ip), true);
    this.logger.log(`Account created for ${maskEmail(user.email)}`);
    this.audit.record({
      action: 'account.registered',
      actor: {
        userId: user.id,
        email: user.email,
        ip: request.ip,
        userAgent: request.userAgent,
      },
    });

    // Never throws: the account exists, and a missing first project is something
    // the person can fix in one click, where failing here would leave an account
    // that cannot be created again under the same address.
    await this.createFirstProject(user).catch((error: unknown) =>
      this.logger.error(`Could not create the first project of ${user.id}: ${String(error)}`),
    );
  }

  private async checkAbuseRules(
    email: string,
    ip: string | null,
    network: string,
  ): Promise<SignupDecision | null> {
    const refuse = async (
      status: SignupRefusalStatus,
      message: string,
    ): Promise<SignupDecision> => {
      await this.guard.record(network, false);
      return { ok: false, status, message };
    };

    if (!this.guard.isEmailAllowed(email)) {
      return refuse(
        'BAD_REQUEST',
        'This email provider is not accepted. Use an address you can receive mail at.',
      );
    }
    if (!(await this.guard.isAddressWithinQuota(this.guard.signupNetworkOf(ip)))) {
      return refuse(
        'TOO_MANY_REQUESTS',
        'An account already exists from this network. Sign in to it, or contact us if this connection is shared.',
      );
    }
    if (!(await this.guard.isNetworkWithinQuota(network))) {
      return refuse(
        'TOO_MANY_REQUESTS',
        'Too many accounts created from this network. Try again later.',
      );
    }
    return null;
  }

  private async createFirstProject(user: { id: string; name?: string | null }): Promise<void> {
    const name = user.name === undefined || user.name === null || user.name.trim() === ''
      ? 'My project'
      : `${user.name.trim()}'s project`;
    const slug = await uniqueSlug(name, (candidate) => this.projects.isSlugTaken(candidate));
    await this.users.createFirstProject({ userId: user.id, name, slug });
  }
}
