import { Module } from '@nestjs/common';
import { ApiKeysModule } from '../api-keys/api-keys.module';
import { PasswordModule } from '../auth/password/password.module';
import { RegistrationModule } from '../auth/registration/registration.module';
import { SessionsModule } from '../auth/sessions/sessions.module';
import { QuotasModule } from '../quotas/quotas.module';
import { RetentionService } from './retention.service';

@Module({
  imports: [ApiKeysModule, QuotasModule, SessionsModule, RegistrationModule, PasswordModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
