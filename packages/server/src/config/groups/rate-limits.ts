import { positiveInt } from '../env-helpers';

/** Request limits. */
export const rateLimitsShape = {
  PING_RATE_LIMIT_PER_MINUTE: positiveInt(1, 100_000).default(120),
  PING_BODY_MAX_BYTES: positiveInt(0, 100_000).default(10_000),
  AUTH_RATE_LIMIT_PER_MINUTE: positiveInt(1, 10_000).default(10),
  API_RATE_LIMIT_PER_MINUTE: positiveInt(1, 1_000_000).default(600),
};
