import type { CheckDto, CreatedApiKeyDto, NotificationChannelDto } from '@silencewatch/shared';
import { randomUUID } from 'node:crypto';
import { auth, createTestApp, registerUser, type TestApp } from './utils/test-app';

/**
 * An API key belongs to one project, and must reach nothing else: not another
 * account's projects, checks, channels or keys, and nothing of the account itself.
 * Every route is tried here with Alice's key against Bob's objects.
 */
describe('API key scope', () => {
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

  async function send(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    url: string,
    token: string,
    payload?: unknown,
  ): Promise<number> {
    const response = await context.app.inject({
      method,
      url: `/api${url}`,
      headers: auth(token),
      payload: payload as Record<string, unknown> | undefined,
    });
    return response.statusCode;
  }

  async function setup() {
    const alice = await registerUser(context);
    const bob = await registerUser(context);

    const key = (
      await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${alice.projectId}/api-keys`,
        headers: auth(alice.token),
        payload: { name: 'CI' },
      })
    ).json<CreatedApiKeyDto>();

    const bobCheck = (
      await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${bob.projectId}/checks`,
        headers: auth(bob.token),
        payload: { name: 'Bob job', scheduleType: 'interval', periodSeconds: 3_600, graceSeconds: 60 },
      })
    ).json<CheckDto>();

    const bobChannel = (
      await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${bob.projectId}/channels`,
        headers: auth(bob.token),
        payload: { type: 'slack', name: 'Bob ops', config: { url: 'https://hooks.example.com/x' } },
      })
    ).json<NotificationChannelDto>();

    return { alice, bob, key: key.token, keyId: key.id, bobCheck, bobChannel };
  }

  it('cannot read, change or delete anything of another account', async () => {
    const { bob, key, bobCheck, bobChannel } = await setup();
    const p = bob.projectId;
    const c = bobCheck.id;
    const ch = bobChannel.id;
    const nobody = randomUUID();

    const attempts: Array<[string, 'GET' | 'POST' | 'PATCH' | 'DELETE', string, unknown?]> = [
      ['project', 'GET', `/v1/projects/${p}`],
      ['project rename', 'PATCH', `/v1/projects/${p}`, { name: 'mine now' }],
      ['project delete', 'DELETE', `/v1/projects/${p}`],
      ['checks of project', 'GET', `/v1/projects/${p}/checks`],
      ['check create', 'POST', `/v1/projects/${p}/checks`, { name: 'x', scheduleType: 'interval', periodSeconds: 3_600, graceSeconds: 60 }],
      ['check read', 'GET', `/v1/checks/${c}`],
      ['check update', 'PATCH', `/v1/checks/${c}`, { name: 'hijacked' }],
      ['check delete', 'DELETE', `/v1/checks/${c}`],
      ['check rotate', 'POST', `/v1/checks/${c}/rotate-ping-key`],
      ['check pings', 'GET', `/v1/checks/${c}/pings`],
      ['check incidents', 'GET', `/v1/checks/${c}/incidents`],
      ['channels list', 'GET', `/v1/projects/${p}/channels`],
      ['channel create', 'POST', `/v1/projects/${p}/channels`, { type: 'slack', name: 'x', config: { url: 'https://hooks.example.com/y' } }],
      ['channel update', 'PATCH', `/v1/projects/${p}/channels/${ch}`, { enabled: false }],
      ['channel delete', 'DELETE', `/v1/projects/${p}/channels/${ch}`],
      ['channel test', 'POST', `/v1/projects/${p}/channels/${ch}/test`],
      ['keys list', 'GET', `/v1/projects/${p}/api-keys`],
      ['key create', 'POST', `/v1/projects/${p}/api-keys`, { name: 'x' }],
      ['key revoke', 'DELETE', `/v1/projects/${p}/api-keys/${nobody}`],
      ['audit of project', 'GET', `/v1/projects/${p}/audit`],
    ];

    for (const [label, method, url, payload] of attempts) {
      const status = await send(method, url, key, payload);
      // Another account's object is 404 (it does not exist for this key); what is
      // reserved to a user session is 401. Never a success, never a 403 that
      // would confirm the object exists.
      expect([401, 404]).toContain(status);
      if (status !== 401 && status !== 404) throw new Error(`${label}: ${status}`);
    }

    // Nothing of Bob's changed.
    const check = await context.prisma.check.findUniqueOrThrow({ where: { id: c } });
    expect(check.name).toBe('Bob job');
    expect(await context.prisma.notificationChannel.count({ where: { projectId: p } })).toBe(1);
    expect(await context.prisma.project.count({ where: { id: p } })).toBe(1);
  });

  it('only ever sees its own project in lists, and in the sync target', async () => {
    const { alice, bob, key, bobCheck } = await setup();

    const projects = await context.app.inject({ method: 'GET', url: '/api/v1/projects', headers: auth(key) });
    expect(projects.json<Array<{ id: string }>>().map((x) => x.id)).toEqual([alice.projectId]);

    const checks = await context.app.inject({ method: 'GET', url: '/api/v1/checks', headers: auth(key) });
    expect(checks.body).not.toContain(bobCheck.id);

    // Naming Bob's project in the query must not move the sync there.
    const synced = await context.app.inject({
      method: 'POST',
      url: `/api/v1/checks/sync?projectId=${bob.projectId}`,
      headers: auth(key),
      payload: { checks: [{ key: 'job', name: 'Planted', scheduleType: 'interval', periodSeconds: 3_600, graceSeconds: 60 }] },
    });
    expect(synced.statusCode).toBeLessThan(500);
    expect(await context.prisma.check.count({ where: { projectId: bob.projectId, name: 'Planted' } })).toBe(0);
  });

  it('has no say over the account, the audit trail or the server internals', async () => {
    const { key } = await setup();

    for (const [method, url, payload] of [
      ['GET', '/auth/me'],
      ['POST', '/auth/password', { currentPassword: 'x', newPassword: 'a-sufficiently-long-password' }],
      ['POST', '/auth/delete-account', { password: 'x', confirmation: 'x' }],
      ['GET', '/v1/account/audit'],
      ['POST', '/v1/projects', { name: 'Another' }],
      ['GET', '/v1/status'],
    ] as const) {
      expect(await send(method, url, key, payload)).toBe(401);
    }
  });

  it('manages the checks of its project but cannot delete them or rotate their ping key', async () => {
    const { alice, key } = await setup();

    const created = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${alice.projectId}/checks`,
      headers: auth(key),
      payload: { name: 'Mine', scheduleType: 'interval', periodSeconds: 3_600, graceSeconds: 60 },
    });
    expect(created.statusCode).toBe(201);
    const id = created.json<CheckDto>().id;

    expect(await send('PATCH', `/v1/checks/${id}`, key, { name: 'Renamed' })).toBe(200);
    expect(await send('POST', `/v1/checks/${id}/rotate-ping-key`, key)).toBe(403);
    expect(await send('DELETE', `/v1/checks/${id}`, key)).toBe(403);
    expect(await send('POST', `/v1/projects/${alice.projectId}/channels`, key, { type: 'slack', name: 'x', config: { url: 'https://hooks.example.com/z' } })).toBe(403);
  });
});

describe('login rate limit', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '5' });
  });

  afterAll(async () => {
    await context.close();
  });

  it('is not reset by changing the query string', async () => {
    const statuses: number[] = [];
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const response = await context.app.inject({
        method: 'POST',
        url: `/api/auth/login?x=${attempt}`,
        payload: { email: 'nobody@example.test', password: 'wrong-password-wrong' },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).toContain(429);
  });
});
