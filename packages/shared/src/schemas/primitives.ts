import { z } from 'zod';
import { isValidCronExpression, isValidTimezone } from '../cron';
import { LIMITS } from './limits';

/** @internal */
export const trimmedString = (max: number) => z.string().trim().min(1).max(max);

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3)
  .max(LIMITS.emailMax)
  .email();

/**
 * Password policy: length over composition rules (NIST SP 800-63B). Upper bound
 * caps the work an attacker can force on the Argon2 hasher.
 */
export const passwordSchema = z.string().min(LIMITS.passwordMin).max(LIMITS.passwordMax);

export const slugSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.slugMax)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, 'must be lowercase alphanumeric with single dashes');

export const uuidSchema = z.string().uuid();

export const httpUrlSchema = z
  .string()
  .trim()
  .max(LIMITS.urlMax)
  .refine((value) => {
    let url: URL;
    try {
      url = new URL(value);
    } catch {
      return false;
    }
    return (
      (url.protocol === 'https:' || url.protocol === 'http:') &&
      url.username === '' &&
      url.password === ''
    );
  }, 'must be an http(s) URL without embedded credentials');

export const cronExpressionSchema = z
  .string()
  .trim()
  .min(1)
  .max(200)
  .refine(isValidCronExpression, 'invalid cron expression');

export const timezoneSchema = z
  .string()
  .trim()
  .max(64)
  .refine(isValidTimezone, 'unknown IANA time zone');

export const environmentSchema = z
  .string()
  .trim()
  .min(1)
  .max(LIMITS.environmentMax)
  .regex(/^[A-Za-z0-9._-]+$/, 'letters, digits, dot, dash and underscore only');

export const tagsSchema = z
  .array(trimmedString(LIMITS.tagMax).regex(/^[A-Za-z0-9._:-]+$/))
  .max(LIMITS.tagsMax);
