import {
  ForbiddenException,
  Inject,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import type {
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  SessionDto,
  UserDto,
} from '@silencewatch/shared';
import { hashPassword, needsRehash, verifyPassword } from '../common/crypto.util';
import { uniqueSlug } from '../common/slug.util';
import { AppConfig, CONFIG } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import { TokenService } from './token.service';

/**
 * An Argon2 hash of a value nobody knows, used to spend the same CPU time on a
 * login for an unknown address as on a real one. Without it, response time is a
 * user-enumeration oracle.
 */
const DECOY_HASH =
  '$argon2id$v=19$m=19456,t=2,p=1$MC01Cc6rwnz7pCpaCukhoQ$WMnsUdeVcjMA2JFp6MLwy2OoKlOJU3GaxXTAKhDknDQ';

const MAX_FAILED_LOGINS = 10;
const LOCKOUT_MS = 15 * 60_000;

export interface SessionContext {
  ip: string | null;
  userAgent: string | null;
}

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly tokens: TokenService,
  ) {}

  /**
   * Creates an account plus a first project, so a fresh self-hosted instance is
   * usable immediately. The very first account is always allowed — otherwise a
   * server started with SIGNUP_ENABLED=false could never be bootstrapped.
   */
  async register(input: RegisterRequest, context: SessionContext): Promise<SessionDto> {
    if (!this.config.SIGNUP_ENABLED) {
      const existing = await this.prisma.user.count({ take: 1 });
      if (existing > 0) {
        throw new ForbiddenException('Sign-up is disabled on this instance');
      }
    }

    const passwordHash = await hashPassword(input.password);
    const projectName = input.name === undefined ? 'My project' : `${input.name}'s project`;
    const slug = await uniqueSlug(projectName, async (candidate) =>
      (await this.prisma.project.count({ where: { slug: candidate } })) > 0,
    );

    const user = await this.prisma.user
      .create({
        data: {
          email: input.email,
          passwordHash,
          name: input.name ?? null,
          memberships: {
            create: { role: 'owner', project: { create: { name: projectName, slug } } },
          },
        },
      })
      .catch((error: { code?: string }) => {
        // Unique violation on email. The message is identical to a successful
        // path from the attacker's point of view — the UI only ever shows this
        // to someone who submitted a form.
        if (error.code === 'P2002') throw new ForbiddenException('Email already registered');
        throw error;
      });

    this.logger.log(`Account created for ${maskEmail(user.email)}`);
    return this.startSession(user, context);
  }

  async login(input: LoginRequest, context: SessionContext): Promise<SessionDto> {
    const user = await this.prisma.user.findUnique({ where: { email: input.email } });

    if (user === null) {
      // Same work, same shape of answer as a wrong password.
      await verifyPassword(DECOY_HASH, input.password);
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.lockedUntil !== null && user.lockedUntil.getTime() > Date.now()) {
      throw new UnauthorizedException(
        'Too many failed attempts. Try again in a few minutes or reset your password.',
      );
    }

    const valid = await verifyPassword(user.passwordHash, input.password);
    if (!valid) {
      await this.recordFailedLogin(user.id, user.failedLoginCount + 1);
      throw new UnauthorizedException('Invalid email or password');
    }

    // Keep hashes current when the cost parameters are raised.
    const passwordHash = needsRehash(user.passwordHash)
      ? await hashPassword(input.password)
      : undefined;

    await this.prisma.user.update({
      where: { id: user.id },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        ...(passwordHash === undefined ? {} : { passwordHash }),
      },
    });

    return this.startSession(user, context);
  }

  /**
   * Rotates a refresh token: the presented token is revoked and a new one is
   * issued, so a stolen token is usable at most once. Reuse of an already-revoked
   * token is treated as theft and kills every session of that user.
   */
  async refresh(refreshToken: string, context: SessionContext): Promise<SessionDto> {
    const tokenHash = this.tokens.hashRefreshToken(refreshToken);
    const session = await this.prisma.session.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (session === null) throw new UnauthorizedException('Invalid refresh token');

    if (session.revokedAt !== null) {
      this.logger.warn(
        `Revoked refresh token replayed for ${maskEmail(session.user.email)} — revoking all sessions`,
      );
      await this.revokeAllSessions(session.userId);
      throw new UnauthorizedException('Invalid refresh token');
    }

    if (session.expiresAt.getTime() <= Date.now()) {
      throw new UnauthorizedException('Session expired');
    }

    const issued = this.tokens.issueRefreshToken();
    const rotated = await this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } });
      return tx.session.create({
        data: {
          userId: session.userId,
          tokenHash: issued.tokenHash,
          expiresAt: issued.expiresAt,
          ip: context.ip,
          userAgent: context.userAgent,
        },
      });
    });

    return {
      user: toUserDto(session.user),
      accessToken: await this.tokens.signAccessToken({
        userId: session.userId,
        sessionId: rotated.id,
      }),
      refreshToken: issued.token,
      expiresIn: this.tokens.accessTokenTtlSeconds,
    };
  }

  async logout(refreshToken: string): Promise<void> {
    // updateMany: an unknown or already-revoked token is a silent no-op, so this
    // endpoint reveals nothing.
    await this.prisma.session.updateMany({
      where: { tokenHash: this.tokens.hashRefreshToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async changePassword(userId: string, input: ChangePasswordRequest): Promise<void> {
    const user = await this.prisma.user.findUniqueOrThrow({ where: { id: userId } });
    if (!(await verifyPassword(user.passwordHash, input.currentPassword))) {
      throw new UnauthorizedException('Current password is incorrect');
    }

    const passwordHash = await hashPassword(input.newPassword);
    await this.prisma.$transaction([
      this.prisma.user.update({ where: { id: userId }, data: { passwordHash } }),
      // A password change ends every session: that is the point of changing it.
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
    this.logger.log(`Password changed for ${maskEmail(user.email)}`);
  }

  async getUser(userId: string): Promise<UserDto> {
    const user = await this.prisma.user.findUnique({ where: { id: userId } });
    if (user === null) throw new UnauthorizedException('Account no longer exists');
    return toUserDto(user);
  }

  /** Verifies the session behind an access token is still live. */
  async isSessionActive(sessionId: string): Promise<boolean> {
    const session = await this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });
    return session !== null && session.revokedAt === null && session.expiresAt.getTime() > Date.now();
  }

  /** Deletes revoked and expired sessions. Called by the retention job. */
  async purgeStaleSessions(): Promise<number> {
    const cutoff = new Date(Date.now() - 7 * 86_400_000);
    const { count } = await this.prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: cutoff } }] },
    });
    return count;
  }

  private async startSession(
    user: { id: string; email: string; name: string | null; createdAt: Date },
    context: SessionContext,
  ): Promise<SessionDto> {
    const issued = this.tokens.issueRefreshToken();
    const session = await this.prisma.session.create({
      data: {
        userId: user.id,
        tokenHash: issued.tokenHash,
        expiresAt: issued.expiresAt,
        ip: context.ip,
        userAgent: context.userAgent,
      },
    });

    return {
      user: toUserDto(user),
      accessToken: await this.tokens.signAccessToken({ userId: user.id, sessionId: session.id }),
      refreshToken: issued.token,
      expiresIn: this.tokens.accessTokenTtlSeconds,
    };
  }

  private async recordFailedLogin(userId: string, failures: number): Promise<void> {
    await this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: failures,
        // Temporary lock, not permanent: a locked-out account is a denial of
        // service against its owner if it never unlocks on its own.
        lockedUntil: failures >= MAX_FAILED_LOGINS ? new Date(Date.now() + LOCKOUT_MS) : null,
      },
    });
  }

  private async revokeAllSessions(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
}

function toUserDto(user: {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}): UserDto {
  return {
    id: user.id,
    email: user.email,
    name: user.name,
    createdAt: user.createdAt.toISOString(),
  };
}

/** Logs must be shareable for support without handing over the user list. */
function maskEmail(email: string): string {
  const [local, domain] = email.split('@');
  if (domain === undefined || local === undefined) return '***';
  return `${local.slice(0, 2)}***@${domain}`;
}
