import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';

export interface ApiKeyRecord {
  id: string;
  projectId: string;
  name: string;
  prefix: string;
  lastUsedAt: Date | null;
  expiresAt: Date | null;
  createdAt: Date;
  revokedAt: Date | null;
}

export interface NewApiKey {
  projectId: string;
  name: string;
  lookupId: string;
  secretHash: string;
  prefix: string;
  expiresAt: Date | null;
}

export interface StoredApiKey {
  id: string;
  projectId: string;
  secretHash: string;
  revokedAt: Date | null;
  expiresAt: Date | null;
}

/** Every query on API keys. Only the hash of the secret half is ever stored. */
@Injectable()
export class ApiKeysRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(input: NewApiKey): Promise<ApiKeyRecord> {
    return this.prisma.apiKey.create({ data: input });
  }

  listForProject(projectId: string): Promise<ApiKeyRecord[]> {
    return this.prisma.apiKey.findMany({ where: { projectId }, orderBy: { createdAt: 'desc' } });
  }

  /** Scoped by project, so one project's admin cannot revoke another project's key by id. */
  async revoke(projectId: string, apiKeyId: string): Promise<void> {
    await this.prisma.apiKey.updateMany({
      where: { id: apiKeyId, projectId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  findByLookupId(lookupId: string): Promise<StoredApiKey | null> {
    return this.prisma.apiKey.findUnique({
      where: { lookupId },
      select: { id: true, projectId: true, secretHash: true, revokedAt: true, expiresAt: true },
    });
  }

  touch(apiKeyId: string): Promise<unknown> {
    return this.prisma.apiKey.update({ where: { id: apiKeyId }, data: { lastUsedAt: new Date() } });
  }
}
