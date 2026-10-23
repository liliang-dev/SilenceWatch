import { checkoutIdempotencyKey, encodeForm, HttpStripeApi } from './stripe.api';
import type { AppConfig } from '../config/config';

describe('encodeForm', () => {
  it('writes nested objects and lists the way Stripe reads them', () => {
    const form = encodeForm({
      mode: 'subscription',
      line_items: [{ price: 'price_1', quantity: 1 }],
      subscription_data: { metadata: { user_id: 'u 1' } },
      skipped: undefined,
      empty: null,
    });
    expect(decodeURIComponent(form)).toBe(
      'mode=subscription&line_items[0][price]=price_1&line_items[0][quantity]=1&subscription_data[metadata][user_id]=u 1',
    );
  });

  it('escapes what would break the encoding', () => {
    expect(encodeForm({ email: 'a+b@example.test&x=1' })).toBe('email=a%2Bb%40example.test%26x%3D1');
  });
});

describe('checkoutIdempotencyKey', () => {
  const params = { mode: 'subscription', customer: 'cus_1', line_items: [{ price: 'price_pro', quantity: 1 }] };
  const minute = 60_000;
  const at = 1_800_000_000_000;

  it('is the same for the same request in the same minute', () => {
    expect(checkoutIdempotencyKey(params, at)).toBe(checkoutIdempotencyKey({ ...params }, at + 20_000));
  });

  it('does not depend on the order the parameters were written in', () => {
    const reordered = { line_items: [{ quantity: 1, price: 'price_pro' }], customer: 'cus_1', mode: 'subscription' };
    expect(checkoutIdempotencyKey(reordered, at)).toBe(checkoutIdempotencyKey(params, at));
  });

  it('is another key for another request, or another minute', () => {
    const base = checkoutIdempotencyKey(params, at);
    expect(checkoutIdempotencyKey({ ...params, customer: 'cus_2' }, at)).not.toBe(base);
    expect(checkoutIdempotencyKey({ ...params, locale: 'fr' }, at)).not.toBe(base);
    expect(checkoutIdempotencyKey(params, at + 2 * minute)).not.toBe(base);
  });

  it('fits what Stripe accepts and carries nothing identifying', () => {
    const key = checkoutIdempotencyKey(params, at);
    expect(key.length).toBeLessThanOrEqual(255);
    expect(key).toMatch(/^silencewatch-checkout-[0-9a-f]{48}$/);
    expect(key).not.toContain('cus_1');
  });
});

describe('HttpStripeApi.createCheckoutSession', () => {
  const config = { STRIPE_API_URL: 'https://stripe.test', STRIPE_SECRET_KEY: 'sk_test_123456789' } as AppConfig;
  const input = {
    customerId: 'cus_1',
    priceId: 'price_pro',
    userId: 'user-1',
    successUrl: 'https://app.test/ok',
    cancelUrl: 'https://app.test/no',
    automaticTax: false,
  };

  afterEach(() => jest.restoreAllMocks());

  const stub = () =>
    jest.spyOn(globalThis, 'fetch').mockImplementation(
      async () => new Response(JSON.stringify({ url: 'https://checkout.stripe.test/s' }), { status: 200 }),
    );

  const keyOf = (spy: jest.SpyInstance, call: number): string =>
    ((spy.mock.calls[call][1] as RequestInit).headers as Record<string, string>)['idempotency-key'] ?? '';

  it('sends the same key for the same request twice, so a double click opens one page', async () => {
    const spy = stub();
    const api = new HttpStripeApi(config);
    await api.createCheckoutSession(input);
    await api.createCheckoutSession(input);
    expect(keyOf(spy, 0)).toMatch(/^silencewatch-checkout-/);
    expect(keyOf(spy, 0)).toBe(keyOf(spy, 1));
  });

  it('sends another key when the language or the plan changed between the two clicks', async () => {
    const spy = stub();
    const api = new HttpStripeApi(config);
    await api.createCheckoutSession(input);
    await api.createCheckoutSession({ ...input, locale: 'fr' });
    await api.createCheckoutSession({ ...input, priceId: 'price_business' });
    const keys = new Set([keyOf(spy, 0), keyOf(spy, 1), keyOf(spy, 2)]);
    expect(keys.size).toBe(3);
  });
});
