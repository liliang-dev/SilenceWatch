import { Module } from '@nestjs/common';
import { AdminModule } from '../admin/admin.module';
import { DetectionModule } from '../detection/detection.module';
import { IngestModule } from '../ingest/ingest.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { HealthController } from './health.controller';

@Module({
  imports: [DetectionModule, NotificationsModule, IngestModule, AdminModule],
  controllers: [HealthController],
})
export class HealthModule {}
