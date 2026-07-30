import { BadRequestException, Inject, Injectable, Logger } from '@nestjs/common';
import type { SyncRequest, SyncResultDto } from '@silencewatch/shared';
import { AppConfig, CONFIG } from '../config/config';
import { PgService } from '../database/pg.service';
import { computeNextDueAt, InvalidScheduleError, type Schedule } from '../schedule/next-due';
import { ChecksService } from './checks.service';

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
const UPSERT_SQL = `
INSERT INTO "check" (
    project_id, name, slug, key, schedule_type, period_seconds, cron_expression,
    timezone, grace_seconds, source, environment, tags, next_due_at, state
)
SELECT $1::uuid,
       incoming.name,
       incoming.slug,
       incoming.key,
       incoming.schedule_type::schedule_type,
       incoming.period_seconds,
       incoming.cron_expression,
       incoming.timezone,
       incoming.grace_seconds,
       'auto'::check_source,
       $3::text,
       COALESCE(incoming.tags, '{}'::text[]),
       incoming.next_due_at,
       'NEW'::check_state
  FROM jsonb_to_recordset($2::jsonb) AS incoming(
           key text, name text, slug text, schedule_type text, period_seconds int,
           cron_expression text, timezone text, grace_seconds int, tags text[],
           next_due_at timestamptz
       )
ON CONFLICT (project_id, key, (COALESCE(environment, ''))) WHERE key IS NOT NULL DO UPDATE SET
    name             = EXCLUDED.name,
    schedule_type    = EXCLUDED.schedule_type,
    period_seconds   = EXCLUDED.period_seconds,
    cron_expression  = EXCLUDED.cron_expression,
    timezone         = EXCLUDED.timezone,
    grace_seconds    = EXCLUDED.grace_seconds,
    tags             = EXCLUDED.tags,
    -- Reappearing after a rename or a redeploy clears the orphan flag.
    orphaned_at      = NULL,
    updated_at       = now(),
    -- The deadline only moves when the schedule actually changed; otherwise a
    -- restart would grant every job a fresh grace period.
    next_due_at      = CASE
                           WHEN "check".schedule_type   IS DISTINCT FROM EXCLUDED.schedule_type
                             OR "check".period_seconds  IS DISTINCT FROM EXCLUDED.period_seconds
                             OR "check".cron_expression IS DISTINCT FROM EXCLUDED.cron_expression
                             OR "check".timezone        IS DISTINCT FROM EXCLUDED.timezone
                           THEN EXCLUDED.next_due_at
                           ELSE "check".next_due_at
                       END
RETURNING id, key, ping_key, (xmax = 0) AS created`;

const ORPHAN_SQL = `
UPDATE "check"
   SET orphaned_at = now(), updated_at = now()
 WHERE project_id = $1::uuid
   AND source = 'auto'
   AND key IS NOT NULL
   AND orphaned_at IS NULL
   -- Scoped to the environment that reported: a staging deployment must not
   -- orphan production checks.
   AND environment IS NOT DISTINCT FROM $3::text
   AND NOT (key = ANY($2::text[]))
RETURNING key`;

/** Applied when a client declares a job without one. */
const DEFAULT_GRACE_SECONDS = 300;
const DEFAULT_TIMEZONE = 'UTC';

interface UpsertRow {
  id: string;
  key: string;
  ping_key: string;
  created: boolean;
}

@Injectable()
export class CheckSyncService {
  private readonly logger = new Logger(CheckSyncService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly pg: PgService,
  ) {}

  async sync(projectId: string, request: SyncRequest): Promise<SyncResultDto> {
    const now = new Date();
    const environment = request.environment ?? null;
    const seen = new Set<string>();
    const rows = request.checks.map((incoming) => {
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
        slug: ChecksService.syncSlug(incoming.name, incoming.key, environment),
        schedule_type: schedule.scheduleType,
        period_seconds: schedule.periodSeconds,
        cron_expression: schedule.cronExpression,
        timezone: schedule.timezone,
        grace_seconds: incoming.grace_seconds ?? DEFAULT_GRACE_SECONDS,
        tags: incoming.tags ?? [],
        next_due_at: nextDueAt.toISOString(),
      };
    });

    const { upserted, orphaned } = await this.pg.transaction(async (client) => {
      const upsertResult = await client.query<UpsertRow>({
        name: 'checks_sync_upsert',
        text: UPSERT_SQL,
        values: [projectId, JSON.stringify(rows), environment],
      } as never);

      const orphanResult = request.prune
        ? await client.query<{ key: string }>({
            name: 'checks_sync_orphan',
            text: ORPHAN_SQL,
            values: [projectId, rows.map((row) => row.key), environment],
          } as never)
        : { rows: [] as Array<{ key: string }> };

      return { upserted: upsertResult.rows, orphaned: orphanResult.rows.map((row) => row.key) };
    });

    const created = upserted.filter((row) => row.created).length;
    this.logger.log(
      `Sync for project ${projectId} (${request.source ?? 'unknown client'}, ` +
        `env=${environment ?? 'none'}): ${created} created, ${upserted.length - created} updated, ` +
        `${orphaned.length} orphaned`,
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
    };
  }
}
