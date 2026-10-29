import { QuotaEnforcerService } from '../src/quotas/quota-enforcer.service';
import { auth, createTestApp, registerUser, TEST_BASE_URL, type TestApp } from './utils/test-app';

const PASSWORD = 'a-sufficiently-long-password';

/**
 * Plan limits, password recovery, ping-key rotation and the audit trail — the
 * findings the security review left open, exercised against a real database.
 *
 * Quotas are switched on explicitly here. Everywhere else in the suite they are
 * off, which is the self-hosted default and the promise that self-hosting is
 * never the reduced edition.
 */
describe('plan quotas', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({
      QUOTAS_ENABLED: 'true',
      DEFAULT_PLAN: 'free',
      PLAN_LIMITS: JSON.stringify({
        free: { checks: 3, projects: 2, channelsPerProject: 1, retentionDays: 7 },
        pro: { checks: 10 },
        unlimited: {},
      }),
    });
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  async function createCheck(
    user: { token: string; projectId: string },
    name: string,
  ): Promise<number> {
    const response = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/checks`,
      headers: auth(user.token),
      payload: { name, scheduleType: 'interval', periodSeconds: 3600, graceSeconds: 300 },
    });
    return response.statusCode;
  }

  it('refuses a check past the plan limit, with the numbers in the answer', async () => {
    const user = await registerUser(context);

    expect(await createCheck(user, 'one')).toBe(201);
    expect(await createCheck(user, 'two')).toBe(201);
    expect(await createCheck(user, 'three')).toBe(201);

    const refused = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/checks`,
      headers: auth(user.token),
      payload: { name: 'four', scheduleType: 'interval', periodSeconds: 3600, graceSeconds: 300 },
    });

    // 402, not 403: "not on this plan" is a different answer from "never".
    expect(refused.statusCode).toBe(402);
    expect(refused.json<{ details: { quota: unknown } }>().details).toEqual({
      quota: { resource: 'checks', used: 3, limit: 3, plan: 'free' },
    });
  });

  it('counts checks across every project the account owns', async () => {
    // Otherwise "10 checks" would quietly mean "10 per project", and a plan
    // limit that a second project resets is not a limit.
    const user = await registerUser(context);
    const second = await context.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: auth(user.token),
      payload: { name: 'Second' },
    });
    const secondId = second.json<{ id: string }>().id;

    expect(await createCheck(user, 'one')).toBe(201);
    expect(await createCheck(user, 'two')).toBe(201);
    expect(await createCheck({ token: user.token, projectId: secondId }, 'three')).toBe(201);
    expect(await createCheck({ token: user.token, projectId: secondId }, 'four')).toBe(402);
  });

  it('limits projects and channels too', async () => {
    const user = await registerUser(context);

    // One project already exists from registration; the plan allows two.
    const second = await context.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: auth(user.token),
      payload: { name: 'Second' },
    });
    expect(second.statusCode).toBe(201);

    const third = await context.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: auth(user.token),
      payload: { name: 'Third' },
    });
    expect(third.statusCode).toBe(402);

    const channel = (name: string) =>
      context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/channels`,
        headers: auth(user.token),
        payload: { type: 'email', name, config: { address: `${name}@example.test` } },
      });
    expect((await channel('first')).statusCode).toBe(201);
    expect((await channel('second')).statusCode).toBe(402);
  });

  it('holds when the requests arrive all at once', async () => {
    const user = await registerUser(context);
    const created = (statuses: number[]) => statuses.filter((status) => status === 201).length;

    // Counting and creating are two steps: sent together, every request used to
    // count before any had created, and the plan of three checks gave twelve.
    const checks = await Promise.all(Array.from({ length: 12 }, (_, index) => createCheck(user, `c${index}`)));
    expect(created(checks)).toBe(3);
    expect(checks.filter((status) => status === 402)).toHaveLength(9);
    expect(await context.prisma.check.count()).toBe(3);

    const projects = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        context.app.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: auth(user.token),
          payload: { name: `p${index}` },
        }),
      ),
    );
    expect(created(projects.map((response) => response.statusCode))).toBe(1);
    expect(await context.prisma.projectMember.count({ where: { userId: user.userId, role: 'owner' } })).toBe(2);

    const channels = await Promise.all(
      Array.from({ length: 6 }, (_, index) =>
        context.app.inject({
          method: 'POST',
          url: `/api/v1/projects/${user.projectId}/channels`,
          headers: auth(user.token),
          payload: { type: 'email', name: `ch${index}`, config: { address: `ch${index}@example.test` } },
        }),
      ),
    );
    expect(created(channels.map((response) => response.statusCode))).toBe(1);
  });

  it('holds back only the excess on a starter sync, and says which', async () => {
    // The starter runs inside somebody's application startup. Failing the whole
    // sync because the eleventh job would not fit is not an option.
    const user = await registerUser(context);
    const keyResponse = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/api-keys`,
      headers: auth(user.token),
      payload: { name: 'starter' },
    });
    const apiKey = keyResponse.json<{ token: string }>().token;

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/checks/sync',
      headers: auth(apiKey),
      payload: {
        source: 'test',
        checks: ['a', 'b', 'c', 'd', 'e'].map((key) => ({
          key,
          name: key,
          interval_seconds: 3600,
        })),
      },
    });

    expect(response.statusCode).toBe(200);
    const body = response.json<{ checks: unknown[]; skipped: string[] }>();
    expect(body.checks).toHaveLength(3);
    expect(body.skipped).toEqual(['d', 'e']);
  });

  it('pauses the newest checks on a downgrade, and resumes them on an upgrade', async () => {
    const user = await registerUser(context);
    await context.prisma.user.update({ where: { id: user.userId }, data: { plan: 'pro' } });

    for (const name of ['first', 'second', 'third', 'fourth', 'fifth']) {
      expect(await createCheck(user, name)).toBe(201);
    }

    // The billing system writes the column; the reconciler is what makes it mean
    // something.
    await context.prisma.user.update({ where: { id: user.userId }, data: { plan: 'free' } });
    const enforcer = context.app.get(QuotaEnforcerService);

    const down = await enforcer.reconcile();
    expect(down.paused).toBe(2);

    const paused = await context.prisma.check.findMany({
      where: { pausedReason: 'quota' },
      select: { name: true },
    });
    // Newest first: the checks somebody has relied on longest are the last to go.
    expect(paused.map((check) => check.name).sort()).toEqual(['fifth', 'fourth']);

    const notice = context.emails.lastTo(user.email);
    expect(notice?.subject).toContain('paused');
    expect(notice?.text).toContain('fifth');

    await context.prisma.user.update({ where: { id: user.userId }, data: { plan: 'pro' } });
    const up = await enforcer.reconcile();
    expect(up.resumed).toBe(2);

    // Resumed as NEW, not UP: nothing is known about a job that has not reported
    // since it was switched off.
    const resumed = await context.prisma.check.findMany({
      where: { name: { in: ['fourth', 'fifth'] } },
      select: { state: true, pausedReason: true },
    });
    expect(resumed.every((check) => check.state === 'NEW' && check.pausedReason === null)).toBe(true);
  });

  it('leaves a deliberately paused check alone', async () => {
    const user = await registerUser(context);
    await context.prisma.user.update({ where: { id: user.userId }, data: { plan: 'pro' } });
    expect(await createCheck(user, 'switched-off')).toBe(201);

    const check = await context.prisma.check.findFirstOrThrow({ where: { name: 'switched-off' } });
    await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/checks/${check.id}`,
      headers: auth(user.token),
      payload: { paused: true },
    });

    await context.prisma.user.update({ where: { id: user.userId }, data: { plan: 'unlimited' } });
    await context.app.get(QuotaEnforcerService).reconcile();

    // An unlimited plan resumes what quota paused — and nothing else.
    const after = await context.prisma.check.findUniqueOrThrow({ where: { id: check.id } });
    expect(after.state).toBe('PAUSED');
    expect(after.pausedReason).toBeNull();
  });
});

describe('ping key rotation', () => {
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

  it('issues a new URL, kills the old one, and keeps the history', async () => {
    const user = await registerUser(context);
    const created = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/checks`,
      headers: auth(user.token),
      payload: { name: 'leaky', scheduleType: 'interval', periodSeconds: 3600, graceSeconds: 300 },
    });
    const check = created.json<{ id: string; pingUrl: string }>();
    const oldKey = check.pingUrl.split('/').pop() as string;

    await context.app.inject({ method: 'GET', url: `/p/${oldKey}` });
    expect(await context.prisma.ping.count({ where: { checkId: check.id } })).toBe(1);

    const rotated = await context.app.inject({
      method: 'POST',
      url: `/api/v1/checks/${check.id}/rotate-ping-key`,
      headers: auth(user.token),
    });
    expect(rotated.statusCode).toBe(200);

    const newKey = rotated.json<{ pingUrl: string }>().pingUrl.split('/').pop() as string;
    expect(newKey).not.toBe(oldKey);

    // The old URL is gone the moment it is rotated — that is the point.
    const stale = await context.app.inject({ method: 'GET', url: `/p/${oldKey}` });
    expect(stale.statusCode).toBe(404);

    const fresh = await context.app.inject({ method: 'GET', url: `/p/${newKey}` });
    expect(fresh.statusCode).toBe(200);

    // And the history that made deleting-and-recreating unacceptable is intact.
    expect(await context.prisma.ping.count({ where: { checkId: check.id } })).toBe(2);
  });
});

