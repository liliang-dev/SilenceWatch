import { z } from 'zod';

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
export function parsePlanLimits(raw: string): Record<string, PlanLimits> | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = planLimitsSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
