import { z } from 'zod';
import { LIMITS } from './limits';
import { trimmedString } from './primitives';

export const createApiKeyRequestSchema = z.object({
  name: trimmedString(LIMITS.nameMax),
  expiresInDays: z.number().int().min(1).max(3650).optional(),
});
export type CreateApiKeyRequest = z.infer<typeof createApiKeyRequestSchema>;

export interface ApiKeyDto {
  id: string;
  projectId: string;
  name: string;
  /** Non-secret display prefix, e.g. `sw_live_3f9a…`. */
  prefix: string;
  lastUsedAt: string | null;
  expiresAt: string | null;
  createdAt: string;
  revokedAt: string | null;
}

export interface CreatedApiKeyDto extends ApiKeyDto {
  /** Full secret, returned exactly once at creation time. */
  token: string;
}
