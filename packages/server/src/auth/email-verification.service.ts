import {
  BadRequestException,
  Inject,
  Injectable,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomToken, sha256Hex } from '../common/crypto.util';
import { AppConfig, CONFIG } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { escapeHtml } from '../notifications/templates';

/**
 * The mail did not go out.
 *
 * Its own type so both registration branches can fail identically, and so the
 * visitor gets something they can act on instead of "internal server error" in
 * front of an account they now cannot use. Retrying the same registration
 * re-sends, because the address is then a known unverified one.
 */
export class UndeliverableError extends ServiceUnavailableException {
  constructor() {
    super('Could not send the confirmation email right now. Please try again in a few minutes.');
  }
}

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
/**
 * Minimum gap between two messages to the same address.
 *
 * The per-IP limiter cannot see that a thousand registrations from a thousand
 * addresses all name one victim's mailbox. Without this, "forgot my password"
 * and "resend the link" are a mail cannon pointed at anyone whose address is
 * known — and the instance pays for it twice, because a sender that emits
 * unsolicited volume loses the deliverability its alerts depend on.
 */
export const EMAIL_COOLDOWN_MS = 60_000;

@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);
  /**
   * Addresses recently told that they already have an account, and when they
   * may be told again. In memory rather than in a table because there is no row
   * to hang it on — the notice is sent precisely when nothing is created.
   */
  private readonly noticeSentAt = new Map<string, number>();

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
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
    const recent = await this.prisma.emailVerification.findFirst({
      where: {
        userId: user.id,
        consumedAt: null,
        createdAt: { gt: new Date(Date.now() - EMAIL_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recent !== null) {
      this.logger.debug(`Verification email for ${user.id} suppressed: one went out moments ago`);
      return;
    }

    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + this.config.EMAIL_VERIFICATION_TTL_HOURS * 3_600_000);

    const [, issued] = await this.prisma.$transaction([
      this.prisma.emailVerification.deleteMany({
        where: { userId: user.id, consumedAt: null },
      }),
      this.prisma.emailVerification.create({
        data: { userId: user.id, tokenHash: sha256Hex(token), email: user.email, expiresAt },
        select: { id: true },
      }),
    ]);

    const link = `${this.config.baseUrl}/verify-email?token=${encodeURIComponent(token)}`;
    await this.email
      .send({
        to: user.email,
        subject: 'Confirm your email address',
        text: verificationText(link, this.config.EMAIL_VERIFICATION_TTL_HOURS),
        html: verificationHtml(link, this.config.EMAIL_VERIFICATION_TTL_HOURS),
      })
      .catch(async (error: unknown) => {
        // The row is what the cooldown above reads, so a token left behind by a
        // send that never happened would hold the retry off for a minute and
        // put the visitor back in front of the inbox that gets nothing — the
        // exact failure UndeliverableError exists to prevent. Drop it, so the
        // cooldown only ever means "a message really went out".
        await this.prisma.emailVerification
          .deleteMany({ where: { id: issued.id } })
          .catch(() => undefined);
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
    const record = await this.prisma.emailVerification.findUnique({
      where: { tokenHash: sha256Hex(token) },
      include: { user: { select: { id: true, email: true, emailVerifiedAt: true } } },
    });

    const invalid = new BadRequestException(
      'This confirmation link is no longer valid. Request a new one from the sign-in page.',
    );

    if (record === null) throw invalid;
    if (record.consumedAt !== null) throw invalid;
    if (record.expiresAt.getTime() <= Date.now()) throw invalid;
    // The address changed after the token was issued: it proves nothing about
    // the address the account carries now.
    if (record.email !== record.user.email) throw invalid;

    await this.prisma.$transaction([
      this.prisma.emailVerification.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { emailVerifiedAt: new Date() },
      }),
    ]);

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
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, emailVerifiedAt: true },
    });

    if (user === null || user.emailVerifiedAt !== null) return;

    await this.sendVerification(user).catch((error: unknown) =>
      this.logger.error(`Could not resend the verification email: ${String(error)}`),
    );
  }

  /**
   * Tells an existing owner that someone tried to register with their address.
   *
   * This is the other half of an enumeration-safe sign-up: the API answers
   * "check your inbox" whether or not the account existed, and the inbox is
   * where the truth is delivered — to the person entitled to it. It also turns
   * a stranger's typo, or a targeted probe, into something the owner can see.
   */
  async sendAlreadyRegisteredNotice(email: string): Promise<void> {
    // Same cooldown as the verification mail, for the same reason: repeating a
    // registration with a stranger's address must not let anyone fill their
    // inbox. Suppressed the same way too — quietly, so both branches of
    // registration still answer identically.
    if (this.noticeCooldownActive(email)) {
      this.logger.debug('Already-registered notice suppressed: one went out moments ago');
      return;
    }

    const signInUrl = `${this.config.baseUrl}/login`;
    await this.email
      .send({
        to: email,
        subject: 'Someone tried to sign up with your email address',
        text: [
          'Someone just tried to create a SilenceWatch account with this address.',
          'You already have one, so nothing changed and no second account was created.',
          '',
          `Sign in: ${signInUrl}`,
          '',
          'If that was you, sign in instead. If it was not, you can ignore this —',
          'nobody learned anything about your account. Consider changing your',
          'password if you reused it elsewhere.',
        ].join('\n'),
        html: alreadyRegisteredHtml(signInUrl),
      })
      .then(() => this.markNoticeSent(email))
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
  private noticeCooldownActive(email: string, now = Date.now()): boolean {
    const until = this.noticeSentAt.get(email);
    return until !== undefined && until > now;
  }

  /**
   * Starts the cooldown. Called only once a message has actually gone out —
   * marking it before the send would let a broken transport lock an address out
   * of a notice it never received.
   */
  private markNoticeSent(email: string, now = Date.now()): void {
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

  /**
   * Deletes accounts that never proved their address, and the spent tokens of
   * those that did. Called by the retention job.
   *
   * Without this, a blocked flood still leaves its sediment: rows that hold an
   * email address hostage against the unique index, so the real owner cannot
   * register later.
   */
  async purge(): Promise<{ tokens: number; accounts: number }> {
    const tokens = await this.prisma.emailVerification.deleteMany({
      where: {
        OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }],
      },
    });

    const ttlDays = this.config.UNVERIFIED_ACCOUNT_TTL_DAYS;
    if (!this.required || ttlDays === 0) return { tokens: tokens.count, accounts: 0 };

    const accounts = await this.prisma.user.deleteMany({
      where: {
        emailVerifiedAt: null,
        createdAt: { lt: new Date(Date.now() - ttlDays * 86_400_000) },
      },
    });

    if (accounts.count > 0) {
      this.logger.log(`Removed ${accounts.count} account(s) that never verified their address`);
    }
    return { tokens: tokens.count, accounts: accounts.count };
  }
}

