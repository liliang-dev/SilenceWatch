import { getAuthenticatorName, passkey, type PasskeyOptions } from '@better-auth/passkey';
import { prismaAdapter } from '@better-auth/prisma-adapter';
import { emailSchema, LIMITS } from '@silencewatch/shared';
import { betterAuth, type BetterAuthOptions, type BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthMiddleware, getSessionFromCtx } from 'better-auth/api';
import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { AuditService } from '../../audit/audit.service';
import { randomToken } from '../../common/crypto.util';
import type { AppConfig } from '../../config/config';
import type { PrismaService } from '../../database/prisma.service';
import type { LoginLockoutService } from '../lockout/login-lockout.service';
import { recoveryCodes } from '../recovery/recovery-codes.plugin';
import type { RecoveryCodesService } from '../recovery/recovery-codes.service';
import type { SignupPolicyService } from '../signup/signup-policy.service';
import type { UsersRepository } from '../users/users.repository';
import {
  AUTH_BASE_PATH,
  CLIENT_IP_HEADER,
  FRESH_SESSION_SECONDS,
  MAX_LIVE_SESSIONS_PER_USER,
  SESSION_TTL_SECONDS,
  SESSION_UPDATE_AGE_SECONDS,
  originOfHeaders,
  setupTokenOfHeaders,
} from './auth-policy';

export interface AuthDeps {
  config: AppConfig;
  prisma: PrismaService;
  users: UsersRepository;
  signup: SignupPolicyService;
  lockout: LoginLockoutService;
  recovery: RecoveryCodesService;
  audit: AuditService;
}

export type Auth = ReturnType<typeof betterAuth>;

const logger = new Logger('BetterAuth');

/** What a person is told when sign-up cannot go ahead for this address. */
const ADDRESS_UNAVAILABLE = 'This account cannot be created. Sign in if you already have one.';

/** The answer to every failed password sign-in, whatever the reason. */
const invalidCredentials = (): APIError =>
  new APIError('UNAUTHORIZED', {
    message: 'Invalid email or password',
    code: 'INVALID_EMAIL_OR_PASSWORD',
  });

/** Every origin that may sign in: the one the UI is served from, and the operator's additions. */
export const trustedOriginsOf = (config: AppConfig): string[] => [
  config.baseUrl,
  ...config.AUTH_TRUSTED_ORIGINS,
];

/**
 * Builds the one Better Auth instance of the process, with exactly the methods
 * AUTH_MODE names. A method that is not named is not configured and not mounted:
 * there is no endpoint to switch on by mistake, and none to probe.
 */
