import { Injectable } from '@nestjs/common';
import { emailChannelConfigSchema, type ChannelType } from '@silencewatch/shared';
import type { Alert } from '../alert';
import { EmailService } from '../email.service';
import { renderAlert } from '../templates';
import { ChannelSender, InvalidChannelConfigError } from './channel-sender';

@Injectable()
export class EmailSender implements ChannelSender {
  readonly type: ChannelType = 'email';

  constructor(private readonly email: EmailService) {}

  async send(alert: Alert, config: unknown): Promise<void> {
    const parsed = emailChannelConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new InvalidChannelConfigError('email', parsed.error.issues[0]?.message ?? 'unknown');
    }

    const rendered = renderAlert(alert);
    await this.email.send({
      to: parsed.data.address,
      subject: rendered.subject,
      text: rendered.text,
      html: rendered.html,
    });
  }
}
