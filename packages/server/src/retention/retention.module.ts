import { Module } from '@nestjs/common';
import { PasswordModule } from '../auth/password/password.module';
import { RegistrationModule } from '../auth/registration/registration.module';
import { SessionsModule } from '../auth/sessions/sessions.module';
import { QuotasModule } from '../quotas/quotas.module';
import { RetentionService } from './retention.service';

@Module({
  imports: [QuotasModule, SessionsModule, RegistrationModule, PasswordModule],
  providers: [RetentionService],
  exports: [RetentionService],
})
export class RetentionModule {}
