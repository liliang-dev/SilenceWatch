import { Injectable, NotFoundException } from '@nestjs/common';
import type { CreateProjectRequest, ProjectDto, UpdateProjectRequest } from '@silencewatch/shared';
import { uniqueSlug } from '../common/slug.util';
import { PrismaService } from '../database/prisma.service';
import { QuotaService } from '../quotas/quota.service';
import type { Principal } from '../auth/principal';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly quotas: QuotaService,
  ) {}

  async listForPrincipal(principal: Principal): Promise<ProjectDto[]> {
    if (principal.kind === 'apiKey') {
      const project = await this.prisma.project.findUnique({
        where: { id: principal.projectId },
        include: { _count: { select: { checks: true } } },
      });
      return project === null ? [] : [toDto(project, 'member', project._count.checks)];
    }

    const memberships = await this.prisma.projectMember.findMany({
      where: { userId: principal.userId },
      include: { project: { include: { _count: { select: { checks: true } } } } },
      orderBy: { createdAt: 'asc' },
    });

    const downCounts = await this.countDownChecks(memberships.map((m) => m.projectId));

    return memberships.map((membership) =>
      toDto(
        membership.project,
        membership.role,
        membership.project._count.checks,
        downCounts.get(membership.projectId) ?? 0,
      ),
    );
  }

  async create(userId: string, input: CreateProjectRequest): Promise<ProjectDto> {
    await this.quotas.assertCanAddProject(userId);

    const slug = await uniqueSlug(input.slug ?? input.name, async (candidate) =>
      (await this.prisma.project.count({ where: { slug: candidate } })) > 0,
    );

    const project = await this.prisma.project.create({
      data: {
        name: input.name,
        slug,
        members: { create: { userId, role: 'owner' } },
      },
    });
    return toDto(project, 'owner', 0, 0);
  }

  async get(projectId: string): Promise<ProjectDto> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { _count: { select: { checks: true } } },
    });
    if (project === null) throw new NotFoundException('Project not found');

    const downCounts = await this.countDownChecks([projectId]);
    return toDto(project, 'member', project._count.checks, downCounts.get(projectId) ?? 0);
  }

  async update(projectId: string, input: UpdateProjectRequest): Promise<ProjectDto> {
    const project = await this.prisma.project.update({
      where: { id: projectId },
      data: {
        ...(input.name === undefined ? {} : { name: input.name }),
        ...(input.pingRetentionDays === undefined
          ? {}
          : { pingRetentionDays: input.pingRetentionDays }),
      },
      include: { _count: { select: { checks: true } } },
    });
    return toDto(project, 'member', project._count.checks);
  }

  /** Removes the project and, by cascade, its checks, pings and incidents. */
  async remove(projectId: string): Promise<void> {
    await this.prisma.project.delete({ where: { id: projectId } });
  }

  private async countDownChecks(projectIds: string[]): Promise<Map<string, number>> {
    if (projectIds.length === 0) return new Map();
    const grouped = await this.prisma.check.groupBy({
      by: ['projectId'],
      where: { projectId: { in: projectIds }, state: 'DOWN' },
      _count: { _all: true },
    });
    return new Map(grouped.map((row) => [row.projectId, row._count._all]));
  }
}

function toDto(
  project: {
    id: string;
    name: string;
    slug: string;
    pingRetentionDays: number | null;
    createdAt: Date;
  },
  role: ProjectDto['role'],
  checkCount?: number,
  downCount?: number,
): ProjectDto {
  return {
    id: project.id,
    name: project.name,
    slug: project.slug,
    role,
    pingRetentionDays: project.pingRetentionDays,
    createdAt: project.createdAt.toISOString(),
    ...(checkCount === undefined ? {} : { checkCount }),
    ...(downCount === undefined ? {} : { downCount }),
  };
}
