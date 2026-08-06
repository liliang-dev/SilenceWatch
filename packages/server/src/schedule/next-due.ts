import { CronExpressionParser } from 'cron-parser';

/** The subset of a check needed to know when the next heartbeat is expected. */
export interface Schedule {
  scheduleType: 'interval' | 'cron';
  periodSeconds: number | null;
  cronExpression: string | null;
  timezone: string;
}

export class InvalidScheduleError extends Error {}

/**
 * Instant by which the next heartbeat must have arrived, grace excluded.
 *
 * Interval checks are relative to the last signal; cron checks are absolute, so
 * a job running late does not push its own deadline forward — the following
 * occurrence still has to arrive on time.
 */
export function computeNextDueAt(schedule: Schedule, from: Date): Date {
  if (schedule.scheduleType === 'interval') {
    const period = schedule.periodSeconds;
    if (period === null || !Number.isFinite(period) || period <= 0) {
      throw new InvalidScheduleError('interval check without a usable period_seconds');
    }
    return new Date(from.getTime() + period * 1000);
  }

  const expression = schedule.cronExpression;
  if (expression === null || expression.length === 0) {
    throw new InvalidScheduleError('cron check without a cron_expression');
  }

  try {
    // cron-parser 5 replaced the `parseExpression` function with a class, and
    // `currentDate` with `currentDate` on the same options object — the shape
    // is unchanged, only the entry point moved.
    return CronExpressionParser.parse(expression, {
      currentDate: from,
      tz: schedule.timezone,
    })
      .next()
      .toDate();
  } catch (error) {
    throw new InvalidScheduleError(
      `cannot evaluate cron expression "${expression}" in ${schedule.timezone}: ${(error as Error).message}`,
    );
  }
}

/**
 * Deadline including the grace period — the instant a check is considered down.
 */
export function computeDeadline(nextDueAt: Date, graceSeconds: number): Date {
  return new Date(nextDueAt.getTime() + graceSeconds * 1000);
}

/**
 * Validates a schedule by evaluating it. Called on every write path so an
 * unevaluable schedule is rejected with a 400 instead of breaking the detection
 * loop later.
 */
export function assertScheduleIsUsable(schedule: Schedule): void {
  computeNextDueAt(schedule, new Date());
}
