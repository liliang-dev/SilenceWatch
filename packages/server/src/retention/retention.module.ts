import { Module } from '@nestjs/common';
import { QuotasModule } from '../quotas/quotas.module';
import { RetentionService } from './retention.service';

@Module({
  imports: [QuotasModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