export function createAuth(
  deps: AuthDeps,
  /** For tests, to stand in for the providers' servers. Never passed by the application. */
  adjust: (options: BetterAuthOptions) => BetterAuthOptions = (options) => options,
): Auth {
  const { config } = deps;
  const mode = config.AUTH_MODE;
  const origins = trustedOriginsOf(config);
  const secure = config.baseUrl.startsWith('https://');
  const strict = {
    window: 60,
    max: config.AUTH_RATE_LIMIT_PER_MINUTE,
  };

  const plugins: BetterAuthPlugin[] = [];
  if (mode !== 'password') plugins.push(passkeyPlugin(deps, origins));
  if (mode === 'passkey') {
    plugins.push(
      recoveryCodes({
        codes: deps.recovery,
        users: deps.users,
        lockout: deps.lockout,
        audit: deps.audit,
        attemptsPerMinute: config.AUTH_RATE_LIMIT_PER_MINUTE,
      }),
    );
  }

  const options: BetterAuthOptions = {
    appName: config.AUTH_RP_NAME,
    baseURL: config.baseUrl,
    basePath: AUTH_BASE_PATH,
    secret: config.SECRET_KEY,
    trustedOrigins: origins,
    database: prismaAdapter(deps.prisma, { provider: 'postgresql' }),
    // Nothing is reported to Better Auth about this deployment.
    telemetry: { enabled: false },
    // Its failures go to our log at our log level. Its warnings do not: a wrong
    // password is one, it is expected many times a day, and the audit trail
    // already records each.
    logger: {
      level: 'error',
      log: (level, message, ...details) => {
        const text = [message, ...details.map(String)].join(' ');
        if (level === 'error') logger.error(text);
        else logger.warn(text);
      },
    },

    emailAndPassword: {
      enabled: mode === 'password',
      // Length over composition rules (NIST SP 800-63B); the ceiling caps the work
      // a request can make the hasher do.
      minPasswordLength: LIMITS.passwordMin,
      maxPasswordLength: LIMITS.passwordMax,
      autoSignIn: true,
    },

    socialProviders:
      mode === 'full'
        ? {
            google: {
              clientId: config.GOOGLE_CLIENT_ID as string,
              clientSecret: config.GOOGLE_CLIENT_SECRET as string,
              prompt: 'select_account',
              // The redirect is the only way in: a token handed straight to the
              // API is a second door nobody asked for.
              disableIdTokenSignIn: true,
              // A picture is not something this application has any use for.
              mapProfileToUser: () => ({ image: undefined }),
            },
            microsoft: {
              clientId: config.MICROSOFT_CLIENT_ID as string,
              clientSecret: config.MICROSOFT_CLIENT_SECRET as string,
              tenantId: config.MICROSOFT_TENANT_ID,
              prompt: 'select_account',
              disableIdTokenSignIn: true,
              // Otherwise a photo is fetched from Microsoft Graph and stored whole.
              disableProfilePhoto: true,
              mapProfileToUser: () => ({ image: undefined }),
            },
          }
        : {},

    account: {
      accountLinking: {
        enabled: true,
        // Google vouches for the address it signs in, so an account that proves
        // the same address with Google is the same account. Microsoft does not:
        // the address in its token can be set by whoever runs a tenant, and
        // trusting it would let them sign in as anyone. A Microsoft login joins
        // an existing account only if that account already has it.
        trustedProviders: ['google'],
        allowDifferentEmails: false,
      },
      // Nothing here ever calls Google or Microsoft again, so nothing they hand over
      // is worth keeping: see the account hook below.
      updateAccountOnSignIn: false,
    },

    user: {
      // Trusting Google with an address means trusting what it says about it. An
      // identity Google has not verified the address of is turned away, so
      // "Google" can never mean "whatever was typed into a Google profile".
      validateUserInfo: ({ user, source }) => {
        if (source.oauth?.providerId === 'google' && user.emailVerified !== true) {
          return {
            error: 'email_not_verified',
            errorDescription: 'Google has not verified this address.',
          };
        }
      },
      additionalFields: {
        // Set by the sign-up rules only; never read from a request.
        plan: { type: 'string', required: false, input: false },
        signupNetwork: { type: 'string', required: false, input: false },
      },
    },

    session: {
      expiresIn: SESSION_TTL_SECONDS,
      updateAge: SESSION_UPDATE_AGE_SECONDS,
      freshAge: FRESH_SESSION_SECONDS,
    },

    advanced: {
      cookiePrefix: 'sw',
      useSecureCookies: secure,
      defaultCookieAttributes: { httpOnly: true, sameSite: 'lax', secure, path: '/' },
      database: { generateId: 'uuid' },
      // Read from a header the server writes itself: see CLIENT_IP_HEADER.
      ipAddress: { ipAddressHeaders: [CLIENT_IP_HEADER] },
    },

    rateLimit: {
      // On in every environment: the default is off outside production, which is
      // exactly where nobody notices that it is missing.
      enabled: true,
      window: 60,
      max: config.API_RATE_LIMIT_PER_MINUTE,
      customRules: {
        '/sign-in/*': strict,
        '/sign-up/*': strict,
        '/change-password': strict,
        '/callback/*': strict,
        '/passkey/generate-register-options': strict,
        '/passkey/verify-registration': strict,
        '/passkey/verify-authentication': strict,
        // Read on every page load by the web UI, and by the server on its own account.
        '/get-session': false,
      },
    },

    // Where a failed provider login lands: the login page, which says it plainly.
    onAPIError: { errorURL: '/login' },

    databaseHooks: {
      user: {
        create: {
          before: async (user, context) => {
            const origin = originOfHeaders(context?.headers ?? context?.request?.headers);
            const decision = await deps.signup.decide({
              email: user.email,
              ...origin,
              setupToken: setupTokenOfHeaders(context?.headers ?? context?.request?.headers),
            });
            if (!decision.ok) throw new APIError(decision.status, { message: decision.message });
            return {
              data: {
                ...user,
                email: user.email.toLowerCase(),
                plan: decision.plan,
                signupNetwork: decision.signupNetwork,
              },
            };
          },
          after: async (user, context) => {
            const headers = context?.headers ?? context?.request?.headers;
            const setupToken = setupTokenOfHeaders(headers);
            await deps.signup.created(user, { ...originOfHeaders(headers), setupToken });
          },
        },
      },
      account: {
        create: {
          // The identity of the account, and no token: a copy of the database holds
          // nothing that could be used at a provider.
          before: (account) =>
            Promise.resolve({
              data: {
                ...account,
                accessToken: null,
                refreshToken: null,
                idToken: null,
                accessTokenExpiresAt: null,
                refreshTokenExpiresAt: null,
              },
            }),
        },
      },
      session: {
        create: {
          after: async (session) => {
            await deps.users.recordSuccessfulLogin(session.userId);
            await deps.users.trimSessions(session.userId, MAX_LIVE_SESSIONS_PER_USER);
          },
        },
      },
    },

    hooks: {
      before: createAuthMiddleware(async (ctx) => {
        if (ctx.path === '/sign-in/email') {
          const user = await deps.users.findByEmail(String(ctx.body?.email ?? '').toLowerCase());
          if (user !== null && deps.lockout.isLocked(user)) {
            // Spend the time a real check would, so a locked account cannot be
            // told from one that merely got the password wrong.
            await ctx.context.password.hash(randomToken(16));
            throw invalidCredentials();
          }
        }
        // Adding or removing a passkey changes who can get in. Better Auth asks for
        // a recent sign-in only when passkeys are the sole way to register, and the
        // question is the same whichever way it was asked.
        if (RECENT_SIGN_IN_PATHS.has(ctx.path)) {
          const session = await getSessionFromCtx(ctx).catch(() => null);
          if (session && Date.now() - new Date(session.session.createdAt).getTime() >= FRESH_SESSION_SECONDS * 1000) {
            throw new APIError('FORBIDDEN', {
              message: 'Sign in again to do this.',
              code: 'SESSION_NOT_FRESH',
            });
          }
        }
        if (ctx.path === '/sign-out') {
          const session = await getSessionFromCtx(ctx).catch(() => null);
          if (session !== null && session !== undefined) {
            deps.audit.record({
              action: 'auth.logout',
              actor: {
                userId: session.user.id,
                email: session.user.email,
                ...originOfHeaders(ctx.headers),
              },
            });
          }
        }
      }),

      after: createAuthMiddleware(async (ctx) => {
        const origin = originOfHeaders(ctx.headers);
        const failed = ctx.context.returned instanceof APIError;

        if (ctx.path === '/sign-in/email') {
          const email = String(ctx.body?.email ?? '').toLowerCase();
          if (failed) {
            const user = await deps.users.findByEmail(email);
            const failures = user === null ? 0 : await deps.lockout.recordFailure(user);
            deps.audit.record({
              action: 'auth.login_failed',
              actor: { userId: user?.id ?? null, email, ...origin },
              detail:
                user === null
                  ? { reason: 'unknown_account' }
                  : { reason: 'bad_password', consecutiveFailures: failures },
            });
          }
        }

        const session = ctx.context.newSession;
        if (!failed && session && isSignIn(ctx.path)) {
          deps.audit.record({
            action: 'auth.login',
            actor: { userId: session.user.id, email: session.user.email, ...origin },
            detail: { method: methodOf(ctx.path) },
          });
        }

        if (!failed && ctx.path === '/change-password') {
          const current = await getSessionFromCtx(ctx).catch(() => null);
          const user = ctx.context.newSession?.user ?? current?.user;
          if (user) {
            deps.audit.record({
              action: 'auth.password_changed',
              actor: { userId: user.id, email: user.email, ...origin },
            });
          }
        }

        if (!failed && ctx.path === '/passkey/verify-registration') {
          const current = await getSessionFromCtx(ctx).catch(() => null);
          const user = ctx.context.newSession?.user ?? current?.user;
          if (user) {
            deps.audit.record({
              action: 'passkey.added',
              actor: { userId: user.id, email: user.email, ...origin },
            });
          }
        }

        if (!failed && ctx.path === '/passkey/delete-passkey') {
          const current = await getSessionFromCtx(ctx).catch(() => null);
          if (current) {
            deps.audit.record({
              action: 'passkey.removed',
              actor: { userId: current.user.id, email: current.user.email, ...origin },
            });
          }
        }
      }),
    },

    plugins,
  };

  return betterAuth(adjust(options));
}

