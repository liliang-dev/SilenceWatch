/**
 * The dialect rules live here because they are enforced in three places at once:
 * the API, the web UI and the client libraries. A drift between them would show
 * up as a check that one of them accepts and another cannot evaluate.
 */

function expectEqual(actual: unknown, expected: unknown, message?: string): void {
  expect({ value: actual, case: message ?? '' }).toEqual({ value: expected, case: message ?? '' });
}

import { isValidCronExpression, isValidTimezone } from './cron';
import { createCheckRequestSchema, syncRequestSchema } from './schemas';

it('accepts standard 5-field expressions', () => {
  for (const expression of [
    '* * * * *',
    '0 2 * * *',
    '*/15 * * * *',
    '0 0 1 1 *',
    '30 9-17 * * mon-fri',
    '0 0 * * 7',
    '5,10,15 * * jan,feb *',
    '0 3 ? * *',
  ]) {
    expectEqual(isValidCronExpression(expression), true, expression);
  }
});

it('accepts 6-field expressions and macros', () => {
  expectEqual(isValidCronExpression('0 0 2 * * *'), true);
  expectEqual(isValidCronExpression('@daily'), true);
  expectEqual(isValidCronExpression('@HOURLY'), true);
});

it('accepts the Spring and Quartz extensions the server can evaluate', () => {
  for (const expression of [
    '0 0 2 L * *', // last day of the month
    '0 0 2 * * 5L', // last Friday
    '0 0 2 * * friL',
    '0 0 2 * * MON#2', // second Monday
    '0 0/30 * * * *', // Quartz step syntax
    '0 0 2 ? * MON-FRI',
  ]) {
    expectEqual(isValidCronExpression(expression), true, expression);
  }
});

it('rejects what the server cannot compute, rather than accepting a check that never fires', () => {
  for (const expression of [
    '0 0 2 15W * *', // nearest weekday: unsupported by the occurrence engine
    '0 0 2 LW * *',
    '0 0 2 * * 9L', // out of range weekday
    '0 0 2 * * MON#6', // there is no sixth Monday
    '0 L * * *', // L is meaningless in the hour field
  ]) {
    expectEqual(isValidCronExpression(expression), false, expression);
  }
});

it('rejects malformed expressions', () => {
  for (const expression of [
    '',
    '* * * *',
    '* * * * * * *',
    '60 * * * *',
    '* 24 * * *',
    '0 0 32 * *',
    '0 0 * 13 *',
    '0 0 * * 8',
    '@never',
    '*/0 * * * *',
    'drop table check',
    '0 0 1 1 * ; DROP',
  ]) {
    expectEqual(isValidCronExpression(expression), false, expression);
  }
});

it('validates IANA time zones', () => {
  expectEqual(isValidTimezone('Europe/Paris'), true);
  expectEqual(isValidTimezone('UTC'), true);
  expectEqual(isValidTimezone('Mars/Olympus'), false);
  expectEqual(isValidTimezone('../../etc/passwd'), false);
});

it('check creation requires a coherent schedule', () => {
  expectEqual(
    createCheckRequestSchema.safeParse({
      name: 'Nightly backup',
      scheduleType: 'cron',
      cronExpression: '0 2 * * *',
      timezone: 'Europe/Paris',
      graceSeconds: 300,
    }).success,
    true,
  );
  expectEqual(
    createCheckRequestSchema.safeParse({
      name: 'Nightly backup',
      scheduleType: 'cron',
      periodSeconds: 3600,
      graceSeconds: 300,
    }).success,
    false,
  );
  expectEqual(
    createCheckRequestSchema.safeParse({
      name: 'Too frequent',
      scheduleType: 'interval',
      periodSeconds: 1,
      graceSeconds: 60,
    }).success,
    false,
  );
});

it('sync payload demands exactly one schedule form per check', () => {
  const base = { environment: 'production', source: 'spring-boot-starter' };
  expectEqual(
    syncRequestSchema.safeParse({
      ...base,
      checks: [{ key: 'com.acme.Job#run', name: 'Job.run', cron: '0 2 * * *' }],
    }).success,
    true,
  );
  expectEqual(
    syncRequestSchema.safeParse({
      ...base,
      checks: [{ key: 'com.acme.Job#run', name: 'Job.run', cron: '0 2 * * *', interval_seconds: 60 }],
    }).success,
    false,
  );
  expectEqual(
    syncRequestSchema.safeParse({ ...base, checks: [] }).success,
    false,
  );
});
