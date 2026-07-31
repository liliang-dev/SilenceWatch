import { Routes } from '@angular/router';
import { authGuard } from './core/auth.guard';

/**
 * Every route is lazy: the login screen must not ship the rest of the
 * application, and a self-hosted instance on a small VPS should not serve a
 * megabyte to show a form.
 */
export const routes: Routes = [
  {
    path: 'login',
    title: 'Sign in — SilenceWatch',
    loadComponent: () => import('./pages/login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'verify-email',
    title: 'Confirm your email — SilenceWatch',
    loadComponent: () =>
      import('./pages/verify-email/verify-email.component').then((m) => m.VerifyEmailComponent),
  },
  {
    path: 'reset-password',
    title: 'Choose a new password — SilenceWatch',
    loadComponent: () =>
      import('./pages/reset-password/reset-password.component').then((m) => m.ResetPasswordComponent),
  },
  {
    path: 'checks',
    title: 'Checks — SilenceWatch',
    canActivate: [authGuard],
    loadComponent: () => import('./pages/checks/checks.component').then((m) => m.ChecksComponent),
  },
  {
    path: 'checks/:id',
    title: 'Check — SilenceWatch',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/check-detail/check-detail.component').then((m) => m.CheckDetailComponent),
  },
  {
    path: 'channels',
    title: 'Alerting — SilenceWatch',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/channels/channels.component').then((m) => m.ChannelsComponent),
  },
  {
    path: 'settings',
    title: 'Settings — SilenceWatch',
    canActivate: [authGuard],
    loadComponent: () =>
      import('./pages/settings/settings.component').then((m) => m.SettingsComponent),
  },
  { path: '', pathMatch: 'full', redirectTo: 'checks' },
  { path: '**', redirectTo: 'checks' },
];
