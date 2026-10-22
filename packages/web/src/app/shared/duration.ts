/**
 * Durations typed as "a number of something": 90 minutes, 2 days, 1 week.
 *
 * The server only knows seconds, so everything here converts both ways. Months
 * and years are left out on purpose: they are not a fixed number of seconds, and
 * a schedule "every month" is a cron expression (`0 8 1 * *`), not an interval.
 */
export type DurationUnit = 'seconds' | 'minutes' | 'hours' | 'days' | 'weeks';

/** Smallest to largest. */
export const DURATION_UNITS: readonly DurationUnit[] = ['seconds', 'minutes', 'hours', 'days', 'weeks'];

export const UNIT_SECONDS: Readonly<Record<DurationUnit, number>> = {
  seconds: 1,
  minutes: 60,
  hours: 3600,
  days: 86_400,
  weeks: 604_800,
};

export interface SplitDuration {
  value: number;
  unit: DurationUnit;
}

/**
 * The way a person would say it: the largest of `units` that divides the number
 * of seconds exactly, so 3600 is "1 hour", 5400 is "90 minutes" and 90 is "90
 * seconds". Zero, and anything no unit divides, is given in `fallback`.
 */
export function splitDuration(
  seconds: number,
  units: readonly DurationUnit[] = DURATION_UNITS,
  fallback: DurationUnit = 'minutes',
): SplitDuration {
  const usable = units.length > 0 ? units : DURATION_UNITS;
  const start: DurationUnit = usable.includes(fallback) ? fallback : (usable[0] as DurationUnit);

  if (!Number.isFinite(seconds) || seconds <= 0) return { value: 0, unit: start };

  const largestFirst = [...usable].sort((a, b) => UNIT_SECONDS[b] - UNIT_SECONDS[a]);
  for (const unit of largestFirst) {
    if (seconds % UNIT_SECONDS[unit] === 0) return { value: seconds / UNIT_SECONDS[unit], unit };
  }
  // Not a whole number of any unit offered: the smallest, with a decimal.
  const smallest = largestFirst[largestFirst.length - 1] as DurationUnit;
  return { value: seconds / UNIT_SECONDS[smallest], unit: smallest };
}

/** The other way. A blank or invalid number is `null`, not zero: nothing was typed. */
export function toSeconds(value: number | string | null | undefined, unit: DurationUnit): number | null {
  if (value === null || value === undefined || value === '') return null;
  const amount = Number(value);
  return Number.isFinite(amount) ? Math.round(amount * UNIT_SECONDS[unit]) : null;
}
