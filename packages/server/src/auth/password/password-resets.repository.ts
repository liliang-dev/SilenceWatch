import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

export interface ResetRecord {
  id: string;
  userId: string;
  consumedAt: Date | null;
  expiresAt: Date;
}

/** Every query on password-reset tokens (only their hashes are stored). */
@Injectable()
export class PasswordResetsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async hasLiveTokenSince(userId: string, since: Date): Promise<boolean> {
    const recent = await this.prisma.passwordReset.findFirst({
      where: { userId, consumedAt: null, createdAt: { gt: since } },
      select: { id: true },
    });
    return recent !== null;
  }

  /**
   * One live link at a time: a resend must not leave the older one usable in an
   * older inbox. Returns the id of the new token.
   */
  async replaceLiveToken(input: {
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    requestedIp: string | null;
  }): Promise<string> {
    const [, issued] = await this.prisma.$transaction([
      this.prisma.passwordReset.deleteMany({ where: { userId: input.userId, consumedAt: null } }),
      this.prisma.passwordReset.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          expiresAt: input.expiresAt,
          requestedIp: input.requestedIp,
        },
        select: { id: true },
      }),
    ]);
    return issued.id;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.passwordReset.deleteMany({ where: { id } });
  }

  findByTokenHash(tokenHash: string): Promise<ResetRecord | null> {
    return this.prisma.passwordReset.findUnique({
      where: { tokenHash },
      select: { id: true, userId: true, consumedAt: true, expiresAt: true },
    });
  }

  /**
   * Spends the token, sets the password, signs the user out everywhere and voids
   * their other reset links: one recovery, one token.
   *
   * A reset is also the way out of a lockout: someone who has proved control of
   * the mailbox should not still be serving a timeout earned by whoever was
   * guessing at their password.
   */
  complete(record: { id: string; userId: string }, passwordHash: string): Promise<unknown> {
    return this.prisma.$transaction([
      this.prisma.passwordReset.update({
        where: { id: record.id },
        data: { consumedAt: new Date() },
      }),
      this.prisma.user.update({
        where: { id: record.userId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      // Whoever knew the old password is signed out, on every device.
      this.prisma.session.updateMany({
        where: { userId: record.userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.passwordReset.deleteMany({
        where: { userId: record.userId, consumedAt: null },
      }),
    ]);
  }

  /** Expired and spent tokens. */
  async deleteSpent(): Promise<number> {
    const { count } = await this.prisma.passwordReset.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }] },
    });
    return count;
  }
}
