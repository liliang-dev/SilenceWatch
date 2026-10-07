import { booleanish, csv, positiveInt } from '../env-helpers';

/** Sign-up integrity, email verification and password reset. */
export const signupShape = {
  /* --- sign-up integrity -------------------------------------------------
   * All of it is off by default. A self-hosted instance behind a VPN has no
   * bot problem, and making its operator solve one would be the kind of
   * crippling this project promised not to do. The hosted deployment turns
   * these on; the code is identical.
   */

  /**
   * Require a proven email address before an account can sign in. Turning it
   * on also makes registration enumeration-safe: the response stops depending
   * on whether the address already exists.
   */
  EMAIL_VERIFICATION_REQUIRED: booleanish.prefault('false'),
  EMAIL_VERIFICATION_TTL_HOURS: positiveInt(1, 168).default(24),
  /**
   * Lifetime of a password reset link. Shorter than a verification link on
   * purpose: it is a credential that replaces a password, and a stale one
   * sitting in an inbox is a longer window than a stale confirmation.
   */
  PASSWORD_RESET_TTL_MINUTES: positiveInt(5, 1_440).default(60),
  /** Unverified accounts older than this are deleted. 0 disables the reaper. */
  UNVERIFIED_ACCOUNT_TTL_DAYS: positiveInt(0, 365).default(7),

  /**
   * Leading zero bits a client must find before its sign-up is accepted.
   * 0 disables the challenge. ~18 costs a browser well under a second and a
   * mass-registration script its entire margin; see docs/abuse-prevention.md.
   */
  SIGNUP_POW_DIFFICULTY: positiveInt(0, 26).default(0),
  /** How long an issued challenge stays valid. Short: it is single-use. */
  SIGNUP_POW_TTL_SECONDS: positiveInt(30, 3_600).default(600),

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
   * IPv6 /64). 0 disables the rule. It counts accounts with a proven address, and
   * those created in the last hour, so that a mistyped address does not lock the
   * person out; it therefore needs EMAIL_VERIFICATION_REQUIRED. Accounts behind a
   * shared address (an office, a school, a mobile carrier) share this budget, so
   * set it with that in mind. Only a keyed hash of the address is stored.
   */
  SIGNUP_MAX_ACCOUNTS_PER_ADDRESS: positiveInt(0, 1_000).default(0),
};
