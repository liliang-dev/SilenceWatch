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
};
