import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import { DISPOSABLE_EMAIL_DOMAINS, domainSuffixes } from './disposable-domains';

export type SignupRejection = 'disposable_email' | 'network_quota';

/**
 * The checks that decide whether an account may be created at all — the ones
 * that need durable state, as opposed to the per-request proof of work.
 *
 * Two rules, both off by default:
 *
 *  1. **Disposable mailboxes.** Cheap, and it removes the laziest way to make a
 *     verification email meaningless.
 *  2. **Per-network velocity, counted in PostgreSQL.** The in-memory rate
 *     limiter is per-instance and forgets everything on restart, which makes a
 *     deploy a free window and a second replica a doubled budget. Counting
 *     accepted sign-ups per network prefix in the database is the only version
 *     of this rule that holds across both.
 */
@Injectable()
export class SignupGuardService {
  private readonly logger = new Logger(SignupGuardService.name);
  private readonly extraBlocked: ReadonlySet<string>;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
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
    const used = await this.prisma.signupAttempt.count({
      where: { network, accepted: true, createdAt: { gte: since } },
    });

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

    await this.prisma.signupAttempt
      .create({ data: { network, accepted } })
      .catch((error: unknown) =>
        this.logger.warn(`Could not record the sign-up attempt: ${String(error)}`),
      );
  }

  /** Drops attempt rows past the window they inform. Called by the retention job. */
  async purgeOldAttempts(): Promise<number> {
    const { count } = await this.prisma.signupAttempt.deleteMany({
      where: { createdAt: { lt: new Date(Date.now() - 7 * 86_400_000) } },
    });
    return count;
  }
}
