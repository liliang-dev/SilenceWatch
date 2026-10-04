import type { ChannelType, NotificationChannelDto } from '@silencewatch/shared';
import type { ChannelRow } from './channels.repository';

/**
 * Channel configuration holds secrets: signing secrets, and webhook URLs whose
 * path *is* the credential (Slack, Discord, Teams). The API therefore never
 * returns `config` — only a masked hint good enough to tell two channels apart.
 */
export function toChannelDto(channel: ChannelRow): NotificationChannelDto {
  return {
    id: channel.id,
    projectId: channel.projectId,
    type: channel.type,
    name: channel.name,
    enabled: channel.enabled,
    target: maskTarget(channel.type, channel.config),
    createdAt: channel.createdAt.toISOString(),
  };
}

function maskTarget(type: ChannelType, config: unknown): string {
  const record = (config ?? {}) as Record<string, unknown>;

  if (type === 'email') {
    return typeof record.address === 'string' ? record.address : '—';
  }
  if (typeof record.url !== 'string') return '—';

  try {
    const url = new URL(record.url);
    const [, firstSegment] = url.pathname.split('/');
    const hasMore = url.pathname.replace(/^\/+/, '').includes('/');
    const shown = firstSegment === undefined || firstSegment === '' ? '' : `/${firstSegment}`;
    return `${url.host}${shown}${hasMore ? '/…' : ''}`;
  } catch {
    return '—';
  }
}
