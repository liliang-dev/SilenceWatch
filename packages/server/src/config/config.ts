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
    SMTP_URL: z.string().min(1).optional(),
    POSTMARK_TOKEN: z.string().min(1).optional(),
    POSTMARK_MESSAGE_STREAM: z.string().min(1).default('outbound'),
    BREVO_API_KEY: z.string().min(1).optional(),

    /** Default ping retention; per-project overrides win. */
    PING_RETENTION_DAYS: positiveInt(1, 3_650).default(90),
    PURGE_CRON: z.string().min(1).default('17 3 * * *'),

    /**
     * SilenceWatch cannot watch itself: point this at a third-party dead man's
     * switch that the detection loop pings after every successful tick.
     */
    OUTBOUND_HEARTBEAT_URL: z.string().url().optional(),
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
    if (env.NODE_ENV === 'production') {
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

export type AppConfig = Readonly<z.infer<typeof envSchema>> & {
  readonly isProduction: boolean;
  readonly baseUrl: string;
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
  });
}
