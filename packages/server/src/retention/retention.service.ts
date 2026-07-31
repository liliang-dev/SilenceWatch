import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { CronJob } from 'cron';
import { AuthService } from '../auth/auth.service';
import { EmailVerificationService } from '../auth/email-verification.service';
import { PasswordResetService } from '../auth/password-reset.service';
import { SignupGuardService } from '../auth/signup-guard.service';
import { AuditService } from '../audit/audit.service';
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
WITH plan_caps AS (
    -- {"free": 7, "pro": 90} from configuration. Empty on a self-hosted
    -- instance, which caps nothing.
    SELECT key AS plan, value::int AS days FROM jsonb_each_text($3::jsonb)
),
project_retention AS (
    -- What a project asked for, capped by what its owner's plan allows. The
    -- project keeps its own larger setting in the column: an upgrade should
    -- restore the intended window without anyone having to re-enter it.
    SELECT pr.id,
           LEAST(
               COALESCE(pr.ping_retention_days, $1::int),
               COALESCE(pc.days, 2147483647)
           ) AS days
      FROM project pr
      LEFT JOIN project_member pm ON pm.project_id = pr.id AND pm.role = 'owner'
      LEFT JOIN "user" u ON u.id = pm.user_id
      LEFT JOIN plan_caps pc ON pc.plan = u.plan
),
doomed AS (
    SELECT p.id
      FROM ping p
      JOIN "check" c ON c.id = p.check_id
      JOIN project_retention pr ON pr.id = c.project_id
     WHERE p.received_at < now() - make_interval(days => pr.days)
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
    private readonly verification: EmailVerificationService,
    private readonly signupGuard: SignupGuardService,
    private readonly passwordResets: PasswordResetService,
    private readonly audit: AuditService,
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

  /**
   * Plan name to retention ceiling, for the purge query. Only plans that
   * actually cap retention appear; everything else is unlimited by omission.
   */
  private retentionCapsJson(): string {
    if (!this.config.QUOTAS_ENABLED) return '{}';

    const caps: Record<string, number> = {};
    for (const [plan, limits] of Object.entries(this.config.planLimits)) {
      if (limits.retentionDays !== undefined) caps[plan] = limits.retentionDays;
    }
    return JSON.stringify(caps);
  }

  /** One full purge pass. Safe to call concurrently with ingestion. */
  async purge(): Promise<{
    pings: number;
    deliveries: number;
    sessions: number;
    verifications: number;
    abandonedAccounts: number;
    auditEvents: number;
  }> {
    const startedAt = Date.now();
    let pings = 0;

    try {
      for (let batch = 0; batch < MAX_BATCHES; batch += 1) {
        const result = await this.pg.query({
          name: 'retention_purge_pings',
          text: PURGE_PINGS_SQL,
          values: [this.config.PING_RETENTION_DAYS, BATCH_SIZE, this.retentionCapsJson()],
        });
        pings += result.rowCount ?? 0;
        if ((result.rowCount ?? 0) < BATCH_SIZE) break;
      }

      const deliveries = await this.pg.query({
        name: 'retention_purge_deliveries',
        text: PURGE_DELIVERIES_SQL,
      });
      const sessions = await this.auth.purgeStaleSessions();
      // Spent verification tokens, accounts that never proved their address,
      // and the sign-up attempt log past the window it informs. Left alone,
      // abandoned rows keep holding real addresses hostage against the unique
      // index — a flood that was blocked would still deny those users an
      // account later.
      const verifications = await this.verification.purge();
      await this.passwordResets.purge();
      await this.signupGuard.purgeOldAttempts();
      // The audit trail keeps its own, much longer window: it exists to answer
      // questions asked months after the fact.
      const auditEvents = await this.audit.purge(this.config.AUDIT_RETENTION_DAYS);

      const summary = {
        pings,
        deliveries: deliveries.rowCount ?? 0,
        sessions,
        verifications: verifications.tokens,
        abandonedAccounts: verifications.accounts,
        auditEvents,
      };
      this.logger.log(
        `Purge done in ${Date.now() - startedAt}ms: ${summary.pings} pings, ` +
          `${summary.deliveries} deliveries, ${summary.sessions} sessions, ` +
          `${summary.verifications} verification tokens, ` +
          `${summary.abandonedAccounts} unverified accounts, ` +
          `${summary.auditEvents} audit events`,
      );
      return summary;
    } catch (error) {
      // Retention failing is not worth taking alerting down for.
      this.logger.error(`Purge failed: ${(error as Error).message}`);
      return {
        pings,
        deliveries: 0,
        sessions: 0,
        verifications: 0,
        abandonedAccounts: 0,
        auditEvents: 0,
      };
    }
  }
}
