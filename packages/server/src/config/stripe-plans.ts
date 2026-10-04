import { z } from 'zod';

/**
 * What the hosted service sells: for each paid plan, the Stripe price that buys
 * it and the amount to show next to it.
 *
 * The amount is only displayed. What a customer is charged is the Stripe price,
 * which is the one place prices live; keeping a copy here is what lets the
 * Settings page show them without a request to Stripe on every visit.
 */
export interface StripePlan {
  /** Stripe's price id, `price_…`. */
  readonly price: string;
  /** Per month, in the smallest unit of the currency (499 for 4,99). */
  readonly amount: number;
}

const stripePlansSchema = z.record(
  z.string().min(1).max(40),
  z
    .object({
      price: z.string().regex(/^price_[A-Za-z0-9_]+$/, 'must be a Stripe price id (price_…)'),
      amount: z.number().int().min(1).max(10_000_000),
    })
    .strict(),
);

/** Returns the parsed plans, or null when the value is not usable at all. */
export function parseStripePlans(raw: string): Record<string, StripePlan> | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  const parsed = stripePlansSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}
