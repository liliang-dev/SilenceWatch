import { z } from 'zod';
import { isValidCronExpression, isValidTimezone } from './cron';
import { CHANNEL_TYPES, CHECK_STATES, PING_KINDS, PROJECT_ROLES } from './enums';

/** Hard bounds enforced on every entry point (API, web UI, client libraries). */
export const LIMITS = {
  nameMin: 1,
  nameMax: 120,
  slugMax: 140,
  emailMax: 254,
  passwordMin: 12,
  passwordMax: 200,
  environmentMax: 40,
  tagMax: 40,
  tagsMax: 20,
  /** 30 seconds keeps the detection loop (10s tick) meaningful. */
  periodSecondsMin: 30,
  periodSecondsMax: 31_536_000,
  graceSecondsMin: 0,
  graceSecondsMax: 604_800,
  /** Ping bodies are truncated at ingestion; never stored in full. */
  pingBodyMax: 10_000,
  syncChecksMax: 500,
  checkKeyMax: 300,
  urlMax: 2048,
} as const;

const trimmedString = (max: number) => z.string().trim().min(1).max(max);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(LIMITS.emailMax)
  .email();

/**
 * Password policy: length over composition rules (NIST SP 800-63B). Upper bound
 * caps the work an attacker can force on the Argon2 hasher.
 */
export const passwordSchema = z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax);

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.slugMax)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase alphanumeric with single dashes');

export const uuidSchema = z.string().uuid();

export const httpUrlSchema = z
  .string()
  .trim()
  .max(LIMITS.urlMax)
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' &&
      url.password === ''
    );
  }, 'must be an http(s) URL without embedded credentials');

export const cronExpressionSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(isValidCronExpression, 'invalid cron expression');

export const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine(isValidTimezone, 'unknown IANA time zone');

export const environmentSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.environmentMax)
  .regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, dot, dash and underscore only');

export const tagsSchema = z
  .array(trimmedString(LIMITS.tagMax).regex(/^[A-Za-z0-9._:-]+$/))
  .max(LIMITS.tagsMax);

/* ------------------------------------------------------------------ auth --- */

export const registerRequestSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
  name: trimmedString(LIMITS.nameMax).optional(),
  /**
   * Solved sign-up challenge, `<challenge>.<nonce>`. Required only when the
   * instance issues one (SIGNUP_POW_DIFFICULTY > 0); the client learns whether
   * it needs one from GET /api/auth/signup-challenge.
   */
  powSolution: z.string().trim().max(400).optional(),
});
export type RegisterRequest = z.infer<typeof registerRequestSchema>;

/**
 * A sign-up may or may not open a session: with email verification on, the
 * account exists but cannot be used until the address is proven.
 */
export type RegisterResponse =
  | ({ status: 'active' } & SessionDto)
  | { status: 'verification_sent'; email: string };

export const verifyEmailRequestSchema = z.object({
  token: z.string().trim().min(1).max(200),
});
export type VerifyEmailRequest = z.infer<typeof verifyEmailRequestSchema>;

export const resendVerificationRequestSchema = z.object({
  email: emailSchema,
});
export type ResendVerificationRequest = z.infer<typeof resendVerificationRequestSchema>;

/**
 * The work a client must do before registering. `difficulty: 0` means the
 * instance asks for none, and the client submits without a solution.
 */
export interface SignupChallengeDto {
  /** Opaque, signed, single-use. Echoed back inside `powSolution`. */
  challenge: string;
  /** Leading zero bits required in SHA-256(`<challenge>.<nonce>`). */
  difficulty: number;
  expiresIn: number;
}

export const loginRequestSchema = z.object({
  email: emailSchema,
  password: z.string().min(1).max(LIMITS.passwordMax),
});
export type LoginRequest = z.infer<typeof loginRequestSchema>;

