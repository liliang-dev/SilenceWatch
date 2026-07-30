import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { IntervalRunner } from '../common/interval-runner';
import { AppConfig, CONFIG } from '../config/config';
import { PgService } from '../database/pg.service';
import { NotificationQueueService, type IncidentRef } from '../notifications/notification-queue.service';

/**
 * Silence detection.
 *
 * Three statements per tick, each bounded and each driven by a partial index —
 * the loop costs what the *late* checks cost, never what all checks cost:
 *
 *   1. advance overdue checks: UP/NEW → LATE → DOWN;
 *   2. open an incident for every DOWN check that has none;
 *   3. resolve incidents whose check has come back (or been paused).
 *
 * Splitting "state" from "incident" is what lets the ingestion path stay bare: a
 * heartbeat only writes `state = 'UP'`, and step 3 turns that into a resolved
 * incident plus a recovery alert a few seconds later. Explicit `/fail` pings
 * land in step 2 through the same road.
 *
 * `FOR UPDATE SKIP LOCKED` is here from day one, not later: the day the server
 * runs two instances, it is the only reason alerts are not sent twice.
 */

const ADVANCE_SQL = `
WITH due AS (
    SELECT id, next_due_at, grace_seconds, state
      FROM "check"
     WHERE next_due_at < now()
       AND state IN ('UP', 'NEW', 'LATE')
       -- A LATE check is only actionable once its grace period is spent.
       -- Without this, every batch would re-select the same untransitionable
       -- rows and starve the checks queued behind them.
       AND (state <> 'LATE' OR now() >= next_due_at + make_interval(secs => grace_seconds))
     ORDER BY next_due_at
     FOR UPDATE SKIP LOCKED
     LIMIT $1
), transitioned AS (
    SELECT id,
           CASE
               WHEN now() >= next_due_at + make_interval(secs => grace_seconds) THEN 'DOWN'::check_state
               ELSE 'LATE'::check_state
           END AS next_state,
           state AS previous_state
      FROM due
)
UPDATE "check" c
   SET state = t.next_state,
       updated_at = now()
  FROM transitioned t
 WHERE c.id = t.id
   -- Belt and braces: the "due" predicate already excludes no-op transitions.
   AND c.state <> t.next_state
RETURNING c.id, c.name, t.previous_state, c.state AS new_state`;

const OPEN_INCIDENTS_SQL = `
WITH candidates AS (
    SELECT c.id
      FROM "check" c
     WHERE c.state = 'DOWN'
       AND NOT EXISTS (
           SELECT 1 FROM incident i
            WHERE i.check_id = c.id AND i.resolved_at IS NULL
       )
     FOR UPDATE OF c SKIP LOCKED
     LIMIT $1
), classified AS (
    SELECT candidates.id,
           CASE WHEN last_ping.kind = 'fail' THEN 'reported' ELSE 'missed' END AS cause
      FROM candidates
      LEFT JOIN LATERAL (
          SELECT kind FROM ping p
           WHERE p.check_id = candidates.id
           ORDER BY p.received_at DESC
           LIMIT 1
      ) last_ping ON true
)
INSERT INTO incident (check_id, cause)
SELECT id, cause FROM classified
-- The unique partial index on open incidents makes a race a no-op instead of a
-- duplicate alert.
ON CONFLICT DO NOTHING
RETURNING id, check_id`;

const RESOLVE_INCIDENTS_SQL = `
WITH resolvable AS (
    SELECT i.id
      FROM incident i
      JOIN "check" c ON c.id = i.check_id
     WHERE i.resolved_at IS NULL
       AND c.state IN ('UP', 'PAUSED')
     FOR UPDATE OF i SKIP LOCKED
     LIMIT $1
)
UPDATE incident i
   SET resolved_at = now()
  FROM resolvable
 WHERE i.id = resolvable.id
RETURNING i.id, i.check_id`;

interface TransitionRow {
  id: string;
  name: string;
  previous_state: string;
  new_state: string;
}

interface IncidentRow {
  id: string;
  check_id: string;
}

@Injectable()
export class DetectionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(DetectionService.name);
  private readonly runner: IntervalRunner;
  private wentLate = 0;
  private wentDown = 0;
  private recovered = 0;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly pg: PgService,
    private readonly notifications: NotificationQueueService,
    schedulerRegistry: SchedulerRegistry,
  ) {
    this.runner = new IntervalRunner(
      'detection',
      config.DETECTION_INTERVAL_MS,
      () => this.tick(),
      schedulerRegistry,
    );
  }

  onApplicationBootstrap(): void {
    if (!this.config.DETECTION_ENABLED) {
      this.logger.warn('Detection loop disabled by configuration — no alerts will be raised');
      return;
    }
    this.runner.start();
  }

  onModuleDestroy(): void {
    this.runner.stop();
  }

  health(): ReturnType<IntervalRunner['health']> & {
    wentLate: number;
    wentDown: number;
    recovered: number;
  } {
    return {
      ...this.runner.health(),
      wentLate: this.wentLate,
      wentDown: this.wentDown,
      recovered: this.recovered,
    };
  }

  /** One full detection pass. Exposed so tests can drive it deterministically. */
  async tick(): Promise<void> {
    await this.advanceOverdueChecks();
    await this.openIncidents();
    await this.resolveIncidents();
  }

  /**
   * Drains the overdue backlog in bounded batches. A cold start after downtime
   * can have thousands of late checks; the loop keeps each transaction short and
   * stops after a fixed number of batches so one tick cannot run forever.
   */
  private async advanceOverdueChecks(): Promise<void> {
    const batchSize = this.config.DETECTION_BATCH_SIZE;
    const maxBatches = 25;

    for (let batch = 0; batch < maxBatches; batch += 1) {
      const rows = await this.pg.transaction(async (client) => {
        const result = await client.query<TransitionRow>({
          name: 'detection_advance',
          text: ADVANCE_SQL,
          values: [batchSize],
        } as never);
        return result.rows;
      });

      for (const row of rows) {
        if (row.new_state === 'DOWN') {
          this.wentDown += 1;
          this.logger.warn(`Check "${row.name}" (${row.id}) is DOWN`);
        } else {
          this.wentLate += 1;
        }
      }

      // Every selected row transitions, so a short batch means drained.
      if (rows.length < batchSize) return;
    }

    this.logger.warn(`Overdue backlog still not drained after ${maxBatches} batches`);
  }

  private async openIncidents(): Promise<void> {
    const opened = await this.claimIncidents(OPEN_INCIDENTS_SQL, 'detection_open_incidents');
    if (opened.length === 0) return;

    this.logger.log(`Opened ${opened.length} incident(s)`);
    await this.notifications.enqueue(opened, 'down');
  }

  private async resolveIncidents(): Promise<void> {
    const resolved = await this.claimIncidents(RESOLVE_INCIDENTS_SQL, 'detection_resolve_incidents');
    if (resolved.length === 0) return;

    this.recovered += resolved.length;
    this.logger.log(`Resolved ${resolved.length} incident(s)`);
    await this.notifications.enqueue(resolved, 'up');
  }

  private async claimIncidents(sql: string, statementName: string): Promise<IncidentRef[]> {
    return this.pg.transaction(async (client) => {
      const result = await client.query<IncidentRow>({
        name: statementName,
        text: sql,
        values: [this.config.DETECTION_BATCH_SIZE],
      } as never);
      return result.rows.map((row) => ({ incidentId: row.id, checkId: row.check_id }));
    });
  }
}
