import { HttpErrorResponse } from '@angular/common/http';
import type { ApiErrorBody } from '@silencewatch/shared';
import type { Translate } from '../i18n/i18n.service';
import { translateServerMessage } from '../i18n/server-messages';

/**
 * Turns a failed request into something worth showing a person.
 *
 * The server sends a stable error envelope, including field-level details for
 * validation failures — those are the useful part, so they are surfaced rather
 * than replaced by a generic "something went wrong".
 *
 * The sentences written here are translated. The ones the server sends are
 * translated when `server-messages.ts` recognises them — a wrong password, an
 * expired link — and otherwise shown as sent: validation details carry field
 * names and limits that make them useful, and the server speaks one language.
 */
export function errorMessage(error: unknown, fallback: string, t: Translate): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;

  if (error.status === 0) return t('error.offline');

  const body = error.error as Partial<ApiErrorBody> | string | null;
  if (typeof body === 'string' && body.trim() !== '') return translateServerMessage(body, t);

  if (error.status === 429 && body !== null && typeof body === 'object') {
    const message = rateMessage(body.details, t);
    if (message !== null) return message;
  }

  if (error.status === 402 && body !== null && typeof body === 'object') {
    const message = quotaMessage(body.details, t);
    if (message !== null) return message;
  }

  if (body !== null && typeof body === 'object') {
    const details = body.details;
    if (Array.isArray(details) && details.length > 0) {
      const issues = details
        .filter(
          (issue): issue is { path: string; message: string } =>
            typeof issue === 'object' && issue !== null && 'message' in issue,
        )
        .map((issue) => (issue.path === '' ? issue.message : `${issue.path}: ${issue.message}`));
      if (issues.length > 0) return issues.join(', ');
    }
    if (typeof body.message === 'string' && body.message.trim() !== '') {
      return translateServerMessage(body.message, t);
    }
  }

  if (error.status === 429) return t('error.tooManyAttempts');
  // The page's own timeout, or a proxy giving up on the application: either way
  // the answer is "slow", which is a different thing to tell someone than "down".
  if (error.status === 504) return t('error.slow');
  if (error.status >= 500) return t('error.server');
  return fallback;
}

/**
 * Whether a refused sign-in was refused for a reason the user can fix from the
 * page they are on — an unconfirmed address, which needs a link, not a
 * different password.
 *
 * Read from a flag the server sets rather than matched against the message, so
 * rewording the message cannot silently remove the button.
 */
export function isVerificationPending(error: unknown): boolean {
  if (!(error instanceof HttpErrorResponse)) return false;
  const details = (error.error as Partial<ApiErrorBody> | null)?.details;
  return (
    details !== null &&
    typeof details === 'object' &&
    (details as { emailVerificationPending?: unknown }).emailVerificationPending === true
  );
}

const QUOTA_MESSAGES = {
  checks: 'error.quota.checks',
  projects: 'error.quota.projects',
  channels: 'error.quota.channels',
} as const;

/**
 * A plan limit, in the page's language. The server says which limit and the
 * numbers (it answers 402, not 403: "not on this plan" rather than "never"), so
 * the sentence is built here from those instead of showing its English one.
 */
function quotaMessage(details: unknown, t: Translate): string | null {
  const quota = (details as { quota?: { resource?: unknown; used?: unknown; limit?: unknown } } | null)
    ?.quota;
  if (quota === undefined || quota === null) return null;

  const { resource, used, limit } = quota;
  if (typeof used !== 'number' || typeof limit !== 'number') return null;
  if (resource !== 'checks' && resource !== 'projects' && resource !== 'channels') return null;
  return t(QUOTA_MESSAGES[resource], { used, limit });
}

/**
 * A refusal to send another test alert, with the time to wait or the budget used,
 * in the language of the page. The server says which rule (`reason`) and the
 * numbers, so the sentence is built here rather than shown in English.
 */
function rateMessage(details: unknown, t: Translate): string | null {
  const { reason, retryAfterSeconds, limit } = (details ?? {}) as {
    reason?: unknown;
    retryAfterSeconds?: unknown;
    limit?: unknown;
  };
  if (reason === 'test_cooldown' && typeof retryAfterSeconds === 'number') {
    return t('error.testCooldown', { seconds: retryAfterSeconds });
  }
  if (reason === 'test_limit' && typeof limit === 'number') {
    return t('error.testLimit', { limit });
  }
  return null;
}
