import { z } from 'zod';
import { optional, positiveInt } from '../env-helpers';

/** The server's own outbound heartbeat. */
export const heartbeatShape = {
  /**
   * SilenceWatch cannot watch itself: point this at a third-party dead man's
   * switch that the detection loop pings after every successful tick.
   */
  OUTBOUND_HEARTBEAT_URL: optional(z.string().url()),
  OUTBOUND_HEARTBEAT_INTERVAL_MS: positiveInt(10_000, 3_600_000).default(60_000),
};
