import { Inject, Injectable, Logger } from '@nestjs/common';
import { hmacSha256Hex } from '../../common/crypto.util';
import { AppConfig, CONFIG } from '../../config/config';
import { UsersRepository } from '../users/users.repository';
import { SignupChallengeService } from './signup-challenge.service';
import { DISPOSABLE_EMAIL_DOMAINS, domainSuffixes } from './disposable-domains';
import { SignupAttemptsRepository } from './signup-attempts.repository';

export type SignupRejection = 'disposable_email' | 'network_quota' | 'address_quota';

/**
 * The checks that decide whether an account may be created at all — the ones
 * that need durable state, as opposed to the per-request proof of work.
 *
 * Three rules, all off by default:
 *
 *  1. **Disposable mailboxes.** Cheap, and it removes the laziest way to make a
 *     verification email meaningless.
 *  2. **Per-network velocity, counted in PostgreSQL.** The in-memory rate
 *     limiter is per-instance and forgets everything on restart, which makes a
 *     deploy a free window and a second replica a doubled budget. Counting
 *     accepted sign-ups per network prefix in the database is the only version
 *     of this rule that holds across both.
 *  3. **One account per connection.** Counted over the accounts that exist, from
 *     a keyed hash stored with each one, so a free plan cannot be multiplied by
 *     registering again. See `isAddressWithinQuota`.
 */
@Injectable()
export class SignupGuardService {
  private readonly logger = new Logger(SignupGuardService.name);
  private readonly extraBlocked: ReadonlySet<string>;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly attempts: SignupAttemptsRepository,
    private readonly users: UsersRepository,
  ) {
    this.extraBlocked = new Set(
      config.SIGNUP_BLOCKED_EMAIL_DOMAINS.map((domain) => domain.trim().toLowerCase()).filter(
        (domain) => domain.length > 0,
      ),
    );
  }

  /** Whether the address may register at all. */
  isEmailAllowed(email: string): boolean {
    const domain = email.slice(email.lastIndexOf('@') + 1).toLowerCase();
    if (domain === '') return false;

    for (const suffix of domainSuffixes(domain)) {
      if (this.extraBlocked.has(suffix)) return false;
      if (this.config.SIGNUP_BLOCK_DISPOSABLE_EMAIL && DISPOSABLE_EMAIL_DOMAINS.has(suffix)) {
        return false;
      }
    }
    return true;
  }

  /**
   * What is stored to recognise a connection later: a keyed hash of its address
   * (IPv4, or IPv6 /64), or null when the rule is off and nothing is kept.
   *
   * Keyed with the server's secret and salted for this one purpose, so that the
   * column is not a list of addresses: it can be compared, and it cannot be read
   * back, and a copy of the database does not let anyone test a guess without the
   * key.
   */
  signupNetworkOf(ip: string | null | undefined): string | null {
    if (this.config.SIGNUP_MAX_ACCOUNTS_PER_ADDRESS === 0) return null;
    return hmacSha256Hex(
      this.config.SECRET_KEY,
      `silencewatch:signup-network:${SignupChallengeService.addressOf(ip)}`,
    ).slice(0, 32);
  }

  /**
   * Whether this connection may have one more account.
   *
   * Counts the accounts that exist, not the ones ever made: one that was deleted
   * frees its place, and one whose address was never proven stops counting after
   * an hour, so a mistyped address costs an hour and not the connection. An
   * address the server cannot read is one shared bucket rather than a way past
   * the rule, as for the hourly one.
   */
  async isAddressWithinQuota(signupNetwork: string | null): Promise<boolean> {
    const ceiling = this.config.SIGNUP_MAX_ACCOUNTS_PER_ADDRESS;
    if (ceiling === 0 || signupNetwork === null) return true;

    const used = await this.users.countFromNetwork(signupNetwork, new Date(Date.now() - 3_600_000));
    if (used >= ceiling) {
      this.logger.warn(`Account limit reached for one connection: ${used} account(s) already`);
      return false;
    }
    return true;
  }

  /**
   * How many accounts this network has created in the last hour, against the
   * configured ceiling.
   *
   * Counted over *accepted* sign-ups only: rejected attempts are recorded for
   * visibility, and letting them consume the budget would hand an attacker a
   * way to lock out everyone behind the same corporate NAT by failing on
   * purpose.
   */
  async isNetworkWithinQuota(network: string): Promise<boolean> {
    const ceiling = this.config.SIGNUP_MAX_PER_NETWORK_PER_HOUR;
    if (ceiling === 0) return true;

    // "unknown" — an unparseable or absent client address — is counted as one
    // shared bucket rather than waved through. Exempting it would make an
    // address the server cannot read the cheapest way past the rule, which is
    // precisely the property an attacker would go looking for.

    const since = new Date(Date.now() - 3_600_000);
    const used = await this.attempts.countAcceptedSince(network, since);

    if (used >= ceiling) {
      this.logger.warn(`Sign-up quota reached for ${network}: ${used} accounts in the last hour`);
      return false;
    }
    return true;
  }

  /**
   * Records the attempt. Never throws: losing an audit row is not a reason to
   * fail a registration the rules already allowed.
   */
  async record(network: string, accepted: boolean): Promise<void> {
    if (this.config.SIGNUP_MAX_PER_NETWORK_PER_HOUR === 0) return;

    await this.attempts
      .record(network, accepted)
      .catch((error: unknown) =>
        this.logger.warn(`Could not record the sign-up attempt: ${String(error)}`),
      );
  }

  /** Drops attempt rows past the window they inform. Called by the retention job. */
  async purgeOldAttempts(): Promise<number> {
    return this.attempts.deleteOlderThan(new Date(Date.now() - 7 * 86_400_000));
  }
}
