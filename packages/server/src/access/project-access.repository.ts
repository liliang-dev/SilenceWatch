import { Injectable } from '@nestjs/common';
import type { ProjectRole } from '@silencewatch/shared';
import { PrismaService } from '../database/prisma.service';

/** What the access rules need to know about memberships and about which project owns a check. */
@Injectable()
export class ProjectAccessRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findRole(projectId: string, userId: string): Promise<ProjectRole | null> {
    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } },
      select: { role: true },
    });
    return membership?.role ?? null;
  }

  async listProjectIds(userId: string): Promise<string[]> {
    const memberships = await this.prisma.projectMember.findMany({
      where: { userId },
      select: { projectId: true },
    });
    return memberships.map((membership) => membership.projectId);
  }

  async findCheckProjectId(checkId: string): Promise<string | null> {
    const check = await this.prisma.check.findUnique({
      where: { id: checkId },
      select: { projectId: true },
    });
    return check?.projectId ?? null;
  }
}
