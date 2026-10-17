import { Inject, Injectable } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';

/**
 * The few things asked of Stripe. An abstract class rather than an interface so
 * that it is its own injection token, and so that the tests can put a stand-in in
 * its place: no test of this application ever contacts Stripe.
 */
export abstract class StripeApi {
  abstract createCustomer(input: { email: string; userId: string }): Promise<{ id: string }>;

  abstract createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    userId: string;
    successUrl: string;
    cancelUrl: string;
    automaticTax: boolean;
  }): Promise<{ url: string }>;

  abstract createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }>;

  /** Ends a subscription at once. One that is already gone is not an error. */
  abstract cancelSubscription(subscriptionId: string): Promise<void>;
}

/** Stripe answered with an error, or did not answer. */
export class StripeError extends Error {
  constructor(
    message: string,
    readonly status: number | null,
    readonly code: string | null,
  ) {
    super(message);
    this.name = 'StripeError';
  }
}

/**
 * The version the requests below were written against, so that a change of the
 * account's default version cannot change what they mean. Events are delivered
 * in the version of the webhook endpoint, which is why their handling accepts
 * both places Stripe has put a subscription's period end.
 */
const API_VERSION = '2024-06-20';
const TIMEOUT_MS = 15_000;

/** Stripe over its REST API, with `fetch`. */
@Injectable()
export class HttpStripeApi extends StripeApi {
  constructor(@Inject(CONFIG) private readonly config: AppConfig) {
    super();
  }

  async createCustomer(input: { email: string; userId: string }): Promise<{ id: string }> {
    const customer = await this.call<{ id: string }>(
      'POST',
      '/v1/customers',
      { email: input.email, metadata: { user_id: input.userId } },
      // Two checkouts started at once must end up with one customer.
      `silencewatch-customer-${input.userId}`,
    );
    return { id: customer.id };
  }

  async createCheckoutSession(input: {
    customerId: string;
    priceId: string;
    userId: string;
    successUrl: string;
    cancelUrl: string;
    automaticTax: boolean;
  }): Promise<{ url: string }> {
    const session = await this.call<{ url: string | null }>('POST', '/v1/checkout/sessions', {
      mode: 'subscription',
      customer: input.customerId,
      client_reference_id: input.userId,
      line_items: [{ price: input.priceId, quantity: 1 }],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      billing_address_collection: 'auto',
      locale: 'auto',
      subscription_data: { metadata: { user_id: input.userId } },
      ...(input.automaticTax
        ? { automatic_tax: { enabled: true }, customer_update: { address: 'auto' } }
        : {}),
    });
    if (typeof session.url !== 'string') {
      throw new StripeError('Stripe returned a checkout session without an address', null, null);
    }
    return { url: session.url };
  }

  async createPortalSession(input: { customerId: string; returnUrl: string }): Promise<{ url: string }> {
    const session = await this.call<{ url: string }>('POST', '/v1/billing_portal/sessions', {
      customer: input.customerId,
      return_url: input.returnUrl,
    });
    return { url: session.url };
  }

  async cancelSubscription(subscriptionId: string): Promise<void> {
    try {
      await this.call('DELETE', `/v1/subscriptions/${encodeURIComponent(subscriptionId)}`, undefined);
    } catch (error) {
      if (error instanceof StripeError && error.code === 'resource_missing') return;
      throw error;
    }
  }

  private async call<T>(
    method: 'POST' | 'DELETE',
    path: string,
    params: Record<string, unknown> | undefined,
    idempotencyKey?: string,
  ): Promise<T> {
    let response: Response;
    try {
      response = await fetch(`${this.config.STRIPE_API_URL}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${this.config.STRIPE_SECRET_KEY}`,
          'stripe-version': API_VERSION,
          ...(params === undefined ? {} : { 'content-type': 'application/x-www-form-urlencoded' }),
          ...(idempotencyKey === undefined ? {} : { 'idempotency-key': idempotencyKey }),
        },
        ...(params === undefined ? {} : { body: encodeForm(params) }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
    } catch (error) {
      // The message of a network error never carries the key: it is in a header.
      throw new StripeError(`Could not reach Stripe: ${(error as Error).message}`, null, null);
    }

    const body = (await response.json().catch(() => null)) as
      | (T & { error?: { message?: string; code?: string } })
      | null;
    if (!response.ok) {
      throw new StripeError(
        body?.error?.message ?? `Stripe answered ${response.status}`,
        response.status,
        body?.error?.code ?? null,
      );
    }
    return body as T;
  }
}

/** Stripe's form encoding: `a[b]=1`, `a[0][b]=1`. */
export function encodeForm(params: Record<string, unknown>): string {
  const pairs: string[] = [];
  const add = (key: string, value: unknown): void => {
    if (value === undefined || value === null) return;
    if (Array.isArray(value)) {
      value.forEach((item, index) => add(`${key}[${index}]`, item));
    } else if (typeof value === 'object') {
      for (const [name, inner] of Object.entries(value)) add(`${key}[${name}]`, inner);
    } else {
      pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  };
  for (const [key, value] of Object.entries(params)) add(key, value);
  return pairs.join('&');
}
