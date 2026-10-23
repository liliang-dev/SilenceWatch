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
  /** Whether the project is left with nobody who may sign in: see ApiKeyService.resolve. */
  suspended: boolean;
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

  /** Keys that still open the API: not revoked, not expired. */
  countLive(projectId: string): Promise<number> {
    return this.prisma.apiKey.count({
      where: {
        projectId,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
      },
    });
  }

  /** Deletes keys that stopped working before the cutoff: revoked, or expired. */
  async deleteDeadBefore(cutoff: Date): Promise<number> {
    const { count } = await this.prisma.apiKey.deleteMany({
      where: { OR: [{ revokedAt: { lt: cutoff } }, { expiresAt: { lt: cutoff } }] },
    });
    return count;
  }

  /** Scoped by project, so one project's admin cannot revoke another project's key by id. */
  async revoke(projectId: string, apiKeyId: string): Promise<void> {
    await this.prisma.apiKey.updateMany({
      where: { id: apiKeyId, projectId, revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }

  async findByLookupId(lookupId: string): Promise<StoredApiKey | null> {
    const row = await this.prisma.apiKey.findUnique({
      where: { lookupId },
      select: {
        id: true,
        projectId: true,
        secretHash: true,
        revokedAt: true,
        expiresAt: true,
        project: {
          select: { members: { where: { role: 'owner' }, select: { user: { select: { disabledAt: true } } } } },
        },
      },
    });
    if (row === null) return null;
    const { project, ...key } = row;
    // A project whose owners are all disabled is suspended with them. One with no
    // owner at all is not: that is not something a disabled account did.
    const suspended =
      project.members.length > 0 && project.members.every((member) => member.user.disabledAt !== null);
    return { ...key, suspended };
  }

  touch(apiKeyId: string): Promise<unknown> {
    return this.prisma.apiKey.update({ where: { id: apiKeyId }, data: { lastUsedAt: new Date() } });
  }
}
