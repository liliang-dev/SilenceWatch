import { z } from 'zod';
import { booleanish, optional } from '../env-helpers';

/** Subscriptions, through Stripe. */
export const billingShape = {
  /* --- subscriptions ------------------------------------------------------
   * Off by default, and invisible when off: no route answers, the Settings
   * page has no subscription tab, nothing contacts Stripe. A self-hosted
   * instance never sets any of this. Billing needs quotas (QUOTAS_ENABLED and
   * PLAN_LIMITS) because a subscription is only ever a way of choosing a plan.
   *
   * Stripe is reached over its REST API with the standard `fetch`, with no SDK:
   * the three calls made are small, and a payment library is the last
   * dependency to take without reading.
   */
  BILLING_ENABLED: booleanish.prefault('false'),
  /** A secret or restricted key (`sk_…` or `rk_…`), never the publishable one. */
  STRIPE_SECRET_KEY: optional(z.string().min(8).max(300)),
  /** The signing secret of the webhook endpoint (`whsec_…`). */
  STRIPE_WEBHOOK_SECRET: optional(z.string().min(8).max(300)),
  /**
   * The paid plans, as JSON: the plan name (a key of PLAN_LIMITS), the Stripe
   * price that buys it, and the monthly amount shown in the application.
   *
   *   {"pro":{"price":"price_123","amount":499},
   *    "business":{"price":"price_456","amount":1999}}
   */
  STRIPE_PLANS: z.preprocess((value) => (value === '' ? undefined : value), z.string().default('{}')),
  /** ISO 4217 code of the prices, lower case. */
  BILLING_CURRENCY: z.string().regex(/^[a-z]{3}$/, 'use a lower-case code like eur').default('eur'),
  /**
   * Let Stripe Tax work out the tax on each payment. Needs Stripe Tax to be set
   * up on the account; leave it off when no tax is charged.
   */
  BILLING_AUTOMATIC_TAX: booleanish.prefault('false'),
  /**
   * The terms of sale. When set, Stripe's payment page asks the buyer to accept
   * them before paying, and the acceptance is recorded on the checkout session.
   * `BILLING_TERMS_URL_FR` is the French page, used when the buyer's language is
   * French; without it the first one is used for everyone. Stripe also needs the
   * terms address in the Dashboard (Settings, Public details) for the box to show.
   */
  BILLING_TERMS_URL: optional(z.url()),
  BILLING_TERMS_URL_FR: optional(z.url()),
  /**
   * Sell to professionals only. The acceptance box then also says the buyer acts
   * for their business, which is what lets the terms leave out the consumer
   * rules (withdrawal, mediation). Needs BILLING_TERMS_URL: the declaration is
   * made in the same box.
   */
  BILLING_PROFESSIONAL_ONLY: booleanish.prefault('false'),
  /** Where Stripe's API lives. Only worth changing to point a test at a stand-in. */
  STRIPE_API_URL: z.url().default('https://api.stripe.com'),
};
