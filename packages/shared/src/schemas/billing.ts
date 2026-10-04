import { z } from 'zod';

/**
 * Plans, usage and the subscription, for the hosted service's Settings page.
 *
 * `enabled` is false on every self-hosted instance, and then nothing else is
 * filled in: the page shows no subscription tab and the routes answer 404.
 */

/** A limit of null is no limit. */
export interface PlanLimitsDto {
  checks: number | null;
  projects: number | null;
  channelsPerProject: number | null;
  retentionDays: number | null;
}

export interface BillingPlanDto {
  /** The plan's name, as in PLAN_LIMITS: `free`, `pro`, `business`… */
  id: string;
  /** Per month, in the smallest unit of `currency` (499 is 4,99). 0 for the free plan. */
  amount: number;
  /** ISO 4217, lower case, as Stripe writes it. */
  currency: string;
  limits: PlanLimitsDto;
  /** Whether it can be bought here: false for the plan everyone starts on. */
  purchasable: boolean;
}

export interface SubscriptionDto {
  /** Stripe's own word: `active`, `past_due`, `canceled`… */
  status: string;
  plan: string | null;
  /** When the paid period ends, and the plan with it if `cancelAtPeriodEnd`. */
  currentPeriodEnd: string | null;
  cancelAtPeriodEnd: boolean;
}

export interface BillingUsageDto {
  checks: number;
  projects: number;
}

export interface BillingStateDto {
  enabled: boolean;
  /** The plan the account is on right now. */
  plan: string | null;
  plans: BillingPlanDto[];
  usage: BillingUsageDto | null;
  subscription: SubscriptionDto | null;
}

export const checkoutRequestSchema = z.object({
  plan: z.string().min(1).max(40),
});
export type CheckoutRequest = z.infer<typeof checkoutRequestSchema>;

/** Where to send the browser: Stripe's payment page, or its customer portal. */
export interface BillingRedirectDto {
  url: string;
}
