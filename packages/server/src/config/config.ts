import { z } from 'zod';

/**
 * Every knob of the server is an environment variable — self-hosting must never
 * require editing a file inside the image. The process refuses to boot on an
 * invalid or unsafe configuration rather than starting in a degraded state.
 */

const booleanish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

const port = z.coerce.number().int().min(1).max(65_535);
const positiveInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

/**
 * Optional, and empty means absent.
 *
 * `.optional()` alone distinguishes unset from empty, but nothing that starts
 * this server does. Compose and Swarm both turn `KEY: ${KEY:-}` into `KEY=""`,
 * and a shell exporting a `.env` does the same for a variable listed with no
 * value — so a setting left blank on purpose arrived as a present, invalid one
 * and stopped the process. `SMTP_URL=` in an .env file means "I am not using
 * SMTP", not "SMTP is the empty string".
 */
const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());

const envSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

    HOST: z.string().min(1).default('0.0.0.0'),
    PORT: port.default(8080),
    /** Public origin, used in ping URLs and alert links. */
    BASE_URL: z.string().url().default('http://localhost:8080'),
    /** Extra browser origins allowed to call the API (the web UI is same-origin). */
    CORS_ORIGINS: csv.default(''),
    /**
     * Set when running behind a reverse proxy so client IPs come from
     * X-Forwarded-For. Leave false when directly exposed: a spoofed header
     * would otherwise defeat per-IP rate limiting.
     */
    TRUST_PROXY: z.union([booleanish, z.string().min(1)]).default('false'),
    /** Serve the compiled Angular UI from the same process. */
    SERVE_WEB: booleanish.default('true'),

    DATABASE_URL: z.string().min(1),
    /** Prisma connection ceiling (CRUD, API, detection). */
    DATABASE_POOL_MAX: positiveInt(1, 200).default(10),
    /** Dedicated pool for the ingestion path: never starved by CRUD traffic. */
    INGEST_POOL_MAX: positiveInt(1, 200).default(10),

    /**
     * Root secret. All other keys are derived from it with HKDF, so rotating it
     * invalidates sessions and signed payloads at once.
     */
    SECRET_KEY: z.string().min(32, 'SECRET_KEY must be at least 32 characters'),
    ACCESS_TOKEN_TTL_SECONDS: positiveInt(60, 86_400).default(900),
    REFRESH_TOKEN_TTL_DAYS: positiveInt(1, 365).default(30),
    /** When false only the very first account can be created (bootstrap). */
    SIGNUP_ENABLED: booleanish.default('true'),

    /* --- sign-up integrity -------------------------------------------------
     * All of it is off by default. A self-hosted instance behind a VPN has no
     * bot problem, and making its operator solve one would be the kind of
     * crippling this project promised not to do. The hosted deployment turns
     * these on; the code is identical.
     */

    /**
     * Require a proven email address before an account can sign in. Turning it
     * on also makes registration enumeration-safe: the response stops depending
     * on whether the address already exists.
     */
    EMAIL_VERIFICATION_REQUIRED: booleanish.default('false'),
    EMAIL_VERIFICATION_TTL_HOURS: positiveInt(1, 168).default(24),
    /**
     * Lifetime of a password reset link. Shorter than a verification link on
     * purpose: it is a credential that replaces a password, and a stale one
     * sitting in an inbox is a longer window than a stale confirmation.
     */
    PASSWORD_RESET_TTL_MINUTES: positiveInt(5, 1_440).default(60),
    /** Unverified accounts older than this are deleted. 0 disables the reaper. */
    UNVERIFIED_ACCOUNT_TTL_DAYS: positiveInt(0, 365).default(7),

    /**
     * Leading zero bits a client must find before its sign-up is accepted.
     * 0 disables the challenge. ~18 costs a browser well under a second and a
     * mass-registration script its entire margin; see docs/abuse-prevention.md.
     */
    SIGNUP_POW_DIFFICULTY: positiveInt(0, 26).default(0),
    /** How long an issued challenge stays valid. Short: it is single-use. */
    SIGNUP_POW_TTL_SECONDS: positiveInt(30, 3_600).default(600),

    /** Reject addresses at known disposable-mailbox domains. */
    SIGNUP_BLOCK_DISPOSABLE_EMAIL: booleanish.default('false'),
    /** Extra domains to reject, comma-separated. */
    SIGNUP_BLOCKED_EMAIL_DOMAINS: csv.default(''),

    /**
     * Accounts creatable per hour from one network prefix (IPv4 /24, IPv6 /48),
     * counted in PostgreSQL so the rule survives a restart. 0 disables it.
     */
    SIGNUP_MAX_PER_NETWORK_PER_HOUR: positiveInt(0, 10_000).default(0),

    /* --- plans and quotas --------------------------------------------------
     * Off by default, and that is the whole point: a self-hosted SilenceWatch
     * is never the crippled edition. With QUOTAS_ENABLED unset, `user.plan`
     * stays null, every limit is unlimited, and none of this code does
     * anything.
     *
     * Note what is *not* here: no prices, no payment state, no subscription
     * lifecycle. The hosted deployment's billing system decides which plan an
     * account is on and writes the name; this side only knows what a name is
     * allowed to do. That is what keeps the commercial model out of a repo
     * licensed to be run by anyone.
     */
    QUOTAS_ENABLED: booleanish.default('false'),
    /** Plan assigned to a new account when quotas are on. */
    DEFAULT_PLAN: z.string().min(1).max(40).default('free'),
    /**
     * Limits per plan, as JSON. Omitted keys mean unlimited. Example:
     *
     *   {"free":{"checks":10,"projects":3,"channelsPerProject":3,"retentionDays":7},
     *    "pro":{"checks":100,"projects":20,"retentionDays":90}}
     */
    PLAN_LIMITS: z.string().default('{}'),
    /**
     * How often accounts are reconciled with their plan. A downgrade written by
     * the billing system takes effect within one of these.
     */
    QUOTA_RECONCILE_INTERVAL_MS: positiveInt(30_000, 86_400_000).default(300_000),

    PING_RATE_LIMIT_PER_MINUTE: positiveInt(1, 100_000).default(120),
    PING_BODY_MAX_BYTES: positiveInt(0, 100_000).default(10_000),
    AUTH_RATE_LIMIT_PER_MINUTE: positiveInt(1, 10_000).default(10),
    API_RATE_LIMIT_PER_MINUTE: positiveInt(1, 1_000_000).default(600),

    DETECTION_INTERVAL_MS: positiveInt(1_000, 600_000).default(10_000),
    DETECTION_BATCH_SIZE: positiveInt(1, 10_000).default(200),
    DETECTION_ENABLED: booleanish.default('true'),

    NOTIFICATION_INTERVAL_MS: positiveInt(500, 600_000).default(3_000),
    NOTIFICATION_BATCH_SIZE: positiveInt(1, 1_000).default(50),
    NOTIFICATION_MAX_ATTEMPTS: positiveInt(1, 20).default(6),
    NOTIFICATION_TIMEOUT_MS: positiveInt(500, 60_000).default(10_000),
    /**
     * Allow alerts to reach private/loopback addresses. Off by default (SSRF
     * protection); self-hosters targeting an internal Mattermost turn it on.
     */
    ALLOW_PRIVATE_NOTIFICATION_TARGETS: booleanish.default('false'),

    EMAIL_PROVIDER: z.enum(['console', 'smtp', 'postmark', 'brevo']).default('console'),
    EMAIL_FROM: z.string().email().default('alerts@silencewatch.local'),
    EMAIL_FROM_NAME: z.string().min(1).max(80).default('SilenceWatch'),
    SMTP_URL: optional(z.string().min(1)),
    POSTMARK_TOKEN: optional(z.string().min(1)),
    POSTMARK_MESSAGE_STREAM: z.string().min(1).default('outbound'),
    BREVO_API_KEY: optional(z.string().min(1)),

    /** Default ping retention; per-project overrides win. */
    PING_RETENTION_DAYS: positiveInt(1, 3_650).default(90),
    PURGE_CRON: z.string().min(1).default('17 3 * * *'),
    /**
     * How long the audit trail is kept. Far longer than ping history on
     * purpose: "who revoked that key in March" is a question asked in
     * September, and a trail that has already been purged answers nothing.
     */
    AUDIT_RETENTION_DAYS: positiveInt(1, 3_650).default(365),

    /**
     * SilenceWatch cannot watch itself: point this at a third-party dead man's
     * switch that the detection loop pings after every successful tick.
     */
    OUTBOUND_HEARTBEAT_URL: optional(z.string().url()),
    OUTBOUND_HEARTBEAT_INTERVAL_MS: positiveInt(10_000, 3_600_000).default(60_000),
  })
  .superRefine((env, ctx) => {
    if (env.EMAIL_PROVIDER === 'smtp' && !env.SMTP_URL) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['SMTP_URL'], message: 'required when EMAIL_PROVIDER=smtp' });
    }
    if (env.EMAIL_PROVIDER === 'postmark' && !env.POSTMARK_TOKEN) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['POSTMARK_TOKEN'], message: 'required when EMAIL_PROVIDER=postmark' });
    }
    if (env.EMAIL_PROVIDER === 'brevo' && !env.BREVO_API_KEY) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['BREVO_API_KEY'], message: 'required when EMAIL_PROVIDER=brevo' });
    }
    // Requiring a verification email while alerts only go to the log would lock
    // every new account out of an instance that looks perfectly healthy.
    if (env.EMAIL_VERIFICATION_REQUIRED && env.EMAIL_PROVIDER === 'console') {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['EMAIL_VERIFICATION_REQUIRED'],
        message:
          'needs a real email transport: with EMAIL_PROVIDER=console nobody could ever verify an address',
      });
    }
    // A quota system nobody configured would silently give every account the
    // unlimited plan, which is the failure that only shows up on the invoice.
    const plans = parsePlanLimits(env.PLAN_LIMITS);
    if (plans === null) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['PLAN_LIMITS'],
        message: 'must be a JSON object of {plan: {checks?, projects?, channelsPerProject?, retentionDays?}}',
      });
    } else if (env.QUOTAS_ENABLED) {
      if (Object.keys(plans).length === 0) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['PLAN_LIMITS'],
          message: 'QUOTAS_ENABLED is on but no plan is defined, so every account would be unlimited',
        });
      } else if (plans[env.DEFAULT_PLAN] === undefined) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['DEFAULT_PLAN'],
          message: `"${env.DEFAULT_PLAN}" is not one of the plans in PLAN_LIMITS (${Object.keys(plans).join(', ')})`,
        });
      }
    }

    if (env.NODE_ENV === 'production') {
      // `true` trusts the hop count blindly, so anything that can reach the
      // server directly can claim any client address it likes. Naming the
      // proxy's address is the difference between a control and a decoration.
      if (env.TRUST_PROXY === true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['TRUST_PROXY'],
          message:
            'in production, set this to your proxy address or CIDR (e.g. 10.0.0.0/8) rather than "true" — ' +
            'a bare true lets anything that can reach the server forge its own client address',
        });
      }
      if (env.EMAIL_PROVIDER === 'console') {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['EMAIL_PROVIDER'],
          message: 'console transport drops alerts; configure smtp, postmark or brevo in production',
        });
      }
      if (env.BASE_URL.startsWith('http://') && !env.BASE_URL.startsWith('http://localhost')) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['BASE_URL'],
          message: 'must be https in production',
        });
      }
    }
  });

