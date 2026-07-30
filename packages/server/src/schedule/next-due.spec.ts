import { computeDeadline, computeNextDueAt, InvalidScheduleError } from './next-due';

describe('computeNextDueAt', () => {
  const from = new Date('2026-07-30T12:00:00.000Z');

  it('adds the period for interval schedules', () => {
    const next = computeNextDueAt(
      { scheduleType: 'interval', periodSeconds: 900, cronExpression: null, timezone: 'UTC' },
      from,
    );
    expect(next.toISOString()).toBe('2026-07-30T12:15:00.000Z');
  });

  it('resolves cron occurrences in the check time zone', () => {
    // 02:00 in Paris is 00:00 UTC in summer: getting this wrong makes every
    // daily job alert an hour or two early, twice a year.
    const next = computeNextDueAt(
      {
        scheduleType: 'cron',
        cronExpression: '0 2 * * *',
        periodSeconds: null,
        timezone: 'Europe/Paris',
      },
      from,
    );
    expect(next.toISOString()).toBe('2026-07-31T00:00:00.000Z');
  });

  it('keeps cron deadlines absolute across a winter/summer boundary', () => {
    const winter = computeNextDueAt(
      {
        scheduleType: 'cron',
        cronExpression: '0 2 * * *',
        periodSeconds: null,
        timezone: 'Europe/Paris',
      },
      new Date('2026-01-15T12:00:00.000Z'),
    );
    expect(winter.toISOString()).toBe('2026-01-16T01:00:00.000Z');
  });

  it('supports macros and six-field expressions', () => {
    expect(
      computeNextDueAt(
        { scheduleType: 'cron', cronExpression: '@hourly', periodSeconds: null, timezone: 'UTC' },
        from,
      ).toISOString(),
    ).toBe('2026-07-30T13:00:00.000Z');

    expect(
      computeNextDueAt(
        { scheduleType: 'cron', cronExpression: '30 0 2 * * *', periodSeconds: null, timezone: 'UTC' },
        from,
      ).toISOString(),
    ).toBe('2026-07-31T02:00:30.000Z');
  });

  it('rejects schedules it cannot evaluate', () => {
    expect(() =>
      computeNextDueAt(
        { scheduleType: 'interval', periodSeconds: null, cronExpression: null, timezone: 'UTC' },
        from,
      ),
    ).toThrow(InvalidScheduleError);

    expect(() =>
      computeNextDueAt(
        { scheduleType: 'cron', cronExpression: 'not a cron', periodSeconds: null, timezone: 'UTC' },
        from,
      ),
    ).toThrow(InvalidScheduleError);

    expect(() =>
      computeNextDueAt(
        {
          scheduleType: 'cron',
          cronExpression: '0 2 * * *',
          periodSeconds: null,
          timezone: 'Mars/Olympus',
        },
        from,
      ),
    ).toThrow(InvalidScheduleError);
  });
});

describe('computeDeadline', () => {
  it('adds the grace period to the due date', () => {
    expect(computeDeadline(new Date('2026-07-30T12:00:00Z'), 300).toISOString()).toBe(
      '2026-07-30T12:05:00.000Z',
    );
  });
});
