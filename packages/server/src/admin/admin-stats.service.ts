import { Inject, Injectable } from '@nestjs/common';
import {
  CHANNEL_TYPES,
  CHECK_SOURCES,
  PING_KINDS,
  SIGNUP_REFUSAL_REASONS,
  type AdminCountDto,
  type AdminPlanCountDto,
  type AdminStatsDto,
} from '@silencewatch/shared';
import { LIVE_STATUSES } from '../billing/stripe-events';
import { AppConfig, CONFIG } from '../config/config';
import { PrismaService } from '../database/prisma.service';

const DAYS = 30;
const HOURS = 24;

/** Rows of a count by age: `age` is how many whole days ago, 0 being the past 24 hours. */
type AgeRow = { age: number; n: number };

/**
 * The instance's figures for its administrator. Counts and nothing else: no query
 * here returns a name, an address or an identifier.
 *
 * Days are 24-hour windows counted back from now, not calendar days, so the
 * figures need no time zone and the last bar is always "the past day".
 */
@Injectable()
export class AdminStatsService {
  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly prisma: PrismaService,
  ) {}

  async stats(): Promise<AdminStatsDto> {
    const [accounts, checks, pings, alertEmails, activeAccounts, failedAlerts, channels, refusedSignups, subscriptions] =
      await Promise.all([
        this.accounts(),
        this.checks(),
        this.pings(),
        this.alertEmails(),
        this.activeAccounts(),
        this.failedAlerts(),
        this.channels(),
        this.refusedSignups(),
        this.config.BILLING_ENABLED ? this.subscriptions() : Promise.resolve(null),
      ]);
    return {
      generatedAt: new Date().toISOString(),
      accounts,
      checks,
      pings,
      alertEmails,
      activeAccounts,
      failedAlerts,
      channels,
      refusedSignups,
      subscriptions,
    };
  }

  private async accounts(): Promise<AdminCountDto> {
    const [total, recent] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.$queryRaw<AgeRow[]>`
        SELECT floor(extract(epoch FROM (now() - created_at)) / 86400)::int AS age, count(*)::int AS n
          FROM "user"
         WHERE created_at > now() - make_interval(days => ${DAYS})
         GROUP BY 1`,
    ]);
    return withDaily(total, recent);
  }

  private async checks(): Promise<AdminStatsDto['checks']> {
    const [sources, recent] = await Promise.all([
      this.prisma.check.groupBy({ by: ['source'], _count: { _all: true } }),
      this.prisma.$queryRaw<AgeRow[]>`
        SELECT floor(extract(epoch FROM (now() - created_at)) / 86400)::int AS age, count(*)::int AS n
          FROM "check"
         WHERE created_at > now() - make_interval(days => ${DAYS})
         GROUP BY 1`,
    ]);
    const bySource = countBy(
      CHECK_SOURCES,
      sources.map((row) => ({ source: row.source, n: row._count._all })),
      (row) => row.source,
    );
    return { ...withDaily(sum(Object.values(bySource)), recent), bySource };
  }

  /** Every signal received in the past 24 hours, whatever its check, by hour and by kind. */
  private async pings(): Promise<AdminStatsDto['pings']> {
    const recent = await this.prisma.$queryRaw<Array<AgeRow & { kind: string }>>`
      SELECT kind::text AS kind,
             floor(extract(epoch FROM (now() - received_at)) / 3600)::int AS age,
             count(*)::int AS n
        FROM ping
       WHERE received_at > now() - make_interval(hours => ${HOURS})
       GROUP BY 1, 2`;
    const hourly = new Array<number>(HOURS).fill(0);
    for (const { age, n } of recent) {
      const index = HOURS - 1 - age;
      if (index >= 0 && index < HOURS) hourly[index] = (hourly[index] ?? 0) + n;
    }
    return { last24Hours: sum(hourly), hourly, byKind: countBy(PING_KINDS, recent, (row) => row.kind) };
  }

  /** Alert emails actually handed to the provider: test alerts and quota notices are not deliveries. */
  private async alertEmails(): Promise<AdminStatsDto['alertEmails']> {
    const recent = await this.prisma.$queryRaw<AgeRow[]>`
      SELECT floor(extract(epoch FROM (now() - d.sent_at)) / 86400)::int AS age, count(*)::int AS n
        FROM notification_delivery d
        JOIN notification_channel c ON c.id = d.channel_id
       WHERE d.status = 'sent'
         AND c.type = 'email'
         AND d.sent_at > now() - make_interval(days => ${DAYS})
       GROUP BY 1`;
    const daily = byDay(recent);
    return { last30Days: sum(daily), daily };
  }

  /**
   * Accounts someone used in the last 30 days. A sign-in alone undercounts: a
   * session lasts weeks, and its last use is when it was last refreshed.
   */
  private async activeAccounts(): Promise<AdminStatsDto['activeAccounts']> {
    const [total, [active]] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.$queryRaw<Array<{ n: number }>>`
        SELECT count(*)::int AS n
          FROM "user" u
         WHERE u.last_login_at > now() - make_interval(days => ${DAYS})
            OR EXISTS (
                 SELECT 1 FROM session s
                  WHERE s.user_id = u.id
                    AND s.updated_at > now() - make_interval(days => ${DAYS}))`,
    ]);
    return { active: active?.n ?? 0, total };
  }

  /** Alerts given up on after every retry, whatever the channel, by when they were raised. */
  private async failedAlerts(): Promise<AdminStatsDto['failedAlerts']> {
    const recent = await this.prisma.$queryRaw<Array<AgeRow & { type: string }>>`
      SELECT c.type::text AS type,
             floor(extract(epoch FROM (now() - d.created_at)) / 86400)::int AS age,
             count(*)::int AS n
        FROM notification_delivery d
        JOIN notification_channel c ON c.id = d.channel_id
       WHERE d.status = 'failed'
         AND d.created_at > now() - make_interval(days => ${DAYS})
       GROUP BY 1, 2`;
    const daily = byDay(recent);
    return { last30Days: sum(daily), daily, byType: countBy(CHANNEL_TYPES, recent, (row) => row.type) };
  }

  private async channels(): Promise<AdminStatsDto['channels']> {
    const rows = await this.prisma.notificationChannel.groupBy({ by: ['type'], _count: { _all: true } });
    const counted = rows.map((row) => ({ type: row.type, n: row._count._all }));
    const byType = countBy(CHANNEL_TYPES, counted, (row) => row.type);
    return { total: sum(Object.values(byType)), byType };
  }

  /** Recorded by SignupPolicyService, one audit entry per refusal, with its reason only. */
  private async refusedSignups(): Promise<AdminStatsDto['refusedSignups']> {
    const recent = await this.prisma.$queryRaw<Array<AgeRow & { reason: string | null }>>`
      SELECT detail->>'reason' AS reason,
             floor(extract(epoch FROM (now() - occurred_at)) / 86400)::int AS age,
             count(*)::int AS n
        FROM audit_event
       WHERE action = 'signup.refused'
         AND occurred_at > now() - make_interval(days => ${DAYS})
       GROUP BY 1, 2`;
    const daily = byDay(recent);
    return {
      last30Days: sum(daily),
      daily,
      byReason: countBy(SIGNUP_REFUSAL_REASONS, recent, (row) => row.reason),
    };
  }

  /** Every paid plan, in price order, with the subscriptions to it that are live. */
  private async subscriptions(): Promise<AdminPlanCountDto[]> {
    const live = [...LIVE_STATUSES];
    const [totals, recent] = await Promise.all([
      this.prisma.$queryRaw<Array<{ plan: string; n: number }>>`
        SELECT plan, count(*)::int AS n
          FROM subscription
         WHERE plan IS NOT NULL AND status = ANY(${live}::text[])
         GROUP BY plan`,
      this.prisma.$queryRaw<Array<AgeRow & { plan: string }>>`
        SELECT plan, floor(extract(epoch FROM (now() - created_at)) / 86400)::int AS age, count(*)::int AS n
          FROM subscription
         WHERE plan IS NOT NULL
           AND status = ANY(${live}::text[])
           AND created_at > now() - make_interval(days => ${DAYS})
         GROUP BY plan, age`,
    ]);

    return Object.entries(this.config.stripePlans)
      .sort(([, left], [, right]) => left.amount - right.amount)
      .map(([plan]) => {
        const daily = byDay(recent.filter((row) => row.plan === plan));
        return {
          plan,
          active: totals.find((row) => row.plan === plan)?.n ?? 0,
          last30Days: sum(daily),
          daily,
        };
      });
  }
}

function byDay(rows: AgeRow[]): number[] {
  const daily = new Array<number>(DAYS).fill(0);
  for (const { age, n } of rows) {
    const index = DAYS - 1 - age;
    if (index >= 0 && index < DAYS) daily[index] = (daily[index] ?? 0) + n;
  }
  return daily;
}

const sum = (values: number[]): number => values.reduce((total, value) => total + value, 0);

/**
 * Counts per key, every key present: a type nobody uses is a zero, not a gap.
 * A row whose key is not in the list (a reason a newer version records) is left out.
 */
function countBy<K extends string, R extends { n: number }>(
  keys: readonly K[],
  rows: R[],
  keyOf: (row: R) => string | null,
): Record<K, number> {
  const counts = Object.fromEntries(keys.map((key) => [key, 0])) as Record<K, number>;
  for (const row of rows) {
    const key = keyOf(row);
    if (key !== null && key in counts) counts[key as K] += row.n;
  }
  return counts;
}

function withDaily(total: number, rows: AgeRow[]): AdminCountDto {
  const daily = byDay(rows);
  return { total, last30Days: sum(daily), daily };
}
