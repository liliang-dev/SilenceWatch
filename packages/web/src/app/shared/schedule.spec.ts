import { TestBed } from '@angular/core/testing';
import type { CheckDto } from '@silencewatch/shared';
import { loadI18n, provideI18n } from '../core/i18n/i18n.testing';
import { describeSchedule, formatSeconds } from './schedule';

describe('schedule', () => {
  beforeEach(async () => {
    localStorage.clear();
    TestBed.configureTestingModule({ providers: [provideI18n()] });
  });
  afterEach(() => localStorage.clear());

  it.each([
    [30, '30s'],
    [900, '15m'],
    [3600, '1h'],
    [86_400, '1d'],
    [172_800, '2d'],
    [604_800, '1w'],
    [1_209_600, '2w'],
    [691_200, '8d'],
    [90, '90s'],
  ])('writes %s seconds as %s', async (seconds, written) => {
    const { t } = await loadI18n('en');
    expect(formatSeconds(seconds, t)).toBe(written);
  });

  it('writes an interval in words, and a cron expression with its zone', async () => {
    const { t } = await loadI18n('en');
    expect(describeSchedule({ scheduleType: 'interval', periodSeconds: 1_209_600 } as CheckDto, t)).toBe('every 2w');
    expect(
      describeSchedule({ scheduleType: 'cron', cronExpression: '0 8 * * 1', timezone: 'Europe/Paris' } as CheckDto, t),
    ).toBe('0 8 * * 1 (Europe/Paris)');
  });

  it('writes weeks the French way', async () => {
    const { t } = await loadI18n('fr');
    expect(formatSeconds(604_800, t)).toBe('1\u00a0sem');
  });
});
