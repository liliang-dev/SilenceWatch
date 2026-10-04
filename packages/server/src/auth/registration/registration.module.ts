import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { ProjectsModule } from '../../projects/projects.module';
import { QuotasModule } from '../../quotas/quotas.module';
import { SessionsModule } from '../sessions/sessions.module';
import { UsersModule } from '../users/users.module';
import { AlreadyRegisteredNoticeService } from './email-verification/already-registered-notice.service';
import { EmailVerificationService } from './email-verification/email-verification.service';
import { EmailVerificationsRepository } from './email-verification/email-verifications.repository';
import { RegistrationController } from './registration.controller';
import { RegistrationService } from './registration.service';
import { SignupAttemptsRepository } from './signup-attempts.repository';
import { SignupChallengeService } from './signup-challenge.service';
import { SignupGuardService } from './signup-guard.service';

@Module({
  imports: [UsersModule, ProjectsModule, SessionsModule, NotificationsModule, QuotasModule],
  controllers: [RegistrationController],
  providers: [
    EmailVerificationsRepository,
    SignupAttemptsRepository,
    EmailVerificationService,
    AlreadyRegisteredNoticeService,
    SignupChallengeService,
    SignupGuardService,
    RegistrationService,
  ],
  exports: [EmailVerificationService, SignupGuardService, SignupChallengeService],
})
export class RegistrationModule {}
