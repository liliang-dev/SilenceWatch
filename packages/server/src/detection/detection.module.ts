import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { DetectionService } from './detection.service';
import { OutboundHeartbeatService } from './outbound-heartbeat.service';

@Module({
  imports: [NotificationsModule],
  providers: [DetectionService, OutboundHeartbeatService],
  exports: [DetectionService],
})
export class DetectionModule {}