/**
 * What one plan is allowed. Every field is optional; absent means unlimited,
 * which is what a self-hosted install gets for everything.
 */
export interface PlanLimits {
  /** Checks across every project the account owns. */
  readonly checks?: number;
  /** Projects the account owns. */
  readonly projects?: number;
  readonly channelsPerProject?: number;
  /** Ceiling on ping history. A project asking for more is capped, not refused. */
  readonly retentionDays?: number;
}

const planLimitsSchema = z.record(
  z.string().min(1).max(40),
  z
    .object({
      checks: z.number().int().min(0).max(1_000_000).optional(),
      projects: z.number().int().min(0).max(100_000).optional(),
      channelsPerProject: z.number().int().min(0).max(10_000).optional(),
      retentionDays: z.number().int().min(1).max(3_650).optional(),
    })
    .strict(),
);

/** Returns the parsed plans, or null when the value is not usable at all. */
function parsePlanLimits(raw: string): Record<string, PlanLimits> | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = planLimitsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

export type AppConfig = Readonly<z.infer<typeof envSchema>> & {
  readonly isProduction: boolean;
  readonly baseUrl: string;
  /** PLAN_LIMITS, parsed once at boot. */
  readonly planLimits: Readonly<Record<string, PlanLimits>>;
};

export const CONFIG = Symbol('SILENCEWATCH_CONFIG');

/** Parses and freezes configuration. Throws a readable aggregate on failure. */
export function loadConfig(source: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid SilenceWatch configuration:\n${details}`);
  }

  return Object.freeze({
    ...parsed.data,
    isProduction: parsed.data.NODE_ENV === 'production',
    // Normalised once so callers can concatenate paths without double slashes.
    baseUrl: parsed.data.BASE_URL.replace(/\/+$/, ''),
    // Validated above, so this cannot be null by the time we get here.
    planLimits: Object.freeze(parsePlanLimits(parsed.data.PLAN_LIMITS) ?? {}),
  });
}
