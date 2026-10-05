import { ChangeDetectionStrategy, Component, DestroyRef, computed, inject, signal } from '@angular/core';
import { takeUntilDestroyed } from '@angular/core/rxjs-interop';
import { ActivatedRoute } from '@angular/router';
import { MatButtonModule } from '@angular/material/button';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { BillingPlanDto, BillingStateDto } from '@silencewatch/shared';
import { catchError, from, interval, of, switchMap, takeWhile } from 'rxjs';
import { BillingApi } from '../../../../core/api/billing.api';
import { BillingStore } from '../../../../core/billing.store';
import { errorMessage } from '../../../../core/http/error-message';
import { I18n } from '../../../../core/i18n/i18n.service';
import type { MessageKey } from '../../../../core/i18n/messages';
import { REDIRECT } from '../../../../core/redirect';
import { SettingsFeedback } from '../../settings-feedback';

/** Stripe's own words for a subscription that is paid, or is still being asked to be. */
const LIVE = new Set(['active', 'trialing', 'past_due']);

const PLAN_NAMES: Record<string, MessageKey> = {
  free: 'billing.planFree',
  pro: 'billing.planPro',
  business: 'billing.planBusiness',
};

/** How long to wait for Stripe's word after a payment, and how often to ask. */
const CONFIRM_EVERY_MS = 2_000;
const CONFIRM_ATTEMPTS = 15;

/**
 * The account's plan and subscription: what it uses, what each plan offers, and
 * the two ways out to Stripe — its payment page to subscribe, and its customer
 * portal to change a plan, update a card, read invoices or cancel.
 *
 * Nothing is charged or changed here. A plan changes when Stripe tells the server
 * a payment happened, which is a moment after the browser comes back, so on the
 * way back this page asks until the plan has changed rather than showing the old
 * one and leaving the person to wonder.
 */
@Component({
  selector: 'sw-subscription-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatButtonModule],
  templateUrl: './subscription-tab.component.html',
  styleUrls: ['../../section.scss', './subscription-tab.component.scss'],
})
export class SubscriptionTabComponent {
  private readonly api = inject(BillingApi);
  private readonly store = inject(BillingStore);
  private readonly redirect = inject(REDIRECT);
  private readonly feedback = inject(SettingsFeedback);
  private readonly snackBar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  protected readonly state = this.store.state;
  /** Which button was pressed, so only that one waits. */
  protected readonly busy = signal<string | null>(null);
  /** After a payment: waiting for Stripe's word, got it, or it is taking long. */
  protected readonly confirmation = signal<'waiting' | 'done' | 'slow' | null>(null);

  protected readonly subscription = computed(() => this.state()?.subscription ?? null);
  protected readonly live = computed(() => {
    const subscription = this.subscription();
    return subscription !== null && LIVE.has(subscription.status);
  });
  protected readonly current = computed(
    () => this.state()?.plans.find((plan) => plan.id === this.state()?.plan) ?? null,
  );
  /** What the account uses, against what its plan allows: no bar where nothing is limited. */
  protected readonly meters = computed(() => {
    const usage = this.state()?.usage;
    const limits = this.current()?.limits;
    if (usage === null || usage === undefined) return [];
    return [
      { label: 'billing.limitChecks' as MessageKey, used: usage.checks, limit: limits?.checks ?? null },
      { label: 'billing.limitProjects' as MessageKey, used: usage.projects, limit: limits?.projects ?? null },
    ].map((meter) => ({ ...meter, percent: this.share(meter.used, meter.limit) }));
  });
  /** The plan an account falls back to: the first, and the only one not for sale. */
  protected readonly base = computed(() => this.state()?.plans.find((plan) => !plan.purchasable) ?? null);

  constructor() {
    const outcome = inject(ActivatedRoute).snapshot.queryParamMap.get('checkout');
    if (outcome === 'cancelled') {
      this.snackBar.open(this.t('billing.cancelledCheckout'), this.t('common.ok'), { duration: 5000 });
    } else if (outcome === 'success') {
      this.waitForPlan();
    }
  }

  /** An account with no plan is the unlimited one: it predates the plans, or is self-hosted. */
  protected planName(id: string | null): string {
    if (id === null || id === '') return this.t('billing.unlimited');
    const key = PLAN_NAMES[id];
    return key === undefined ? id.charAt(0).toUpperCase() + id.slice(1) : this.t(key);
  }

  protected price(plan: BillingPlanDto): string {
    return new Intl.NumberFormat(this.i18n.language(), {
      style: 'currency',
      currency: plan.currency.toUpperCase(),
      minimumFractionDigits: 0,
      maximumFractionDigits: 2,
    }).format(plan.amount / 100);
  }

  protected date(iso: string): string {
    return new Intl.DateTimeFormat(this.i18n.language(), { dateStyle: 'long' }).format(new Date(iso));
  }

  protected limit(value: number | null): string {
    return value === null ? this.t('billing.unlimited') : String(value);
  }

  protected days(value: number | null): string {
    return value === null ? this.t('billing.unlimited') : this.i18n.plural('billing.days', value);
  }

  protected usedOf(used: number, limit: number | null): string {
    return limit === null
      ? this.t('billing.usedUnlimited', { used })
      : this.t('billing.usedOf', { used, limit });
  }

  /** Share of a limit in use, for the bar: nothing to draw when there is no limit. */
  private share(used: number, limit: number | null): number | null {
    if (limit === null) return null;
    return limit === 0 ? 100 : Math.min(100, Math.round((used / limit) * 100));
  }

  protected isCurrent(plan: BillingPlanDto): boolean {
    return plan.id === this.state()?.plan;
  }

  /** To Stripe's payment page, or to its portal when a subscription is already running. */
  protected choose(plan: BillingPlanDto): void {
    if (this.busy() !== null) return;
    this.busy.set(plan.id);
    this.feedback.clear();

    const request = this.live() ? this.api.portal() : this.api.checkout(plan.id);
    request.subscribe({
      next: ({ url }) => this.redirect(url),
      error: (failure: unknown) => {
        this.busy.set(null);
        this.feedback.show(errorMessage(failure, this.t('billing.checkoutFailed'), this.t));
      },
    });
  }

  protected manage(): void {
    if (this.busy() !== null) return;
    this.busy.set('portal');
    this.feedback.clear();

    this.api.portal().subscribe({
      next: ({ url }) => this.redirect(url),
      error: (failure: unknown) => {
        this.busy.set(null);
        this.feedback.show(errorMessage(failure, this.t('billing.portalFailed'), this.t));
      },
    });
  }

  /**
   * Asks for the state until the plan is not the one the page came back with —
   * or until it has asked long enough, and says so.
   */
  private waitForPlan(): void {
    const before = this.state()?.plan ?? null;
    this.confirmation.set('waiting');

    let attempts = 0;
    interval(CONFIRM_EVERY_MS)
      .pipe(
        switchMap(() => from(this.store.refresh()).pipe(catchError(() => of<BillingStateDto | null>(null)))),
        takeWhile((state) => {
          attempts += 1;
          const changed = state !== null && state.plan !== before;
          if (changed) this.confirmation.set('done');
          else if (attempts >= CONFIRM_ATTEMPTS) this.confirmation.set('slow');
          return !changed && attempts < CONFIRM_ATTEMPTS;
        }),
        takeUntilDestroyed(this.destroyRef),
      )
      .subscribe();
  }
}