const RECENT_SIGN_IN_PATHS: ReadonlySet<string> = new Set([
  '/passkey/generate-register-options',
  '/passkey/verify-registration',
  '/passkey/delete-passkey',
]);

const isSignIn = (path: string): boolean =>
  path === '/sign-in/email' ||
  path === '/sign-up/email' ||
  path === '/passkey/verify-authentication' ||
  path.startsWith('/callback/') ||
  path === '/recovery-codes/sign-in';

const methodOf = (path: string): string =>
  path.startsWith('/callback/') ? path.slice('/callback/'.length) : path.startsWith('/passkey') ? 'passkey' : 'password';

/**
 * Passkeys. Where they are the only way in (AUTH_MODE=passkey) an account is
 * created by registering its first passkey; where they sit beside a provider
 * (AUTH_MODE=full) a passkey is only ever added to an account that already exists,
 * by someone signed in to it.
 *
 * The second is not a limitation but the point: an address typed into a form has
 * been proven by nothing, and a provider login that later arrives with the same
 * address must not land in an account somebody else made first.
 */
function passkeyPlugin(deps: AuthDeps, origins: string[]): BetterAuthPlugin {
  const { config } = deps;
  return passkey({
    rpID: config.AUTH_RP_ID ?? new URL(config.baseUrl).hostname,
    rpName: config.AUTH_RP_NAME,
    origin: origins,
    // A credential kept by the authenticator is what lets the browser offer it
    // without being told which account, and a verified user is what makes a
    // passkey more than a possession factor.
    authenticatorSelection: { residentKey: 'required', userVerification: 'required' },
    ...(config.AUTH_MODE === 'passkey' ? { registration: passkeyFirstRegistration(deps) } : {}),
  });
}

