import { booleanish, positiveInt } from '../env-helpers';

/** The detection loop. */
export const detectionShape = {
  DETECTION_INTERVAL_MS: positiveInt(1_000, 600_000).default(10_000),
  DETECTION_BATCH_SIZE: positiveInt(1, 10_000).default(200),
  DETECTION_ENABLED: booleanish.prefault('true'),
};
