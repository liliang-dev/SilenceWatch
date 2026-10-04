import { decidePlan, readSubscriptionEvent, type StripeEvent } from './stripe-events';

const PLANS = {
  pro: { price: 'price_pro', amount: 499 },
  business: { price: 'price_business', amount: 999 },
};

function event(type: string, object: Record<string, unknown>): StripeEvent {
  return { id: 'evt_1', type, created: 1_800_000_000, data: { object } };
}

const subscription = (overrides: Record<string, unknown> = {}) => ({
  id: 'sub_1',
  customer: 'cus_1',
  status: 'active',
  cancel_at_period_end: false,
  current_period_end: 1_802_000_000,
  items: { data: [{ price: { id: 'price_pro' } }] },
  ...overrides,
});

describe('readSubscriptionEvent', () => {
  it('reads a subscription', () => {
    const change = readSubscriptionEvent(event('customer.subscription.updated', subscription()));
    expect(change).toEqual({
      customerId: 'cus_1',
      subscriptionId: 'sub_1',
      status: 'active',
      priceId: 'price_pro',
      currentPeriodEnd: new Date(1_802_000_000_000),
      cancelAtPeriodEnd: false,
    });
  });

  it('finds the period end on the item, where recent API versions put it', () => {
    const change = readSubscriptionEvent(
      event(
        'customer.subscription.created',
        subscription({
          current_period_end: undefined,
          items: { data: [{ price: { id: 'price_pro' }, current_period_end: 1_803_000_000 }] },
        }),
      ),
    );
    expect(change?.currentPeriodEnd).toEqual(new Date(1_803_000_000_000));
  });

  it('reads a customer sent expanded, and calls a deleted subscription cancelled', () => {
    const change = readSubscriptionEvent(
      event('customer.subscription.deleted', subscription({ customer: { id: 'cus_2' }, status: 'active' })),
    );
    expect(change?.customerId).toBe('cus_2');
    expect(change?.status).toBe('canceled');
  });

  it('ignores other events, and subscriptions that do not say whose they are', () => {
    expect(readSubscriptionEvent(event('invoice.paid', subscription()))).toBeNull();
    expect(readSubscriptionEvent(event('customer.subscription.updated', { id: 'sub_1' }))).toBeNull();
    expect(readSubscriptionEvent(event('customer.subscription.updated', { customer: 'cus_1' }))).toBeNull();
  });
});

describe('decidePlan', () => {
  const change = (status: string, priceId: string | null = 'price_pro') => ({
    customerId: 'cus_1',
    subscriptionId: 'sub_1',
    status,
    priceId,
    currentPeriodEnd: null,
    cancelAtPeriodEnd: false,
  });

  it('grants the plan the price buys while the customer is paying or being asked to', () => {
    expect(decidePlan(change('active'), PLANS)).toEqual({ kind: 'grant', plan: 'pro' });
    expect(decidePlan(change('trialing', 'price_business'), PLANS)).toEqual({ kind: 'grant', plan: 'business' });
    // A declined card is not the end of the plan: Stripe retries first.
    expect(decidePlan(change('past_due'), PLANS)).toEqual({ kind: 'grant', plan: 'pro' });
  });

  it('ends the subscription when Stripe says it is over', () => {
    for (const status of ['canceled', 'unpaid', 'incomplete_expired', 'paused']) {
      expect(decidePlan(change(status), PLANS)).toEqual({ kind: 'end' });
    }
  });

  it('says nothing about the plan while a first payment is still pending', () => {
    expect(decidePlan(change('incomplete'), PLANS)).toEqual({ kind: 'keep', reason: 'not_settled' });
  });

  it('leaves a price that is not ours alone', () => {
    expect(decidePlan(change('active', 'price_other'), PLANS)).toEqual({ kind: 'keep', reason: 'unknown_price' });
    expect(decidePlan(change('active', null), PLANS)).toEqual({ kind: 'keep', reason: 'unknown_price' });
  });
});
