import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type {
  BillingPlanDto,
  BillingRedirectDto,
  BillingStateDto,
  PlanLimitsDto,
  SubscriptionDto,
} from '@silencewatch/shared';
import { AuditService } from '../audit/audit.service';
import { maskEmail } from '../auth/masking';
import { UsersRepository } from '../auth/users/users.repository';
import { AppConfig, CONFIG, type PlanLimits } from '../config/config';
import { QuotaService } from '../quotas/quota.service';
import { BillingRepository, type ApplyOutcome, type SubscriptionRecord } from './billing.repository';
import { LIVE_STATUSES, readSubscriptionEvent, type StripeEvent } from './stripe-events';
import { StripeApi, StripeError } from './stripe.api';

const DISABLED: BillingStateDto = {
  enabled: false,
  plan: null,
  plans: [],
  usage: null,
  subscription: null,
};

/**
 * Subscriptions: who is paying for what, and what that makes of their plan.
 *
 * The rule this keeps is the one the quotas keep: nothing here exists unless
 * `BILLING_ENABLED` is on. Off, every route but the state answers 404, the state
 * says `enabled: false`, and Stripe is never contacted.
 *
 * A subscription only ever chooses a plan, and it does so by writing
 * `user.plan`: what the plan allows is the quotas' business, and the reconciler
 * that pauses or resumes checks on a change is the same one that serves a plan
 * changed by hand.
 */
