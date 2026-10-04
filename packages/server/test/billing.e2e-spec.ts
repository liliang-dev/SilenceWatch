import type { AuditEventDto, BillingRedirectDto, BillingStateDto, PageDto } from '@silencewatch/shared';
import { QuotaEnforcerService } from '../src/quotas/quota-enforcer.service';
import { signStripePayload } from '../src/billing/stripe-signature';
import { auth, createTestApp, registerUser, type TestApp } from './utils/test-app';

const WEBHOOK_SECRET = 'whsec_test_secret_value';
const PASSWORD = 'a-sufficiently-long-password';

const BILLING = {
  QUOTAS_ENABLED: 'true',
  DEFAULT_PLAN: 'free',
  PLAN_LIMITS: JSON.stringify({
    free: { checks: 2, projects: 2, channelsPerProject: 2, retentionDays: 7 },
    pro: { checks: 5, projects: 5, channelsPerProject: 5, retentionDays: 30 },
    business: { checks: 20, projects: 20, channelsPerProject: 20, retentionDays: 90 },
  }),
  BILLING_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_123456789',
  STRIPE_WEBHOOK_SECRET: WEBHOOK_SECRET,
  STRIPE_PLANS: JSON.stringify({
    pro: { price: 'price_pro', amount: 499 },
    business: { price: 'price_business', amount: 999 },
  }),
};

describe('billing, off', () => {
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

  it('is invisible: it says it is off, answers no other route, and has no webhook', async () => {
    const user = await registerUser(context);

    const state = await context.app.inject({ method: 'GET', url: '/api/v1/billing', headers: auth(user.token) });
    expect(state.statusCode).toBe(200);
    expect(state.json<BillingStateDto>()).toEqual({
      enabled: false,
      plan: null,
      plans: [],
      usage: null,
      subscription: null,
    });

    for (const url of ['/api/v1/billing/checkout', '/api/v1/billing/portal']) {
      const response = await context.app.inject({
        method: 'POST',
        url,
        headers: auth(user.token),
        payload: url.endsWith('checkout') ? { plan: 'pro' } : undefined,
      });
      expect(response.statusCode).toBe(404);
    }

    const webhook = await context.app.inject({ method: 'POST', url: '/api/v1/billing/webhook', payload: '{}' });
    expect(webhook.statusCode).toBe(404);
    expect(context.stripe.customers).toHaveLength(0);
  });
});

