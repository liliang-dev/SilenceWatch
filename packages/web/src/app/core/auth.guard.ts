import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { catchError, map, of } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * Protects the application shell.
 *
 * On a hard reload there is no access token in memory, only the refresh token, so
 * the guard exchanges it before deciding — which is why a reload lands on the
 * page the user asked for rather than bouncing through the login screen.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;

  if (auth.storedRefreshToken === null) {
    return router.createUrlTree(['/login'], { queryParams: { next: state.url } });
  }

  return auth.refresh().pipe(
    map(() => true),
    catchError(() => {
      auth.forget();
      return of(router.createUrlTree(['/login'], { queryParams: { next: state.url } }));
    }),
  );
};
