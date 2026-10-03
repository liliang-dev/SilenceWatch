import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

/**
 * Every route is lazy: the login screen must not ship the rest of the
 * application, and a self-hosted instance on a small VPS should not serve a
 * megabyte to show a form.
 *
 * A route's `title` is a message key, not a sentence: `TranslatedTitleStrategy`
 * turns it into the window title in the language that is current.
 */
export const routes: Routes = [
  {
    path: 'login',
    title: 'title.login',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'verify-email',
    title: 'title.verifyEmail',
    loadComponent: () =>
      import('./pages/verify-email/verify-email.component').then((m) => m.VerifyEmailComponent),
  },
  {
    path: 'reset-password',
    title: 'title.resetPassword',
    loadComponent: () =>
      import('./pages/reset-password/reset-password.component').then((m) => m.ResetPasswordComponent),
  },
  {
    path: 'checks',
    title: 'title.checks',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/checks/checks.component').then((m) => m.ChecksComponent),
  },
  {
    path: 'checks/:id',
    title: 'title.check',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/check-detail/check-detail.component').then((m) => m.CheckDetailComponent),
  },
  {
    path: 'channels',
    title: 'title.channels',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/channels/channels.component').then((m) => m.ChannelsComponent),
  },
  {
    path: 'settings',
    title: 'title.settings',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: 'checks' },
  { path: '**', redirectTo: 'checks' },
];
