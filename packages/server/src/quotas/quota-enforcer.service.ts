import { Inject, Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { SchedulerRegistry } from '@nestjs/schedule';
import { IntervalRunner } from '../common/interval-runner';
import { AppConfig, CONFIG } from '../config/config';
import { PgService } from '../database/pg.service';
import { PrismaService } from '../database/prisma.service';
import { AuditService } from '../audit/audit.service';
import { EmailService } from '../notifications/email.service';
import { escapeHtml } from '../notifications/templates';
import { QuotaService } from './quota.service';

/**
 * Reconciles accounts with the plan they are on.
 *
 * The plan itself is written by whatever system does billing — a column, not an
 * API this repository owns. This loop is what makes a change to that column
 * mean something: an account that drops below its check count has the excess
 * paused, and an account that moves back up has them resumed.
 *
 * **Pausing monitoring is a serious act**, and this is a product built on the
 * premise that silence is the failure. Three rules follow, and they are the
 * reason this is a reconciler and not a line in a billing webhook:
 *
 *  - Only checks paused *by quota* are ever resumed automatically. A check
 *    somebody paused on purpose stays paused.
 *  - The newest checks go first. The ones that have been watched longest are
 *    the ones somebody is most likely relying on.
 *  - Nobody finds out by noticing the absence of alerts. An email names every
 *    check that stopped.
 */
@Injectable()
export class QuotaEnforcerService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QuotaEnforcerService.name);
  private readonly runner: IntervalRunner;

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
    private readonly pg: PgService,
    private readonly quotas: QuotaService,
    private readonly email: EmailService,
    private readonly audit: AuditService,
    scheduler: SchedulerRegistry,
  ) {
    this.runner = new IntervalRunner(
      'quota-enforcer',
      this.config.QUOTA_RECONCILE_INTERVAL_MS,
      async () => {
        await this.reconcile();
      },
      scheduler,
    );
  }

  onApplicationBootstrap(): void {
    if (!this.quotas.enabled) return;
    this.runner.start();
  }

  onModuleDestroy(): void {
    this.runner.stop();
  }

  /** One pass. Returns what it changed, for tests and for the log line. */
  async reconcile(): Promise<{ paused: number; resumed: number; accounts: number }> {
    if (!this.quotas.enabled) return { paused: 0, resumed: 0, accounts: 0 };

    const owners = await this.ownersWithChecks();
    let paused = 0;
    let resumed = 0;
    let touched = 0;

    for (const owner of owners) {
      const limit = this.quotas.limitsFor(owner.plan).checks;
      if (limit === undefined) {
        // Moved to an unlimited plan: give back everything quota took.
        const back = await this.resume(owner.userId, Number.MAX_SAFE_INTEGER);
        resumed += back;
        if (back > 0) touched += 1;
        continue;
      }

      const excess = owner.activeChecks - limit;
      if (excess > 0) {
        const stopped = await this.pauseExcess(owner.userId, excess);
        paused += stopped.length;
        if (stopped.length > 0) {
          touched += 1;
          this.audit.record({
            action: 'quota.checks_paused',
            actor: { userId: owner.userId, email: owner.email },
            detail: { plan: owner.plan, limit, paused: stopped.length, checks: stopped.slice(0, 20) },
          });
          await this.notify(owner.email, owner.plan, limit, stopped);
        }
      } else if (owner.pausedByQuota > 0) {
        const back = await this.resume(owner.userId, limit - owner.activeChecks);
        resumed += back;
        if (back > 0) touched += 1;
      }
    }

    if (paused > 0 || resumed > 0) {
      this.logger.log(
        `Quota reconciliation: ${paused} check(s) paused, ${resumed} resumed across ${touched} account(s)`,
      );
      // No cache to invalidate: the ingestion cache holds only the schedule,
      // and "is it paused" is answered in SQL on every heartbeat
      // (`WHERE state <> 'PAUSED'`), which is what makes a pause take effect
      // immediately across every instance.
    }

    return { paused, resumed, accounts: touched };
  }

  /**
   * One row per account that owns at least one check, with what it is using.
   *
   * Raw SQL because the shape — group checks by the *owner* of their project,
   * splitting quota-paused from active — is three joins and two filtered counts,
   * and expressing that through the ORM would be longer and slower without
   * being any clearer.
   */
  private async ownersWithChecks(): Promise<
    Array<{ userId: string; email: string; plan: string | null; activeChecks: number; pausedByQuota: number }>
  > {
    const result = await this.pg.query<{
      user_id: string;
      email: string;
      plan: string | null;
      active_checks: string;
      paused_by_quota: string;
    }>({
      name: 'quota_owners_with_checks',
      text: `
        SELECT u.id   AS user_id,
               u.email,
               u.plan,
               count(*) FILTER (WHERE c.paused_reason IS DISTINCT FROM 'quota') AS active_checks,
               count(*) FILTER (WHERE c.paused_reason = 'quota')                AS paused_by_quota
          FROM "check" c
          JOIN project_member pm ON pm.project_id = c.project_id AND pm.role = 'owner'
          JOIN "user" u ON u.id = pm.user_id
         GROUP BY u.id, u.email, u.plan`,
    });

    return result.rows.map((row) => ({
      userId: row.user_id,
      email: row.email,
      plan: row.plan,
      activeChecks: Number(row.active_checks),
      pausedByQuota: Number(row.paused_by_quota),
    }));
  }

  /** Pauses the newest `count` active checks and returns their names. */
  private async pauseExcess(userId: string, count: number): Promise<string[]> {
    const doomed = await this.prisma.check.findMany({
      where: {
        project: { members: { some: { userId, role: 'owner' } } },
        pausedReason: null,
      },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: count,
      select: { id: true, name: true },
    });

    if (doomed.length === 0) return [];

    await this.prisma.check.updateMany({
      where: { id: { in: doomed.map((check) => check.id) } },
      // nextDueAt is cleared with the state, so the detection loop stops
      // considering them at all rather than treating them as perpetually late.
      data: { state: 'PAUSED', pausedReason: 'quota', nextDueAt: null },
    });

    return doomed.map((check) => check.name);
  }

  /** Resumes up to `room` quota-paused checks, oldest first. */
  private async resume(userId: string, room: number): Promise<number> {
    if (room <= 0) return 0;

    const revived = await this.prisma.check.findMany({
      where: {
        project: { members: { some: { userId, role: 'owner' } } },
        pausedReason: 'quota',
      },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: room,
      select: { id: true },
    });

    if (revived.length === 0) return 0;

    // Back to NEW rather than UP: nothing is known about a job that has not
    // reported since it was switched off, and claiming it is healthy would be
    // the exact lie this product exists to prevent.
    await this.prisma.check.updateMany({
      where: { id: { in: revived.map((check) => check.id) } },
      data: { state: 'NEW', pausedReason: null },
    });

    return revived.length;
  }

  private async notify(
    email: string,
    plan: string | null,
    limit: number,
    names: string[],
  ): Promise<void> {
    const shown = names.slice(0, 20);
    const rest = names.length - shown.length;
    const list = shown.map((name) => `  - ${name}`).join('\n');

    await this.email
      .send({
        to: email,
        subject: `[SilenceWatch] ${names.length} check(s) paused — plan limit reached`,
        text: [
          `Your plan includes ${limit} checks, and your account is over that limit.`,
          '',
          'These checks have been paused and are no longer being watched:',
          list,
          rest > 0 ? `  … and ${rest} more` : '',
          '',
          'They are not deleted and their history is intact. Removing checks you no',
          'longer need, or moving to a larger plan, brings them back automatically.',
          '',
          `${this.config.baseUrl}/checks`,
        ]
          .filter((line) => line !== '')
          .join('\n'),
        html: pausedHtml(this.config.baseUrl, limit, plan, shown, rest),
      })
      .catch((error: unknown) =>
        // The pause already happened; failing to announce it must not undo it,
        // but it does deserve to be loud in the log.
        this.logger.error(`Could not tell ${email} that checks were paused: ${String(error)}`),
      );
  }
}

