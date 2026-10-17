import { Injectable } from '@nestjs/common';
import type { ProjectRole } from '@silencewatch/shared';
import { PrismaService } from '../../database/prisma.service';

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}

/** The first project of a new account, created with the account's owner membership. */
export interface FirstProject {
  userId: string;
  name: string;
  slug: string;
}

/** A project the user belongs to, with who else is in it: what deleting an account must weigh. */
export interface MembershipWithPeers {
  projectId: string;
  role: ProjectRole;
  projectName: string;
  peers: Array<{ userId: string; role: ProjectRole }>;
}

/**
 * Every query on users. Services decide what the rules are; this is the only
 * place that knows how they are stored.
 */
@Injectable()
export class UsersRepository {
  constructor(private readonly prisma: PrismaService) {}

  async isEmpty(): Promise<boolean> {
    return (await this.prisma.user.count({ take: 1 })) === 0;
  }

  findByEmail(email: string) {
    return this.prisma.user.findUnique({ where: { email } });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByIdOrThrow(id: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id } });
  }

  /** Accounts created from a network, which is what one-account-per-address counts. */
  countFromNetwork(signupNetwork: string): Promise<number> {
    return this.prisma.user.count({ where: { signupNetwork } });
  }

  /** The owner membership of a new account's first project, in one write with the project. */
  createFirstProject(input: FirstProject) {
    return this.prisma.project.create({
      data: {
        name: input.name,
        slug: input.slug,
        members: { create: { userId: input.userId, role: 'owner' } },
      },
    });
  }

  /**
   * Whether anything at all lets this account sign in: a passkey, a password or a
   * provider. An account without one is what a registration that failed halfway
   * leaves behind, and it may be finished by whoever asks next.
   */
  async hasCredential(userId: string): Promise<boolean> {
    const [passkeys, accounts] = await Promise.all([
      this.prisma.passkey.count({ where: { userId } }),
      this.prisma.account.count({ where: { userId } }),
    ]);
    return passkeys + accounts > 0;
  }

  /** A successful sign-in: clears the lockout. */
  recordSuccessfulLogin(userId: string): Promise<unknown> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: 0, lockedUntil: null, lastLoginAt: new Date() },
    });
  }

  recordFailedLogin(userId: string, failures: number, lockedUntil: Date | null): Promise<unknown> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: failures, lockedUntil },
    });
  }

  /**
   * Sets a password and ends every session, in one transaction: that is the
   * point of resetting it. The lockout goes with the old password.
   */
  replacePasswordAndEndSessions(userId: string, passwordHash: string): Promise<unknown> {
    return this.prisma.$transaction([
      this.prisma.account.upsert({
        where: { providerId_accountId: { providerId: 'credential', accountId: userId } },
        create: { providerId: 'credential', accountId: userId, userId, password: passwordHash },
        update: { password: passwordHash },
      }),
      this.prisma.user.update({
        where: { id: userId },
        data: { failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.session.deleteMany({ where: { userId } }),
    ]);
  }

  /** Ends the oldest sessions beyond a ceiling, so signing in over and over is not a way to make rows. */
  async trimSessions(userId: string, keep: number): Promise<void> {
    const surplus = await this.prisma.session.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      skip: keep,
      select: { id: true },
    });
    if (surplus.length === 0) return;
    await this.prisma.session.deleteMany({ where: { id: { in: surplus.map((row) => row.id) } } });
  }

  async listMembershipsWithPeers(userId: string): Promise<MembershipWithPeers[]> {
    const memberships = await this.prisma.projectMember.findMany({
      where: { userId },
      include: { project: { include: { members: { select: { userId: true, role: true } } } } },
    });
    return memberships.map((membership) => ({
      projectId: membership.projectId,
      role: membership.role,
      projectName: membership.project.name,
      peers: membership.project.members.filter((member) => member.userId !== userId),
    }));
  }

  /**
   * Deletes the user and the projects only it belonged to. Memberships, sessions
   * and tokens go with the user (the schema cascades).
   */
  deleteWithProjects(userId: string, projectIds: string[]): Promise<unknown> {
    return this.prisma.$transaction([
      this.prisma.project.deleteMany({ where: { id: { in: projectIds } } }),
      this.prisma.user.delete({ where: { id: userId } }),
    ]);
  }
}
