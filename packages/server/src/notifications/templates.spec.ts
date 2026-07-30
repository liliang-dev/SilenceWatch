import type { Alert } from './alert';
import { formatDuration } from './alert';
import { escapeHtml, renderAlert } from './templates';

function alert(overrides: Partial<Alert> = {}): Alert {
  return {
    kind: 'down',
    project: { id: 'p1', name: 'Billing' },
    check: {
      id: 'c1',
      name: 'Nightly invoice export',
      state: 'DOWN',
      environment: 'production',
      tags: ['billing', 'nightly'],
      lastPingAt: new Date('2026-07-29T02:00:05Z'),
      nextDueAt: new Date('2026-07-30T02:00:00Z'),
      graceSeconds: 300,
      scheduleType: 'cron',
      periodSeconds: null,
      cronExpression: '0 2 * * *',
      timezone: 'Europe/Paris',
      ...overrides.check,
    },
    incident: {
      id: 'i1',
      startedAt: new Date('2026-07-30T02:05:00Z'),
      resolvedAt: null,
      cause: 'missed',
      ...overrides.incident,
    },
    url: 'https://silencewatch.com/checks/c1',
    ...overrides,
  } as Alert;
}

describe('renderAlert', () => {
  it('says what broke, where, and since when', () => {
    const rendered = renderAlert(alert());

    expect(rendered.subject).toBe('[SilenceWatch] DOWN — Nightly invoice export (Billing / production)');
    expect(rendered.headline).toContain('stopped checking in');
    expect(rendered.text).toContain('Schedule: cron "0 2 * * *" (Europe/Paris)');
    expect(rendered.text).toContain('Grace period: 5m');
    expect(rendered.text).toContain('https://silencewatch.com/checks/c1');
  });

  it('reports the outage length on recovery', () => {
    const rendered = renderAlert(
      alert({
        kind: 'up',
        incident: {
          id: 'i1',
          startedAt: new Date('2026-07-30T02:05:00Z'),
          resolvedAt: new Date('2026-07-30T04:35:00Z'),
          cause: 'missed',
        },
      }),
    );

    expect(rendered.subject).toContain('UP');
    expect(rendered.headline).toContain('2h 30m');
    expect(rendered.fields.some((field) => field.label === 'Was down for')).toBe(true);
  });

  it('distinguishes a reported failure from silence', () => {
    const rendered = renderAlert(
      alert({
        incident: { id: 'i1', startedAt: new Date(), resolvedAt: null, cause: 'reported' },
      }),
    );
    expect(rendered.fields.some((field) => field.value.includes('reported a failure'))).toBe(true);
  });

  it('escapes user-controlled text in the HTML body', () => {
    const rendered = renderAlert(
      alert({
        check: {
          ...alert().check,
          name: '<img src=x onerror="alert(1)">',
          tags: ['<script>evil()</script>'],
        },
      }),
    );

    // Check names come from users and land in an HTML email.
    expect(rendered.html).not.toContain('<img src=x');
    expect(rendered.html).not.toContain('<script>');
    expect(rendered.html).toContain('&lt;img src=x');
  });
});

describe('escapeHtml', () => {
  it('escapes every character that could break out of text or an attribute', () => {
    expect(escapeHtml(`<>&"'`)).toBe('&lt;&gt;&amp;&quot;&#39;');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [45, '45s'],
    [60, '1m'],
    [3_600, '1h'],
    [5_400, '1h 30m'],
    [86_400, '1d'],
    [90_000, '1d 1h'],
  ])('formats %ss as %s', (seconds, expected) => {
    expect(formatDuration(seconds)).toBe(expected);
  });
});
