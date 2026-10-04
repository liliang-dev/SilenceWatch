import { z } from 'zod';
import { CHECK_STATES, PING_KINDS } from '../enums';
import { LIMITS } from './limits';
import {
  cronExpressionSchema,
  environmentSchema,
  slugSchema,
  tagsSchema,
  timezoneSchema,
  trimmedString,
  uuidSchema,
} from './primitives';

/** @internal */
export const scheduleFields = {
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
/** @internal */
export function refineSchedule<T extends { scheduleType?: string; periodSeconds?: number; cronExpression?: string }>(
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
