import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../../database/prisma.service';

export interface VerificationRecord {
  id: string;
  userId: string;
  email: string;
  consumedAt: Date | null;
  expiresAt: Date;
  user: { id: string; email: string; emailVerifiedAt: Date | null };
}

/** Every query on email-verification tokens (only their hashes are stored). */
@Injectable()
export class EmailVerificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /** Whether a live token was issued to this user after the given moment. */
  async hasLiveTokenSince(userId: string, since: Date): Promise<boolean> {
    const recent = await this.prisma.emailVerification.findFirst({
      where: { userId, consumedAt: null, createdAt: { gt: since } },
      select: { id: true },
    });
    return recent !== null;
  }

  /** One live token at a time: issuing a new one voids the previous. Returns the new id. */
  async replaceLiveToken(input: {
    userId: string;
    email: string;
    tokenHash: string;
    expiresAt: Date;
  }): Promise<string> {
    const [, issued] = await this.prisma.$transaction([
      this.prisma.emailVerification.deleteMany({
        where: { userId: input.userId, consumedAt: null },
      }),
      this.prisma.emailVerification.create({
        data: {
          userId: input.userId,
          tokenHash: input.tokenHash,
          email: input.email,
          expiresAt: input.expiresAt,
        },
        select: { id: true },
      }),
    ]);
    return issued.id;
  }

  async delete(id: string): Promise<void> {
    await this.prisma.emailVerification.deleteMany({ where: { id } });
  }

  findByTokenHash(tokenHash: string): Promise<VerificationRecord | null> {
    return this.prisma.emailVerification.findUnique({
      where: { tokenHash },
      include: { user: { select: { id: true, email: true, emailVerifiedAt: true } } },
    });
  }

  /** Spends the token and marks the address verified, together. */
  consumeAndVerifyUser(id: string, userId: string): Promise<unknown> {
    return this.prisma.$transaction([
      this.prisma.emailVerification.update({ where: { id }, data: { consumedAt: new Date() } }),
      this.prisma.user.update({ where: { id: userId }, data: { emailVerifiedAt: new Date() } }),
    ]);
  }

  /** Expired and spent tokens. */
  async deleteSpent(): Promise<number> {
    const { count } = await this.prisma.emailVerification.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { consumedAt: { not: null } }] },
    });
    return count;
  }
}
