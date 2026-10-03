import type { CheckDto } from '@silencewatch/shared';
import type { Translate } from '../core/i18n/i18n.service';

/**
 * How a check's schedule is written, everywhere it is written.
 *
 * Shared rather than duplicated per page: the list saying "every 15m" while the
 * detail said "every 900s" for the same check is the kind of small inconsistency
 * that makes a reader stop and check whether they are looking at the same thing.
 */
export function describeSchedule(check: CheckDto, t: Translate): string {
  if (check.scheduleType === 'cron') return `${check.cronExpression} (${check.timezone})`;

  const seconds = check.periodSeconds ?? 0;
  const value = formatSeconds(seconds, t);
  return t(seconds > 0 && seconds % 86_400 === 0 ? 'time.everyDays' : 'time.every', { value });
}

/** 900 → "15m", 86 400 → "1d". Falls back to seconds when nothing divides evenly. */
export function formatSeconds(seconds: number, t: Translate): string {
  if (seconds > 0 && seconds % 86_400 === 0) return `${seconds / 86_400}${t('time.unitDay')}`;
  if (seconds > 0 && seconds % 3_600 === 0) return `${seconds / 3_600}${t('time.unitHour')}`;
  if (seconds > 0 && seconds % 60 === 0) return `${seconds / 60}${t('time.unitMinute')}`;
  return `${seconds}${t('time.unitSecond')}`;
}
