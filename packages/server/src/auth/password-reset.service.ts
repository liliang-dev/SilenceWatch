import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import { hashPassword, randomToken, sha256Hex } from '../common/crypto.util';
import { AppConfig, CONFIG } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { escapeHtml } from '../notifications/templates';
import { EMAIL_COOLDOWN_MS } from './email-verification.service';

/**
 * "I forgot my password."
 *
 * Before this existed, losing a password meant losing the account, and a
 * self-hoster's only recourse was an UPDATE against the database. That is not
 * merely inconvenient: no recovery path is what pushes teams into sharing one
 * login, which is a worse security outcome than any reset flow.
 *
 * The rules are the same ones the verification flow settled, for the same
 * reasons — only the hash of the token is stored, issuing a new one voids the
 * previous, the emailed link is a GET into the SPA while the state change is a
 * POST, and every response is identical whether or not the address exists.
 *
 * The one addition: completing a reset **revokes every session**. Somebody who
 * has just been through "I lost control of my password" should not find the
 * thief still signed in on another device.
 */
@Injectable()
export class PasswordResetService {
  private readonly logger = new Logger(PasswordResetService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
  ) {}

  /**
   * Sends a reset link, and says nothing about whether it did.
   *
   * Never throws for a caller's benefit: a delivery failure is logged, because
   * reporting one for a known address and staying silent for an unknown one
   * would rebuild exactly the membership oracle this shape avoids. Unlike
   * registration — where the visitor is waiting on an account that does not yet
   * work — there is nothing here for them to act on either way.
   */
  async request(email: string, ip: string | null): Promise<void> {
    const user = await this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true },
    });
    if (user === null) {
      this.logger.log('Password reset requested for an address with no account');
      return;
    }

    // A link issued moments ago is still in the inbox and still works, so a
    // second one adds nothing but volume. Without this the endpoint is a mail
    // cannon aimed at any address someone knows: the per-IP limiter counts
    // senders, and it is the recipient who is being attacked.
    const recent = await this.prisma.passwordReset.findFirst({
      where: {
        userId: user.id,
        consumedAt: null,
        createdAt: { gt: new Date(Date.now() - EMAIL_COOLDOWN_MS) },
      },
      select: { id: true },
    });
    if (recent !== null) {
      this.logger.debug(`Password reset email for ${user.id} suppressed: one went out moments ago`);
      return;
    }

    const token = randomToken(32);
    const expiresAt = new Date(Date.now() + this.config.PASSWORD_RESET_TTL_MINUTES * 60_000);

    const [, issued] = await this.prisma.$transaction([
      // One live link at a time: a resend must not leave the older one usable
      // in an older inbox.
      this.prisma.passwordReset.deleteMany({ where: { userId: user.id, consumedAt: null } }),
      this.prisma.passwordReset.create({
        data: { userId: user.id, tokenHash: sha256Hex(token), expiresAt, requestedIp: ip },
        select: { id: true },
      }),
    ]);

    this.audit.record({
      action: 'auth.password_reset_requested',
      actor: { userId: user.id, email: user.email, ip },
    });

    const link = `${this.config.baseUrl}/reset-password?token=${encodeURIComponent(token)}`;
    await this.email
      .send({
        to: user.email,
        subject: 'Reset your password',
        text: resetText(link, this.config.PASSWORD_RESET_TTL_MINUTES),
        html: resetHtml(link, this.config.PASSWORD_RESET_TTL_MINUTES),
      })
      .catch(async (error: unknown) => {
        // A token whose link never left the building is not a live reset, and
        // leaving it behind would make the cooldown above refuse the retry for
        // a minute over a message nobody received.
        await this.prisma.passwordReset
          .deleteMany({ where: { id: issued.id } })
          .catch(() => undefined);
        this.logger.error(`Password reset email to ${user.id} failed: ${String(error)}`);
      });
  }

  /**
   * Consumes a token and sets the new password.
   *
   * Every failure says the same thing. Which of "no such token", "already
   * used" and "expired" applies is information about somebody else's account.
   */
  async complete(token: string, newPassword: string): Promise<void> {
    const record = await this.prisma.passwordReset.findUnique({
      where: { tokenHash: sha256Hex(token) },
      select: { id: true, userId: true, consumedAt: true, expiresAt: true },
    });

    const invalid = new BadRequestException(
      'This reset link is no longer valid. Request a new one from the sign-in page.',
    );

    if (record === null || record.consumedAt !== null) throw invalid;
    if (record.expiresAt.getTime() <= Date.now()) throw invalid;

    const passwordHash = await hashPassword(newPassword);

    await this.prisma.$transaction([
      this.prisma.passwordReset.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: {
          passwordHash,
          // A reset is also the way out of a lockout: someone who has proved
          // control of the mailbox should not still be serving a timeout
          // earned by whoever was guessing at their password.
          failedLoginCount: 0,
          lockedUntil: null,
        },
      }),
      // Whoever knew the old password is signed out, on every device.
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      // Other live reset links die with it: one recovery, one token.
      this.prisma.passwordReset.deleteMany({
        where: { userId: record.userId, consumedAt: null },
      }),
    ]);

    this.logger.log(`Password reset completed for user ${record.userId}`);
    this.audit.record({
      action: 'auth.password_reset_completed',
      actor: { userId: record.userId },
    });
  }

  /** Drops spent and expired tokens. Called by the retention job. */
  async purge(): Promise<number> {
    const { count } = await this.prisma.passwordReset.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }] },
    });
    return count;
  }
}

function resetText(link: string, ttlMinutes: number): string {
  return [
    'Somebody asked to reset the password on your SilenceWatch account.',
    '',
    link,
    '',
    `The link is valid for ${ttlMinutes} minutes and can be used once.`,
    'If it was not you, ignore this message — your password has not changed and',
    'nothing has been done to your account.',
  ].join('\n');
}

function resetHtml(link: string, ttlMinutes: number): string {
  const href = escapeHtml(link);
  return `<!doctype html>
<html lang="en"><body style="margin:0;background:#f7f8fa;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:28px">
    <h1 style="margin:0 0 12px;font-size:18px;color:#101828">Reset your password</h1>
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#475467">
      Somebody asked to reset the password on your SilenceWatch account.
    </p>
    <p style="margin:0 0 20px">
      <a href="${href}" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#7533e1;color:#fff;font-size:14px;font-weight:600;text-decoration:none">Choose a new password</a>
    </p>
    <p style="margin:0 0 8px;font-size:13px;color:#667085">
      Or paste this into your browser:<br>
      <span style="word-break:break-all;color:#7533e1">${href}</span>
    </p>
    <p style="margin:16px 0 0;font-size:12px;color:#98a2b3">
      Valid for ${ttlMinutes} minutes, usable once. If it was not you, ignore this message — your
      password has not changed and nothing has been done to your account.
    </p>
  </div>
</body></html>`;
}
