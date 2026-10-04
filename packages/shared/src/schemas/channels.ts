import { z } from 'zod';
import { CHANNEL_TYPES } from '../enums';
import { LIMITS } from './limits';
import { emailSchema, httpUrlSchema, trimmedString } from './primitives';

export const emailChannelConfigSchema = z.object({ address: emailSchema });
export const webhookChannelConfigSchema = z.object({
  url: httpUrlSchema,
  /** Optional HMAC-SHA256 signing secret; write-only, never returned by the API. */
  secret: z.string().min(16).max(200).optional(),
  method: z.enum(['POST', 'PUT']).default('POST'),
});
export const chatChannelConfigSchema = z.object({ url: httpUrlSchema });

export const createChannelRequestSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('email'),
    name: trimmedString(LIMITS.nameMax),
    config: emailChannelConfigSchema,
  }),
  z.object({
    type: z.literal('webhook'),
    name: trimmedString(LIMITS.nameMax),
    config: webhookChannelConfigSchema,
  }),
  z.object({
    type: z.literal('slack'),
    name: trimmedString(LIMITS.nameMax),
    config: chatChannelConfigSchema,
  }),
  z.object({
    type: z.literal('teams'),
    name: trimmedString(LIMITS.nameMax),
    config: chatChannelConfigSchema,
  }),
  z.object({
    type: z.literal('discord'),
    name: trimmedString(LIMITS.nameMax),
    config: chatChannelConfigSchema,
  }),
]);
export type CreateChannelRequest = z.infer<typeof createChannelRequestSchema>;

export const updateChannelRequestSchema = z.object({
  name: trimmedString(LIMITS.nameMax).optional(),
  enabled: z.boolean().optional(),
});
export type UpdateChannelRequest = z.infer<typeof updateChannelRequestSchema>;

export interface NotificationChannelDto {
  id: string;
  projectId: string;
  type: (typeof CHANNEL_TYPES)[number];
  name: string;
  enabled: boolean;
  /** Secrets are redacted server-side; only non-sensitive hints are exposed. */
  target: string;
  createdAt: string;
}
