import { Module } from '@nestjs/common';
import { EmailService } from './email.service';
import { NotificationQueueService } from './notification-queue.service';
import { SafeHttpService } from './safe-http.service';
import { SenderRegistry } from './sender.registry';
import { DiscordSender, SlackSender, TeamsSender } from './senders/chat.senders';
import { EmailSender } from './senders/email.sender';
import { WebhookSender } from './senders/webhook.sender';

@Module({
  providers: [
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
  exports: [NotificationQueueService, SenderRegistry, SafeHttpService],
})
export class NotificationsModule {}
