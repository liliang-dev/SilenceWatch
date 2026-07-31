import { QuotaEnforcerService } from '../src/quotas/quota-enforcer.service';
import { auth, createTestApp, registerUser, type TestApp } from './utils/test-app';

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

describe('password reset', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({
      EMAIL_PROVIDER: 'smtp',
      SMTP_URL: 'smtp://user:pass@smtp.example.test:587',
    });
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  function tokenFrom(text: string): string {
    const match = /reset-password\?token=(\S+)/.exec(text);
    if (match === null) throw new Error(`no reset link in:\n${text}`);
    return decodeURIComponent(match[1] as string);
  }

  it('resets the password and signs every session out', async () => {
    const user = await registerUser(context);

    // The old session works right up until the reset.
    const before = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: auth(user.token),
    });
    expect(before.statusCode).toBe(200);

    const requested = await context.app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: user.email },
    });
    expect(requested.statusCode).toBe(204);

    const token = tokenFrom(context.emails.lastTo(user.email)?.text as string);
    const reset = await context.app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, newPassword: 'a-brand-new-long-password' },
    });
    expect(reset.statusCode).toBe(204);

    // Whoever knew the old password is signed out, on every device.
    const after = await context.app.inject({
      method: 'GET',
      url: '/api/auth/me',
      headers: auth(user.token),
    });
    expect(after.statusCode).toBe(401);

    const signIn = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'a-brand-new-long-password' },
    });
    expect(signIn.statusCode).toBe(200);
  });

  it('burns the token', async () => {
    const user = await registerUser(context);
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: user.email },
    });
    const token = tokenFrom(context.emails.lastTo(user.email)?.text as string);

    const first = await context.app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, newPassword: 'a-brand-new-long-password' },
    });
    expect(first.statusCode).toBe(204);

    const replay = await context.app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: { token, newPassword: 'yet-another-long-password' },
    });
    expect(replay.statusCode).toBe(400);
  });

  it('answers the same for an address with no account', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: 'nobody@example.test' },
    });

    expect(response.statusCode).toBe(204);
    expect(context.emails.lastTo('nobody@example.test')).toBeUndefined();
  });

  it('clears a lockout, so a reset is a way back in', async () => {
    const user = await registerUser(context);
    await context.prisma.user.update({
      where: { id: user.userId },
      data: { failedLoginCount: 10, lockedUntil: new Date(Date.now() + 900_000) },
    });

    await context.app.inject({
      method: 'POST',
      url: '/api/auth/forgot-password',
      payload: { email: user.email },
    });
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/reset-password',
      payload: {
        token: tokenFrom(context.emails.lastTo(user.email)?.text as string),
        newPassword: 'a-brand-new-long-password',
      },
    });

    const signIn = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: 'a-brand-new-long-password' },
    });
    expect(signIn.statusCode).toBe(200);
  });
});

describe('refresh token cookie', () => {
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

  it('sets the token as an HttpOnly, SameSite=Strict cookie', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'cookie@example.test', password: PASSWORD },
    });

    const cookie = response.headers['set-cookie'] as string;
    expect(cookie).toContain('sw_refresh=');
    // The whole point: no script can read it, and no other site can send it.
    expect(cookie).toContain('HttpOnly');
    expect(cookie).toContain('SameSite=Strict');
    expect(cookie).toContain('Path=/api/auth');
  });

  it('refreshes from the cookie with an empty body', async () => {
    const registered = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'cookie2@example.test', password: PASSWORD },
    });
    const cookie = (registered.headers['set-cookie'] as string).split(';')[0] as string;

    const refreshed = await context.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie },
      payload: {},
    });

    expect(refreshed.statusCode).toBe(200);
    expect(refreshed.json<{ accessToken: string }>().accessToken).toEqual(expect.any(String));
    // Rotated, so the cookie carries a different token than it arrived with.
    expect(refreshed.headers['set-cookie']).not.toContain(cookie.split('=')[1]);
  });

  it('clears the cookie when the token is refused', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/refresh',
      headers: { cookie: 'sw_refresh=not-a-real-token' },
      payload: {},
    });

    expect(response.statusCode).toBe(401);
    // Leaving a dead credential in the browser would make every page load
    // retry something that cannot work.
    expect(response.headers['set-cookie']).toContain('Max-Age=0');
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
      url: '/api/auth/login',
      payload: { email: user.email, password: 'wrong-password-entirely' },
    });
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
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
      url: '/api/auth/login',
      payload: { email: 'nobody@example.test', password: 'guessing' },
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