/**
 * The browser sends the refresh token as an HttpOnly cookie and this body is
 * empty. It stays optional for clients that have nowhere to put a cookie and
 * hold the token themselves.
 */
export const refreshRequestSchema = z.object({
  refreshToken: z.string().min(1).max(500).optional(),
});
export type RefreshRequest = z.infer<typeof refreshRequestSchema>;

export const forgotPasswordRequestSchema = z.object({
  email: emailSchema,
});
export type ForgotPasswordRequest = z.infer<typeof forgotPasswordRequestSchema>;

export const resetPasswordRequestSchema = z.object({
  token: z.string().trim().min(1).max(200),
  newPassword: passwordSchema,
});
export type ResetPasswordRequest = z.infer<typeof resetPasswordRequestSchema>;

export const changePasswordRequestSchema = z.object({
  currentPassword: z.string().min(1).max(LIMITS.passwordMax),
  newPassword: passwordSchema,
});
export type ChangePasswordRequest = z.infer<typeof changePasswordRequestSchema>;

export interface AuthTokens {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface UserDto {
  id: string;
  email: string;
  name: string | null;
  createdAt: string;
}

export interface SessionDto extends AuthTokens {
  user: UserDto;
}

/* --------------------------------------------------------------- projects --- */

export const createProjectRequestSchema = z.object({
  name: trimmedString(LIMITS.nameMax),
  slug: slugSchema.optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z.object({
  name: trimmedString(LIMITS.nameMax).optional(),
  /** Days of ping history to keep; `null` uses the server default. */
  pingRetentionDays: z.number().int().min(1).max(3650).nullable().optional(),
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export interface ProjectDto {
  id: string;
  name: string;
  slug: string;
  role: (typeof PROJECT_ROLES)[number];
  pingRetentionDays: number | null;
  createdAt: string;
  checkCount?: number;
  downCount?: number;
}

/* ----------------------------------------------------------------- checks --- */

const scheduleFields = {
  scheduleType: z.enum(['interval', 'cron']),
  periodSeconds: z
    .number()
    .int()
    .min(LIMITS.periodSecondsMin)
    .max(LIMITS.periodSecondsMax)
    .optional(),
  cronExpression: cronExpressionSchema.optional(),
  timezone: timezoneSchema.optional(),
};

/** A schedule is either `interval` + period, or `cron` + expression. Never both. */
function refineSchedule<T extends { scheduleType?: string; periodSeconds?: number; cronExpression?: string }>(
  value: T,
  ctx: z.RefinementCtx,
): void {
  if (value.scheduleType === 'interval') {
    if (value.periodSeconds === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['periodSeconds'],
        message: 'required when scheduleType is "interval"',
      });
    }
    if (value.cronExpression !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cronExpression'],
        message: 'not allowed when scheduleType is "interval"',
      });
    }
  } else if (value.scheduleType === 'cron') {
    if (value.cronExpression === undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['cronExpression'],
        message: 'required when scheduleType is "cron"',
      });
    }
    if (value.periodSeconds !== undefined) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['periodSeconds'],
        message: 'not allowed when scheduleType is "cron"',
      });
    }
  }
}

export const createCheckRequestSchema = z
  .object({
    name: trimmedString(LIMITS.nameMax),
    slug: slugSchema.optional(),
    graceSeconds: z.number().int().min(LIMITS.graceSecondsMin).max(LIMITS.graceSecondsMax),
    environment: environmentSchema.optional(),
    tags: tagsSchema.optional(),
    description: z.string().trim().max(2000).optional(),
    ...scheduleFields,
  })
  .superRefine(refineSchedule);
export type CreateCheckRequest = z.infer<typeof createCheckRequestSchema>;

