import type { ChannelType } from '@silencewatch/shared';
import type { Alert } from '../alert';

/**
 * A channel knows how to turn an alert into one outbound message. It either
 * succeeds or throws — retries, backoff and give-up rules belong to the queue.
 */
export interface ChannelSender {
  readonly type: ChannelType;
  send(alert: Alert, config: unknown): Promise<void>;
}

/** Raised when a channel's stored configuration no longer matches its schema. */
export class InvalidChannelConfigError extends Error {
  constructor(type: ChannelType, reason: string) {
    super(`invalid ${type} channel configuration: ${reason}`);
  }
}
