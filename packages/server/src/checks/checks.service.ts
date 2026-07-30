import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, type Check } from '@prisma/client';
import type {
  CheckDto,
  CreateCheckRequest,
  IncidentDto,
  ListChecksQuery,
  PageDto,
  PingDto,
  UpdateCheckRequest,
} from '@silencewatch/shared';
import { sha256Hex } from '../common/crypto.util';
import { slugify, uniqueSlug } from '../common/slug.util';
import { AppConfig, CONFIG } from '../config/config';
import { PrismaService } from '../database/prisma.service';
import { CheckMetadataCache } from '../ingest/check-metadata.cache';
import { computeNextDueAt, InvalidScheduleError, type Schedule } from '../schedule/next-due';
import { toCheckDto, toIncidentDto, toPingDto } from './check.mapper';

const DEFAULT_TIMEZONE = 'UTC';

@Injectable()
export class ChecksService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly cache: CheckMetadataCache,
  ) {}

  async create(projectId: string, input: CreateCheckRequest): Promise<CheckDto> {
    const schedule = toSchedule(input);
    const nextDueAt = this.nextDueOrThrow(schedule, new Date());

    const slug = await uniqueSlug(input.slug ?? input.name, (candidate) =>
      this.slugTaken(projectId, candidate),
    );

    const check = await this.prisma.check.create({
      data: {
        projectId,
        name: input.name,
        slug,
        graceSeconds: input.graceSeconds,
        environment: input.environment ?? null,
        tags: input.tags ?? [],
        description: input.description ?? null,
        source: 'api',
        nextDueAt,
        ...schedule,
      },
    });

    return this.toDto(check);
  }

  async update(checkId: string, input: UpdateCheckRequest): Promise<CheckDto> {
    const existing = await this.prisma.check.findUnique({ where: { id: checkId } });
    if (existing === null) throw new NotFoundException('Check not found');

    const data: Prisma.CheckUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.graceSeconds !== undefined) data.graceSeconds = input.graceSeconds;
    if (input.environment !== undefined) data.environment = input.environment;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.description !== undefined) data.description = input.description;

    // A schedule change moves the deadline: recompute it from now, otherwise the
    // check would keep the deadline of the schedule it no longer has.
    const scheduleChanged = input.scheduleType !== undefined;
    if (scheduleChanged) {
      const schedule = toSchedule(input as CreateCheckRequest);
      Object.assign(data, schedule);
      data.nextDueAt = this.nextDueOrThrow(schedule, new Date());
    }

    if (input.paused !== undefined) {
      if (input.paused) {
        data.state = 'PAUSED';
      } else if (existing.state === 'PAUSED') {
        // Resuming restarts the clock: the check has not reported since.
        const schedule = scheduleChanged ? (data as unknown as Schedule) : toScheduleFromRow(existing);
        data.state = 'NEW';
        data.nextDueAt = this.nextDueOrThrow(schedule, new Date());
      }
    }

    const check = await this.prisma.check.update({ where: { id: checkId }, data });
    this.cache.invalidate(check.pingKey);
    return this.toDto(check);
  }

  async remove(checkId: string): Promise<void> {
    const deleted = await this.prisma.check
      .delete({ where: { id: checkId }, select: { pingKey: true } })
      .catch(() => null);
    if (deleted === null) throw new NotFoundException('Check not found');
    this.cache.invalidate(deleted.pingKey);
  }

  async get(checkId: string): Promise<CheckDto> {
    const check = await this.prisma.check.findUnique({ where: { id: checkId } });
    if (check === null) throw new NotFoundException('Check not found');
    return this.toDto(check);
  }

  async list(projectIds: readonly string[], query: ListChecksQuery): Promise<PageDto<CheckDto>> {
    if (projectIds.length === 0) return { items: [], nextCursor: null };

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

    const items = await this.prisma.check.findMany({
      where,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: query.limit + 1,
      ...(query.cursor === undefined ? {} : { cursor: { id: query.cursor }, skip: 1 }),
    });

    return this.paginate(items, query.limit, (check) => this.toDto(check));
  }

  async listPings(
    checkId: string,
    limit: number,
    cursor?: string,
  ): Promise<PageDto<PingDto>> {
    const cursorId = parseBigIntCursor(cursor);
    const pings = await this.prisma.ping.findMany({
      where: { checkId },
      orderBy: [{ receivedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursorId === null ? {} : { cursor: { id: cursorId }, skip: 1 }),
    });

    const page = this.paginate(pings, limit, toPingDto);
    return { items: page.items, nextCursor: page.nextCursor };
  }

  async listIncidents(
    checkId: string,
    limit: number,
    cursor?: string,
  ): Promise<PageDto<IncidentDto>> {
    const incidents = await this.prisma.incident.findMany({
      where: { checkId },
      orderBy: [{ startedAt: 'desc' }, { id: 'desc' }],
      take: limit + 1,
      ...(cursor === undefined ? {} : { cursor: { id: cursor }, skip: 1 }),
    });
    return this.paginate(incidents, limit, toIncidentDto);
  }

  /**
   * Slug for a starter-declared check: derived from the identity, not from the
   * display name, so renaming a job keeps its URL — and so the same job declared
   * by two environments does not collide on the per-project slug uniqueness.
   */
  static syncSlug(name: string, key: string, environment: string | null): string {
    const root = slugify(name).slice(0, 40).replace(/-+$/, '');
    const fingerprint = sha256Hex(`${environment ?? ''}|${key}`).slice(0, 8);
    return `${root.length > 0 ? `${root}-` : ''}${fingerprint}`;
  }

  toDto(check: Check): CheckDto {
    return toCheckDto(check, this.config.baseUrl);
  }

  private paginate<TRow extends { id: string | bigint }, TDto>(
    rows: TRow[],
    limit: number,
    map: (row: TRow) => TDto,
  ): PageDto<TDto> {
    const hasMore = rows.length > limit;
    const page = hasMore ? rows.slice(0, limit) : rows;
    const last = page[page.length - 1];
    return {
      items: page.map(map),
      nextCursor: hasMore && last !== undefined ? String(last.id) : null,
    };
  }

  private nextDueOrThrow(schedule: Schedule, from: Date): Date {
    try {
      return computeNextDueAt(schedule, from);
    } catch (error) {
      if (error instanceof InvalidScheduleError) throw new BadRequestException(error.message);
      throw error;
    }
  }

  private async slugTaken(projectId: string, slug: string): Promise<boolean> {
    return (await this.prisma.check.count({ where: { projectId, slug } })) > 0;
  }
}

export function toSchedule(input: {
  scheduleType?: 'interval' | 'cron';
  periodSeconds?: number;
  cronExpression?: string;
  timezone?: string;
}): Schedule {
  return input.scheduleType === 'cron'
    ? {
        scheduleType: 'cron',
        cronExpression: input.cronExpression as string,
        periodSeconds: null,
        timezone: input.timezone ?? DEFAULT_TIMEZONE,
      }
    : {
        scheduleType: 'interval',
        periodSeconds: input.periodSeconds as number,
        cronExpression: null,
        timezone: input.timezone ?? DEFAULT_TIMEZONE,
      };
}

function toScheduleFromRow(check: Check): Schedule {
  return {
    scheduleType: check.scheduleType,
    periodSeconds: check.periodSeconds,
    cronExpression: check.cronExpression,
    timezone: check.timezone,
  };
}

function parseBigIntCursor(cursor: string | undefined): bigint | null {
  if (cursor === undefined || !/^\d{1,19}$/.test(cursor)) return null;
  try {
    return BigInt(cursor);
  } catch {
    return null;
  }
}
