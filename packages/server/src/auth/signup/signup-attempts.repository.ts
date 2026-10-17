import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';

/** The record of sign-up attempts per network, kept in PostgreSQL so it survives a restart. */
@Injectable()
export class SignupAttemptsRepository {
  constructor(private readonly prisma: PrismaService) {}

  countAcceptedSince(network: string, since: Date): Promise<number> {
    return this.prisma.signupAttempt.count({
      where: { network, accepted: true, createdAt: { gte: since } },
    });
  }

  record(network: string, accepted: boolean): Promise<unknown> {
    return this.prisma.signupAttempt.create({ data: { network, accepted } });
  }

  async deleteOlderThan(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.signupAttempt.deleteMany({
      where: { createdAt: { lt: cutoff } },
    });
    return count;
  }
}