function alreadyRegisteredHtml(signInUrl: string): string {
  const href = escapeHtml(signInUrl);
  return `<!doctype html>
<html lang="en"><body style="margin:0;background:#f7f8fa;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:28px">
    <h1 style="margin:0 0 12px;font-size:18px;color:#101828">Someone tried to sign up with your address</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#475467">
      You already have a SilenceWatch account with this address, so nothing changed and no second
      account was created.
    </p>
    <p style="margin:0 0 20px">
      <a href="${href}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#3538cd;color:#fff;font-size:14px;font-weight:600;text-decoration:none">Sign in</a>
    </p>
    <p style="margin:0;font-size:12px;color:#98a2b3">
      If this was not you, you can ignore this message — nobody learned anything about your account.
      Change your password if you reused it elsewhere.
    </p>
  </div>
</body></html>`;
}

function verificationText(link: string, ttlHours: number): string {
  return [
    'Confirm your email address to finish setting up your SilenceWatch account.',
    '',
    link,
    '',
    `The link is valid for ${ttlHours} hours and can be used once.`,
    'If you did not create an account, ignore this message — nothing was activated.',
  ].join('\n');
}

function verificationHtml(link: string, ttlHours: number): string {
  const href = escapeHtml(link);
  return `<!doctype html>
<html lang="en"><body style="margin:0;background:#f7f8fa;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:28px">
    <h1 style="margin:0 0 12px;font-size:18px;color:#101828">Confirm your email address</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#475467">
      One click and your SilenceWatch account is ready.
    </p>
    <p style="margin:0 0 20px">
      <a href="${href}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#3538cd;color:#fff;font-size:14px;font-weight:600;text-decoration:none">Confirm my address</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#667085">
      Or paste this into your browser:<br>
      <span style="word-break:break-all;color:#3538cd">${href}</span>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#98a2b3">
      Valid for ${ttlHours} hours, usable once. If you did not create an account, ignore this message — nothing was activated.
    </p>
  </div>
</body></html>`;
}
