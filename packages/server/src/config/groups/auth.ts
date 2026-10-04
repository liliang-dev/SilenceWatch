import { z } from 'zod';
import { booleanish, positiveInt } from '../env-helpers';

/** Secrets, token lifetimes and who may sign up. */
export const authShape = {
  /**
   * Root secret. All other keys are derived from it with HKDF, so rotating it
   * invalidates sessions and signed payloads at once.
   */
  SECRET_KEY: z.string().min(32, 'SECRET_KEY must be at least 32 characters'),
  ACCESS_TOKEN_TTL_SECONDS: positiveInt(60, 86_400).default(900),
  REFRESH_TOKEN_TTL_DAYS: positiveInt(1, 365).default(30),
  /** When false only the very first account can be created (bootstrap). */
  SIGNUP_ENABLED: booleanish.prefault('true'),
};
