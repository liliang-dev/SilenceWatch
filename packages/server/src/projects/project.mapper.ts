import type { ProjectDto } from '@silencewatch/shared';
import type { ProjectRow } from './projects.repository';

export function toProjectDto(
  project: ProjectRow,
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
