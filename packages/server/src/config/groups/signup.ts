import { booleanish, csv, positiveInt } from '../env-helpers';

/** Sign-up integrity. */
export const signupShape = {
  /* --- sign-up integrity -------------------------------------------------
   * All of it is off by default. A self-hosted instance behind a VPN has no
   * bot problem, and making its operator solve one would be the kind of
   * crippling this project promised not to do. The hosted deployment turns
   * these on; the code is identical.
   */

  /** Reject addresses at known disposable-mailbox domains. */
  SIGNUP_BLOCK_DISPOSABLE_EMAIL: booleanish.prefault('false'),
  /** Extra domains to reject, comma-separated. */
  SIGNUP_BLOCKED_EMAIL_DOMAINS: csv.prefault(''),

  /**
   * Accounts creatable per hour from one network prefix (IPv4 /24, IPv6 /48),
   * counted in PostgreSQL so the rule survives a restart. 0 disables it.
   */
  SIGNUP_MAX_PER_NETWORK_PER_HOUR: positiveInt(0, 10_000).default(0),
  /**
   * Accounts that may exist at once from one connection (an IPv4 address, an
   * IPv6 /64). 0 disables the rule. Accounts behind a shared address (an
   * office, a school, a mobile carrier) share this budget, so set it with that
   * in mind. Only a keyed hash of the address is stored.
   */
  SIGNUP_MAX_ACCOUNTS_PER_ADDRESS: positiveInt(0, 1_000).default(0),
};