describe('billing', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp(BILLING);
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  const get = (token: string) =>
    context.app.inject({ method: 'GET', url: '/api/v1/billing', headers: auth(token) });

  const checkout = (token: string, plan: string) =>
    context.app.inject({ method: 'POST', url: '/api/v1/billing/checkout', headers: auth(token), payload: { plan } });

  let eventCounter = 0;
  /** A signed delivery, as Stripe would make it. */
  function deliver(
    type: string,
    object: Record<string, unknown>,
    options: { id?: string; created?: number; secret?: string; signed?: boolean } = {},
  ) {
    const body = JSON.stringify({
      id: options.id ?? `evt_${(eventCounter += 1)}`,
      type,
      created: options.created ?? Math.floor(Date.now() / 1000),
      data: { object },
    });
    return context.app.inject({
      method: 'POST',
      url: '/api/v1/billing/webhook',
      headers: {
        'content-type': 'application/json',
        ...(options.signed === false
          ? {}
          : {
              'stripe-signature': signStripePayload(
                body,
                options.secret ?? WEBHOOK_SECRET,
                Math.floor(Date.now() / 1000),
              ),
            }),
      },
      payload: body,
    });
  }

  const subscription = (customer: string, overrides: Record<string, unknown> = {}) => ({
    id: 'sub_1',
    customer,
    status: 'active',
    cancel_at_period_end: false,
    current_period_end: Math.floor(Date.now() / 1000) + 30 * 86_400,
    items: { data: [{ price: { id: 'price_pro' } }] },
    ...overrides,
  });

  /** A user who has started a checkout, so that Stripe knows them as a customer. */
  async function customerWithCheckout() {
    const user = await registerUser(context);
    const started = await checkout(user.token, 'pro');
    expect(started.statusCode).toBe(200);
    return { user, customerId: context.stripe.customers[0]?.id as string };
  }

  const planOf = async (userId: string) =>
    (await context.prisma.user.findUniqueOrThrow({ where: { id: userId } })).plan;

  it('shows the plans, what the account uses and what it is on', async () => {
    const user = await registerUser(context);
    const state = (await get(user.token)).json<BillingStateDto>();

    expect(state.enabled).toBe(true);
    expect(state.plan).toBe('free');
    expect(state.usage).toEqual({ checks: 0, projects: 1 });
    expect(state.subscription).toBeNull();
    expect(state.plans.map((plan) => [plan.id, plan.amount, plan.purchasable])).toEqual([
      ['free', 0, false],
      ['pro', 499, true],
      ['business', 999, true],
    ]);
    expect(state.plans[1]).toMatchObject({
      currency: 'eur',
      limits: { checks: 5, projects: 5, channelsPerProject: 5, retentionDays: 30 },
    });
  });

  it('opens a payment page for a plan, with one customer however many times', async () => {
    const user = await registerUser(context);

    const first = await checkout(user.token, 'pro');
    expect(first.statusCode).toBe(200);
    expect(first.json<BillingRedirectDto>().url).toBe('https://checkout.stripe.test/price_pro');

    await checkout(user.token, 'business');
    expect(context.stripe.customers).toHaveLength(1);
    expect(context.stripe.customers[0]).toMatchObject({ email: user.email, userId: user.userId });
    expect(context.stripe.checkouts.map((session) => session.priceId)).toEqual(['price_pro', 'price_business']);
    expect(context.stripe.checkouts[0]).toMatchObject({
      userId: user.userId,
      successUrl: 'http://test.silencewatch.local/settings?tab=subscription&checkout=success',
      cancelUrl: 'http://test.silencewatch.local/settings?tab=subscription&checkout=cancelled',
      automaticTax: false,
    });

    // Nothing changes until Stripe says someone paid.
    expect(await planOf(user.userId)).toBe('free');
  });

  it('refuses a plan that is not for sale, and says so when Stripe is down', async () => {
    const user = await registerUser(context);

    expect((await checkout(user.token, 'free')).statusCode).toBe(400);
    expect((await checkout(user.token, 'gold')).statusCode).toBe(400);

    context.stripe.failing = true;
    const down = await checkout(user.token, 'pro');
    expect(down.statusCode).toBe(502);
    // Stripe's own words stay in the log.
    expect(down.body).not.toContain('simulated');
  });

  it('is for the signed-in user alone: an API key has no say over what an account pays', async () => {
    const user = await registerUser(context);
    const key = (
      await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/api-keys`,
        headers: auth(user.token),
        payload: { name: 'CI' },
      })
    ).json<{ token: string }>().token;

    expect((await get(key)).statusCode).toBe(401);
    expect((await checkout(key, 'pro')).statusCode).toBe(401);
    expect(
      (await context.app.inject({ method: 'POST', url: '/api/v1/billing/portal', headers: auth(key) })).statusCode,
    ).toBe(401);
    expect(context.stripe.customers).toHaveLength(0);
  });

  describe('webhook', () => {
    it('turns away what is not signed with the secret, and changes nothing', async () => {
      const { user, customerId } = await customerWithCheckout();
      const paid = subscription(customerId);

      expect((await deliver('customer.subscription.created', paid, { signed: false })).statusCode).toBe(400);
      expect(
        (await deliver('customer.subscription.created', paid, { secret: 'whsec_somebody_else' })).statusCode,
      ).toBe(400);
      expect(
        (
          await context.app.inject({
            method: 'POST',
            url: '/api/v1/billing/webhook',
            headers: { 'stripe-signature': 't=1,v1=00' },
            payload: 'not json',
          })
        ).statusCode,
      ).toBe(400);

      expect(await planOf(user.userId)).toBe('free');
    });

    it('moves the account to the plan that was paid for, and says so in the trail', async () => {
      const { user, customerId } = await customerWithCheckout();

      const response = await deliver('customer.subscription.created', subscription(customerId));
      expect(response.statusCode).toBe(200);
      expect(await planOf(user.userId)).toBe('pro');

      const state = (await get(user.token)).json<BillingStateDto>();
      expect(state.plan).toBe('pro');
      expect(state.subscription).toMatchObject({ status: 'active', plan: 'pro', cancelAtPeriodEnd: false });
      expect(state.subscription?.currentPeriodEnd).not.toBeNull();

      await context.app.get(QuotaEnforcerService).reconcile();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const trail = (
        await context.app.inject({ method: 'GET', url: '/api/v1/account/audit', headers: auth(user.token) })
      ).json<PageDto<AuditEventDto>>();
      const change = trail.items.find((event) => event.action === 'billing.plan_changed');
      expect(change?.detail).toEqual({ from: 'free', to: 'pro', status: 'active' });
    });

    it('does the same event once, however many times Stripe sends it', async () => {
      const { user, customerId } = await customerWithCheckout();
      const created = subscription(customerId);

      expect((await deliver('customer.subscription.created', created, { id: 'evt_same' })).statusCode).toBe(200);
      await context.prisma.user.update({ where: { id: user.userId }, data: { plan: 'business' } });

      // The repeat is acknowledged and does nothing: if it had been applied, the
      // plan set by hand above would have gone back to pro.
      expect((await deliver('customer.subscription.created', created, { id: 'evt_same' })).statusCode).toBe(200);
      expect(await planOf(user.userId)).toBe('business');
      expect(await context.prisma.stripeEvent.count({ where: { id: 'evt_same' } })).toBe(1);
    });

    it('follows a change of plan, a cancellation set for the end of the period, and the end', async () => {
      const { user, customerId } = await customerWithCheckout();
      const now = Math.floor(Date.now() / 1000);

      await deliver('customer.subscription.created', subscription(customerId), { created: now - 30 });

      await deliver(
        'customer.subscription.updated',
        subscription(customerId, { items: { data: [{ price: { id: 'price_business' } }] } }),
        { created: now - 20 },
      );
      expect(await planOf(user.userId)).toBe('business');

      await deliver(
        'customer.subscription.updated',
        subscription(customerId, { items: { data: [{ price: { id: 'price_business' } }] }, cancel_at_period_end: true }),
        { created: now - 10 },
      );
      // Still paid for until the period ends.
      expect(await planOf(user.userId)).toBe('business');
      expect((await get(user.token)).json<BillingStateDto>().subscription?.cancelAtPeriodEnd).toBe(true);

      await deliver('customer.subscription.deleted', subscription(customerId, { status: 'canceled' }), { created: now });
      expect(await planOf(user.userId)).toBe('free');
      expect((await get(user.token)).json<BillingStateDto>().subscription).toMatchObject({
        status: 'canceled',
        plan: null,
      });
    });

    it('keeps the plan while a payment is being retried, and ends it when Stripe gives up', async () => {
      const { user, customerId } = await customerWithCheckout();
      const now = Math.floor(Date.now() / 1000);

      await deliver('customer.subscription.created', subscription(customerId), { created: now - 20 });
      await deliver('customer.subscription.updated', subscription(customerId, { status: 'past_due' }), { created: now - 10 });
      expect(await planOf(user.userId)).toBe('pro');
      expect((await get(user.token)).json<BillingStateDto>().subscription?.status).toBe('past_due');

      await deliver('customer.subscription.updated', subscription(customerId, { status: 'unpaid' }), { created: now });
      expect(await planOf(user.userId)).toBe('free');
    });

    it('does not let a late event undo a later one', async () => {
      const { user, customerId } = await customerWithCheckout();
      const now = Math.floor(Date.now() / 1000);

      await deliver('customer.subscription.updated', subscription(customerId), { created: now });
      // Created earlier, delivered later: it describes a subscription that has
      // since changed.
      await deliver('customer.subscription.updated', subscription(customerId, { status: 'canceled' }), {
        created: now - 60,
      });
      expect(await planOf(user.userId)).toBe('pro');
    });

    it('ignores an old subscription ending while a new one runs', async () => {
      const { user, customerId } = await customerWithCheckout();
      const now = Math.floor(Date.now() / 1000);

      await deliver('customer.subscription.created', subscription(customerId, { id: 'sub_new' }), { created: now - 5 });
      await deliver('customer.subscription.deleted', subscription(customerId, { id: 'sub_old' }), { created: now });
      expect(await planOf(user.userId)).toBe('pro');
    });

    it('leaves the plan alone for a price that is not one of ours, and for customers it does not know', async () => {
      const { user, customerId } = await customerWithCheckout();

      const other = subscription(customerId, { items: { data: [{ price: { id: 'price_something_else' } }] } });
      expect((await deliver('customer.subscription.created', other)).statusCode).toBe(200);
      expect(await planOf(user.userId)).toBe('free');

      // Another product on the same Stripe account is not this application's business.
      expect((await deliver('customer.subscription.created', subscription('cus_stranger'))).statusCode).toBe(200);
      expect((await deliver('invoice.paid', { id: 'in_1' })).statusCode).toBe(200);
      expect(await context.prisma.subscription.count()).toBe(1);
    });

    it('refuses a second subscription next to a running one, and sends the account to the portal instead', async () => {
      const { user, customerId } = await customerWithCheckout();
      await deliver('customer.subscription.created', subscription(customerId));

      const again = await checkout(user.token, 'business');
      expect(again.statusCode).toBe(409);

      const portal = await context.app.inject({
        method: 'POST',
        url: '/api/v1/billing/portal',
        headers: auth(user.token),
      });
      expect(portal.statusCode).toBe(200);
      expect(portal.json<BillingRedirectDto>().url).toBe(`https://portal.stripe.test/${customerId}`);
      expect(context.stripe.portals[0]?.returnUrl).toBe('http://test.silencewatch.local/settings?tab=subscription');
    });

    it('has no portal for an account that never paid', async () => {
      const user = await registerUser(context);
      const portal = await context.app.inject({
        method: 'POST',
        url: '/api/v1/billing/portal',
        headers: auth(user.token),
      });
      expect(portal.statusCode).toBe(404);
    });

    it('lets the quotas act on what the new plan allows', async () => {
      const { user, customerId } = await customerWithCheckout();
      await deliver('customer.subscription.created', subscription(customerId));

      for (const name of ['a', 'b', 'c', 'd']) {
        const created = await context.app.inject({
          method: 'POST',
          url: `/api/v1/projects/${user.projectId}/checks`,
          headers: auth(user.token),
          payload: { name, scheduleType: 'interval', periodSeconds: 3600, graceSeconds: 300 },
        });
        expect(created.statusCode).toBe(201);
      }

      await deliver('customer.subscription.deleted', subscription(customerId, { status: 'canceled' }));
      const outcome = await context.app.get(QuotaEnforcerService).reconcile();

      // Four checks on a plan that allows two: the two newest are paused, not deleted.
      expect(outcome.paused).toBe(2);
      expect(await context.prisma.check.count({ where: { project: { id: user.projectId } } })).toBe(4);
    });
  });

  describe('deleting the account', () => {
    const deleteAccount = (token: string) =>
      context.app.inject({
        method: 'POST',
        url: '/api/auth/delete-account',
        headers: auth(token),
        payload: { password: PASSWORD },
      });

    it('ends the subscription first, so no card is charged for an account that is gone', async () => {
      const { user, customerId } = await customerWithCheckout();
      await deliver('customer.subscription.created', subscription(customerId, { id: 'sub_to_end' }));

      expect((await deleteAccount(user.token)).statusCode).toBe(204);
      expect(context.stripe.cancelled).toEqual(['sub_to_end']);
      expect(await context.prisma.user.count({ where: { id: user.userId } })).toBe(0);
      expect(await context.prisma.subscription.count()).toBe(0);
    });

    it('keeps the account when the subscription cannot be ended', async () => {
      const { user, customerId } = await customerWithCheckout();
      await deliver('customer.subscription.created', subscription(customerId));

      context.stripe.failing = true;
      expect((await deleteAccount(user.token)).statusCode).toBe(502);
      expect(await context.prisma.user.count({ where: { id: user.userId } })).toBe(1);

      context.stripe.failing = false;
      expect((await deleteAccount(user.token)).statusCode).toBe(204);
    });

    it('needs nothing from Stripe for an account that never paid', async () => {
      const user = await registerUser(context);
      expect((await deleteAccount(user.token)).statusCode).toBe(204);
      expect(context.stripe.cancelled).toHaveLength(0);
    });
  });
});
