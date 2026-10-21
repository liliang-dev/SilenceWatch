import { Module } from '@nestjs/common';
import { BillingModule } from '../billing/billing.module';
import { ProjectsModule } from '../projects/projects.module';
import { QuotasModule } from '../quotas/quotas.module';
import { AccountController } from './account/account.controller';
import { AccountService } from './account/account.service';
import { AuthConfigController } from './auth-config.controller';
import { AUTH, authProvider, SessionResolver } from './better-auth/auth.provider';
import { LoginLockoutService } from './lockout/login-lockout.service';
import { RecoveryCodesService } from './recovery/recovery-codes.service';
import { BootstrapService } from './signup/bootstrap.service';
import { SetupLinkService } from './signup/setup-link.service';
import { SignupAttemptsRepository } from './signup/signup-attempts.repository';
import { SignupGuardService } from './signup/signup-guard.service';
import { SignupPolicyService } from './signup/signup-policy.service';
import { UsersModule } from './users/users.module';

/**
 * Who a user is: signing in and out (Better Auth, mounted on Fastify in main.ts),
 * the rules for who may create an account, and the account itself. API keys are a
 * separate system (see ApiKeysModule) and share nothing with this one.
 */
@Module({
  imports: [UsersModule, ProjectsModule, QuotasModule, BillingModule],
  controllers: [AuthConfigController, AccountController],
  providers: [
    authProvider,
    SessionResolver,
    LoginLockoutService,
    RecoveryCodesService,
    SetupLinkService,
    BootstrapService,
    SignupAttemptsRepository,
    SignupGuardService,
    SignupPolicyService,
    AccountService,
  ],
  exports: [AUTH, SessionResolver, SetupLinkService, SignupGuardService, UsersModule],
})
export class AuthModule {}
