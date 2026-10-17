import type { BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, freshSessionMiddleware, sessionMiddleware } from 'better-auth/api';
import { setSessionCookie } from 'better-auth/cookies';
import * as z from 'zod';
import type { AuditService } from '../../audit/audit.service';
import { originOfHeaders } from '../better-auth/auth-policy';
import type { LoginLockoutService } from '../lockout/login-lockout.service';
import type { UsersRepository } from '../users/users.repository';
import type { RecoveryCodesService } from './recovery-codes.service';

export interface RecoveryCodesDeps {
  codes: RecoveryCodesService;
  users: UsersRepository;
  lockout: LoginLockoutService;
  audit: AuditService;
  /** Sign-in attempts allowed per minute from one address. */
  attemptsPerMinute: number;
}

/**
 * Recovery codes, for an instance whose only way in is a passkey.
 *
 * Three endpoints and no more: make a set (right after signing in, so a stolen
 * idle session cannot mint codes), say how many are left, and sign in with one.
 */
export function recoveryCodes(deps: RecoveryCodesDeps): BetterAuthPlugin {
  const generate = createAuthEndpoint(
    '/recovery-codes/generate',
    { method: 'POST', use: [freshSessionMiddleware] },
    async (ctx) => {
      const { user } = ctx.context.session;
      const codes = await deps.codes.replaceAll(user.id);
      deps.audit.record({
        action: 'auth.recovery_codes_generated',
        actor: { userId: user.id, email: user.email, ...originOfHeaders(ctx.headers) },
      });
      return ctx.json({ codes });
    },
  );

  const remaining = createAuthEndpoint(
    '/recovery-codes/remaining',
    { method: 'GET', use: [sessionMiddleware] },
    async (ctx) => ctx.json({ remaining: await deps.codes.remaining(ctx.context.session.user.id) }),
  );

  const signIn = createAuthEndpoint(
    '/recovery-codes/sign-in',
    {
      method: 'POST',
      body: z.object({ email: z.string().trim().toLowerCase().max(254), code: z.string().max(64) }),
    },
    async (ctx) => {
      const origin = originOfHeaders(ctx.headers);
      // One answer for every way this can fail: an unknown address, a wrong code,
      // a spent one and a locked account must not be told apart.
      const refuse = (): never => {
        throw new APIError('UNAUTHORIZED', { message: 'Invalid email or recovery code' });
      };

      const user = await deps.users.findByEmail(ctx.body.email);
      if (user === null) {
        deps.audit.record({
          action: 'auth.login_failed',
          actor: { email: ctx.body.email, ...origin },
          detail: { reason: 'unknown_account', method: 'recovery_code' },
        });
        return refuse();
      }
      if (deps.lockout.isLocked(user)) return refuse();

      if (!(await deps.codes.spend(user.id, ctx.body.code))) {
        const failures = await deps.lockout.recordFailure(user);
        deps.audit.record({
          action: 'auth.login_failed',
          actor: { userId: user.id, email: user.email, ...origin },
          detail: { reason: 'bad_recovery_code', consecutiveFailures: failures },
        });
        return refuse();
      }

      const session = await ctx.context.internalAdapter.createSession(user.id);
      const full = await ctx.context.internalAdapter.findUserById(user.id);
      if (!session || !full) return refuse();
      await setSessionCookie(ctx, { session, user: full });

      deps.audit.record({
        action: 'auth.recovery_code_used',
        actor: { userId: user.id, email: user.email, ...origin },
        detail: { remaining: await deps.codes.remaining(user.id) },
      });
      return ctx.json({ user: { id: full.id, email: full.email } });
    },
  );

  return {
    id: 'recovery-codes',
    endpoints: { generateRecoveryCodes: generate, remainingRecoveryCodes: remaining, signInWithRecoveryCode: signIn },
    rateLimit: [
      {
        pathMatcher: (path) => path === '/recovery-codes/sign-in',
        window: 60,
        max: deps.attemptsPerMinute,
      },
    ],
  };
}
