import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import type { AlertKind, ChannelType, CheckState } from '@silencewatch/shared';
import { IntervalRunner } from '../common/interval-runner';
import { AppConfig, CONFIG } from '../config/config';
import { PgService } from '../database/pg.service';
import type { Alert } from './alert';
import { SenderRegistry } from './sender.registry';

/**
 * The alert queue lives in PostgreSQL. No Redis, no BullMQ: a monitoring product
 * cannot afford a moving part that itself needs monitoring, and `FOR UPDATE SKIP
 * LOCKED` gives exactly the semantics needed — two instances claim disjoint
 * batches, and a crashed instance's rows become claimable again when their lease
 * expires.
 */

/** How long a claimed row is invisible to other workers while a send is in flight. */
const CLAIM_LEASE = "interval '5 minutes'";

const ENQUEUE_SQL = `
INSERT INTO notification_delivery (incident_id, channel_id, kind)
SELECT incoming.incident_id, ch.id, $3::alert_kind
  FROM unnest($1::uuid[], $2::uuid[]) AS incoming(incident_id, check_id)
  JOIN "check" c ON c.id = incoming.check_id
  JOIN notification_channel ch ON ch.project_id = c.project_id AND ch.enabled
 WHERE $3::alert_kind = 'down'
    -- Never announce a recovery for an outage nobody was told about.
    OR EXISTS (
        SELECT 1 FROM notification_delivery sent
         WHERE sent.incident_id = incoming.incident_id
           AND sent.kind = 'down'
           AND sent.status = 'sent'
    )
ON CONFLICT (incident_id, channel_id, kind) DO NOTHING
RETURNING id`;

const CLAIM_SQL = `
WITH claimed AS (
    SELECT d.id
      FROM notification_delivery d
     WHERE d.status = 'pending'
       AND d.next_attempt_at <= now()
     ORDER BY d.next_attempt_at
     FOR UPDATE SKIP LOCKED
     LIMIT $1
)
UPDATE notification_delivery d
   SET attempts = d.attempts + 1,
       next_attempt_at = now() + ${CLAIM_LEASE}
  FROM claimed
 WHERE d.id = claimed.id
RETURNING d.id`;

const CONTEXT_SQL = `
SELECT d.id, d.kind, d.attempts,
       ch.id AS channel_id, ch.type AS channel_type, ch.name AS channel_name, ch.config,
       i.id AS incident_id, i.started_at, i.resolved_at, i.cause,
       c.id AS check_id, c.name AS check_name, c.state, c.environment, c.tags,
       c.last_ping_at, c.next_due_at, c.grace_seconds,
       c.schedule_type, c.period_seconds, c.cron_expression, c.timezone,
       p.id AS project_id, p.name AS project_name
  FROM notification_delivery d
  JOIN notification_channel ch ON ch.id = d.channel_id
  JOIN incident i ON i.id = d.incident_id
  JOIN "check" c ON c.id = i.check_id
  JOIN project p ON p.id = c.project_id
 WHERE d.id = ANY($1::uuid[])`;

const MARK_SENT_SQL = `
UPDATE notification_delivery
   SET status = 'sent', sent_at = now(), last_error = NULL
 WHERE id = ANY($1::uuid[])
RETURNING incident_id`;

/**
 * Kept as a *separate* statement on purpose: marking a delivery sent and bumping
 * its incident's counter touch two tables that the detection loop locks in the
 * opposite order. Two short transactions cannot form a cycle, and the counter is
 * reporting only — losing an increment is preferable to holding both locks.
 */
const COUNT_SENT_SQL = `
UPDATE incident i
   SET notifications_sent = i.notifications_sent + counted.total
  FROM (
      SELECT id, count(*)::int AS total
        FROM unnest($1::uuid[]) AS t(id)
       GROUP BY id
  ) counted
 WHERE i.id = counted.id`;

/**
 * Exponential backoff, capped at an hour: 30s, 1m, 2m, 4m, 8m, … A channel that
 * is down for a while should not be hammered, but recovery must not take a day.
 */
const RETRY_SQL = `
UPDATE notification_delivery
   SET status = CASE WHEN attempts >= $2::int THEN 'failed'::delivery_status ELSE 'pending'::delivery_status END,
       last_error = left($3::text, 500),
       next_attempt_at = now() + make_interval(secs => LEAST(3600, 30 * power(2, GREATEST(0, attempts - 1)))::double precision)
 WHERE id = $1::uuid`;

interface ContextRow {
  id: string;
  kind: AlertKind;
  attempts: number;
  channel_id: string;
  channel_type: ChannelType;
  channel_name: string;
  config: unknown;
  incident_id: string;
  started_at: Date;
  resolved_at: Date | null;
  cause: string;
  check_id: string;
  check_name: string;
  state: CheckState;
  environment: string | null;
  tags: string[];
  last_ping_at: Date | null;
  next_due_at: Date | null;
  grace_seconds: number;
  schedule_type: 'interval' | 'cron';
  period_seconds: number | null;
  cron_expression: string | null;
  timezone: string;
  project_id: string;
  project_name: string;
}

export interface IncidentRef {
  incidentId: string;
  checkId: string;
}

