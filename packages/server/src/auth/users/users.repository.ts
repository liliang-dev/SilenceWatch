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
   * Whether this account is what a registration that failed halfway leaves behind,
   * and so may be finished by whoever asks next with its address.
   *
   * Having no way in is not enough. An account whose passkeys are all gone (two
   * tabs each removing one, an operator) still has its projects and its history,
   * and handing it to the next person to type its address would be handing it to
   * a stranger. So it must also never have signed in, hold no session and no
   * recovery code: nothing that only its owner could have done.
   */
  async isUnfinishedRegistration(userId: string): Promise<boolean> {
    const [user, passkeys, accounts, codes, sessions] = await Promise.all([
      this.prisma.user.findUnique({ where: { id: userId }, select: { lastLoginAt: true } }),
      this.prisma.passkey.count({ where: { userId } }),
      this.prisma.account.count({ where: { userId } }),
      this.prisma.recoveryCode.count({ where: { userId } }),
      this.prisma.session.count({ where: { userId } }),
    ]);
    return user !== null && user.lastLoginAt === null && passkeys + accounts + codes + sessions === 0;
  }

  /**
   * Whether this account runs the instance: the one ADMIN_EMAIL names, or, when
   * none is named, the first account ever created, which is the one that set the
   * instance up. On a shared instance everyone else is a customer.
   */
  async isOperator(userId: string, adminEmail: string | undefined): Promise<boolean> {
    if (adminEmail !== undefined) {
      const user = await this.prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
      return user !== null && user.email === adminEmail.toLowerCase();
    }
    const first = await this.prisma.user.findFirst({
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      select: { id: true },
    });
    return first?.id === userId;
  }

  /** How many passkeys an account holds: the last one is not removed where it is the only way in. */
  countPasskeys(userId: string): Promise<number> {
    return this.prisma.passkey.count({ where: { userId } });
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
