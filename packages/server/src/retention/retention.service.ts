import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AuthService } from '../auth/auth.service';
import { AppConfig, CONFIG } from '../config/config';
import { PgService } from '../database/pg.service';

/**
 * `ping` is the one table that grows without bound — one row per heartbeat,
 * forever. Retention is configurable per project (with a server-wide default)
 * and enforced here.
 *
 * Deletions run in bounded batches: a single `DELETE` covering months of history
 * would hold a long transaction and bloat the table's dead-tuple count while
 * ingestion is trying to write to it.
 */
const PURGE_PINGS_SQL = `
WITH doomed AS (
    SELECT p.id
      FROM ping p
      JOIN "check" c ON c.id = p.check_id
      JOIN project pr ON pr.id = c.project_id
     WHERE p.received_at < now() - make_interval(days => COALESCE(pr.ping_retention_days, $1::int))
     LIMIT $2
)
DELETE FROM ping WHERE id IN (SELECT id FROM doomed)`;

/** Finished deliveries are an audit trail, not history worth keeping forever. */
const PURGE_DELIVERIES_SQL = `
DELETE FROM notification_delivery
 WHERE status <> 'pending'
   AND created_at < now() - interval '30 days'`;

const BATCH_SIZE = 10_000;
const MAX_BATCHES = 200;

@Injectable()
export class RetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(RetentionService.name);
  private readonly jobName = 'retention-purge';

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly pg: PgService,
    private readonly auth: AuthService,
    private readonly scheduler: SchedulerRegistry,
  ) {}

  onApplicationBootstrap(): void {
    const job = new CronJob(this.config.PURGE_CRON, () => void this.purge(), null, false, 'UTC');
    this.scheduler.addCronJob(this.jobName, job as never);
    job.start();
    this.logger.log(
      `Purge scheduled (${this.config.PURGE_CRON} UTC, default retention ` +
        `${this.config.PING_RETENTION_DAYS} days)`,
    );
  }

  onModuleDestroy(): void {
    if (this.scheduler.doesExist('cron', this.jobName)) {
      this.scheduler.getCronJob(this.jobName).stop();
      this.scheduler.deleteCronJob(this.jobName);
    }
  }

  /** One full purge pass. Safe to call concurrently with ingestion. */
  async purge(): Promise<{ pings: number; deliveries: number; sessions: number }> {
    const startedAt = Date.now();
    let pings = 0;

    try {
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const result = await this.pg.query({
          name: 'retention_purge_pings',
          text: PURGE_PINGS_SQL,
          values: [this.config.PING_RETENTION_DAYS, BATCH_SIZE],
        });
        pings += result.rowCount ?? 0;
        if ((result.rowCount ?? 0) < BATCH_SIZE) break;
      }

      const deliveries = await this.pg.query({
        name: 'retention_purge_deliveries',
        text: PURGE_DELIVERIES_SQL,
      });
      const sessions = await this.auth.purgeStaleSessions();

      const summary = {
        pings,
        deliveries: deliveries.rowCount ?? 0,
        sessions,
      };
      this.logger.log(
        `Purge done in ${Date.now() - startedAt}ms: ${summary.pings} pings, ` +
          `${summary.deliveries} deliveries, ${summary.sessions} sessions`,
      );
      return summary;
    } catch (error) {
      // Retention failing is not worth taking alerting down for.
      this.logger.error(`Purge failed: ${(error as Error).message}`);
      return { pings, deliveries: 0, sessions: 0 };
    }
  }
}