export const updateCheckRequestSchema = z
  .object({
    name: trimmedString(LIMITS.nameMax).optional(),
    graceSeconds: z
      .number()
      .int()
      .min(LIMITS.graceSecondsMin)
      .max(LIMITS.graceSecondsMax)
      .optional(),
    environment: environmentSchema.nullable().optional(),
    tags: tagsSchema.optional(),
    description: z.string().trim().max(2000).nullable().optional(),
    paused: z.boolean().optional(),
    ...scheduleFields,
    scheduleType: z.enum(['interval', 'cron']).optional(),
  })
  .superRefine(refineSchedule);
export type UpdateCheckRequest = z.infer<typeof updateCheckRequestSchema>;

export const listChecksQuerySchema = z.object({
  state: z.enum(CHECK_STATES).optional(),
  environment: environmentSchema.optional(),
  tag: trimmedString(LIMITS.tagMax).optional(),
  search: z.string().trim().max(120).optional(),
  orphaned: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
  cursor: uuidSchema.optional(),
});
export type ListChecksQuery = z.infer<typeof listChecksQuerySchema>;

export interface CheckDto {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  /** Stable client-supplied identity (`com.acme.Job#run`), when registered by a starter. */
  key: string | null;
  pingKey: string;
  pingUrl: string;
  scheduleType: 'interval' | 'cron';
  periodSeconds: number | null;
  cronExpression: string | null;
  timezone: string;
  graceSeconds: number;
  state: (typeof CHECK_STATES)[number];
  lastPingAt: string | null;
  lastDurationMs: number | null;
  nextDueAt: string | null;
  source: 'manual' | 'api' | 'auto';
  environment: string | null;
  tags: string[];
  description: string | null;
  orphanedAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** When the ping URL was last reissued, if ever. */
  pingKeyRotatedAt?: string | null;
  /**
   * Why the check is paused: absent when a person paused it, "quota" when the
   * account's plan did. Only the second resumes on its own.
   */
  pausedReason?: string | null;
}

export interface PingDto {
  id: string;
  checkId: string;
  receivedAt: string;
  kind: (typeof PING_KINDS)[number];
  exitCode: number | null;
  durationMs: number | null;
  body: string | null;
  sourceIp: string | null;
  userAgent: string | null;
}

export interface IncidentDto {
  id: string;
  checkId: string;
  startedAt: string;
  resolvedAt: string | null;
  notificationsSent: number;
}

export interface PageDto<T> {
  items: T[];
  nextCursor: string | null;
}

/* --------------------------------------------------------------- channels --- */

export const emailChannelConfigSchema = z.object({ address: emailSchema });
export const webhookChannelConfigSchema = z.object({
  url: httpUrlSchema,
  /** Optional HMAC-SHA256 signing secret; write-only, never returned by the API. */
  secret: z.string().min(16).max(200).optional(),
  method: z.enum(['POST', 'PUT']).default('POST'),
});
export const chatChannelConfigSchema = z.object({ url: httpUrlSchema });

export const createChannelRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('email'),
    name: trimmedString(LIMITS.nameMax),
    config: emailChannelConfigSchema,
  }),
  z.object({
    type: z.literal('webhook'),
    name: trimmedString(LIMITS.nameMax),
    config: webhookChannelConfigSchema,
  }),
  z.object({
    type: z.literal('slack'),
    name: trimmedString(LIMITS.nameMax),
    config: chatChannelConfigSchema,
  }),
  z.object({
    type: z.literal('teams'),
    name: trimmedString(LIMITS.nameMax),
    config: chatChannelConfigSchema,
  }),
  z.object({
    type: z.literal('discord'),
    name: trimmedString(LIMITS.nameMax),
    config: chatChannelConfigSchema,
  }),
]);
export type CreateChannelRequest = z.infer<typeof createChannelRequestSchema>;

