import {
  HttpErrorResponse,
  HttpEvent,
  HttpHandlerFn,
  HttpRequest,
} from '@angular/common/http';
import { Observable, TimeoutError, catchError, throwError, timeout } from 'rxjs';

/**
 * How long a read may stay unanswered before the page gives up on it.
 *
 * A browser waits on a silent connection for minutes — a proxy that lost the
 * upstream, a pooled socket the network dropped without telling anyone — and
 * the page showed a spinner for all of it. Thirty seconds is far above any
 * answer this API gives (it is normally a few milliseconds) and far below the
 * point where a person decides the application is broken.
 */
export const REQUEST_TIMEOUT_MS = 30_000;

/**
 * Bounds how long a GET can hang, then aborts it and fails it as a 504.
 *
 * Reads only. A write that times out in the browser may well have succeeded on
 * the server, and turning that into an error the person retries is how a form
 * gets submitted twice; a read can always simply be asked again.
 *
 * Unsubscribing is what aborts the underlying request, so a timed-out read
 * does not keep a connection busy behind the one that replaces it.
 */
export function timeoutInterceptor(
  request: HttpRequest<unknown>,
  next: HttpHandlerFn,
): Observable<HttpEvent<unknown>> {
  if (request.method !== 'GET') return next(request);

  return next(request).pipe(
    timeout(REQUEST_TIMEOUT_MS),
    catchError((error: unknown) =>
      error instanceof TimeoutError
        ? throwError(
            () =>
              new HttpErrorResponse({
                url: request.url,
                status: 504,
                statusText: 'Timeout',
                error: null,
              }),
          )
        : throwError(() => error),
    ),
  );
}
