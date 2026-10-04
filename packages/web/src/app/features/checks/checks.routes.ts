import { Routes } from '@angular/router';

/** The list of checks, and one check's detail. */
export const CHECKS_ROUTES: Routes = [
  {
    path: '',
    title: 'title.checks',
    loadComponent: () => import('./list/checks.component').then((m) => m.ChecksComponent),
  },
  {
    path: ':id',
    title: 'title.check',
    loadComponent: () =>
      import('./detail/check-detail.component').then((m) => m.CheckDetailComponent),
  },
];
