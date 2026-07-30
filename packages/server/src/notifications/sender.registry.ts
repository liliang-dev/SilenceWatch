import { Injectable } from '@nestjs/common';
import type { ChannelType } from '@silencewatch/shared';
import { DiscordSender, SlackSender, TeamsSender } from './senders/chat.senders';
import type { ChannelSender } from './senders/channel-sender';
import { EmailSender } from './senders/email.sender';
import { WebhookSender } from './senders/webhook.sender';

/** Resolves a channel type to its sender. Adding a channel means adding one class. */
@Injectable()
export class SenderRegistry {
  private readonly byType: ReadonlyMap<ChannelType, ChannelSender>;

  constructor(
    email: EmailSender,
    webhook: WebhookSender,
    slack: SlackSender,
    teams: TeamsSender,
    discord: DiscordSender,
  ) {
    this.byType = new Map<ChannelType, ChannelSender>(
      [email, webhook, slack, teams, discord].map((sender) => [sender.type, sender]),
    );
  }

  get(type: ChannelType): ChannelSender {
    const sender = this.byType.get(type);
    if (sender === undefined) throw new Error(`no sender registered for channel type "${type}"`);
    return sender;
  }
}
