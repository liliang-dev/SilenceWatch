import { Module } from '@nestjs/common';
import { NotificationsModule } from '../notifications/notifications.module';
import { ChannelsController } from './channels.controller';
import { ChannelsService } from './channels.service';

@Module({
  imports: [NotificationsModule],
  controllers: [ChannelsController],
  providers: [ChannelsService],
})
export class ChannelsModule {}
