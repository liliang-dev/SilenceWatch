import { Module } from '@nestjs/common';
import { AccessModule } from '../access/access.module';
import { QuotasModule } from '../quotas/quotas.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChannelConfigBackfill } from './channel-config.backfill';
import { ChannelsController } from './channels.controller';
import { ChannelsRepository } from './channels.repository';
import { ChannelsService } from './channels.service';

@Module({
  imports: [AccessModule, QuotasModule, NotificationsModule],
  controllers: [ChannelsController],
  providers: [ChannelsRepository, ChannelsService, ChannelConfigBackfill],
})
export class ChannelsModule {}
