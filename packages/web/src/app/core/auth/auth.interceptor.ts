import { HttpErrorResponse, HttpEvent, HttpHandlerFn, HttpRequest } from '@angular/common/http';
import { inject } from '@angular/core';
import { Router } from '@angular/router';
import { Observable, catchError, from, switchMap, throwError } from 'rxjs';
import { AuthService } from './auth.service';
import { ReauthService } from './reauth.service';

/**
 * Two things the server can answer that the page has to act on.
 *
 * **401 from the API**: the session is over (it ran out, was signed out elsewhere,
 * or the account is gone). The page forgets it and goes to the sign-in screen. The
 * auth endpoints themselves are left alone, since a 401 there is a wrong credential
 * and not an ended session.
 *
 * **403 asking for a recent sign-in**: deleting the account, managing an API key
 * and adding a passkey want proof that the person is there now. The request is held
 * while they sign in again, then sent once more as it was; if they decline, the
 * refusal is the answer.
 */
export function authInterceptor(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  const auth = inject(AuthService);
  const router = inject(Router);
  const reauth = inject(ReauthService);

  return next(request).pipe(
    catchError((error: unknown) => {
      if (!(error instanceof HttpErrorResponse)) return throwError(() => error);

      if (error.status === 401 && !request.url.startsWith('/api/auth/')) {
        auth.forget();
        void router.navigate(['/login'], { queryParams: { next: router.url } });
        return throwError(() => error);
      }

      if (error.status === 403 && asksForRecentSignIn(error)) {
        return from(reauth.confirm()).pipe(
          switchMap((confirmed) => (confirmed ? next(request) : throwError(() => error))),
        );
      }

      return throwError(() => error);
    }),
  );
}

/** Read from what the server flags, not from its wording. */
export function asksForRecentSignIn(error: HttpErrorResponse): boolean {
  const body = error.error as { code?: unknown; details?: { reauthRequired?: unknown } } | null;
  return body?.details?.reauthRequired === true || body?.code === 'SESSION_NOT_FRESH';
}
