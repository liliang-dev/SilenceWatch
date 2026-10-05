import { z } from 'zod';
import { runtimeShape } from './groups/runtime';
import { httpShape } from './groups/http';
import { databaseShape } from './groups/database';
import { authShape } from './groups/auth';
import { signupShape } from './groups/signup';
import { billingShape } from './groups/billing';
import { quotasShape } from './groups/quotas';
import { rateLimitsShape } from './groups/rate-limits';
import { detectionShape } from './groups/detection';
import { notificationsShape } from './groups/notifications';
import { emailShape } from './groups/email';
import { retentionShape } from './groups/retention';
import { heartbeatShape } from './groups/heartbeat';
import { validateEnv } from './validation';

/** Every environment variable, grouped by concern in `groups/`. */
const shape = {
  ...runtimeShape,
  ...httpShape,
  ...databaseShape,
  ...authShape,
  ...signupShape,
  ...quotasShape,
  ...billingShape,
  ...rateLimitsShape,
  ...detectionShape,
  ...notificationsShape,
  ...emailShape,
  ...retentionShape,
  ...heartbeatShape,
};

export type Env = z.infer<z.ZodObject<typeof shape>>;

export const envSchema = z.object(shape).superRefine(validateEnv);