export const updateChannelRequestSchema = z.object({
  name: trimmedString(LIMITS.nameMax).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateChannelRequest = z.infer<typeof updateChannelRequestSchema>;

export interface NotificationChannelDto {
  id: string;
  projectId: string;
  type: (typeof CHANNEL_TYPES)[number];
  name: string;
  enabled: boolean;
  /** Secrets are redacted server-side; only non-sensitive hints are exposed. */
  target: string;
  createdAt: string;
}

/* -------------------------------------------------------------- api keys --- */

export const createApiKeyRequestSchema = z.object({
  name: trimmedString(LIMITS.nameMax),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;

export interface ApiKeyDto {
  id: string;
  projectId: string;
  name: string;
  /** Non-secret display prefix, e.g. `sw_live_3f9a…`. */
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreatedApiKeyDto extends ApiKeyDto {
  /** Full secret, returned exactly once at creation time. */
  token: string;
}

/* ------------------------------------------------------------------ sync --- */

export const syncCheckSchema = z
  .object({
    key: trimmedString(LIMITS.checkKeyMax),
    name: trimmedString(LIMITS.nameMax),
    cron: cronExpressionSchema.optional(),
    /** Interval schedules, expressed in seconds (`fixedRate` / `fixedDelay`). */
    interval_seconds: z
      .number()
      .int()
      .min(LIMITS.periodSecondsMin)
      .max(LIMITS.periodSecondsMax)
      .optional(),
    timezone: timezoneSchema.optional(),
    grace_seconds: z
      .number()
      .int()
      .min(LIMITS.graceSecondsMin)
      .max(LIMITS.graceSecondsMax)
      .optional(),
    tags: tagsSchema.optional(),
  })
  .superRefine((value, ctx) => {
    if ((value.cron === undefined) === (value.interval_seconds === undefined)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'exactly one of "cron" or "interval_seconds" is required',
      });
    }
  });
export type SyncCheck = z.infer<typeof syncCheckSchema>;

export const syncRequestSchema = z.object({
  environment: environmentSchema.optional(),
  source: trimmedString(60).optional(),
  /** When true, checks missing from the payload are flagged as orphaned. */
  prune: z.boolean().default(true),
  checks: z.array(syncCheckSchema).min(1).max(LIMITS.syncChecksMax),
});
export type SyncRequest = z.infer<typeof syncRequestSchema>;

export interface SyncResultCheckDto {
  key: string;
  id: string;
  pingKey: string;
  pingUrl: string;
  created: boolean;
}

export interface SyncResultDto {
  checks: SyncResultCheckDto[];
  orphaned: string[];
  /**
   * Keys the server refused to create because the account is at its plan's
   * check limit. Empty on a self-hosted instance, which has no limit.
   *
   * Reported rather than thrown: a deployment must not fail because the
   * fortieth scheduled job would have been the eleventh check.
   */
  skipped?: string[];
}

/* ------------------------------------------------------------------ audit --- */

/**
 * Security-relevant actions. A closed set so the UI can label them and an
 * operator can grep for them; anything not here is not recorded.
 */
export const AUDIT_ACTIONS = [
  'auth.login',
  'auth.login_failed',
  'auth.logout',
  'auth.password_changed',
  'auth.password_reset_requested',
  'auth.password_reset_completed',
  'auth.email_verified',
  'account.registered',
  'api_key.created',
  'api_key.revoked',
  'channel.created',
  'channel.updated',
  'channel.deleted',
  'channel.tested',
  'check.created',
  'check.deleted',
  'check.ping_key_rotated',
  'project.created',
  'project.updated',
  'quota.checks_paused',
] as const;
export type AuditAction = (typeof AUDIT_ACTIONS)[number];

export interface AuditEventDto {
  id: string;
  occurredAt: string;
  action: AuditAction;
  /** Who, denormalised so the entry survives the account's deletion. */
  actorEmail: string | null;
  actorIsApiKey: boolean;
  targetType: string | null;
  targetId: string | null;
  targetLabel: string | null;
  ip: string | null;
  detail: Record<string, unknown> | null;
}

/* ---------------------------------------------------------------- errors --- */

export interface ApiErrorBody {
  statusCode: number;
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}
