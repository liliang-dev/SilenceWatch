import { inject } from '@angular/core';
import { CanActivateFn, Router } from '@angular/router';
import { from, map } from 'rxjs';
import { AuthService } from './auth.service';

/**
 * Protects the application shell.
 *
 * On a hard reload nothing is in memory, and the session cookie cannot be read
 * from script. So the guard simply asks: the browser attaches the cookie if it
 * has one, and a 401 is the answer that there is no session. A reload therefore
 * lands on the page that was asked for rather than bouncing through the sign-in
 * screen.
 */
export const authGuard: CanActivateFn = (_route, state) => {
  const auth = inject(AuthService);
  const router = inject(Router);

  if (auth.isAuthenticated()) return true;

  return from(auth.restore()).pipe(
    map((restored) =>
      restored ? true : router.createUrlTree(['/login'], { queryParams: { next: state.url } }),
    ),
  );
};
