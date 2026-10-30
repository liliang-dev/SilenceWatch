import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { AdminStatsDto, ChannelType, PingKind, SignupRefusalReason } from '@silencewatch/shared';
import { AdminApi } from '../../../../core/api/admin.api';
import { errorMessage } from '../../../../core/http/error-message';
import { I18n } from '../../../../core/i18n/i18n.service';
import type { MessageKey } from '../../../../core/i18n/messages';
import { IconComponent } from '../../../../shared/icon.component';
import { areaPath, barsPath, cumulative, linePath, SPARK_HEIGHT, SPARK_WIDTH } from './sparkline';

/** One line of a breakdown: a channel type, a reason. */
interface Part {
  id: string;
  label: string;
  value: number;
  /** Against the largest line of the breakdown, for its bar. */
  share: number;
}

/** One figure of the tab: its number, what it means in 30 days, its chart, and what it is made of. */
interface Figure {
  id: string;
  label: string;
  value: number;
  /** Under the number: "+4 in 30 days", "Last 30 days", "38 % of 52 accounts". */
  caption: string;
  /** Growth, shown as good news. */
  up: boolean;
  note: string;
  chart:
    | { kind: 'line'; line: string; area: string }
    | { kind: 'bars'; bars: string; tone: 'brand' | 'down' }
    | { kind: 'meter'; share: number }
    | { kind: 'none' };
  /** The lines that are not zero, largest first. */
  parts: Part[];
}

const CHANNEL_NAMES: Record<ChannelType, MessageKey> = {
  email: 'channels.typeEmail',
  webhook: 'channels.typeWebhook',
  slack: 'channels.typeSlack',
  teams: 'channels.typeTeams',
  discord: 'channels.typeDiscord',
};

const PING_NAMES: Record<PingKind, MessageKey> = {
  success: 'detail.kindSuccess',
  start: 'detail.kindStart',
  fail: 'detail.kindFail',
};

const REASON_NAMES: Record<SignupRefusalReason, MessageKey> = {
  admin_without_link: 'stats.reasonAdminWithoutLink',
  signup_closed: 'stats.reasonSignupClosed',
  email_provider: 'stats.reasonEmailProvider',
  address_quota: 'stats.reasonAddressQuota',
  network_quota: 'stats.reasonNetworkQuota',
};

const PLAN_NAMES: Record<string, MessageKey> = {
  pro: 'billing.planPro',
  business: 'billing.planBusiness',
};

/**
 * The instance's figures, for its administrator (ADMIN_EMAIL) only: the settings
 * page shows the tab to that account alone, and the server answers 404 to anyone
 * else whatever the page shows. Counts, never a name.
 */
@Component({
  selector: 'sw-statistics-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, MatButtonModule],
  templateUrl: './statistics-tab.component.html',
  styleUrls: ['../../section.scss', './statistics-tab.component.scss'],
})
export class StatisticsTabComponent {
  private readonly api = inject(AdminApi);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  protected readonly width = SPARK_WIDTH;
  protected readonly height = SPARK_HEIGHT;

