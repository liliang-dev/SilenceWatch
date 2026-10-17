import { Injectable } from '@nestjs/common';
import type { Subscription } from '@prisma/client';
import { PrismaService } from '../database/prisma.service';
import { decidePlan, LIVE_STATUSES, type StripeEvent, type SubscriptionChange } from './stripe-events';
import type { StripePlan } from '../config/config';

export type SubscriptionRecord = Subscription;

/** What applying an event did, for the caller to log and to audit. */
export type ApplyOutcome =
  | { kind: 'duplicate' }
  | { kind: 'unknown_customer' }
  | { kind: 'stale' }
  | { kind: 'other_subscription' }
  | {
      kind: 'applied';
      userId: string;
      email: string;
      from: string | null;
      to: string | null;
      status: string;
      /** The plan was left as it was because the price is not one of ours. */
      unknownPrice: boolean;
    };

/**
 * Every query on subscriptions. The rules about what an event means are in
 * `stripe-events.ts`; this is the only place that knows how it is stored.
 */
@Injectable()
export class BillingRepository {
  constructor(private readonly prisma: PrismaService) {}

  findByUser(userId: string): Promise<SubscriptionRecord | null> {
    return this.prisma.subscription.findUnique({ where: { userId } });
  }

  /**
   * Remembers which Stripe customer an account is. Two requests made at once
   * both succeed and agree: the second finds the first's row.
   */
  async rememberCustomer(userId: string, customerId: string): Promise<SubscriptionRecord> {
    await this.prisma.subscription.createMany({
      data: [{ userId, stripeCustomerId: customerId }],
      skipDuplicates: true,
    });
    return this.prisma.subscription.findUniqueOrThrow({ where: { userId } });
  }

  /**
   * Applies one subscription event, once.
   *
   * The event's id, the subscription row and the account's plan change in one
   * transaction: either the event is recorded and its effect is in, or neither is
   * and Stripe delivers it again. Recording it first is what makes a repeat
   * harmless, and doing it in the same transaction is what stops a failure from
   * leaving an event marked as handled that never was.
   */
  apply(
    event: StripeEvent,
    change: SubscriptionChange,
    plans: Readonly<Record<string, StripePlan>>,
    defaultPlan: string | null,
  ): Promise<ApplyOutcome> {
    return this.prisma.$transaction(async (tx): Promise<ApplyOutcome> => {
      const recorded = await tx.stripeEvent.createMany({
        data: [{ id: event.id, type: event.type }],
        skipDuplicates: true,
      });
      if (recorded.count === 0) return { kind: 'duplicate' };

      const row = await tx.subscription.findUnique({ where: { stripeCustomerId: change.customerId } });
      if (row === null) return { kind: 'unknown_customer' };

      const createdAt = new Date(event.created * 1000);
      if (row.lastEventAt !== null && createdAt < row.lastEventAt) return { kind: 'stale' };

      // Events about an earlier subscription arrive after a new one has begun
      // (someone cancels, then subscribes again). They must not undo it.
      if (
        row.stripeSubscriptionId !== null &&
        row.stripeSubscriptionId !== change.subscriptionId &&
        LIVE_STATUSES.has(row.status)
      ) {
        return { kind: 'other_subscription' };
      }

      const decision = decidePlan(change, plans);
      const user = await tx.user.findUniqueOrThrow({
        where: { id: row.userId },
        select: { plan: true, email: true },
      });

      let plan: string | null = row.plan;
      let userPlan: string | null = user.plan;
      if (decision.kind === 'grant') {
        plan = decision.plan;
        userPlan = decision.plan;
      } else if (decision.kind === 'end') {
        plan = null;
        userPlan = defaultPlan;
      }

      await tx.subscription.update({
        where: { userId: row.userId },
        data: {
          stripeSubscriptionId: change.subscriptionId,
          plan,
          status: change.status,
          currentPeriodEnd: change.currentPeriodEnd,
          cancelAtPeriodEnd: change.cancelAtPeriodEnd,
          lastEventAt: createdAt,
        },
      });
      if (userPlan !== user.plan) {
        await tx.user.update({ where: { id: row.userId }, data: { plan: userPlan } });
      }

      return {
        kind: 'applied',
        userId: row.userId,
        email: user.email,
        from: user.plan,
        to: userPlan,
        status: change.status,
        unknownPrice: decision.kind === 'keep' && decision.reason === 'unknown_price',
      };
    });
  }
}
