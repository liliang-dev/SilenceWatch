import { Global, Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ApiKeyService } from './api-key.service';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthService } from './auth.service';
import { EmailVerificationService } from './email-verification.service';
import { ProjectAccessService } from './project-access.service';
import { SignupChallengeService } from './signup-challenge.service';
import { SignupGuardService } from './signup-guard.service';
import { TokenService } from './token.service';

/**
 * Global because authorisation is not a feature: every project-scoped module
 * needs ProjectAccessService, and the guard is registered application-wide.
 */
@Global()
@Module({
  imports: [NotificationsModule],
  controllers: [AuthController],
  providers: [
    AuthService,
    TokenService,
    ApiKeyService,
    ProjectAccessService,
    AuthGuard,
    EmailVerificationService,
    SignupChallengeService,
    SignupGuardService,
  ],
  exports: [
    AuthService,
    TokenService,
    ApiKeyService,
    ProjectAccessService,
    EmailVerificationService,
    SignupChallengeService,
    SignupGuardService,
  ],
})
export class AuthModule {}
