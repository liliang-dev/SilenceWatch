import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import type { SessionContext } from '../session-context';

export interface NewSession {
  userId: string;
  tokenHash: string;
  expiresAt: Date;
  context: SessionContext;
}

/** Every query on sessions, i.e. on refresh tokens (only their hashes are stored). */
@Injectable()
export class SessionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: NewSession) {
    return this.prisma.session.create({ data: toData(input) });
  }

  findByTokenHash(tokenHash: string) {
    return this.prisma.session.findUnique({ where: { tokenHash }, include: { user: true } });
  }

  /** Just enough to name the actor of a sign-out. */
  findOwnerByTokenHash(tokenHash: string) {
    return this.prisma.session.findUnique({
      where: { tokenHash },
      select: { userId: true, user: { select: { email: true } } },
    });
  }

  /** The state of one session, for the guard: a signed token is not enough on its own. */
  findStatus(sessionId: string) {
    return this.prisma.session.findUnique({
      where: { id: sessionId },
      select: { revokedAt: true, expiresAt: true },
    });
  }

  /** Revokes the presented session and issues its successor, atomically. */
  rotate(revokedSessionId: string, successor: NewSession) {
    return this.prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: revokedSessionId }, data: { revokedAt: new Date() } });
      return tx.session.create({ data: toData(successor) });
    });
  }

  /** How many sessions this closed: zero for an unknown or already-revoked token. */
  async revokeByTokenHash(tokenHash: string): Promise<number> {
    const { count } = await this.prisma.session.updateMany({
      where: { tokenHash, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  /**
   * Revokes the oldest live sessions of a user beyond the `keep` newest, and
   * returns how many it closed.
   */
  async revokeOldestBeyond(userId: string, keep: number): Promise<number> {
    const surplus = await this.prisma.session.findMany({
      where: { userId, revokedAt: null, expiresAt: { gt: new Date() } },
      orderBy: { createdAt: 'desc' },
      skip: keep,
      select: { id: true },
    });
    if (surplus.length === 0) return 0;

    const { count } = await this.prisma.session.updateMany({
      where: { id: { in: surplus.map((session) => session.id) }, revokedAt: null },
      data: { revokedAt: new Date() },
    });
    return count;
  }

  async revokeAllForUser(userId: string): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  /** Deletes expired sessions, and those revoked before the cutoff. */
  async deleteStale(revokedBefore: Date): Promise<number> {
    const { count } = await this.prisma.session.deleteMany({
      where: { OR: [{ expiresAt: { lt: new Date() } }, { revokedAt: { lt: revokedBefore } }] },
    });
    return count;
  }
}

function toData(input: NewSession) {
  return {
    userId: input.userId,
    tokenHash: input.tokenHash,
    expiresAt: input.expiresAt,
    ip: input.context.ip,
    userAgent: input.context.userAgent,
  };
}