/**
 * Passkey-first: an account is created by registering its first passkey, with
 * nothing but an address typed in beforehand.
 *
 * The ceremony runs before the account exists. The address travels as the
 * plugin's `context`, which the server stores with the challenge, so what is
 * checked at the end is what was asked at the start; and the account is created
 * only when the browser has produced a credential that verifies.
 */
function passkeyFirstRegistration(deps: AuthDeps): NonNullable<PasskeyOptions['registration']> {
  return {
    requireSession: false,
    resolveUser: async ({ ctx, context }) => {
      const email = emailSchema.safeParse(context);
      if (!email.success) throw new APIError('BAD_REQUEST', { message: 'Enter a valid email address.' });

      const existing = await deps.users.findByEmail(email.data);
      // An address that already has a way in is not available. One that has
      // none was left by a registration that stopped halfway; finishing it is
      // what its owner would want, and no more than anyone could have done.
      if (existing !== null && (await deps.users.hasCredential(existing.id))) {
        throw new APIError('BAD_REQUEST', { message: ADDRESS_UNAVAILABLE });
      }

      // Fail before the browser asks for a fingerprint, not after.
      const decision = await deps.signup.decide({
        email: email.data,
        ...originOfHeaders(ctx.headers),
        setupToken: setupTokenOfHeaders(ctx.headers),
      });
      if (!decision.ok) throw new APIError(decision.status, { message: decision.message });

      return { id: existing?.id ?? randomUUID(), name: email.data, displayName: email.data };
    },
    afterVerification: async ({ ctx, verification, context }) => {
      const name = getAuthenticatorName(verification.registrationInfo?.aaguid);
      // No address means the passkey is being added to the account of someone who
      // is signed in, which needs nothing more than a name.
      if (typeof context !== 'string') return { name };

      const email = emailSchema.parse(context);
      const existing = await deps.users.findByEmail(email);
      if (existing !== null && (await deps.users.hasCredential(existing.id))) {
        throw new APIError('BAD_REQUEST', { message: ADDRESS_UNAVAILABLE });
      }
      const user =
        existing ??
        (await ctx.context.internalAdapter.createUser(
          { email, name: '', emailVerified: false },
          { method: 'passkey' },
        ));
      return { userId: user.id, name };
    },
  };
}