@Injectable()
export class NotificationQueueService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationQueueService.name);
  private readonly runner: IntervalRunner;
  private sent = 0;
  private failed = 0;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly pg: PgService,
    private readonly senders: SenderRegistry,
    schedulerRegistry: SchedulerRegistry,
  ) {
    this.runner = new IntervalRunner(
      'notifications',
      config.NOTIFICATION_INTERVAL_MS,
      () => this.drain(),
      schedulerRegistry,
    );
  }

  onApplicationBootstrap(): void {
    this.runner.start();
  }

  onModuleDestroy(): void {
    this.runner.stop();
  }

  /**
   * Fans an incident out to every enabled channel of its project. Idempotent:
   * the unique index on (incident, channel, kind) makes a double call a no-op,
   * which is what makes at-least-once detection safe.
   */
  async enqueue(incidents: readonly IncidentRef[], kind: AlertKind): Promise<number> {
    if (incidents.length === 0) return 0;

    const result = await this.pg.query<{ id: string }>({
      name: 'notification_enqueue',
      text: ENQUEUE_SQL,
      values: [
        incidents.map((incident) => incident.incidentId),
        incidents.map((incident) => incident.checkId),
        kind,
      ],
    });

    const queued = result.rowCount ?? 0;
    if (queued > 0) {
      this.logger.log(`Queued ${queued} ${kind} notification(s)`);
      // Deliver now rather than waiting for the next tick: alert latency is the
      // product.
      void this.runner.run();
    }
    return queued;
  }

  health(): ReturnType<IntervalRunner['health']> & { sent: number; failed: number } {
    return { ...this.runner.health(), sent: this.sent, failed: this.failed };
  }

  /** Resolves once no delivery pass is in flight. */
  async settle(): Promise<void> {
    await this.runner.settle();
  }

  /**
   * Waits for any in-flight delivery pass, then makes one more, so nothing that
   * could have gone out is left sitting in the queue. Used by tests and by the
   * diagnostics command.
   */
  async flush(): Promise<void> {
    await this.runner.settle();
    await this.runner.run();
  }

  /** Claims a batch and delivers it. Exposed for tests. */
  async drain(): Promise<void> {
    const claimed = await this.pg.query<{ id: string }>({
      name: 'notification_claim',
      text: CLAIM_SQL,
      values: [this.config.NOTIFICATION_BATCH_SIZE],
    });
    if ((claimed.rowCount ?? 0) === 0) return;

    const contexts = await this.pg.query<ContextRow>({
      name: 'notification_context',
      text: CONTEXT_SQL,
      values: [claimed.rows.map((row) => row.id)],
    });

    // Sequential on purpose: batches are small, and one hung provider must not
    // open fifty concurrent sockets.
    const delivered: string[] = [];
    for (const row of contexts.rows) {
      try {
        await this.deliver(row);
        delivered.push(row.id);
        this.sent += 1;
      } catch (error) {
        this.failed += 1;
        const message = (error as Error).message;
        this.logger.warn(
          `Delivery ${row.id} to ${row.channel_type} channel "${row.channel_name}" failed ` +
            `(attempt ${row.attempts}/${this.config.NOTIFICATION_MAX_ATTEMPTS}): ${message}`,
        );
        await this.pg
          .query({
            name: 'notification_retry',
            text: RETRY_SQL,
            values: [row.id, this.config.NOTIFICATION_MAX_ATTEMPTS, message],
          })
          .catch((updateError: Error) =>
            this.logger.error(`Could not record delivery failure: ${updateError.message}`),
          );
      }
    }

    if (delivered.length === 0) return;

    const marked = await this.pg.query<{ incident_id: string }>({
      name: 'notification_mark_sent',
      text: MARK_SENT_SQL,
      values: [delivered],
    });

    // The counter is reporting, not correctness: a failure here must never turn a
    // delivered alert back into a pending one.
    await this.pg
      .query({
        name: 'notification_count_sent',
        text: COUNT_SENT_SQL,
        values: [marked.rows.map((row) => row.incident_id)],
      })
      .catch((error: Error) =>
        this.logger.warn(`Could not update incident notification counters: ${error.message}`),
      );
  }

  private async deliver(row: ContextRow): Promise<void> {
    const sender = this.senders.get(row.channel_type);
    await sender.send(this.toAlert(row), row.config);
  }

  private toAlert(row: ContextRow): Alert {
    return {
      kind: row.kind,
      project: { id: row.project_id, name: row.project_name },
      check: {
        id: row.check_id,
        name: row.check_name,
        state: row.state,
        environment: row.environment,
        tags: row.tags ?? [],
        lastPingAt: row.last_ping_at,
        nextDueAt: row.next_due_at,
        graceSeconds: row.grace_seconds,
        scheduleType: row.schedule_type,
        periodSeconds: row.period_seconds,
        cronExpression: row.cron_expression,
        timezone: row.timezone,
      },
      incident: {
        id: row.incident_id,
        startedAt: row.started_at,
        resolvedAt: row.resolved_at,
        cause: row.cause,
      },
      url: `${this.config.baseUrl}/checks/${row.check_id}`,
    };
  }
}
