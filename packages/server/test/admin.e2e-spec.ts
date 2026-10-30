import type { AdminStatsDto, CreatedApiKeyDto, UserDto } from '@silencewatch/shared';
import {
  auth,
  createTestApp,
  registerAdmin,
  registerUser,
  signIn,
  TEST_ADMIN_EMAIL,
  TEST_BASE_URL,
  type TestApp,
} from './utils/test-app';

const DAY = 86_400_000;

/**
 * The administrator's figures: who may read them (only the account ADMIN_EMAIL
 * names, never an API key) and whether they count what they say they count.
 */
describe('administrator statistics', () => {
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

  const stats = (headers: Record<string, string> = {}) =>
    context.app.inject({ method: 'GET', url: '/api/v1/admin/stats', headers });

  describe('who may read them', () => {
    it('asks for a session first', async () => {
      expect((await stats()).statusCode).toBe(401);
      expect((await stats({ cookie: 'sw.session_token=forged' })).statusCode).toBe(401);
    });

    it('answers any other account as if the route did not exist', async () => {
      await registerAdmin(context);
      const customer = await registerUser(context);
      const response = await stats(auth(customer.token));
      expect(response.statusCode).toBe(404);
      expect(response.body).not.toContain('accounts');
    });

    it("refuses an API key, even one of the administrator's own projects", async () => {
      const admin = await registerAdmin(context);
      const fresh = await signIn(context, admin.email);
      const key = (
        await context.app.inject({
          method: 'POST',
          url: `/api/v1/projects/${admin.projectId}/api-keys`,
          headers: { ...auth(fresh), origin: TEST_BASE_URL },
          payload: { name: 'CI' },
        })
      ).json<CreatedApiKeyDto>();

      expect((await stats({ authorization: `Bearer ${key.token}` })).statusCode).toBe(401);
      expect(
        (await context.app.inject({ method: 'GET', url: '/api/v1/status', headers: { authorization: `Bearer ${key.token}` } }))
          .statusCode,
      ).toBe(401);
    });

    it('answers the administrator, and tells nobody else that they are one', async () => {
      const admin = await registerAdmin(context);
      const customer = await registerUser(context);

      const response = await stats(auth(admin.token));
      expect(response.statusCode).toBe(200);
      // Figures about everyone: no cache along the way may keep a copy.
      expect(response.headers['cache-control']).toBe('no-store');

      const me = (token: string) =>
        context.app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(token) }).then((r) => r.json<UserDto>());
      expect((await me(admin.token)).admin).toBe(true);
      expect((await me(customer.token)).admin).toBe(false);
    });

    it('accepts only reads', async () => {
      const admin = await registerAdmin(context);
      for (const method of ['POST', 'PATCH', 'DELETE'] as const) {
        const response = await context.app.inject({
          method,
          url: '/api/v1/admin/stats',
          headers: { ...auth(admin.token), origin: TEST_BASE_URL },
          payload: {},
        });
        expect(response.statusCode).toBe(404);
      }
    });
  });

  describe('what they count', () => {
    it('counts accounts and checks, in total and over the last 30 days, without naming any', async () => {
      const admin = await registerAdmin(context);
      const customer = await registerUser(context, 'customer@example.test');

      // An account and a check from long ago: in the totals, not in the 30 days.
      await context.prisma.user.update({
        where: { id: customer.userId },
        data: { createdAt: new Date(Date.now() - 40 * DAY) },
      });
      for (const name of ['one', 'two', 'three']) {
        await context.app.inject({
          method: 'POST',
          url: `/api/v1/projects/${customer.projectId}/checks`,
          headers: { ...auth(customer.token), origin: TEST_BASE_URL },
          payload: { name, scheduleType: 'interval', periodSeconds: 3600, graceSeconds: 60 },
        });
      }
      await context.prisma.check.updateMany({ where: { name: 'one' }, data: { createdAt: new Date(Date.now() - 40 * DAY) } });
      await context.prisma.check.updateMany({ where: { name: 'two' }, data: { createdAt: new Date(Date.now() - 2 * DAY - 3_600_000) } });

      const body = (await stats(auth(admin.token))).json<AdminStatsDto>();

      expect(body.accounts).toMatchObject({ total: 2, last30Days: 1 });
      expect(body.checks).toMatchObject({ total: 3, last30Days: 2 });
      expect(body.checks.daily).toHaveLength(30);
      // Oldest first: the last day is today's check, two days before it the other.
      expect(body.checks.daily[29]).toBe(1);
      expect(body.checks.daily[27]).toBe(1);
      expect(body.checks.daily.reduce((a, b) => a + b, 0)).toBe(2);

      // Billing is off on this instance: no subscriptions to count.
      expect(body.subscriptions).toBeNull();

      // Figures, never who.
      const text = JSON.stringify(body);
      expect(text).not.toContain('customer@example.test');
      expect(text).not.toContain(customer.userId);
      expect(text).not.toContain(customer.projectId);
    });

    it('counts the alert emails sent in the last 30 days, and nothing else', async () => {
      const admin = await registerAdmin(context);
      const project = admin.projectId;

      const check = await context.prisma.check.create({
        data: {
          projectId: project,
          name: 'job',
          slug: 'job',
          scheduleType: 'interval',
          periodSeconds: 3600,
          graceSeconds: 60,
          nextDueAt: new Date(),
        },
      });
      const incident = await context.prisma.incident.create({ data: { checkId: check.id, startedAt: new Date() } });
      const email = await context.prisma.notificationChannel.create({
        data: { projectId: project, type: 'email', name: 'mail', config: { address: 'a@example.test' } },
      });
      const hook = await context.prisma.notificationChannel.create({
        data: { projectId: project, type: 'webhook', name: 'hook', config: { url: 'https://h.example.test' } },
      });
      await context.prisma.notificationDelivery.createMany({
        data: [
          // Counted: an email, sent today.
          { incidentId: incident.id, channelId: email.id, kind: 'down', status: 'sent', sentAt: new Date() },
          // Counted on its day: an email sent five days ago.
          { incidentId: incident.id, channelId: email.id, kind: 'up', status: 'sent', sentAt: new Date(Date.now() - 5 * DAY - 3_600_000) },
          // Not an email.
          { incidentId: incident.id, channelId: hook.id, kind: 'down', status: 'sent', sentAt: new Date() },
          // Not sent.
          { incidentId: incident.id, channelId: hook.id, kind: 'up', status: 'failed' },
        ],
      });

      const body = (await stats(auth(admin.token))).json<AdminStatsDto>();
      expect(body.alertEmails.last30Days).toBe(2);
      expect(body.alertEmails.daily[29]).toBe(1);
      expect(body.alertEmails.daily[24]).toBe(1);

      // The failed one, on the day it was raised and under its channel's type.
      expect(body.failedAlerts.last30Days).toBe(1);
      expect(body.failedAlerts.daily[29]).toBe(1);
      expect(body.failedAlerts.byType).toEqual({ email: 0, webhook: 1, slack: 0, teams: 0, discord: 0 });

      // Every type is listed, the unused ones as zero.
      expect(body.channels).toEqual({
        total: 2,
        byType: { email: 1, webhook: 1, slack: 0, teams: 0, discord: 0 },
      });
    });

    it('leaves out the alerts that failed more than 30 days ago', async () => {
      const admin = await registerAdmin(context);
      const check = await context.prisma.check.create({
        data: {
          projectId: admin.projectId,
          name: 'job',
          slug: 'job',
          scheduleType: 'interval',
          periodSeconds: 3600,
          graceSeconds: 60,
          nextDueAt: new Date(),
        },
      });
      const incident = await context.prisma.incident.create({ data: { checkId: check.id, startedAt: new Date() } });
      const slack = await context.prisma.notificationChannel.create({
        data: { projectId: admin.projectId, type: 'slack', name: 'chat', config: { url: 'https://hooks.slack.com/x' } },
      });
      await context.prisma.notificationDelivery.createMany({
        data: [
          { incidentId: incident.id, channelId: slack.id, kind: 'down', status: 'failed', createdAt: new Date(Date.now() - 40 * DAY) },
          { incidentId: incident.id, channelId: slack.id, kind: 'up', status: 'failed', createdAt: new Date(Date.now() - 3 * DAY - 3_600_000) },
        ],
      });

      const body = (await stats(auth(admin.token))).json<AdminStatsDto>();
      expect(body.failedAlerts.last30Days).toBe(1);
      expect(body.failedAlerts.daily[26]).toBe(1);
      expect(body.failedAlerts.byType.slack).toBe(1);
    });

    it('counts as active the accounts signed in or used in the last 30 days', async () => {
      const admin = await registerAdmin(context);
      const idle = await registerUser(context);
      const returning = await registerUser(context);
      const longAgo = new Date(Date.now() - 40 * DAY);

      // Neither signed in nor used for 40 days.
      await context.prisma.user.update({ where: { id: idle.userId }, data: { lastLoginAt: longAgo } });
      await context.prisma.$executeRaw`UPDATE session SET updated_at = ${longAgo} WHERE user_id = ${idle.userId}::uuid`;
      // Signed in long ago, but its session was used this week.
      await context.prisma.user.update({ where: { id: returning.userId }, data: { lastLoginAt: longAgo } });

      const body = (await stats(auth(admin.token))).json<AdminStatsDto>();
      expect(body.activeAccounts).toEqual({ active: 2, total: 3 });
    });

    it('counts the refused sign-ups by reason, without keeping who was refused', async () => {
      // The administrator's address, without the link: refused.
      const refused = await context.app.inject({
        method: 'POST',
        url: '/api/auth/sign-up/email',
        headers: { origin: TEST_BASE_URL, 'x-forwarded-for': '203.0.113.7' },
        payload: { email: TEST_ADMIN_EMAIL, password: 'a-sufficiently-long-password', name: '' },
      });
      expect(refused.statusCode).toBe(403);

      // The entry is written without blocking the request.
      let entries: Awaited<ReturnType<typeof context.prisma.auditEvent.findMany>> = [];
      for (let attempt = 0; attempt < 20 && entries.length === 0; attempt += 1) {
        entries = await context.prisma.auditEvent.findMany({ where: { action: 'signup.refused' } });
        if (entries.length === 0) await new Promise((resolve) => setTimeout(resolve, 50));
      }
      expect(entries).toHaveLength(1);
      expect(entries[0]).toMatchObject({ actorEmail: null, actorUserId: null, ip: null, userAgent: null, projectId: null });
      expect(entries[0]?.detail).toEqual({ reason: 'admin_without_link' });

      const admin = await registerAdmin(context);

      // One from long ago, and one from yesterday.
      await context.prisma.auditEvent.createMany({
        data: [
          { action: 'signup.refused', detail: { reason: 'signup_closed' }, occurredAt: new Date(Date.now() - 40 * DAY) },
          { action: 'signup.refused', detail: { reason: 'network_quota' }, occurredAt: new Date(Date.now() - DAY - 3_600_000) },
        ],
      });

      const body = (await stats(auth(admin.token))).json<AdminStatsDto>();
      expect(body.refusedSignups.last30Days).toBe(2);
      expect(body.refusedSignups.daily[29]).toBe(1);
      expect(body.refusedSignups.daily[28]).toBe(1);
      expect(body.refusedSignups.byReason).toEqual({
        admin_without_link: 1,
        signup_closed: 0,
        email_provider: 0,
        address_quota: 0,
        network_quota: 1,
      });
    });
  });
});

