import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { AuditService } from '../../../audit/audit.service';
import { randomToken, sha256Hex } from '../../../common/crypto.util';
import { AppConfig, CONFIG } from '../../../config/config';
import { EmailService } from '../../../notifications/email.service';
import { UsersRepository } from '../../users/users.repository';
import { EMAIL_COOLDOWN_MS } from './email-cooldown';
import { EmailVerificationsRepository } from './email-verifications.repository';
import { verificationHtml, verificationText } from './email-verification.templates';
import { UndeliverableError } from './undeliverable.error';

/**
 * Proving that the address on an account belongs to whoever created it.
 *
 * Design notes worth keeping:
 *
 *  - **The emailed link is a GET into the SPA; the state change is a POST.**
 *    Corporate mail scanners, link previewers and antivirus proxies fetch every
 *    URL in an inbound message. A one-shot GET would be burned before the user
 *    ever read the mail, and the failure looks exactly like an attack.
 *  - **Only the SHA-256 of the token is stored**, like refresh tokens and API
 *    keys, so read access to the database is not the ability to take over an
 *    unverified account.
 *  - **Issuing a new token invalidates the old ones.** "Resend" would otherwise
 *    leave a widening set of live credentials in a widening set of inboxes.
 */
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly verifications: EmailVerificationsRepository,
    private readonly users: UsersRepository,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  get required(): boolean {
    return this.config.EMAIL_VERIFICATION_REQUIRED;
  }

  /**
   * Issues a token and emails it.
   *
   * A delivery failure is reported, not swallowed. Answering "check your inbox"
   * for a message that was never sent leaves the user waiting on something that
   * will never arrive, in front of an account they cannot use.
   */
  async sendVerification(user: { id: string; email: string; name: string | null }): Promise<void> {
    // A live token issued moments ago is still in the recipient's inbox, so a
    // second message adds nothing but volume. Returning quietly keeps the
    // caller's answer identical to a successful send, which is what stops this
    // from becoming the oracle the whole flow is shaped to avoid.
    if (await this.verifications.hasLiveTokenSince(user.id, cooldownStart())) {
      this.logger.debug(`Verification email for ${user.id} suppressed: one went out moments ago`);
      return;
    }

    const token = randomToken(32);
    const ttlHours = this.config.EMAIL_VERIFICATION_TTL_HOURS;
    const tokenId = await this.verifications.replaceLiveToken({
      userId: user.id,
      email: user.email,
      tokenHash: sha256Hex(token),
      expiresAt: new Date(Date.now() + ttlHours * 3_600_000),
    });

    const link = `${this.config.baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.email
      .send({
        to: user.email,
        subject: 'Confirm your email address',
        text: verificationText(link, ttlHours),
        html: verificationHtml(link, ttlHours),
      })
      .catch(async (error: unknown) => {
        // The row is what the cooldown above reads, so a token left behind by a
        // send that never happened would hold the retry off for a minute and
        // put the visitor back in front of the inbox that gets nothing — the
        // exact failure UndeliverableError exists to prevent. Drop it, so the
        // cooldown only ever means "a message really went out".
        await this.verifications.delete(tokenId).catch(() => undefined);
        // The transport's own message would name the mail host and the reason
        // it refused, which is the operator's business and not the visitor's.
        this.logger.error(`Verification email to ${user.id} failed: ${String(error)}`);
        throw new UndeliverableError();
      });
  }

  /**
   * Consumes a token and marks the address verified.
   *
   * Every failure returns the same message. Which of "no such token", "already
   * used" and "expired" applies is information about somebody else's account.
   */
  async verify(token: string): Promise<void> {
    const record = await this.verifications.findByTokenHash(sha256Hex(token));

    const invalid = new BadRequestException(
      'This confirmation link is no longer valid. Request a new one from the sign-in page.',
    );

    if (record === null) throw invalid;
    if (record.consumedAt !== null) throw invalid;
    if (record.expiresAt.getTime() <= Date.now()) throw invalid;
    // The address changed after the token was issued: it proves nothing about
    // the address the account carries now.
    if (record.email !== record.user.email) throw invalid;

    await this.verifications.consumeAndVerifyUser(record.id, record.userId);

    this.logger.log(`Email verified for user ${record.userId}`);
    this.audit.record({
      action: 'auth.email_verified',
      actor: { userId: record.userId, email: record.user.email },
    });
  }

  /**
   * Re-sends the link, and says nothing about whether it did.
   *
   * The caller always gets the same answer: an endpoint that reported "no such
   * account" would be a free membership oracle for anyone with a word list.
   */
  async resend(email: string): Promise<void> {
    const user = await this.users.findIdentityByEmail(email);

    if (user === null || user.emailVerifiedAt !== null) return;

    await this.sendVerification(user).catch((error: unknown) =>
      this.logger.error(`Could not resend the verification email: ${String(error)}`),
    );
  }

  /**
   * Deletes accounts that never proved their address, and the spent tokens of
   * those that did. Called by the retention job.
   *
   * Without this, a blocked flood still leaves its sediment: rows that hold an
   * email address hostage against the unique index, so the real owner cannot
   * register later.
   */
  async purge(): Promise<{ tokens: number; accounts: number }> {
    const tokens = await this.verifications.deleteSpent();

    const ttlDays = this.config.UNVERIFIED_ACCOUNT_TTL_DAYS;
    if (!this.required || ttlDays === 0) return { tokens, accounts: 0 };

    const accounts = await this.users.deleteUnverifiedCreatedBefore(
      new Date(Date.now() - ttlDays * 86_400_000),
    );

    if (accounts > 0) {
      this.logger.log(`Removed ${accounts} account(s) that never verified their address`);
    }
    return { tokens, accounts };
  }
}

function cooldownStart(): Date {
  return new Date(Date.now() - EMAIL_COOLDOWN_MS);
}
