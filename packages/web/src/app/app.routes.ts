import { Routes } from '@angular/router';
import { authGuard } from './core/auth/auth.guard';

/**
 * Every route is lazy: the login screen must not ship the rest of the
 * application, and a self-hosted instance on a small VPS should not serve a
 * megabyte to show a form.
 *
 * A route's `title` is a message key, not a sentence: `TranslatedTitleStrategy`
 * turns it into the window title in the language that is current.
 *
 * Each feature owns its routes (`features/<name>/…routes.ts`); this file only says
 * where they are mounted and which of them need a session.
 */
export const routes: Routes = [
  // First, and `pathMatch: 'full'`: the auth routes below are mounted on the empty path,
  // and an empty-path parent whose children do not match "/" would claim it and render
  // nothing at all.
  { path: '', pathMatch: 'full', redirectTo: 'checks' },
  {
    path: '',
    loadChildren: () => import('./features/auth/auth.routes').then((m) => m.AUTH_ROUTES),
  },
  {
    path: 'checks',
    canActivate: [authGuard],
    loadChildren: () => import('./features/checks/checks.routes').then((m) => m.CHECKS_ROUTES),
  },
  {
    path: 'channels',
    title: 'title.channels',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/channels/channels.component').then((m) => m.ChannelsComponent),
  },
  {
    path: 'settings',
    title: 'title.settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./features/settings/settings.component').then((m) => m.SettingsComponent),
  },
  { path: '**', redirectTo: 'checks' },
];