@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(CONFIG) private readonly config: AppConfig,
    private readonly repository: BillingRepository,
    private readonly stripe: StripeApi,
    private readonly users: UsersRepository,
    private readonly quotas: QuotaService,
    private readonly audit: AuditService,
  ) {}

  get enabled(): boolean {
    return this.config.BILLING_ENABLED;
  }

  async state(userId: string): Promise<BillingStateDto> {
    if (!this.enabled) return DISABLED;

    const [user, usage, subscription] = await Promise.all([
      this.users.findByIdOrThrow(userId),
      this.quotas.usageOf(userId),
      this.repository.findByUser(userId),
    ]);

    return {
      enabled: true,
      plan: user.plan,
      plans: this.catalogue(),
      usage,
      subscription: subscription === null ? null : toSubscriptionDto(subscription),
    };
  }

  /** The page to pay on, for a plan. */
  async startCheckout(userId: string, planName: string): Promise<BillingRedirectDto> {
    this.assertEnabled();

    const plan = this.config.stripePlans[planName];
    if (plan === undefined) throw new BadRequestException('Unknown plan');

    const existing = await this.repository.findByUser(userId);
    if (existing?.stripeSubscriptionId && LIVE_STATUSES.has(existing.status)) {
      // A second subscription would be charged next to the first. Changing plan
      // is the portal's job.
      throw new ConflictException(
        'You already have a subscription. Change or cancel it from "Manage subscription".',
      );
    }

    try {
      const customerId = existing?.stripeCustomerId ?? (await this.createCustomer(userId));
      const session = await this.stripe.createCheckoutSession({
        customerId,
        priceId: plan.price,
        userId,
        successUrl: this.returnUrl('checkout=success'),
        cancelUrl: this.returnUrl('checkout=cancelled'),
        automaticTax: this.config.BILLING_AUTOMATIC_TAX,
      });
      return { url: session.url };
    } catch (error) {
      throw this.unavailable('open the payment page', error);
    }
  }

  /** Stripe's customer portal: payment method, invoices, plan change, cancellation. */
  async openPortal(userId: string): Promise<BillingRedirectDto> {
    this.assertEnabled();

    const subscription = await this.repository.findByUser(userId);
    if (subscription === null) throw new NotFoundException('There is no subscription to manage');

    try {
      const session = await this.stripe.createPortalSession({
        customerId: subscription.stripeCustomerId,
        returnUrl: this.returnUrl(),
      });
      return { url: session.url };
    } catch (error) {
      throw this.unavailable('open the customer portal', error);
    }
  }

  /**
   * Ends the account's subscription before the account is deleted: deleting the
   * account must not leave a card being charged for it.
   *
   * Refuses (and so stops the deletion) if Stripe cannot be reached, because the
   * alternative is an account that is gone and a subscription that is not.
   */
  async cancelForAccount(userId: string): Promise<void> {
    if (!this.enabled) return;

    const subscription = await this.repository.findByUser(userId);
    if (subscription?.stripeSubscriptionId == null || subscription.status === 'canceled') return;

    try {
      await this.stripe.cancelSubscription(subscription.stripeSubscriptionId);
    } catch (error) {
      throw this.unavailable('cancel your subscription', error);
    }
  }

  /**
   * Handles an event whose signature has been checked. Returns what happened,
   * for the log; any exception is a failure Stripe should be told about, so that
   * it delivers the event again.
   */
  async handleEvent(event: StripeEvent): Promise<ApplyOutcome | { kind: 'ignored' }> {
    const change = readSubscriptionEvent(event);
    if (change === null) return { kind: 'ignored' };

    const outcome = await this.repository.apply(
      event,
      change,
      this.config.stripePlans,
      this.quotas.defaultPlan,
    );

    if (outcome.kind === 'applied') {
      if (outcome.unknownPrice) {
        this.logger.warn(
          `Subscription ${change.subscriptionId} uses the price ${change.priceId ?? '(none)'}, ` +
            'which is not in STRIPE_PLANS: the plan was left as it was',
        );
      }
      if (outcome.from !== outcome.to) {
        this.logger.log(
          `Plan of ${maskEmail(outcome.email)}: ${outcome.from ?? 'none'} → ${outcome.to ?? 'none'} (${outcome.status})`,
        );
        this.audit.record({
          action: 'billing.plan_changed',
          actor: { userId: outcome.userId, email: outcome.email },
          targetType: 'user',
          targetId: outcome.userId,
          detail: { from: outcome.from, to: outcome.to, status: outcome.status },
        });
      }
    }
    return outcome;
  }

  /** The plans on offer: the one everyone starts on, then the paid ones by price. */
  private catalogue(): BillingPlanDto[] {
    const currency = this.config.BILLING_CURRENCY;
    const defaultPlan = this.config.DEFAULT_PLAN;
    const plans: BillingPlanDto[] = [];

    if (this.config.planLimits[defaultPlan] !== undefined) {
      plans.push({
        id: defaultPlan,
        amount: 0,
        currency,
        limits: limitsDto(this.config.planLimits[defaultPlan]),
        purchasable: false,
      });
    }
    const paid = Object.entries(this.config.stripePlans)
      .sort(([, left], [, right]) => left.amount - right.amount)
      .map(([id, plan]) => ({
        id,
        amount: plan.amount,
        currency,
        limits: limitsDto(this.config.planLimits[id]),
        purchasable: true,
      }));
    return [...plans, ...paid];
  }

  private async createCustomer(userId: string): Promise<string> {
    const user = await this.users.findByIdOrThrow(userId);
    const customer = await this.stripe.createCustomer({ email: user.email, userId });
    return (await this.repository.rememberCustomer(userId, customer.id)).stripeCustomerId;
  }

  private returnUrl(query?: string): string {
    return `${this.config.baseUrl}/settings?tab=subscription${query === undefined ? '' : `&${query}`}`;
  }

  private assertEnabled(): void {
    // 404, not 403: on an instance without billing this is simply not a route.
    if (!this.enabled) throw new NotFoundException();
  }

  /** What the person is told, and what the log keeps: Stripe's words stay in the log. */
  private unavailable(action: string, error: unknown): BadGatewayException {
    this.logger.error(
      `Could not ${action}: ${error instanceof StripeError ? `${error.message} (${error.status ?? 'no answer'})` : String(error)}`,
    );
    return new BadGatewayException(
      'The payment service is not answering right now: try again in a moment.',
    );
  }
}

function limitsDto(limits: PlanLimits | undefined): PlanLimitsDto {
  return {
    checks: limits?.checks ?? null,
    projects: limits?.projects ?? null,
    channelsPerProject: limits?.channelsPerProject ?? null,
    retentionDays: limits?.retentionDays ?? null,
  };
}

function toSubscriptionDto(subscription: SubscriptionRecord): SubscriptionDto {
  return {
    status: subscription.status,
    plan: subscription.plan,
    currentPeriodEnd: subscription.currentPeriodEnd?.toISOString() ?? null,
    cancelAtPeriodEnd: subscription.cancelAtPeriodEnd,
  };
}
