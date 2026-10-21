import { Module } from '@nestjs/common';
import { UsersModule } from '../auth/users/users.module';
import { QuotasModule } from '../quotas/quotas.module';
import { BillingController } from './billing.controller';
import { BillingRepository } from './billing.repository';
import { BillingService } from './billing.service';
import { HttpStripeApi, StripeApi } from './stripe.api';

/**
 * Subscriptions through Stripe. Always loaded, and inert unless BILLING_ENABLED
 * is on: the service says so, and the webhook is only registered then.
 */
@Module({
  imports: [UsersModule, QuotasModule],
  controllers: [BillingController],
  providers: [BillingService, BillingRepository, { provide: StripeApi, useClass: HttpStripeApi }],
  exports: [BillingService],
})
export class BillingModule {}
