import { z } from 'zod';
import { booleanish, positiveInt } from '../env-helpers';

/** Plans and quotas. */
export const quotasShape = {
  /* --- plans and quotas --------------------------------------------------
   * Off by default, and that is the whole point: a self-hosted SilenceWatch
   * is never the crippled edition. With QUOTAS_ENABLED unset, `user.plan`
   * stays null, every limit is unlimited, and none of this code does
   * anything.
   *
   * Note what is *not* here: no prices, no payment state, no subscription
   * lifecycle. The hosted deployment's billing system decides which plan an
   * account is on and writes the name; this side only knows what a name is
   * allowed to do. That is what keeps the commercial model out of a repo
   * licensed to be run by anyone.
   */
  QUOTAS_ENABLED: booleanish.prefault('false'),
  /** Plan assigned to a new account when quotas are on. */
  DEFAULT_PLAN: z.string().min(1).max(40).default('free'),
  /**
   * Limits per plan, as JSON. Omitted keys mean unlimited. Example:
   *
   *   {"free":{"checks":10,"projects":3,"channelsPerProject":3,"retentionDays":7},
   *    "pro":{"checks":100,"projects":20,"retentionDays":90}}
   */
  // Blank rather than absent, for the same reason as the optional settings
  // above: a Compose file cannot express "no value" without writing one, and
  // `${PLAN_LIMITS:-{}}` cannot be written at all — the closing brace ends the
  // interpolation early.
  PLAN_LIMITS: z.preprocess((value) => (value === '' ? undefined : value), z.string().default('{}')),
  /**
   * How often accounts are reconciled with their plan. A downgrade written by
   * the billing system takes effect within one of these.
   */
  QUOTA_RECONCILE_INTERVAL_MS: positiveInt(30_000, 86_400_000).default(300_000),
};
