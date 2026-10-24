import { Module } from '@nestjs/common';
import { AppConfig, CONFIG } from '../config/config';
import { ChannelConfigVault } from './channel-config.vault';
import { EmailService } from './email.service';
import { NotificationQueueService } from './notification-queue.service';
import { SafeHttpService } from './safe-http.service';
import { SenderRegistry } from './sender.registry';
import { DiscordSender, SlackSender, TeamsSender } from './senders/chat.senders';
import { EmailSender } from './senders/email.sender';
import { WebhookSender } from './senders/webhook.sender';

@Module({
  providers: [
    {
      provide: ChannelConfigVault,
      useFactory: (config: AppConfig): ChannelConfigVault => new ChannelConfigVault(config.SECRET_KEY),
      inject: [CONFIG],
    },
    SafeHttpService,
    EmailService,
    EmailSender,
    WebhookSender,
    SlackSender,
    TeamsSender,
    DiscordSender,
    SenderRegistry,
    NotificationQueueService,
  ],
  // EmailService is exported for account mail (address verification), which is
  // not an alert but goes out the same, deliberately non-self-hosted, pipe.
  exports: [NotificationQueueService, SenderRegistry, SafeHttpService, EmailService, ChannelConfigVault],
})
export class NotificationsModule {}
