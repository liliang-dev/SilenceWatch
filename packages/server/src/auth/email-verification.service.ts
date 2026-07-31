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
@Injectable()
export class EmailVerificationService {
  private readonly logger = new Logger(EmailVerificationService.name);

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
    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + this.config.EMAIL_VERIFICATION_TTL_HOURS * 3_600_000);

    await this.prisma.$transaction([
      this.prisma.emailVerification.deleteMany({
        where: { userId: user.id, consumedAt: null },
      }),
      this.prisma.emailVerification.create({
        data: { userId: user.id, tokenHash: sha256Hex(token), email: user.email, expiresAt },
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
      .catch((error: unknown) => {
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
      .catch((error: unknown) => {
        // Fails exactly like the new-account branch, and that is the point: if
        // one path answered 201 while the other reported a mail outage, the
        // difference between them would be the enumeration oracle this whole
        // design exists to close.
        this.logger.error(`Already-registered notice failed: ${String(error)}`);
        throw new UndeliverableError();
      });
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
