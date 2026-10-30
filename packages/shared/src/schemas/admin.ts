/**
 * The instance's figures, for its administrator only (ADMIN_EMAIL). Counts, never
 * a list: nothing here names an account, a check or an address.
 */

/** A count, how much of it is from the last 30 days, and the 30 days one by one. */
export interface AdminCountDto {
  total: number;
  last30Days: number;
  /** New in each of the last 30 days, oldest first; the last value is the past 24 hours. */
  daily: number[];
}

export interface AdminPlanCountDto {
  /** A paid plan's name, as STRIPE_PLANS has it. */
  plan: string;
  /** Subscriptions to it that are paid, or still being asked to be. */
  active: number;
  /** Of those, the ones started in the last 30 days. */
  last30Days: number;
  daily: number[];
}

export interface AdminStatsDto {
  generatedAt: string;
  /** Accounts on the instance. */
  accounts: AdminCountDto;
  /** Checks on the instance, in every project. */
  checks: AdminCountDto;
  /**
   * Alert emails sent in the last 30 days. Deliveries are kept for 30 days, so
   * there is no total from the beginning to give.
   */
  alertEmails: { last30Days: number; daily: number[] };
  /** One entry per paid plan; null when the instance sells none. */
  subscriptions: AdminPlanCountDto[] | null;
}
