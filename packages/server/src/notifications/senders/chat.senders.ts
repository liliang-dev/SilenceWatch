import { Injectable } from '@nestjs/common';
import { chatChannelConfigSchema, type ChannelType } from '@silencewatch/shared';
import type { Alert } from '../alert';
import { SafeHttpService } from '../safe-http.service';
import { renderAlert, type RenderedAlert } from '../templates';
import { ChannelSender, InvalidChannelConfigError } from './channel-sender';

/**
 * Slack, Teams and Discord all boil down to "POST JSON to an incoming webhook
 * URL"; only the payload shape differs. The URL host is not restricted, so
 * Slack-compatible endpoints (Mattermost, Rocket.Chat) work too — the SSRF
 * guard in SafeHttpService is what keeps this from becoming a proxy into the
 * host network.
 */
abstract class ChatWebhookSender implements ChannelSender {
  abstract readonly type: ChannelType;

  constructor(protected readonly http: SafeHttpService) {}

  protected abstract buildPayload(alert: Alert, rendered: RenderedAlert): unknown;

  async send(alert: Alert, config: unknown): Promise<void> {
    const parsed = chatChannelConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new InvalidChannelConfigError(this.type, parsed.error.issues[0]?.message ?? 'unknown');
    }

    await this.http.send({
      url: parsed.data.url,
      body: JSON.stringify(this.buildPayload(alert, renderAlert(alert))),
    });
  }

  protected accentHex(alert: Alert): string {
    return alert.kind === 'down' ? 'B3261E' : '146C2E';
  }
}

@Injectable()
export class SlackSender extends ChatWebhookSender {
  readonly type: ChannelType = 'slack';

  protected buildPayload(alert: Alert, rendered: RenderedAlert): unknown {
    return {
      text: `${alert.kind === 'down' ? ':red_circle:' : ':large_green_circle:'} ${rendered.headline}`,
      attachments: [
        {
          color: `#${this.accentHex(alert)}`,
          fallback: rendered.headline,
          title: alert.check.name,
          title_link: alert.url,
          fields: rendered.fields.map((field) => ({
            title: field.label,
            value: field.value,
            short: field.value.length <= 30,
          })),
          footer: 'SilenceWatch',
          ts: Math.floor(Date.now() / 1000),
        },
      ],
    };
  }
}

@Injectable()
export class TeamsSender extends ChatWebhookSender {
  readonly type: ChannelType = 'teams';

  protected buildPayload(alert: Alert, rendered: RenderedAlert): unknown {
    // MessageCard rather than an Adaptive Card: it is what plain "Incoming
    // Webhook" connectors accept, which is what people actually have.
    return {
      '@type': 'MessageCard',
      '@context': 'https://schema.org/extensions',
      summary: rendered.subject,
      themeColor: this.accentHex(alert),
      title: rendered.headline,
      sections: [
        {
          facts: rendered.fields.map((field) => ({ name: field.label, value: field.value })),
          markdown: false,
        },
      ],
      potentialAction: [
        {
          '@type': 'OpenUri',
          name: 'Open check',
          targets: [{ os: 'default', uri: alert.url }],
        },
      ],
    };
  }
}

@Injectable()
export class DiscordSender extends ChatWebhookSender {
  readonly type: ChannelType = 'discord';

  protected buildPayload(alert: Alert, rendered: RenderedAlert): unknown {
    return {
      username: 'SilenceWatch',
      embeds: [
        {
          title: rendered.headline.slice(0, 256),
          url: alert.url,
          color: Number.parseInt(this.accentHex(alert), 16),
          timestamp: new Date().toISOString(),
          fields: rendered.fields.slice(0, 25).map((field) => ({
            name: field.label,
            value: field.value.slice(0, 1024),
            inline: field.value.length <= 30,
          })),
          footer: { text: 'SilenceWatch' },
        },
      ],
    };
  }
}