describe('audit trail', () => {
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

  /** The trail is written fire-and-forget; give it a tick to land. */
  async function settled(): Promise<void> {
    await new Promise((resolve) => setTimeout(resolve, 150));
  }

  it('records a sign-in and a failed attempt, with the address that acted', async () => {
    const user = await registerUser(context);

    await context.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: TEST_BASE_URL },
      payload: { email: user.email, password: 'wrong-password-entirely' },
    });
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: TEST_BASE_URL },
      payload: { email: user.email, password: PASSWORD },
    });
    await settled();

    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/account/audit',
      headers: auth(user.token),
    });
    const actions = response.json<{ items: Array<{ action: string; actorEmail: string }> }>().items;

    expect(actions.map((event) => event.action)).toEqual(
      expect.arrayContaining(['auth.login', 'auth.login_failed', 'account.registered']),
    );
    expect(actions.every((event) => event.actorEmail === user.email)).toBe(true);
  });

  it('records a sign-in attempt against an address that has no account', async () => {
    // This is the shape of a password-spraying run, and it is invisible if only
    // failures against real accounts are kept.
    await registerUser(context);
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: TEST_BASE_URL },
      payload: { email: 'nobody@example.test', password: 'guessing-guessing' },
    });
    await settled();

    const events = await context.prisma.auditEvent.findMany({
      where: { action: 'auth.login_failed' },
    });
    expect(events).toHaveLength(1);
    expect(events[0]?.actorEmail).toBe('nobody@example.test');
    expect(events[0]?.actorUserId).toBeNull();
  });

  it('records key and channel changes without recording the secrets', async () => {
    const user = await registerUser(context);

    const key = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/api-keys`,
      headers: auth(user.token),
      payload: { name: 'ci' },
    });
    const token = key.json<{ token: string }>().token;

    await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/channels`,
      headers: auth(user.token),
      payload: {
        type: 'webhook',
        name: 'ops',
        config: { url: 'https://hooks.example.test/abc', secret: 'super-secret-signing-key' },
      },
    });
    await settled();

    const response = await context.app.inject({
      method: 'GET',
      url: `/api/v1/projects/${user.projectId}/audit`,
      headers: auth(user.token),
    });
    const body = response.body;

    expect(response.statusCode).toBe(200);
    expect(body).toContain('api_key.created');
    expect(body).toContain('channel.created');
    // The trail is readable by every admin on the project, so a secret in it
    // would be a disclosure rather than a record.
    expect(body).not.toContain(token);
    expect(body).not.toContain('super-secret-signing-key');
  });

  it('survives the deletion of what it describes', async () => {
    const user = await registerUser(context);
    const created = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/checks`,
      headers: auth(user.token),
      payload: { name: 'doomed', scheduleType: 'interval', periodSeconds: 3600, graceSeconds: 300 },
    });
    const checkId = created.json<{ id: string }>().id;

    await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/checks/${checkId}`,
      headers: auth(user.token),
    });
    await settled();

    // The name is the only thing left to say what was lost.
    const events = await context.prisma.auditEvent.findMany({ where: { action: 'check.deleted' } });
    expect(events[0]?.targetLabel).toBe('doomed');
    expect(events[0]?.targetId).toBe(checkId);
  });

  /**
   * Deleting a project takes every check, ping and incident with it — the most
   * destructive thing the API can do, and for a while the only one that left no
   * trace at all.
   */
  it('records a project deletion where its owner can still read it', async () => {
    const user = await registerUser(context);
    const created = await context.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: auth(user.token),
      payload: { name: 'Doomed project' },
    });
    const projectId = created.json<{ id: string }>().id;

    const removed = await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${projectId}`,
      headers: auth(user.token),
    });
    expect(removed.statusCode).toBe(204);
    await settled();

    // Filed against the account, not the project: a trail readable only through
    // the project would have died with it.
    const response = await context.app.inject({
      method: 'GET',
      url: '/api/v1/account/audit',
      headers: auth(user.token),
    });
    const event = response
      .json<{ items: Array<{ action: string; targetId: string; targetLabel: string }> }>()
      .items.find((item) => item.action === 'project.deleted');

    expect(event?.targetId).toBe(projectId);
    expect(event?.targetLabel).toBe('Doomed project');
  });

  it('records a sign-out, so an open session can be told from a closed one', async () => {
    const user = await registerUser(context);

    const out = () =>
      context.app.inject({
        method: 'POST',
        url: '/api/auth/sign-out',
        headers: auth(user.token),
        payload: {},
      });
    await out();
    await settled();

    const events = await context.prisma.auditEvent.findMany({ where: { action: 'auth.logout' } });
    expect(events).toHaveLength(1);
    expect(events[0]?.actorEmail).toBe(user.email);

    // Replaying the dead session must not write a second entry: anyone holding a
    // revoked cookie could otherwise append to the trail at will.
    await out();
    await settled();
    expect(await context.prisma.auditEvent.count({ where: { action: 'auth.logout' } })).toBe(1);
  });

  it('refuses an API key read access to the trail', async () => {
    // A leaked key must not become a way to learn who signs in, and from where.
    const user = await registerUser(context);
    const key = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/api-keys`,
      headers: auth(user.token),
      payload: { name: 'ci' },
    });

    const response = await context.app.inject({
      method: 'GET',
      url: `/api/v1/projects/${user.projectId}/audit`,
      headers: auth(key.json<{ token: string }>().token),
    });
    // 401, the same answer every user-session-only endpoint gives a key —
    // consistency matters more here than the 403 the situation might suggest.
    expect(response.statusCode).toBe(401);
    expect(response.json<{ message: string }>().message).toContain('user session');
  });
});
