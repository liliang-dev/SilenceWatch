import { Module } from '@nestjs/common';
import { QuotasModule } from '../quotas/quotas.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';

@Module({
  imports: [QuotasModule, NotificationsModule],
  controllers: [ChannelsController],
  providers: [ChannelsService],
})
export class ChannelsModule {}
