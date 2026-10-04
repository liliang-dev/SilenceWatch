import { Module } from '@nestjs/common';
import { UsersModule } from '../users/users.module';
import { LoginLockoutService } from './login-lockout.service';
import { SessionController } from './session.controller';
import { SessionService } from './session.service';
import { SessionsRepository } from './sessions.repository';
import { TokenService } from './token.service';

@Module({
  imports: [UsersModule],
  controllers: [SessionController],
  providers: [SessionsRepository, TokenService, LoginLockoutService, SessionService],
  exports: [SessionsRepository, TokenService, LoginLockoutService, SessionService],
})
export class SessionsModule {}
