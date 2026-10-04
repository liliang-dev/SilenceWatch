import { z } from 'zod';
import { LIMITS } from './limits';
import {
  cronExpressionSchema,
  environmentSchema,
  tagsSchema,
  timezoneSchema,
  trimmedString,
} from './primitives';

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
