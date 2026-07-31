import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { QuotaEnforcerService } from './quota-enforcer.service';
import { QuotaService } from './quota.service';

/**
 * Plan limits. Global-ish by necessity — checks, projects and channels all
 * consult it — but the enforcement loop only starts when quotas are on, so a
 * self-hosted instance runs none of it.
 */
@Module({
  imports: [NotificationsModule],
  providers: [QuotaService, QuotaEnforcerService],
  exports: [QuotaService, QuotaEnforcerService],
})
export class QuotasModule {}
