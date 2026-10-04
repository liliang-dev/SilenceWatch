import { Injectable } from '@nestjs/common';
import type { ProjectRole } from '@silencewatch/shared';
import { PrismaService } from '../database/prisma.service';

export interface ProjectRow {
  id: string;
  name: string;
  slug: string;
  pingRetentionDays: number | null;
  createdAt: Date;
}

export interface ProjectWithCheckCount extends ProjectRow {
  checkCount: number;
}

export interface MembershipRow {
  role: ProjectRole;
  project: ProjectWithCheckCount;
}

/** Every query on projects and their memberships. */
@Injectable()
export class ProjectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findWithCheckCount(projectId: string): Promise<ProjectWithCheckCount | null> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { _count: { select: { checks: true } } },
    });
    return project === null ? null : withCount(project);
  }

  /** The projects a user belongs to, oldest membership first. */
  async listMemberships(userId: string): Promise<MembershipRow[]> {
    const memberships = await this.prisma.projectMember.findMany({
      where: { userId },
      include: { project: { include: { _count: { select: { checks: true } } } } },
      orderBy: { createdAt: 'asc' },
    });
    return memberships.map((m) => ({ role: m.role, project: withCount(m.project) }));
  }

  countMemberships(userId: string): Promise<number> {
    return this.prisma.projectMember.count({ where: { userId } });
  }

  /** Checks currently DOWN, per project. Projects with none are absent. */
  async countDownChecks(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const grouped = await this.prisma.check.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, state: 'DOWN' },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.projectId, row._count._all]));
  }

  isSlugTaken(slug: string): Promise<boolean> {
    return this.prisma.project.count({ where: { slug } }).then((count) => count > 0);
  }

  createOwnedBy(userId: string, input: { name: string; slug: string }): Promise<ProjectRow> {
    return this.prisma.project.create({
      data: { name: input.name, slug: input.slug, members: { create: { userId, role: 'owner' } } },
    });
  }

  async update(
    projectId: string,
    patch: { name?: string; pingRetentionDays?: number | null },
  ): Promise<ProjectWithCheckCount> {
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(patch.name === undefined ? {} : { name: patch.name }),
        ...(patch.pingRetentionDays === undefined
          ? {}
          : { pingRetentionDays: patch.pingRetentionDays }),
      },
      include: { _count: { select: { checks: true } } },
    });
    return withCount(project);
  }

  /** Removes the project and, by cascade, its checks, pings and incidents. */
  async delete(projectId: string): Promise<void> {
    await this.prisma.project.delete({ where: { id: projectId } });
  }
}

function withCount(project: ProjectRow & { _count: { checks: number } }): ProjectWithCheckCount {
  const { _count, ...row } = project;
  return { ...row, checkCount: _count.checks };
}
