import { Injectable, Logger } from '@nestjs/common';
import type { ApiKeyDto, CreatedApiKeyDto } from '@silencewatch/shared';
import { generateApiKey, parseApiKey, timingSafeEqualHex } from '../common/crypto.util';
import { ApiKeysRepository, type ApiKeyRecord } from './api-keys.repository';

export interface ResolvedApiKey {
  apiKeyId: string;
  projectId: string;
}

/**
 * Project-scoped API keys, used by the REST API and by the client starters.
 *
 * The presented token is split: a public lookup id finds the row, and the secret
 * half is compared as a SHA-256 digest in constant time. Only the digest is
 * stored, so keys cannot be recovered from a database dump — including by us.
 */
@Injectable()
export class ApiKeyService {
  private readonly logger = new Logger(ApiKeyService.name);
  /** Rate at which `last_used_at` is refreshed, to avoid a write per request. */
  private readonly lastUsedThrottleMs = 60_000;
  private readonly lastUsedWrites = new Map<string, number>();

  constructor(private readonly keys: ApiKeysRepository) {}

  async create(
    projectId: string,
    input: { name: string; expiresInDays?: number },
  ): Promise<CreatedApiKeyDto> {
    const generated = generateApiKey();
    const record = await this.keys.create({
      projectId,
      name: input.name,
      lookupId: generated.lookupId,
      secretHash: generated.secretHash,
      prefix: generated.prefix,
      expiresAt:
        input.expiresInDays === undefined
          ? null
          : new Date(Date.now() + input.expiresInDays * 86_400_000),
    });

    // The only moment the full token exists outside the caller's memory.
    return { ...toDto(record), token: generated.token };
  }

  async list(projectId: string): Promise<ApiKeyDto[]> {
    return (await this.keys.listForProject(projectId)).map(toDto);
  }

  async revoke(projectId: string, apiKeyId: string): Promise<void> {
    await this.keys.revoke(projectId, apiKeyId);
  }

  /** Resolves a presented token, or null when it is unknown, revoked or expired. */
  async resolve(token: string): Promise<ResolvedApiKey | null> {
    const parsed = parseApiKey(token);
    if (parsed === null) return null;

    const record = await this.keys.findByLookupId(parsed.lookupId);
    if (record === null) return null;
    if (!timingSafeEqualHex(record.secretHash, parsed.secretHash)) return null;
    if (record.revokedAt !== null) return null;
    if (record.expiresAt !== null && record.expiresAt.getTime() <= Date.now()) return null;

    this.touch(record.id);
    return { apiKeyId: record.id, projectId: record.projectId };
  }

  /**
   * "Last used" is useful for spotting stale keys, but not worth a write on every
   * request — one per key per minute is plenty, and failures are irrelevant.
   */
  private touch(apiKeyId: string): void {
    const now = Date.now();
    const last = this.lastUsedWrites.get(apiKeyId) ?? 0;
    if (now - last < this.lastUsedThrottleMs) return;

    this.lastUsedWrites.set(apiKeyId, now);
    if (this.lastUsedWrites.size > 10_000) this.lastUsedWrites.clear();

    void this.keys
      .touch(apiKeyId)
      .catch((error: Error) => this.logger.debug(`Could not record key usage: ${error.message}`));
  }
}

function toDto(record: ApiKeyRecord): ApiKeyDto {
  return {
    id: record.id,
    projectId: record.projectId,
    name: record.name,
    prefix: record.prefix,
    lastUsedAt: record.lastUsedAt?.toISOString() ?? null,
    expiresAt: record.expiresAt?.toISOString() ?? null,
    createdAt: record.createdAt.toISOString(),
    revokedAt: record.revokedAt?.toISOString() ?? null,
  };
}
