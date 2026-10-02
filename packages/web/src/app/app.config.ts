import { provideHttpClient, withInterceptors } from '@angular/common/http';
import {
  ApplicationConfig,
  provideBrowserGlobalErrorListeners,
  provideZonelessChangeDetection,
} from '@angular/core';
import { provideAnimations } from '@angular/platform-browser/animations';
import {
  TitleStrategy,
  provideRouter,
  withComponentInputBinding,
  withInMemoryScrolling,
} from '@angular/router';
import { authInterceptor } from './core/auth.interceptor';
import { TranslatedTitleStrategy } from './core/title.strategy';
import { timeoutInterceptor } from './core/timeout.interceptor';
import { routes } from './app.routes';

/**
 * Zoneless change detection: state is held in signals, so there is no reason to
 * ship zone.js and monkey-patch every browser API to find out when to re-render.
 */
export const appConfig: ApplicationConfig = {
  providers: [
    provideBrowserGlobalErrorListeners(),
    provideZonelessChangeDetection(),
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: 'top' }),
    ),
    // The timeout is outermost: it bounds the whole read, including the one
    // refresh-and-retry the auth interceptor may add to it.
    provideHttpClient(withInterceptors([timeoutInterceptor, authInterceptor])),
    { provide: TitleStrategy, useExisting: TranslatedTitleStrategy },
    provideAnimations(),
  ],
};
