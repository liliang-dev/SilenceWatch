import { Injectable } from '@nestjs/common';
import { webhookChannelConfigSchema, type ChannelType } from '@silencewatch/shared';
import { hmacSha256Hex } from '../../common/crypto.util';
import { Alert, describeSchedule, downtimeSeconds } from '../alert';
import { SafeHttpService } from '../safe-http.service';
import { ChannelSender, InvalidChannelConfigError } from './channel-sender';

/**
 * Generic webhook: a stable JSON envelope plus an HMAC signature so the receiver
 * can prove the payload came from this SilenceWatch instance.
 *
 * Signature scheme (identical to what most providers use, and easy to verify in
 * five lines): `sha256=HMAC_SHA256(secret, "<timestamp>.<raw body>")`. Including
 * the timestamp lets receivers reject replays.
 */
@Injectable()
export class WebhookSender implements ChannelSender {
  readonly type: ChannelType = 'webhook';

  constructor(private readonly http: SafeHttpService) {}

  async send(alert: Alert, config: unknown): Promise<void> {
    const parsed = webhookChannelConfigSchema.safeParse(config);
    if (!parsed.success) {
      throw new InvalidChannelConfigError('webhook', parsed.error.issues[0]?.message ?? 'unknown');
    }

    const body = JSON.stringify(buildPayload(alert));
    const timestamp = Math.floor(Date.now() / 1000).toString();
    const headers: Record<string, string> = {
      'x-silencewatch-event': alert.kind === 'down' ? 'check.down' : 'check.up',
      'x-silencewatch-timestamp': timestamp,
      'x-silencewatch-incident': alert.incident.id,
    };

    if (parsed.data.secret !== undefined) {
      headers['x-silencewatch-signature'] =
        `sha256=${hmacSha256Hex(parsed.data.secret, `${timestamp}.${body}`)}`;
    }

    await this.http.send({
      url: parsed.data.url,
      method: parsed.data.method,
      body,
      headers,
    });
  }
}

function buildPayload(alert: Alert): Record<string, unknown> {
  return {
    event: alert.kind === 'down' ? 'check.down' : 'check.up',
    occurredAt: new Date().toISOString(),
    url: alert.url,
    project: { id: alert.project.id, name: alert.project.name },
    check: {
      id: alert.check.id,
      name: alert.check.name,
      state: alert.check.state,
      environment: alert.check.environment,
      tags: alert.check.tags,
      schedule: describeSchedule(alert.check),
      graceSeconds: alert.check.graceSeconds,
      lastPingAt: alert.check.lastPingAt?.toISOString() ?? null,
      expectedBy: alert.check.nextDueAt?.toISOString() ?? null,
    },
    incident: {
      id: alert.incident.id,
      startedAt: alert.incident.startedAt.toISOString(),
      resolvedAt: alert.incident.resolvedAt?.toISOString() ?? null,
      cause: alert.incident.cause,
      durationSeconds: Math.round(downtimeSeconds(alert.incident)),
    },
  };
}
