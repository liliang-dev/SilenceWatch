import { Inject, Injectable } from '@nestjs/common';
import type { Provider } from '@nestjs/common';
import { fromNodeHeaders } from 'better-auth/node';
import type { IncomingHttpHeaders } from 'node:http';
import { AuditService } from '../../audit/audit.service';
import { AppConfig, CONFIG } from '../../config/config';
import { PrismaService } from '../../database/prisma.service';
import { LoginLockoutService } from '../lockout/login-lockout.service';
import { RecoveryCodesService } from '../recovery/recovery-codes.service';
import { SignupPolicyService } from '../signup/signup-policy.service';
import { UsersRepository } from '../users/users.repository';
import { createAuth, type Auth } from './auth.factory';

/** Injection token for the Better Auth instance. */
export const AUTH = Symbol('SILENCEWATCH_AUTH');

export const authProvider: Provider = {
  provide: AUTH,
  inject: [
    CONFIG,
    PrismaService,
    UsersRepository,
    SignupPolicyService,
    LoginLockoutService,
    RecoveryCodesService,
    AuditService,
  ],
  useFactory: (
    config: AppConfig,
    prisma: PrismaService,
    users: UsersRepository,
    signup: SignupPolicyService,
    lockout: LoginLockoutService,
    recovery: RecoveryCodesService,
    audit: AuditService,
  ): Auth => createAuth({ config, prisma, users, signup, lockout, recovery, audit }),
};

/** A signed-in browser, as the rest of the server needs to know it. */
export interface ResolvedSession {
  userId: string;
  sessionId: string;
  /** When this sign-in happened: what "recent" is measured from. */
  signedInAt: Date;
  /**
   * Cookies to send back. Using a session for the first time in a day moves its
   * end forward, and the browser only learns the new end from a Set-Cookie: without
   * it the cookie would die on the original date while the session lived on.
   */
  setCookies: string[];
}

/** Turns the cookies of a request into the session behind them, or nothing. */
@Injectable()
export class SessionResolver {
  constructor(@Inject(AUTH) private readonly auth: Auth) {}

  async resolve(headers: IncomingHttpHeaders): Promise<ResolvedSession | null> {
    const { headers: answer, response: found } = await this.auth.api.getSession({
      headers: fromNodeHeaders(headers),
      returnHeaders: true,
    });
    if (found === null || found === undefined) return null;
    return {
      userId: found.user.id,
      sessionId: found.session.id,
      signedInAt: new Date(found.session.createdAt),
      setCookies: answer.getSetCookie(),
    };
  }
}
