import { encodeForm } from './stripe.api';

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
