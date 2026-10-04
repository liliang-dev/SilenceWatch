import { Injectable } from '@nestjs/common';
import { PgService } from '../database/pg.service';
import { PrismaService } from '../database/prisma.service';

/**
 * The statements behind `POST /api/v1/checks/sync`. The whole payload is
 * upserted in a single statement: 500 declared jobs are one round trip, not 500.
 *
 * Upsert by `(project_id, key, environment)`, where the key is the client's
 * stable identity (`com.acme.jobs.BackupJob#run`), so redeploys and restarts
 * land on the same check and keep their history — while a staging deployment
 * declaring the same jobs gets its own checks instead of overwriting
 * production's. Checks absent from the payload are flagged orphaned, never
 * deleted: an automatic delete would wipe a check's history at the first
 * refactoring.
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

/** One row of the sync payload, shaped for `jsonb_to_recordset`. */
export interface SyncRow {
  key: string;
  name: string;
  slug: string;
  schedule_type: string;
  period_seconds: number | null;
  cron_expression: string | null;
  timezone: string;
  grace_seconds: number;
  tags: string[];
  next_due_at: string;
}

export interface UpsertedCheck {
  id: string;
  key: string;
  ping_key: string;
  created: boolean;
}

@Injectable()
export class CheckSyncRepository {
  constructor(
    private readonly pg: PgService,
    private readonly prisma: PrismaService,
  ) {}

  /** Keys of this environment that already exist, i.e. the ones a sync would update. */
  async findExistingKeys(
    projectId: string,
    keys: string[],
    environment: string | null,
  ): Promise<Set<string>> {
    const existing = await this.prisma.check.findMany({
      where: { projectId, key: { in: keys }, environment },
      select: { key: true },
    });
    return new Set(existing.flatMap((check) => (check.key === null ? [] : [check.key])));
  }

  /**
   * Upserts the rows and, when asked, flags as orphaned every other declared check
   * of the same environment. Both in one transaction.
   */
  async upsert(
    projectId: string,
    environment: string | null,
    accepted: SyncRow[],
    orphanScope: { keysToKeep: string[] } | null,
  ): Promise<{ upserted: UpsertedCheck[]; orphaned: string[] }> {
    return this.pg.transaction(async (client) => {
      const upsertResult = await client.query<UpsertedCheck>({
        name: 'checks_sync_upsert',
        text: UPSERT_SQL,
        values: [projectId, JSON.stringify(accepted), environment],
      } as never);

      const orphanResult =
        orphanScope === null
          ? { rows: [] as Array<{ key: string }> }
          : await client.query<{ key: string }>({
              name: 'checks_sync_orphan',
              text: ORPHAN_SQL,
              values: [projectId, orphanScope.keysToKeep, environment],
            } as never);

      return { upserted: upsertResult.rows, orphaned: orphanResult.rows.map((row) => row.key) };
    });
  }
}
