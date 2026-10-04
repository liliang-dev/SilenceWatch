import { Inject, Injectable, Logger } from '@nestjs/common';
import { AppConfig, CONFIG } from '../../../config/config';
import { EmailService } from '../../../notifications/email.service';
import { EMAIL_COOLDOWN_MS } from './email-cooldown';
import { alreadyRegisteredHtml, alreadyRegisteredText } from './email-verification.templates';
import { UndeliverableError } from './undeliverable.error';

/**
 * Tells an existing owner that someone tried to register with their address.
 *
 * This is the other half of an enumeration-safe sign-up: the API answers
 * "check your inbox" whether or not the account existed, and the inbox is
 * where the truth is delivered — to the person entitled to it. It also turns
 * a stranger's typo, or a targeted probe, into something the owner can see.
 */
@Injectable()
export class AlreadyRegisteredNoticeService {
  private readonly logger = new Logger(AlreadyRegisteredNoticeService.name);
  /**
   * Addresses recently told that they already have an account, and when they
   * may be told again. In memory rather than in a table because there is no row
   * to hang it on — the notice is sent precisely when nothing is created.
   */
  private readonly noticeSentAt = new Map<string, number>();

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly email: EmailService,
  ) {}

  async send(email: string): Promise<void> {
    // Same cooldown as the verification mail, for the same reason: repeating a
    // registration with a stranger's address must not let anyone fill their
    // inbox. Suppressed the same way too — quietly, so both branches of
    // registration still answer identically.
    if (this.cooldownActive(email)) {
      this.logger.debug('Already-registered notice suppressed: one went out moments ago');
      return;
    }

    const signInUrl = `${this.config.baseUrl}/login`;
    await this.email
      .send({
        to: email,
        subject: 'Someone tried to sign up with your email address',
        text: alreadyRegisteredText(signInUrl),
        html: alreadyRegisteredHtml(signInUrl),
      })
      .then(() => this.markSent(email))
      .catch((error: unknown) => {
        // Fails exactly like the new-account branch, and that is the point: if
        // one path answered 201 while the other reported a mail outage, the
        // difference between them would be the enumeration oracle this whole
        // design exists to close.
        this.logger.error(`Already-registered notice failed: ${String(error)}`);
        throw new UndeliverableError();
      });
  }

  /** Whether this address was told recently enough that telling it again is noise. */
  private cooldownActive(email: string, now = Date.now()): boolean {
    const until = this.noticeSentAt.get(email);
    return until !== undefined && until > now;
  }

  /**
   * Starts the cooldown. Called only once a message has actually gone out —
   * marking it before the send would let a broken transport lock an address out
   * of a notice it never received.
   */
  private markSent(email: string, now = Date.now()): void {
    // Entries expire on their own; sweep when the map grows, so a flood of
    // registrations against distinct addresses cannot leak memory.
    if (this.noticeSentAt.size >= 20_000) {
      for (const [key, expiry] of this.noticeSentAt) {
        if (expiry <= now) this.noticeSentAt.delete(key);
      }
      if (this.noticeSentAt.size >= 20_000) this.noticeSentAt.clear();
    }
    this.noticeSentAt.set(email, now + EMAIL_COOLDOWN_MS);
  }
}
