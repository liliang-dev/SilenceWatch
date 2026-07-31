import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * Protects the application shell.
 *
 * On a hard reload there is no access token in memory — and, since the refresh
 * token became an HttpOnly cookie, no way to look and see whether one exists.
 * So the guard simply tries: the browser attaches the cookie if it has one, and
 * a 401 is the answer that there is no session. A reload therefore lands on the
 * page the user asked for rather than bouncing through the login screen, and
 * the one wasted request is the price of the token being unreadable.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;

  return auth.refresh().pipe(
    map(() => true),
    catchError(() => {
      auth.forget();
      return of(router.createUrlTree(['/login'], { queryParams: { next: state.url } }));
    }),
  );
};
