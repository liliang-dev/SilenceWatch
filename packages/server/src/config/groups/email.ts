import { z } from 'zod';
import { optional } from '../env-helpers';

/** Email transport. */
export const emailShape = {
  EMAIL_PROVIDER: z.enum(['console', 'smtp', 'postmark', 'brevo']).default('console'),
  EMAIL_FROM: z.string().email().default('alerts@silencewatch.local'),
  EMAIL_FROM_NAME: z.string().min(1).max(80).default('SilenceWatch'),
  SMTP_URL: optional(z.string().min(1)),
  POSTMARK_TOKEN: optional(z.string().min(1)),
  POSTMARK_MESSAGE_STREAM: z.string().min(1).default('outbound'),
  BREVO_API_KEY: optional(z.string().min(1)),
};
