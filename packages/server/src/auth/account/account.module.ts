import { Module } from '@nestjs/common';
import { BillingModule } from '../../billing/billing.module';
import { SessionsModule } from '../sessions/sessions.module';
import { UsersModule } from '../users/users.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [UsersModule, SessionsModule, BillingModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
