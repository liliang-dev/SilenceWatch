import { BadRequestException } from '@nestjs/common';
import { nextDueOrThrow, toSchedule } from './check-schedule';
import { syncSlug } from './check-slug';

describe('toSchedule', () => {
  it('shapes an interval and defaults the time zone', () => {
    expect(toSchedule({ scheduleType: 'interval', periodSeconds: 300 })).toEqual({
      scheduleType: 'interval',
      periodSeconds: 300,
      cronExpression: null,
      timezone: 'UTC',
    });
  });

  it('shapes a cron schedule', () => {
    expect(
      toSchedule({ scheduleType: 'cron', cronExpression: '0 2 * * *', timezone: 'Europe/Paris' }),
    ).toEqual({
      scheduleType: 'cron',
      periodSeconds: null,
      cronExpression: '0 2 * * *',
      timezone: 'Europe/Paris',
    });
  });
});

describe('nextDueOrThrow', () => {
  it('turns an unusable schedule into a 400', () => {
    const schedule = toSchedule({ scheduleType: 'cron', cronExpression: 'not a cron' });
    expect(() => nextDueOrThrow(schedule, new Date())).toThrow(BadRequestException);
  });
});

describe('syncSlug', () => {
  it('is stable for one identity and differs per environment', () => {
    const production = syncSlug('Nightly backup', 'com.acme.Backup#run', 'production');
    expect(syncSlug('Nightly backup', 'com.acme.Backup#run', 'production')).toBe(production);
    expect(syncSlug('Nightly backup', 'com.acme.Backup#run', 'staging')).not.toBe(production);
    expect(production).toMatch(/^nightly-backup-[0-9a-f]{8}$/);
  });
});
