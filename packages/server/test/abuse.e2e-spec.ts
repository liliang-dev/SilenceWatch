import type { CheckDto, CreatedApiKeyDto } from '@silencewatch/shared';
import { RetentionService } from '../src/retention/retention.service';
import { auth, createTestApp, registerUser, type TestApp } from './utils/test-app';

const PASSWORD = 'a-sufficiently-long-password';

/**
 * What stops a free account from costing more than it is worth: how many accounts
 * a connection may have, how often a channel may be tested, how many alerts it may
 * send, and how many rows an account can make for itself.
 */

describe('one account per connection', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({
      EMAIL_VERIFICATION_REQUIRED: 'true',
      EMAIL_PROVIDER: 'smtp',
      SMTP_URL: 'smtp://user:pass@smtp.example.test:587',
      SIGNUP_MAX_ACCOUNTS_PER_ADDRESS: '1',
    });
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
    // The first account of an instance is exempt from every check.
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      remoteAddress: '198.51.100.1',
      payload: { email: 'first@example.test', password: PASSWORD },
    });
  });

  const register = async (email: string, ip: string) =>
    (
      await context.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        remoteAddress: ip,
        payload: { email, password: PASSWORD },
      })
    ).statusCode;

  const verify = (email: string) =>
    context.prisma.user.update({ where: { email }, data: { emailVerifiedAt: new Date() } });

  it('lets a second account in from another connection, and refuses it from the same one', async () => {
    expect(await register('a@example.test', '203.0.113.7')).toBe(201);
    await verify('a@example.test');

    expect(await register('b@example.test', '203.0.113.7')).toBe(429);
    expect(await context.prisma.user.count({ where: { email: 'b@example.test' } })).toBe(0);

    // The neighbouring address is another connection.
    expect(await register('c@example.test', '203.0.113.8')).toBe(201);
  });

  it('holds a connection while its first address is unproven, for an hour, and then lets go', async () => {
    expect(await register('typo@exmaple.test', '203.0.113.20')).toBe(201);

    // A mistyped address must not lock the person out for good, but a flood of
    // them must not slip through either: inside the hour it counts.
    expect(await register('right@example.test', '203.0.113.20')).toBe(429);

    await context.prisma.user.update({
      where: { email: 'typo@exmaple.test' },
      data: { createdAt: new Date(Date.now() - 2 * 3_600_000) },
    });
    expect(await register('right@example.test', '203.0.113.20')).toBe(201);
  });

  it('frees the place when the account is deleted', async () => {
    expect(await register('a@example.test', '203.0.113.30')).toBe(201);
    await verify('a@example.test');
    expect(await register('b@example.test', '203.0.113.30')).toBe(429);

    await context.prisma.user.delete({ where: { email: 'a@example.test' } });
    expect(await register('b@example.test', '203.0.113.30')).toBe(201);
  });

  it('treats an IPv6 /64 as one connection', async () => {
    expect(await register('a@example.test', '2001:db8:1:2:aaaa::1')).toBe(201);
    await verify('a@example.test');

    // Any address in the same /64 is the same line; the next /64 is another.
    expect(await register('b@example.test', '2001:db8:1:2:bbbb::9')).toBe(429);
    expect(await register('c@example.test', '2001:db8:1:3::1')).toBe(201);
  });

  it('keeps no address: only a keyed hash that tells nothing on its own', async () => {
    await register('a@example.test', '203.0.113.40');
    const user = await context.prisma.user.findUniqueOrThrow({ where: { email: 'a@example.test' } });

    expect(user.signupNetwork).toMatch(/^[0-9a-f]{32}$/);
    expect(JSON.stringify(user)).not.toContain('203.0.113.40');
  });
});

