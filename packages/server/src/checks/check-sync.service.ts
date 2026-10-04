import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { SyncRequest, SyncResultDto } from '@silencewatch/shared';
import { AppConfig, CONFIG } from '../config/config';
import { QuotaService } from '../quotas/quota.service';
import { computeNextDueAt, InvalidScheduleError, type Schedule } from '../schedule/next-due';
import { syncSlug } from './check-slug';
import { CheckSyncRepository, type SyncRow } from './check-sync.repository';

/**
 * `POST /api/v1/checks/sync` — the endpoint the client starters call at startup.
 *
 * Contract:
 *  - upsert by `(project_id, key, environment)`, where the key is the client's
 *    stable identity (`com.acme.jobs.BackupJob#run`), so redeploys and restarts
 *    land on the same check and keep their history — while a staging deployment
 *    declaring the same jobs gets its own checks instead of overwriting
 *    production's;
 *  - checks that exist in the database but are absent from the payload are
 *    **flagged orphaned, never deleted** — an automatic delete would wipe a
 *    check's history at the first refactoring;
 *  - the response returns each check's ping key, which is all the client needs.
 *
 * The whole payload is upserted in a single statement: 500 declared jobs are one
 * round trip, not 500.
 */

/** Applied when a client declares a job without one. */
const DEFAULT_GRACE_SECONDS = 300;
const DEFAULT_TIMEZONE = 'UTC';

@Injectable()
export class CheckSyncService {
  private readonly logger = new Logger(CheckSyncService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly repository: CheckSyncRepository,
    private readonly quotas: QuotaService,
  ) {}

  async sync(projectId: string, request: SyncRequest): Promise<SyncResultDto> {
    const now = new Date();
    const environment = request.environment ?? null;
    const seen = new Set<string>();
    const rows: SyncRow[] = request.checks.map((incoming) => {
      if (seen.has(incoming.key)) {
        throw new BadRequestException(`Duplicate check key in payload: "${incoming.key}"`);
      }
      seen.add(incoming.key);

      const schedule: Schedule =
        incoming.cron === undefined
          ? {
              scheduleType: 'interval',
              periodSeconds: incoming.interval_seconds as number,
              cronExpression: null,
              timezone: incoming.timezone ?? DEFAULT_TIMEZONE,
            }
          : {
              scheduleType: 'cron',
              cronExpression: incoming.cron,
              periodSeconds: null,
              timezone: incoming.timezone ?? DEFAULT_TIMEZONE,
            };

      let nextDueAt: Date;
      try {
        nextDueAt = computeNextDueAt(schedule, now);
      } catch (error) {
        if (error instanceof InvalidScheduleError) {
          throw new BadRequestException(`Check "${incoming.key}": ${error.message}`);
        }
        throw error;
      }

      return {
        key: incoming.key,
        name: incoming.name,
        slug: syncSlug(incoming.name, incoming.key, environment),
        schedule_type: schedule.scheduleType,
        period_seconds: schedule.periodSeconds,
        cron_expression: schedule.cronExpression,
        timezone: schedule.timezone,
        grace_seconds: incoming.grace_seconds ?? DEFAULT_GRACE_SECONDS,
        tags: incoming.tags ?? [],
        next_due_at: nextDueAt.toISOString(),
      };
    });

    // Plan ceiling. Applied to the rows that would be *created*: an account at
    // its limit must still be able to update the checks it already has, or a
    // schedule change would start failing for reasons nobody could guess.
    const skipped = await this.applyCheckQuota(projectId, rows, environment);
    const accepted = skipped.length === 0 ? rows : rows.filter((row) => !skipped.includes(row.key));

    // Keys held back by quota are *not* orphans: pruning them would delete history
    // the account is still paying to keep.
    const { upserted, orphaned } = await this.repository.upsert(
      projectId,
      environment,
      accepted,
      request.prune ? { keysToKeep: rows.map((row) => row.key) } : null,
    );

    const created = upserted.filter((row) => row.created).length;
    this.logger.log(
      `Sync for project ${projectId} (${request.source ?? 'unknown client'}, ` +
        `env=${environment ?? 'none'}): ${created} created, ${upserted.length - created} updated, ` +
        `${orphaned.length} orphaned` +
        (skipped.length > 0 ? `, ${skipped.length} refused by plan limit` : ''),
    );

    return {
      checks: upserted.map((row) => ({
        key: row.key,
        id: row.id,
        pingKey: row.ping_key,
        pingUrl: `${this.config.baseUrl}/p/${row.ping_key}`,
        created: row.created,
      })),
      orphaned,
      ...(skipped.length === 0 ? {} : { skipped }),
    };
  }

  /**
   * Returns the keys that must not be created because the owner's plan has no
   * room left.
   *
   * Deliberately not an exception. This endpoint is called by an application
   * starting up, and the contract with the starter is that SilenceWatch never
   * fails somebody else's deployment. Refusing part of the payload and saying
   * which part is the honest version of that promise; a 402 that aborts the
   * whole sync would take the other thirty-nine jobs down with it.
   */
  private async applyCheckQuota(
    projectId: string,
    rows: Array<{ key: string }>,
    environment: string | null,
  ): Promise<string[]> {
    const remaining = await this.quotas.remainingChecks(projectId);
    if (remaining === null) return [];

    const known = await this.repository.findExistingKeys(
      projectId,
      rows.map((row) => row.key),
      environment,
    );

    const wouldCreate = rows.filter((row) => !known.has(row.key));
    if (wouldCreate.length <= remaining) return [];

    // Keep the first `remaining` in payload order: the starter reports its jobs
    // in a stable order, so the same ones survive across restarts rather than
    // a different arbitrary subset each time.
    return wouldCreate.slice(remaining).map((row) => row.key);
  }
}
