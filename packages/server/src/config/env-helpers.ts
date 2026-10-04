import { z } from 'zod';

export const booleanish = z
  .enum(['true', 'false', '1', '0', 'yes', 'no'])
  .transform((value) => value === 'true' || value === '1' || value === 'yes');

export const port = z.coerce.number().int().min(1).max(65_535);
export const positiveInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);

export const csv = z
  .string()
  .transform((value) =>
    value
      .split(',')
      .map((entry) => entry.trim())
      .filter((entry) => entry.length > 0),
  );

/**
 * Optional, and empty means absent.
 *
 * `.optional()` alone distinguishes unset from empty, but nothing that starts
 * this server does. Compose and Swarm both turn `KEY: ${KEY:-}` into `KEY=""`,
 * and a shell exporting a `.env` does the same for a variable listed with no
 * value — so a setting left blank on purpose arrived as a present, invalid one
 * and stopped the process. `SMTP_URL=` in an .env file means "I am not using
 * SMTP", not "SMTP is the empty string".
 */
export const optional = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess((value) => (value === '' ? undefined : value), schema.optional());
