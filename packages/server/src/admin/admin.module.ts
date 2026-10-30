import { Module } from '@nestjs/common';
import { UsersModule } from '../auth/users/users.module';
import { AdminController } from './admin.controller';
import { AdminStatsService } from './admin-stats.service';
import { AdministratorService } from './administrator.service';

/** What only the administrator (ADMIN_EMAIL) sees: the instance's figures. */
@Module({
  imports: [UsersModule],
  controllers: [AdminController],
  providers: [AdministratorService, AdminStatsService],
  exports: [AdministratorService],
})
export class AdminModule {}