function pausedHtml(
  baseUrl: string,
  limit: number,
  plan: string | null,
  names: string[],
  rest: number,
): string {
  const items = names.map((name) => `<li>${escapeHtml(name)}</li>`).join('');
  return `<!doctype html>
<html lang="en"><body style="margin:0;background:#f7f8fa;padding:24px;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif">
  <div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #e4e7ec;border-radius:14px;padding:28px">
    <h1 style="margin:0 0 12px;font-size:18px;color:#101828">Some checks were paused</h1>
    <p style="margin:0 0 16px;font-size:14px;line-height:1.55;color:#475467">
      Your ${escapeHtml(plan ?? 'current')} plan includes ${limit} checks and your account is above
      that. These are no longer being watched:
    </p>
    <ul style="margin:0 0 16px;padding-left:20px;font-size:14px;line-height:1.7;color:#101828">${items}</ul>
    ${rest > 0 ? `<p style="margin:0 0 16px;font-size:13px;color:#667085">… and ${rest} more.</p>` : ''}
    <p style="margin:0 0 20px;font-size:14px;line-height:1.55;color:#475467">
      Nothing was deleted and no history was lost. Remove checks you no longer need, or move to a
      larger plan, and they come back on their own.
    </p>
    <p style="margin:0">
      <a href="${escapeHtml(baseUrl)}/checks" style="display:inline-block;padding:11px 20px;border-radius:8px;background:#8b4bf1;color:#fff;font-size:14px;font-weight:600;text-decoration:none">Review my checks</a>
    </p>
  </div>
</body></html>`;
}
