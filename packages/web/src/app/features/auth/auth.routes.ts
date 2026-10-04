import { Routes } from '@angular/router';

/** The screens a signed-out visitor can reach: sign in, confirm an address, reset a password. */
export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    title: 'title.login',
    loadComponent: () => import('./login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'verify-email',
    title: 'title.verifyEmail',
    loadComponent: () =>
      import('./verify-email/verify-email.component').then((m) => m.VerifyEmailComponent),
  },
  {
    path: 'reset-password',
    title: 'title.resetPassword',
    loadComponent: () =>
      import('./reset-password/reset-password.component').then((m) => m.ResetPasswordComponent),
  },
];
