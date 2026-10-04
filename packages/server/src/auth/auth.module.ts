import { Module } from '@nestjs/common';
import { AccountModule } from './account/account.module';
import { PasswordModule } from './password/password.module';
import { RegistrationModule } from './registration/registration.module';
import { SessionsModule } from './sessions/sessions.module';

/**
 * Who a user is: registering, signing in and out, passwords, and the account
 * itself. Each part is its own module; this one only gathers them, and re-exports
 * what other parts of the application need (the retention job purges what they
 * leave behind).
 */
@Module({
  imports: [SessionsModule, RegistrationModule, PasswordModule, AccountModule],
  exports: [SessionsModule, RegistrationModule, PasswordModule],
})
export class AuthModule {}
