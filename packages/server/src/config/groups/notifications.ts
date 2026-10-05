import { booleanish, positiveInt } from '../env-helpers';

/** Alert delivery. */
export const notificationsShape = {
  NOTIFICATION_INTERVAL_MS: positiveInt(500, 600_000).default(3_000),
  NOTIFICATION_BATCH_SIZE: positiveInt(1, 1_000).default(50),
  NOTIFICATION_MAX_ATTEMPTS: positiveInt(1, 20).default(6),
  NOTIFICATION_TIMEOUT_MS: positiveInt(500, 60_000).default(10_000),
  /**
   * Allow alerts to reach private/loopback addresses. Off by default (SSRF
   * protection); self-hosters targeting an internal Mattermost turn it on.
   */
  ALLOW_PRIVATE_NOTIFICATION_TARGETS: booleanish.prefault('false'),
  /**
   * Alerts one channel may deliver in an hour. A check that keeps going up and
   * down, or a channel pointed at somebody else's mailbox, would otherwise send
   * as many messages as the checks care to produce; past this the alerts are not
   * sent and are marked as refused. 0 disables it, which is what a self-hosted
   * instance wants.
   */
  ALERT_MAX_PER_CHANNEL_PER_HOUR: positiveInt(0, 100_000).default(0),
};
