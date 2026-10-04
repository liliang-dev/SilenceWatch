import { z } from 'zod';
import { PROJECT_ROLES } from '../enums';
import { LIMITS } from './limits';
import { slugSchema, trimmedString } from './primitives';

export const createProjectRequestSchema = z.object({
  name: trimmedString(LIMITS.nameMax),
  slug: slugSchema.optional(),
});
export type CreateProjectRequest = z.infer<typeof createProjectRequestSchema>;

export const updateProjectRequestSchema = z.object({
  name: trimmedString(LIMITS.nameMax).optional(),
  /** Days of ping history to keep; `null` uses the server default. */
  pingRetentionDays: z.number().int().min(1).max(3650).nullable().optional(),
});
export type UpdateProjectRequest = z.infer<typeof updateProjectRequestSchema>;

export interface ProjectDto {
  id: string;
  name: string;
  slug: string;
  role: (typeof PROJECT_ROLES)[number];
  pingRetentionDays: number | null;
  createdAt: string;
  checkCount?: number;
  downCount?: number;
}
