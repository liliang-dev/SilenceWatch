import type { StripePlan } from '../config/config';

/** The part of a Stripe event this application reads. */
export interface StripeEvent {
  id: string;
  type: string;
  /** Unix seconds. */
  created: number;
  data: { object: Record<string, unknown> };
}

/** What a `customer.subscription.*` event says, in the terms used here. */
export interface SubscriptionChange {
  customerId: string;
  subscriptionId: string;
  /** Stripe's own word. */
  status: string;
  priceId: string | null;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
}

/** Statuses in which the customer has paid, or is still being asked to. */
export const LIVE_STATUSES: ReadonlySet<string> = new Set(['active', 'trialing', 'past_due']);

/** Statuses in which the subscription is over, whatever it was. */
export const ENDED_STATUSES: ReadonlySet<string> = new Set([
  'canceled',
  'unpaid',
  'incomplete_expired',
  'paused',
]);

const SUBSCRIPTION_EVENTS: ReadonlySet<string> = new Set([
  'customer.subscription.created',
  'customer.subscription.updated',
  'customer.subscription.deleted',
]);

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value !== '' ? value : null;

/** The id of an object that Stripe may send either bare or expanded. */
const idOf = (value: unknown): string | null =>
  asString(value) ?? asString((value as { id?: unknown } | null)?.id);

/**
 * Reads a subscription event, or returns null for any other kind of event or for
 * one that does not say what is needed.
 *
 * The end of the paid period has moved between Stripe API versions, from the
 * subscription to its items, so both places are read.
 */
export function readSubscriptionEvent(event: StripeEvent): SubscriptionChange | null {
  if (!SUBSCRIPTION_EVENTS.has(event.type)) return null;

  const subscription = event.data.object;
  const customerId = idOf(subscription.customer);
  const subscriptionId = asString(subscription.id);
  if (customerId === null || subscriptionId === null) return null;

  // A subscription that was deleted says `canceled`; do not rely on it saying so.
  const status =
    event.type === 'customer.subscription.deleted'
      ? 'canceled'
      : (asString(subscription.status) ?? 'incomplete');

  const items = (subscription.items as { data?: unknown } | undefined)?.data;
  const item = Array.isArray(items) ? (items[0] as Record<string, unknown> | undefined) : undefined;
  const priceId = idOf((item as { price?: unknown } | undefined)?.price);

  const periodEnd = subscription.current_period_end ?? item?.current_period_end;
  return {
    customerId,
    subscriptionId,
    status,
    priceId,
    currentPeriodEnd: typeof periodEnd === 'number' ? new Date(periodEnd * 1000) : null,
    cancelAtPeriodEnd: subscription.cancel_at_period_end === true,
  };
}

export type PlanDecision =
  /** The account is on this plan. */
  | { kind: 'grant'; plan: string }
  /** The subscription is over: back to the plan everyone starts on. */
  | { kind: 'end' }
  /** Say nothing about the plan. */
  | { kind: 'keep'; reason: 'unknown_price' | 'not_settled' };

/**
 * What a subscription change means for the account's plan.
 *
 * `past_due` keeps the paid plan: Stripe retries the payment for a while, and an
 * account does not lose its monitoring on the first declined card. When Stripe
 * gives up it ends the subscription, and that is what takes the plan away.
 *
 * A price that is not one of ours changes nothing: it is another product on the
 * same Stripe account, or a price that was never configured here, and neither is
 * a reason to move someone off a plan they pay for.
 */
export function decidePlan(
  change: SubscriptionChange,
  plans: Readonly<Record<string, StripePlan>>,
): PlanDecision {
  if (ENDED_STATUSES.has(change.status)) return { kind: 'end' };
  if (!LIVE_STATUSES.has(change.status)) return { kind: 'keep', reason: 'not_settled' };

  const plan = Object.entries(plans).find(([, candidate]) => candidate.price === change.priceId)?.[0];
  return plan === undefined ? { kind: 'keep', reason: 'unknown_price' } : { kind: 'grant', plan };
}
