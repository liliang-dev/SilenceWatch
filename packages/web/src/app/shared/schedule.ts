import type { CheckDto } from '@silencewatch/shared';

/**
 * How a check's schedule is written, everywhere it is written.
 *
 * Shared rather than duplicated per page: the list saying "every 15m" while the
 * detail said "every 900s" for the same check is the kind of small inconsistency
 * that makes a reader stop and check whether they are looking at the same thing.
 */
export function describeSchedule(check: CheckDto): string {
  return check.scheduleType === 'cron'
    ? `${check.cronExpression} (${check.timezone})`
    : `every ${formatSeconds(check.periodSeconds ?? 0)}`;
}

/** 900 → "15m", 86 400 → "1d". Falls back to seconds when nothing divides evenly. */
export function formatSeconds(seconds: number): string {
  if (seconds > 0 && seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds > 0 && seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds > 0 && seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}
