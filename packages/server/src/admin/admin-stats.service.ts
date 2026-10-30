import { Inject, Injectable } from '@nestjs/common';
import type { AdminCountDto, AdminPlanCountDto, AdminStatsDto } from '@silencewatch/shared';
import { LIVE_STATUSES } from '../billing/stripe-events';
import { AppConfig, CONFIG } from '../config/config';
import { PrismaService } from '../database/prisma.service';

const DAYS = 30;

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
    const [accounts, checks, alertEmails, subscriptions] = await Promise.all([
      this.accounts(),
      this.checks(),
      this.alertEmails(),
      this.config.BILLING_ENABLED ? this.subscriptions() : Promise.resolve(null),
    ]);
    return { generatedAt: new Date().toISOString(), accounts, checks, alertEmails, subscriptions };
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

  private async checks(): Promise<AdminCountDto> {
    const [total, recent] = await Promise.all([
      this.prisma.check.count(),
      this.prisma.$queryRaw<AgeRow[]>`
        SELECT floor(extract(epoch FROM (now() - created_at)) / 86400)::int AS age, count(*)::int AS n
          FROM "check"
         WHERE created_at > now() - make_interval(days => ${DAYS})
         GROUP BY 1`,
    ]);
    return withDaily(total, recent);
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

function withDaily(total: number, rows: AgeRow[]): AdminCountDto {
  const daily = byDay(rows);
  return { total, last30Days: sum(daily), daily };
}
