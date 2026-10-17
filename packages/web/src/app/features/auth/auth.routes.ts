import { Routes } from '@angular/router';

/** The screens a signed-out visitor can reach: sign in, and the first visit by a setup link. */
export const AUTH_ROUTES: Routes = [
  {
    path: 'login',
    title: 'title.login',
    loadComponent: () => import('./login/login.component').then((m) => m.LoginComponent),
  },
  {
    path: 'setup',
    title: 'title.setup',
    data: { setup: true },
    loadComponent: () => import('./login/login.component').then((m) => m.LoginComponent),
  },
];
