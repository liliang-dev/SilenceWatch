import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpRequest,
} from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';

/** Endpoints that must not carry a token, and must not trigger a refresh loop. */
const ANONYMOUS_PATHS = [
  '/api/auth/login',
  '/api/auth/register',
  '/api/auth/refresh',
  '/api/auth/logout',
  '/api/auth/signup-challenge',
  '/api/auth/verify-email',
  '/api/auth/resend-verification',
  '/api/auth/forgot-password',
  '/api/auth/reset-password',
];

/**
 * Attaches the bearer token and, on a 401, refreshes once before giving up.
 *
 * A single retry is the whole policy: if the refresh itself fails, the session is
 * genuinely over and the user goes back to the login page rather than watching
 * the application retry forever.
 */
export function authInterceptor(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (ANONYMOUS_PATHS.some((path) => request.url.startsWith(path))) {
    return next(request);
  }

  return next(withToken(request, auth.token)).pipe(
    catchError((error: unknown) => {
      const isExpired = error instanceof HttpErrorResponse && error.status === 401;
      // Whether a refresh token exists is no longer knowable from here — it is
      // an HttpOnly cookie. So the retry is unconditional on a 401, and the
      // refresh failing is what tells us the session is genuinely over.
      if (!isExpired) return throwError(() => error);

      return auth.refresh().pipe(
        switchMap(() => next(withToken(request, auth.token))),
        catchError((refreshError: unknown) => {
          auth.forget();
          void router.navigate(['/login']);
          return throwError(() => refreshError);
        }),
      );
    }),
  );
}

function withToken(request: HttpRequest<unknown>, token: string | null): HttpRequest<unknown> {
  return token === null
    ? request
    : request.clone({ setHeaders: { authorization: `Bearer ${token}` } });
}
