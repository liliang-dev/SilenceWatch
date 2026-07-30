import { HttpErrorResponse } from '@angular/common/http';
import type { ApiErrorBody } from '@silencewatch/shared';

/**
 * Turns a failed request into something worth showing a person.
 *
 * The server sends a stable error envelope, including field-level details for
 * validation failures — those are the useful part, so they are surfaced rather
 * than replaced by a generic "something went wrong".
 */
export function errorMessage(error: unknown, fallback = 'Something went wrong.'): string {
  if (!(error instanceof HttpErrorResponse)) return fallback;

  if (error.status === 0) {
    return 'Cannot reach the server. Check your connection and try again.';
  }

  const body = error.error as Partial<ApiErrorBody> | string | null;
  if (typeof body === 'string' && body.trim() !== '') return body;

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
    if (typeof body.message === 'string' && body.message.trim() !== '') return body.message;
  }

  if (error.status === 429) return 'Too many attempts. Wait a moment and try again.';
  if (error.status >= 500) return 'The server is having trouble. Try again shortly.';
  return fallback;
}
