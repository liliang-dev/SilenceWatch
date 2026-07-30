import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import type { ProjectRole } from '@silencewatch/shared';
import { PrismaService } from '../database/prisma.service';
import type { Principal } from './principal';

/** owner > admin > member. A higher rank satisfies any lower requirement. */
const RANK: Record<ProjectRole, number> = { member: 1, admin: 2, owner: 3 };

/**
 * The single place where "may this principal touch this project?" is answered.
 *
 * Every project-scoped service calls it before doing anything. Keeping the rule
 * in one method is what makes it auditable — and it deliberately answers 404,
 * not 403, for projects the caller cannot see, so project ids cannot be probed.
 */
@Injectable()
export class ProjectAccessService {
  constructor(private readonly prisma: PrismaService) {}

  async assertAccess(
    principal: Principal,
    projectId: string,
    minimumRole: ProjectRole = 'member',
  ): Promise<void> {
    if (principal.kind === 'apiKey') {
      // An API key is bound to one project and acts with member rights: it can
      // manage checks, never the project's members or its keys.
      if (principal.projectId !== projectId) throw new NotFoundException('Project not found');
      if (RANK[minimumRole] > RANK.member) {
        throw new ForbiddenException('This operation requires a user session');
      }
      return;
    }

    const membership = await this.prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId: principal.userId } },
      select: { role: true },
    });

    if (membership === null) throw new NotFoundException('Project not found');
    if (RANK[membership.role] < RANK[minimumRole]) {
      throw new ForbiddenException(`This operation requires the ${minimumRole} role`);
    }
  }

  /** Project ids the principal may read. */
  async visibleProjectIds(principal: Principal): Promise<string[]> {
    if (principal.kind === 'apiKey') return [principal.projectId];

    const memberships = await this.prisma.projectMember.findMany({
      where: { userId: principal.userId },
      select: { projectId: true },
    });
    return memberships.map((membership) => membership.projectId);
  }

  /**
   * Resolves the project a check belongs to and authorises it in one step, so no
   * handler can accidentally read a check without checking its project.
   */
  async assertCheckAccess(
    principal: Principal,
    checkId: string,
    minimumRole: ProjectRole = 'member',
  ): Promise<{ projectId: string }> {
    const check = await this.prisma.check.findUnique({
      where: { id: checkId },
      select: { projectId: true },
    });
    if (check === null) throw new NotFoundException('Check not found');

    await this.assertAccess(principal, check.projectId, minimumRole);
    return check;
  }
}