describe('test alerts', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  async function setup() {
    const user = await registerUser(context);
    const channel = (
      await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/channels`,
        headers: auth(user.token),
        payload: { type: 'email', name: 'Ops', config: { address: 'ops@example.test' } },
      })
    ).json<{ id: string }>();
    const test = (id = channel.id) =>
      context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/channels/${id}/test`,
        headers: auth(user.token),
      });
    return { user, channel, test };
  }

  it('sends one, and asks the next to wait, without sending it', async () => {
    const { test } = await setup();

    expect((await test()).statusCode).toBe(204);
    const second = await test();

    expect(second.statusCode).toBe(429);
    expect(second.json<{ details: { reason: string; retryAfterSeconds: number } }>().details).toMatchObject({
      reason: 'test_cooldown',
    });
    const wait = Number(second.headers['retry-after']);
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(60);
    expect(context.senders.captured).toHaveLength(1);
  });

  it('lets two requests made together send only one', async () => {
    const { test } = await setup();
    const statuses = (await Promise.all([test(), test(), test()])).map((response) => response.statusCode);

    expect(statuses.filter((status) => status === 204)).toHaveLength(1);
    expect(statuses.filter((status) => status === 429)).toHaveLength(2);
    expect(context.senders.captured).toHaveLength(1);
  });

  it('is open again after the minute', async () => {
    const { channel, test } = await setup();
    expect((await test()).statusCode).toBe(204);

    await context.prisma.notificationChannel.update({
      where: { id: channel.id },
      data: { lastTestedAt: new Date(Date.now() - 61_000) },
    });
    expect((await test()).statusCode).toBe(204);
  });

  it('counts each channel on its own', async () => {
    const { user, test } = await setup();
    const other = (
      await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/channels`,
        headers: auth(user.token),
        payload: { type: 'email', name: 'Backup', config: { address: 'backup@example.test' } },
      })
    ).json<{ id: string }>();

    expect((await test()).statusCode).toBe(204);
    expect((await test(other.id)).statusCode).toBe(204);
  });
});

describe('test alerts, hourly budget', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({ TEST_ALERT_COOLDOWN_SECONDS: '0', TEST_ALERT_MAX_PER_HOUR: '2' });
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  it('stops an account after its budget, whichever channel it uses', async () => {
    const user = await registerUser(context);
    const channel = (
      await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/channels`,
        headers: auth(user.token),
        payload: { type: 'email', name: 'Ops', config: { address: 'ops@example.test' } },
      })
    ).json<{ id: string }>();
    const test = () =>
      context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/channels/${channel.id}/test`,
        headers: auth(user.token),
      });

    expect((await test()).statusCode).toBe(204);
    expect((await test()).statusCode).toBe(204);
    // The trail is written after the response; the budget reads it.
    await new Promise((resolve) => setTimeout(resolve, 150));

    const refused = await test();
    expect(refused.statusCode).toBe(429);
    expect(refused.json<{ details: { reason: string } }>().details.reason).toBe('test_limit');
    expect(context.senders.captured).toHaveLength(2);
  });
});

describe('alerts per channel', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({ ALERT_MAX_PER_CHANNEL_PER_HOUR: '2' });
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  it('stops sending past the ceiling, and says why on the alert it did not send', async () => {
    const user = await registerUser(context);
    await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/channels`,
      headers: auth(user.token),
      payload: { type: 'email', name: 'Ops', config: { address: 'ops@example.test' } },
    });

    for (const name of ['a', 'b', 'c']) {
      const check = (
        await context.app.inject({
          method: 'POST',
          url: `/api/v1/projects/${user.projectId}/checks`,
          headers: auth(user.token),
          payload: { name, scheduleType: 'interval', periodSeconds: 3_600, graceSeconds: 0 },
        })
      ).json<CheckDto>();
      await context.prisma.$executeRawUnsafe(
        `UPDATE "check" SET next_due_at = now() - interval '10 seconds' WHERE id = $1::uuid`,
        check.id,
      );
      await context.detection.tick();
      await context.notifications.flush();
    }

    expect(context.senders.captured).toHaveLength(2);
    const refused = await context.prisma.notificationDelivery.findMany({ where: { status: 'failed' } });
    expect(refused).toHaveLength(1);
    expect(refused[0]?.lastError).toContain('limit of 2 alerts per hour');
  });
});

describe('rows an account can make for itself', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  it('caps the live API keys of a project, and deletes dead ones after a month', async () => {
    const user = await registerUser(context);
    const create = () =>
      context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/api-keys`,
        headers: auth(user.token),
        payload: { name: 'key' },
      });

    const ids: string[] = [];
    for (let index = 0; index < 25; index += 1) {
      const response = await create();
      expect(response.statusCode).toBe(201);
      ids.push(response.json<CreatedApiKeyDto>().id);
    }
    expect((await create()).statusCode).toBe(409);

    // Revoking one makes room.
    await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${user.projectId}/api-keys/${ids[0]}`,
      headers: auth(user.token),
    });
    expect((await create()).statusCode).toBe(201);

    await context.prisma.apiKey.update({
      where: { id: ids[0] as string },
      data: { revokedAt: new Date(Date.now() - 40 * 86_400_000) },
    });
    await context.app.get(RetentionService).purge();
    expect(await context.prisma.apiKey.count({ where: { id: ids[0] as string } })).toBe(0);
    expect(await context.prisma.apiKey.count({ where: { id: ids[1] as string } })).toBe(1);
  });

  it('keeps the 20 newest sessions of an account signed in', async () => {
    const user = await registerUser(context);

    for (let index = 0; index < 22; index += 1) {
      const response = await context.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: user.email, password: PASSWORD },
      });
      expect(response.statusCode).toBe(200);
    }

    const live = await context.prisma.session.count({
      where: { userId: user.userId, revokedAt: null },
    });
    expect(live).toBe(20);
  });

  it('purges resolved incidents with the history, and never an open one', async () => {
    const user = await registerUser(context);
    const check = (
      await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/checks`,
        headers: auth(user.token),
        payload: { name: 'job', scheduleType: 'interval', periodSeconds: 3_600, graceSeconds: 60 },
      })
    ).json<CheckDto>();
    const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000);

    await context.prisma.incident.createMany({
      data: [
        { checkId: check.id, startedAt: daysAgo(101), resolvedAt: daysAgo(100) },
        { checkId: check.id, startedAt: daysAgo(101), resolvedAt: null },
        { checkId: check.id, startedAt: daysAgo(2), resolvedAt: daysAgo(1) },
      ],
    });

    const purged = await context.app.get(RetentionService).purge();
    expect(purged.incidents).toBe(1);
    expect(await context.prisma.incident.count({ where: { checkId: check.id } })).toBe(2);
    expect(await context.prisma.incident.count({ where: { checkId: check.id, resolvedAt: null } })).toBe(1);
  });
});
