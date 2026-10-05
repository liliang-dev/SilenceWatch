import {
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type { LoginRequest, SessionDto } from '@silencewatch/shared';
import { AuditService } from '../../audit/audit.service';
import { hashPassword, needsRehash, verifyPassword } from '../../common/crypto.util';
import { AppConfig, CONFIG } from '../../config/config';
import { maskEmail } from '../masking';
import { auditActorOf, type SessionContext } from '../session-context';
import { toUserDto } from '../users/user.mapper';
import { UsersRepository, type UserRecord } from '../users/users.repository';
import { LoginLockoutService } from './login-lockout.service';
import { SessionsRepository } from './sessions.repository';
import { TokenService } from './token.service';

/**
 * An Argon2 hash of a value nobody knows, used to spend the same CPU time on a
 * login for an unknown address as on a real one. Without it, response time is a
 * user-enumeration oracle.
 */
const DECOY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$MC01Cc6rwnz7pCpaCukhoQ$WMnsUdeVcjMA2JFp6MLwy2OoKlOJU3GaxXTAKhDknDQ';

const REVOKED_SESSION_RETENTION_MS = 7 * 86_400_000;

/**
 * Sessions one account may keep signed in at once. Each browser or device holds
 * one, so this is generous; it exists so that signing in over and over is not a
 * way to make rows, and the oldest are the ones that go.
 */
export const MAX_LIVE_SESSIONS_PER_USER = 20;

/** Signing in and out, and the life of a session in between. */
@Injectable()
export class SessionService {
  private readonly logger = new Logger(SessionService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly users: UsersRepository,
    private readonly sessions: SessionsRepository,
    private readonly tokens: TokenService,
    private readonly lockout: LoginLockoutService,
    private readonly audit: AuditService,
  ) {}

  async login(input: LoginRequest, context: SessionContext): Promise<SessionDto> {
    const user = await this.users.findByEmail(input.email);

    if (user === null) {
      // Same work, same shape of answer as a wrong password.
      await verifyPassword(DECOY_HASH, input.password);
      // Recorded without an actor id, because there is no account: this is the
      // shape of a password-spraying run, which is invisible if only failures
      // against real accounts are kept.
      this.audit.record({
        action: 'auth.login_failed',
        actor: { email: input.email, ip: context.ip, userAgent: context.userAgent },
        detail: { reason: 'unknown_account' },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    if (this.lockout.isLocked(user)) {
      throw new UnauthorizedException(
        'Too many failed attempts. Try again in a few minutes or reset your password.',
      );
    }

    if (!(await verifyPassword(user.passwordHash, input.password))) {
      const failures = await this.lockout.recordFailure(user);
      this.audit.record({
        action: 'auth.login_failed',
        actor: auditActorOf(user, context),
        detail: { reason: 'bad_password', consecutiveFailures: failures },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    // Checked only after the password: an unverified-account message handed out
    // before authentication would tell anyone which addresses are registered.
    if (this.config.EMAIL_VERIFICATION_REQUIRED && user.emailVerifiedAt === null) {
      throw new HttpException(
        {
          message: 'Confirm your email address before signing in. Check your inbox for the link.',
          details: { emailVerificationPending: true },
        },
        HttpStatus.FORBIDDEN,
      );
    }

    // Keep hashes current when the cost parameters are raised.
    const passwordHash = needsRehash(user.passwordHash)
      ? await hashPassword(input.password)
      : undefined;
    await this.users.recordSuccessfulLogin(user.id, passwordHash);

    this.audit.record({ action: 'auth.login', actor: auditActorOf(user, context) });
    return this.start(user, context);
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a new one is
   * issued, so a stolen token is usable at most once. Reuse of an already-revoked
   * token is treated as theft and kills every session of that user.
   */
  async refresh(refreshToken: string, context: SessionContext): Promise<SessionDto> {
    const session = await this.sessions.findByTokenHash(this.tokens.hashRefreshToken(refreshToken));

    if (session === null) throw new UnauthorizedException('Invalid refresh token');

    if (session.revokedAt !== null) {
      this.logger.warn(
        `Revoked refresh token replayed for ${maskEmail(session.user.email)} — revoking all sessions`,
      );
      await this.sessions.revokeAllForUser(session.userId);
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session expired');
    }

    const issued = this.tokens.issueRefreshToken();
    const rotated = await this.sessions.rotate(session.id, {
      userId: session.userId,
      tokenHash: issued.tokenHash,
      expiresAt: issued.expiresAt,
      context,
    });

    return this.describe(session.user, rotated.id, issued.token);
  }

  async logout(refreshToken: string, context: SessionContext): Promise<void> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    // Read before the write, only to name the actor: a trail that records every
    // sign-in and no sign-out cannot answer "was that session still open?".
    const owner = await this.sessions.findOwnerByTokenHash(tokenHash);

    // An unknown or already-revoked token is a silent no-op, so this endpoint
    // reveals nothing.
    const closed = await this.sessions.revokeByTokenHash(tokenHash);

    // Only a session that was actually open is worth an entry; replaying a dead
    // token would otherwise let anyone write to the trail.
    if (closed > 0 && owner !== null) {
      this.audit.record({
        action: 'auth.logout',
        actor: auditActorOf({ id: owner.userId, email: owner.user.email }, context),
      });
    }
  }

  /** Opens a session for a user who has just been authenticated or created. */
  async start(user: UserRecord, context: SessionContext): Promise<SessionDto> {
    const issued = this.tokens.issueRefreshToken();
    const session = await this.sessions.create({
      userId: user.id,
      tokenHash: issued.tokenHash,
      expiresAt: issued.expiresAt,
      context,
    });
    await this.sessions
      .revokeOldestBeyond(user.id, MAX_LIVE_SESSIONS_PER_USER)
      .catch((error: unknown) =>
        this.logger.warn(`Could not trim the live sessions of ${user.id}: ${String(error)}`),
      );
    return this.describe(user, session.id, issued.token);
  }

  /** Verifies the session behind an access token is still live. */
  async isActive(sessionId: string): Promise<boolean> {
    const session = await this.sessions.findStatus(sessionId);
    return session !== null && session.revokedAt === null && session.expiresAt.getTime() > Date.now();
  }

  /** Deletes revoked and expired sessions. Called by the retention job. */
  purgeStale(): Promise<number> {
    return this.sessions.deleteStale(new Date(Date.now() - REVOKED_SESSION_RETENTION_MS));
  }

  private async describe(user: UserRecord, sessionId: string, refreshToken: string): Promise<SessionDto> {
    return {
      user: toUserDto(user),
      accessToken: await this.tokens.signAccessToken({ userId: user.id, sessionId }),
      refreshToken,
      expiresIn: this.tokens.accessTokenTtlSeconds,
    };
  }
}
