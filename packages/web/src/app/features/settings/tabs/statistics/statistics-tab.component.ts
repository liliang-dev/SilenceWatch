import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import type { AdminStatsDto } from '@silencewatch/shared';
import { AdminApi } from '../../../../core/api/admin.api';
import { errorMessage } from '../../../../core/http/error-message';
import { I18n } from '../../../../core/i18n/i18n.service';
import type { MessageKey } from '../../../../core/i18n/messages';
import { IconComponent } from '../../../../shared/icon.component';
import { areaPath, barsPath, cumulative, linePath, SPARK_HEIGHT, SPARK_WIDTH } from './sparkline';

/** One figure of the tab: its number, what changed in 30 days, and its chart. */
interface Figure {
  id: string;
  label: string;
  value: number;
  /** "+4 in 30 days" for a total; null for a figure that is already a 30-day count. */
  delta: number | null;
  note: string;
  chart: { kind: 'line'; line: string; area: string } | { kind: 'bars'; bars: string };
}

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

    const total = (id: string, label: MessageKey, count: AdminStatsDto['accounts'], note: MessageKey): Figure => {
      const values = cumulative(count.total, count.daily);
      return {
        id,
        label: this.t(label),
        value: count.total,
        delta: count.last30Days,
        note: this.t(note),
        chart: { kind: 'line', line: linePath(values), area: areaPath(values) },
      };
    };

    const figures = [
      total('accounts', 'stats.accounts', stats.accounts, 'stats.accountsNote'),
      total('checks', 'stats.checks', stats.checks, 'stats.checksNote'),
    ];
    for (const plan of stats.subscriptions ?? []) {
      figures.push(
        total(
          `plan-${plan.plan}`,
          'stats.subscriptions',
          { total: plan.active, last30Days: plan.last30Days, daily: plan.daily },
          'stats.subscriptionsNote',
        ),
      );
      const last = figures[figures.length - 1] as Figure;
      last.label = this.t('stats.subscriptions', { plan: this.planName(plan.plan) });
    }
    figures.push({
      id: 'emails',
      label: this.t('stats.emails'),
      value: stats.alertEmails.last30Days,
      delta: null,
      note: this.t('stats.emailsNote'),
      chart: { kind: 'bars', bars: barsPath(stats.alertEmails.daily) },
    });
    return figures;
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

  private planName(id: string): string {
    const key = PLAN_NAMES[id];
    return key === undefined ? id.charAt(0).toUpperCase() + id.slice(1) : this.t(key);
  }
}
