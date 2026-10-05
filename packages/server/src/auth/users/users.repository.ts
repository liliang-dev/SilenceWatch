import { Injectable } from '@nestjs/common';
import type { ProjectRole } from '@silencewatch/shared';
import { PrismaService } from '../../database/prisma.service';

export interface UserRecord {
  id: string;
  email: string;
  name: string | null;
  createdAt: Date;
}

export interface UserIdentity extends UserRecord {
  emailVerifiedAt: Date | null;
}

export interface NewUser {
  email: string;
  passwordHash: string;
  name: string | null;
  /** Null when quotas are off, which is every self-hosted install. */
  plan: string | null;
  /** Keyed hash of the network it was created from, or null when the rule is off. */
  signupNetwork: string | null;
  projectName: string;
  projectSlug: string;
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

  findIdentityByEmail(email: string): Promise<UserIdentity | null> {
    return this.prisma.user.findUnique({
      where: { email },
      select: { id: true, email: true, name: true, createdAt: true, emailVerifiedAt: true },
    });
  }

  findById(id: string) {
    return this.prisma.user.findUnique({ where: { id } });
  }

  findByIdOrThrow(id: string) {
    return this.prisma.user.findUniqueOrThrow({ where: { id } });
  }

  /**
   * Accounts created from a network that still count against its limit: those
   * whose address is proven, and those too young to have had the chance.
   */
  countFromNetwork(signupNetwork: string, recentSince: Date): Promise<number> {
    return this.prisma.user.count({
      where: {
        signupNetwork,
        OR: [{ emailVerifiedAt: { not: null } }, { createdAt: { gte: recentSince } }],
      },
    });
  }

  /** The account and the owner membership of its first project, in one write. */
  createWithFirstProject(input: NewUser) {
    return this.prisma.user.create({
      data: {
        email: input.email,
        passwordHash: input.passwordHash,
        name: input.name,
        plan: input.plan,
        signupNetwork: input.signupNetwork,
        memberships: {
          create: {
            role: 'owner',
            project: { create: { name: input.projectName, slug: input.projectSlug } },
          },
        },
      },
    });
  }

  /** A successful sign-in: clears the lockout, and keeps the hash current if it was rehashed. */
  recordSuccessfulLogin(userId: string, passwordHash?: string): Promise<unknown> {
    return this.prisma.user.update({
      where: { id: userId },
      data: {
        failedLoginCount: 0,
        lockedUntil: null,
        lastLoginAt: new Date(),
        ...(passwordHash === undefined ? {} : { passwordHash }),
      },
    });
  }

  recordFailedLogin(userId: string, failures: number, lockedUntil: Date | null): Promise<unknown> {
    return this.prisma.user.update({
      where: { id: userId },
      data: { failedLoginCount: failures, lockedUntil },
    });
  }

  /**
   * Sets a new password and ends every session, in one transaction: that is the
   * point of changing it. The lockout goes with the old password.
   */
  replacePasswordAndEndSessions(userId: string, passwordHash: string): Promise<unknown> {
    return this.prisma.$transaction([
      this.prisma.user.update({
        where: { id: userId },
        data: { passwordHash, failedLoginCount: 0, lockedUntil: null },
      }),
      this.prisma.session.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
    ]);
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

  /** Accounts that never proved their address and are older than the cutoff. */
  async deleteUnverifiedCreatedBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.user.deleteMany({
      where: { emailVerifiedAt: null, createdAt: { lt: cutoff } },
    });
    return count;
  }
}
