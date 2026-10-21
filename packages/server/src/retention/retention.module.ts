import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { AuthModule } from '../auth/auth.module';
import { QuotasModule } from '../quotas/quotas.module';
import { RetentionService } from './retention.service';

@Module({
  imports: [ApiKeysModule, QuotasModule, AuthModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
