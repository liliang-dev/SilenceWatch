import { Module } from '@nestjs/common';
import { UsersModule } from '../auth/users/users.module';
import { DetectionModule } from '../detection/detection.module';
import { IngestModule } from '../ingest/ingest.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HealthController } from './health.controller';

@Module({
  imports: [DetectionModule, NotificationsModule, IngestModule, UsersModule],
  controllers: [HealthController],
})
export class HealthModule {}
