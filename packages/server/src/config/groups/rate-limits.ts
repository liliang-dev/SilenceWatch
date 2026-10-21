import { positiveInt } from '../env-helpers';

/** Request limits. */
export const rateLimitsShape = {
  PING_RATE_LIMIT_PER_MINUTE: positiveInt(1, 100_000).default(120),
  PING_BODY_MAX_BYTES: positiveInt(0, 100_000).default(10_000),
  AUTH_RATE_LIMIT_PER_MINUTE: positiveInt(1, 10_000).default(10),
  API_RATE_LIMIT_PER_MINUTE: positiveInt(1, 1_000_000).default(600),
  /**
   * Gap between two test alerts from one channel. A test sends a real email or
   * request, so a channel pointed at somebody else's address is a way to spend
   * the sender's money and reputation. 0 disables it.
   */
  TEST_ALERT_COOLDOWN_SECONDS: positiveInt(0, 3_600).default(60),
  /** Test alerts one account may send in an hour, across its channels. 0 disables it. */
  TEST_ALERT_MAX_PER_HOUR: positiveInt(0, 10_000).default(20),
};
