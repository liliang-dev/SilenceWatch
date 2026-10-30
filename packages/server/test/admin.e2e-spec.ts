import type { AdminStatsDto, CreatedApiKeyDto, UserDto } from '@silencewatch/shared';
import {
  auth,
  createTestApp,
  registerAdmin,
  registerUser,
  signIn,
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
