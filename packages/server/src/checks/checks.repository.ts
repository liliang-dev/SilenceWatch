import { Injectable } from '@nestjs/common';
import { Prisma, type Check, type Incident, type Ping } from '@prisma/client';
import type { ListChecksQuery } from '@silencewatch/shared';
import { PrismaService } from '../database/prisma.service';

/** Every query on checks, their pings and their incidents. */
@Injectable()
export class ChecksRepository {
  constructor(private readonly prisma: PrismaService) {}

  create(data: Prisma.CheckUncheckedCreateInput): Promise<Check> {
    return this.prisma.check.create({ data });
  }

  findById(checkId: string): Promise<Check | null> {
    return this.prisma.check.findUnique({ where: { id: checkId } });
  }

  async findPingKey(checkId: string): Promise<string | null> {
    const row = await this.prisma.check.findUnique({
      where: { id: checkId },
      select: { pingKey: true },
    });
    return row?.pingKey ?? null;
  }

  update(checkId: string, data: Prisma.CheckUpdateInput): Promise<Check> {
    return this.prisma.check.update({ where: { id: checkId }, data });
  }

  /** Whether the check existed and its ping key was replaced. */
  async replacePingKey(checkId: string): Promise<boolean> {
    const rows = await this.prisma.$queryRaw<Array<{ id: string }>>`
      UPDATE "check"
         SET ping_key = gen_random_uuid(),
             ping_key_rotated_at = now()
       WHERE id = ${checkId}::uuid
       RETURNING id`;
    return rows.length > 0;
  }

  /** The deleted check's ping key (for the cache), or null if there was none. */
  async delete(checkId: string): Promise<{ pingKey: string } | null> {
    return this.prisma.check
      .delete({ where: { id: checkId }, select: { pingKey: true } })
      .catch(() => null);
  }

  isSlugTaken(projectId: string, slug: string): Promise<boolean> {
    return this.prisma.check.count({ where: { projectId, slug } }).then((count) => count > 0);
  }

  /** One page, plus the extra row that tells whether there is another. */
  list(projectIds: readonly string[], query: ListChecksQuery): Promise<Check[]> {
    const where: Prisma.CheckWhereInput = {
      projectId: { in: [...projectIds] },
      ...(query.state === undefined ? {} : { state: query.state }),
      ...(query.environment === undefined ? {} : { environment: query.environment }),
      ...(query.tag === undefined ? {} : { tags: { has: query.tag } }),
      ...(query.orphaned === undefined
        ? {}
        : query.orphaned
          ? { orphanedAt: { not: null } }
          : { orphanedAt: null }),
      // `contains` with mode insensitive keeps this a simple ILIKE; user input is
      // parameterised by Prisma, never interpolated.
      ...(query.search === undefined
        ? {}
        : { name: { contains: query.search, mode: 'insensitive' } }),
    };

    return this.prisma.check.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
    });
  }

  listPings(checkId: string, limit: number, cursorId: bigint | null): Promise<Ping[]> {
    return this.prisma.ping.findMany({
      where: { checkId },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursorId === null ? {} : { cursor: { id: cursorId }, skip: 1 }),
    });
  }

  listIncidents(checkId: string, limit: number, cursor: string | undefined): Promise<Incident[]> {
    return this.prisma.incident.findMany({
      where: { checkId },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    });
  }
}
