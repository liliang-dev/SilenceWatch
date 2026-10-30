import type { ChannelType, CheckSource, PingKind } from '../enums';

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

/** Why an account was not created. Recorded without the address that was refused. */
export const SIGNUP_REFUSAL_REASONS = [
  /** ADMIN_EMAIL, asked for without the setup link. */
  'admin_without_link',
  /** Any other address while SIGNUP_ENABLED is off. */
  'signup_closed',
  /** An email provider SIGNUP_EMAIL_DOMAIN rules turn away. */
  'email_provider',
  /** A network that already holds its accounts (SIGNUP_MAX_ACCOUNTS_PER_ADDRESS). */
  'address_quota',
  /** A network that created too many in the past hour (SIGNUP_MAX_PER_NETWORK_PER_HOUR). */
  'network_quota',
] as const;
export type SignupRefusalReason = (typeof SIGNUP_REFUSAL_REASONS)[number];

export interface AdminStatsDto {
  generatedAt: string;
  /** Accounts on the instance. */
  accounts: AdminCountDto;
  /** Checks on the instance, in every project, and how each was declared. */
  checks: AdminCountDto & { bySource: Record<CheckSource, number> };
  /** Signals (pings) received in the past 24 hours, hour by hour, oldest first, and of which kind. */
  pings: { last24Hours: number; hourly: number[]; byKind: Record<PingKind, number> };
  /**
   * Alert emails sent in the last 30 days. Deliveries are kept for 30 days, so
   * there is no total from the beginning to give.
   */
  alertEmails: { last30Days: number; daily: number[] };
  /**
   * Accounts used in the last 30 days: signed in, or holding a session that made
   * a request. `total` is every account, for the share.
   */
  activeAccounts: { active: number; total: number };
  /** Alerts that could not be delivered after every retry, in the last 30 days, by channel type. */
  failedAlerts: { last30Days: number; daily: number[]; byType: Record<ChannelType, number> };
  /** Alert channels on the instance, by type. */
  channels: { total: number; byType: Record<ChannelType, number> };
  /** Sign-ups refused in the last 30 days, by reason. */
  refusedSignups: {
    last30Days: number;
    daily: number[];
    byReason: Record<SignupRefusalReason, number>;
  };
  /** One entry per paid plan; null when the instance sells none. */
  subscriptions: AdminPlanCountDto[] | null;
}