describe('administrator statistics, with billing', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({
      QUOTAS_ENABLED: 'true',
      DEFAULT_PLAN: 'free',
      PLAN_LIMITS: JSON.stringify({ free: { checks: 10 }, pro: { checks: 100 }, business: { checks: 1000 } }),
      BILLING_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_123456789',
      STRIPE_WEBHOOK_SECRET: 'whsec_test_secret_value',
      STRIPE_PLANS: JSON.stringify({
        business: { price: 'price_business', amount: 1999 },
        pro: { price: 'price_pro', amount: 499 },
      }),
    });
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  it('counts the live subscriptions of each paid plan, in price order', async () => {
    const admin = await registerAdmin(context);
    const subscribe = async (plan: string, status: string, ageDays = 0) => {
      const user = await registerUser(context);
      await context.prisma.subscription.create({
        data: {
          userId: user.userId,
          stripeCustomerId: `cus_${user.userId}`,
          stripeSubscriptionId: `sub_${user.userId}`,
          plan,
          status,
          createdAt: new Date(Date.now() - ageDays * DAY),
        },
      });
    };
    await subscribe('pro', 'active');
    await subscribe('pro', 'past_due', 45);
    await subscribe('pro', 'canceled');
    await subscribe('business', 'trialing', 3);

    const body = (
      await context.app.inject({ method: 'GET', url: '/api/v1/admin/stats', headers: auth(admin.token) })
    ).json<AdminStatsDto>();

    expect(body.subscriptions?.map((plan) => plan.plan)).toEqual(['pro', 'business']);
    expect(body.subscriptions?.[0]).toMatchObject({ plan: 'pro', active: 2, last30Days: 1 });
    expect(body.subscriptions?.[1]).toMatchObject({ plan: 'business', active: 1, last30Days: 1 });
  });
});
