import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Check, Prisma } from '@prisma/client';
import type {
  CheckDto,
  CreateCheckRequest,
  IncidentDto,
  ListChecksQuery,
  PageDto,
  PingDto,
  UpdateCheckRequest,
} from '@silencewatch/shared';
import { uniqueSlug } from '../common/slug.util';
import { AppConfig, CONFIG } from '../config/config';
import { CheckMetadataCache } from '../ingest/check-metadata.cache';
import { QuotaService } from '../quotas/quota.service';
import type { Schedule } from '../schedule/next-due';
import { nextDueOrThrow, toSchedule, toScheduleFromRow } from './check-schedule';
import { toCheckDto, toIncidentDto, toPingDto } from './check.mapper';
import { ChecksRepository } from './checks.repository';
import { paginate, parseBigIntCursor } from './pagination';

@Injectable()
export class ChecksService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly checks: ChecksRepository,
    private readonly cache: CheckMetadataCache,
    private readonly quotas: QuotaService,
  ) {}

  async create(projectId: string, input: CreateCheckRequest): Promise<CheckDto> {
    // Before any work: a plan ceiling refused after the slug search would still
    // be correct, but it would burn a query to say no.
    await this.quotas.assertCanAddCheck(projectId);

    const schedule = toSchedule(input);
    const nextDueAt = nextDueOrThrow(schedule, new Date());

    const slug = await uniqueSlug(input.slug ?? input.name, (candidate) =>
      this.checks.isSlugTaken(projectId, candidate),
    );

    const check = await this.checks.create({
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
    });

    return this.toDto(check);
  }

  async update(checkId: string, input: UpdateCheckRequest): Promise<CheckDto> {
    const existing = await this.checks.findById(checkId);
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
      data.nextDueAt = nextDueOrThrow(schedule, new Date());
    }

    if (input.paused !== undefined) {
      if (input.paused) {
        data.state = 'PAUSED';
      } else if (existing.state === 'PAUSED') {
        // Resuming restarts the clock: the check has not reported since.
        const schedule = scheduleChanged ? (data as unknown as Schedule) : toScheduleFromRow(existing);
        data.state = 'NEW';
        data.nextDueAt = nextDueOrThrow(schedule, new Date());
      }
    }

    const check = await this.checks.update(checkId, data);
    this.cache.invalidate(check.pingKey);
    return this.toDto(check);
  }

  /**
   * Issues a new ping URL for a check, keeping everything else.
   *
   * A ping URL is a bearer secret that ends up pasted into crontabs, CI
   * configuration and chat messages, so it leaks the way secrets leak. Without
   * this, the only remedy was deleting the check — which throws away its
   * history and its incidents to fix a problem that has nothing to do with
   * them.
   *
   * The old key stops working the moment this returns. That is the point, and
   * it is also why the UI says so before doing it: any job still calling the
   * previous URL goes silent, and this product turns silence into an alert.
   */
  async rotatePingKey(checkId: string): Promise<CheckDto> {
    const previousKey = await this.checks.findPingKey(checkId);
    if (previousKey === null) throw new NotFoundException('Check not found');

    if (!(await this.checks.replacePingKey(checkId))) {
      throw new NotFoundException('Check not found');
    }

    // The old key must stop resolving here too, not just in the database.
    this.cache.invalidate(previousKey);

    const updated = await this.requireCheck(checkId);
    this.cache.invalidate(updated.pingKey);
    return this.toDto(updated);
  }

  async remove(checkId: string): Promise<void> {
    const deleted = await this.checks.delete(checkId);
    if (deleted === null) throw new NotFoundException('Check not found');
    this.cache.invalidate(deleted.pingKey);
  }

  async get(checkId: string): Promise<CheckDto> {
    return this.toDto(await this.requireCheck(checkId));
  }

  async list(projectIds: readonly string[], query: ListChecksQuery): Promise<PageDto<CheckDto>> {
    if (projectIds.length === 0) return { items: [], nextCursor: null };

    const rows = await this.checks.list(projectIds, query);
    return paginate(rows, query.limit, (check) => this.toDto(check));
  }

  async listPings(checkId: string, limit: number, cursor?: string): Promise<PageDto<PingDto>> {
    const rows = await this.checks.listPings(checkId, limit, parseBigIntCursor(cursor));
    return paginate(rows, limit, toPingDto);
  }

  async listIncidents(
    checkId: string,
    limit: number,
    cursor?: string,
  ): Promise<PageDto<IncidentDto>> {
    const rows = await this.checks.listIncidents(checkId, limit, cursor);
    return paginate(rows, limit, toIncidentDto);
  }

  toDto(check: Check): CheckDto {
    return toCheckDto(check, this.config.baseUrl);
  }

  private async requireCheck(checkId: string): Promise<Check> {
    const check = await this.checks.findById(checkId);
    if (check === null) throw new NotFoundException('Check not found');
    return check;
  }
}
