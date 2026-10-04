import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { CreateProjectRequest, ProjectDto, UpdateProjectRequest } from '@silencewatch/shared';
import type { Principal } from '../access/principal';
import { uniqueSlug } from '../common/slug.util';
import { QuotaService } from '../quotas/quota.service';
import { toProjectDto } from './project.mapper';
import { ProjectsRepository } from './projects.repository';

@Injectable()
export class ProjectsService {
  constructor(
    private readonly projects: ProjectsRepository,
    private readonly quotas: QuotaService,
  ) {}

  async listForPrincipal(principal: Principal): Promise<ProjectDto[]> {
    if (principal.kind === 'apiKey') {
      const project = await this.projects.findWithCheckCount(principal.projectId);
      return project === null ? [] : [toProjectDto(project, 'member', project.checkCount)];
    }

    const memberships = await this.projects.listMemberships(principal.userId);
    const downCounts = await this.projects.countDownChecks(memberships.map((m) => m.project.id));

    return memberships.map(({ role, project }) =>
      toProjectDto(project, role, project.checkCount, downCounts.get(project.id) ?? 0),
    );
  }

  async create(userId: string, input: CreateProjectRequest): Promise<ProjectDto> {
    await this.quotas.assertCanAddProject(userId);

    const slug = await uniqueSlug(input.slug ?? input.name, (candidate) =>
      this.projects.isSlugTaken(candidate),
    );
    const project = await this.projects.createOwnedBy(userId, { name: input.name, slug });
    return toProjectDto(project, 'owner', 0, 0);
  }

  async get(projectId: string): Promise<ProjectDto> {
    const project = await this.projects.findWithCheckCount(projectId);
    if (project === null) throw new NotFoundException('Project not found');

    const downCounts = await this.projects.countDownChecks([projectId]);
    return toProjectDto(project, 'member', project.checkCount, downCounts.get(projectId) ?? 0);
  }

  async update(projectId: string, input: UpdateProjectRequest): Promise<ProjectDto> {
    const project = await this.projects.update(projectId, input);
    return toProjectDto(project, 'member', project.checkCount);
  }

  /**
   * Deletes a project, unless it is the caller's last one.
   *
   * An account with no project is not a state this application has a screen
   * for: every list, every form and the project picker itself assume one
   * exists, and the only way back would be through the database. The rule is
   * enforced here rather than in the browser because a confirmation dialog is
   * a courtesy, not a constraint — the endpoint is reachable without it.
   *
   * Counted over memberships rather than ownership on purpose: being left with
   * a project someone else owns still leaves you with a project.
   */
  async remove(userId: string, projectId: string): Promise<void> {
    if ((await this.projects.countMemberships(userId)) <= 1) {
      throw new ConflictException(
        'This is your last project, and an account needs one. Create another before deleting it.',
      );
    }
    await this.projects.delete(projectId);
  }
}
