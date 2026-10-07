import { InjectionToken } from '@angular/core';

/**
 * Sends the browser to another site: Stripe's payment page and customer portal.
 *
 * A token rather than a call to `window.location` in the component, so that a
 * test can see where the user would have been sent instead of leaving the page.
 */
export const REDIRECT = new InjectionToken<(url: string) => void>('redirect', {
  providedIn: 'root',
  factory: () => (url) => window.location.assign(url),
});
