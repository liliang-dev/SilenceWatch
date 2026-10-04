import { Module } from '@nestjs/common';
import { NotificationsModule } from '../../notifications/notifications.module';
import { UsersModule } from '../users/users.module';
import { PasswordResetService } from './password-reset.service';
import { PasswordResetsRepository } from './password-resets.repository';
import { PasswordController } from './password.controller';
import { PasswordService } from './password.service';

@Module({
  imports: [UsersModule, NotificationsModule],
  controllers: [PasswordController],
  providers: [PasswordResetsRepository, PasswordResetService, PasswordService],
  exports: [PasswordResetService],
})
export class PasswordModule {}
