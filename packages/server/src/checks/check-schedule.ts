import { BadRequestException } from '@nestjs/common';
import type { Check } from '@prisma/client';
import { computeNextDueAt, InvalidScheduleError, type Schedule } from '../schedule/next-due';

const DEFAULT_TIMEZONE = 'UTC';

/** The schedule a create or update request describes, normalised to one shape. */
export function toSchedule(input: {
  scheduleType?: 'interval' | 'cron';
  periodSeconds?: number;
  cronExpression?: string;
  timezone?: string;
}): Schedule {
  return input.scheduleType === 'cron'
    ? {
        scheduleType: 'cron',
        cronExpression: input.cronExpression as string,
        periodSeconds: null,
        timezone: input.timezone ?? DEFAULT_TIMEZONE,
      }
    : {
        scheduleType: 'interval',
        periodSeconds: input.periodSeconds as number,
        cronExpression: null,
        timezone: input.timezone ?? DEFAULT_TIMEZONE,
      };
}

export function toScheduleFromRow(check: Check): Schedule {
  return {
    scheduleType: check.scheduleType,
    periodSeconds: check.periodSeconds,
    cronExpression: check.cronExpression,
    timezone: check.timezone,
  };
}

/** The next deadline, or a 400 when the schedule cannot be computed (a bad cron, a bad zone). */
export function nextDueOrThrow(schedule: Schedule, from: Date): Date {
  try {
    return computeNextDueAt(schedule, from);
  } catch (error) {
    if (error instanceof InvalidScheduleError) throw new BadRequestException(error.message);
    throw error;
  }
}
