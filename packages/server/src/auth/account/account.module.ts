import { Module } from '@nestjs/common';
import { SessionsModule } from '../sessions/sessions.module';
import { UsersModule } from '../users/users.module';
import { AccountController } from './account.controller';
import { AccountService } from './account.service';

@Module({
  imports: [UsersModule, SessionsModule],
  controllers: [AccountController],
  providers: [AccountService],
})
export class AccountModule {}