  protected readonly stats = signal<AdminStatsDto | null>(null);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly figures = computed<Figure[]>(() => {
    const stats = this.stats();
    if (stats === null) return [];

    const total = (id: string, label: string, count: AdminStatsDto['accounts'], note: MessageKey): Figure => {
      const values = cumulative(count.total, count.daily);
      return {
        id,
        label,
        value: count.total,
        caption: this.t('stats.delta', { count: `+${this.number(count.last30Days)}` }),
        up: count.last30Days > 0,
        note: this.t(note),
        chart: { kind: 'line', line: linePath(values), area: areaPath(values) },
        parts: [],
      };
    };
    const daily = (
      id: string,
      label: MessageKey,
      count: { last30Days: number; daily: number[] },
      note: MessageKey,
      tone: 'brand' | 'down',
      parts: Part[] = [],
    ): Figure => ({
      id,
      label: this.t(label),
      value: count.last30Days,
      caption: this.t('stats.last30'),
      up: false,
      note: this.t(note),
      chart: { kind: 'bars', bars: barsPath(count.daily), tone },
      parts,
    });

    const { active, total: accounts } = stats.activeAccounts;
    const share = accounts === 0 ? 0 : active / accounts;

    return [
      total('accounts', this.t('stats.accounts'), stats.accounts, 'stats.accountsNote'),
      {
        id: 'active',
        label: this.t('stats.active'),
        value: active,
        caption: this.t('stats.activeShare', { share: this.percent(share), total: this.number(accounts) }),
        up: false,
        note: this.t('stats.activeNote'),
        chart: { kind: 'meter', share },
        parts: [],
      },
      {
        ...total('checks', this.t('stats.checks'), stats.checks, 'stats.checksNote'),
        // Whatever made a check by hand, the web interface or the API, against what a client library declared.
        parts: this.parts(
          { manual: stats.checks.bySource.manual + stats.checks.bySource.api, auto: stats.checks.bySource.auto },
          { manual: 'stats.checksManual', auto: 'stats.checksAuto' },
        ),
      },
      {
        id: 'pings',
        label: this.t('stats.pings'),
        value: stats.pings.last24Hours,
        caption: this.t('stats.last24'),
        up: false,
        note: this.t('stats.pingsNote'),
        chart: { kind: 'bars', bars: barsPath(stats.pings.hourly), tone: 'brand' },
        parts: this.parts(stats.pings.byKind, PING_NAMES),
      },
      ...(stats.subscriptions ?? []).map((plan) =>
        total(
          `plan-${plan.plan}`,
          this.t('stats.subscriptions', { plan: this.planName(plan.plan) }),
          { total: plan.active, last30Days: plan.last30Days, daily: plan.daily },
          'stats.subscriptionsNote',
        ),
      ),
      daily('emails', 'stats.emails', stats.alertEmails, 'stats.emailsNote', 'brand'),
      daily(
        'failed-alerts',
        'stats.failedAlerts',
        stats.failedAlerts,
        'stats.failedAlertsNote',
        'down',
        this.parts(stats.failedAlerts.byType, CHANNEL_NAMES),
      ),
      {
        id: 'channels',
        label: this.t('stats.channels'),
        value: stats.channels.total,
        caption: '',
        up: false,
        note: this.t('stats.channelsNote'),
        chart: { kind: 'none' },
        parts: this.parts(stats.channels.byType, CHANNEL_NAMES),
      },
      daily(
        'refused',
        'stats.refused',
        stats.refusedSignups,
        'stats.refusedNote',
        'down',
        this.parts(stats.refusedSignups.byReason, REASON_NAMES),
      ),
    ];
  });

  constructor() {
    this.load();
  }

  protected load(): void {
    this.loading.set(true);
    this.error.set(null);
    this.api.stats().subscribe({
      next: (stats) => {
        this.stats.set(stats);
        this.loading.set(false);
      },
      error: (failure: unknown) => {
        this.loading.set(false);
        this.error.set(errorMessage(failure, this.t('stats.failed'), this.t));
      },
    });
  }

  protected number(value: number): string {
    return new Intl.NumberFormat(this.i18n.language()).format(value);
  }

  protected updated(iso: string): string {
    return new Intl.DateTimeFormat(this.i18n.language(), { dateStyle: 'medium', timeStyle: 'short' }).format(
      new Date(iso),
    );
  }

  protected meterShare(figure: Figure): number {
    return figure.chart.kind === 'meter' ? figure.chart.share : 0;
  }

  private percent(share: number): string {
    return new Intl.NumberFormat(this.i18n.language(), { style: 'percent', maximumFractionDigits: 0 }).format(share);
  }

  /** A breakdown's non-zero lines, largest first, each with its bar against the largest. */
  private parts<K extends string>(counts: Record<K, number>, names: Record<K, MessageKey>): Part[] {
    const lines = (Object.keys(names) as K[])
      .map((id) => ({ id, label: this.t(names[id]), value: counts[id] ?? 0 }))
      .filter((line) => line.value > 0)
      .sort((left, right) => right.value - left.value);
    const largest = lines[0]?.value ?? 0;
    return lines.map((line) => ({ ...line, share: largest === 0 ? 0 : line.value / largest }));
  }

  private planName(id: string): string {
    const key = PLAN_NAMES[id];
    return key === undefined ? id.charAt(0).toUpperCase() + id.slice(1) : this.t(key);
  }
}
