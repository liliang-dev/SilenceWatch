import { Component } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter, type Routes } from '@angular/router';
import { routes } from './app.routes';

@Component({ template: '' })
class Stub {}

/**
 * The shape of the route table: where "/" and an unknown address end up. Those are the
 * two a reshuffle of the routes breaks silently — the page just stays blank.
 */
describe('app routes', () => {
  async function navigate(url: string): Promise<string> {
    // The real table, with every lazy screen swapped for a stub and the session guard
    // removed: only the redirects are under test.
    const stubbed = (table: Routes): Routes =>
      table.map((route) => {
        const { canActivate: _guard, loadChildren: _children, loadComponent: _component, ...rest } = route;
        if (route.loadChildren !== undefined) {
          return { ...rest, children: [{ path: 'login', component: Stub }, { path: 'verify-email', component: Stub }, { path: 'reset-password', component: Stub }] };
        }
        return route.redirectTo === undefined ? { ...rest, component: Stub } : rest;
      });

    TestBed.configureTestingModule({ providers: [provideRouter(stubbed(routes))] });
    const router = TestBed.inject(Router);
    await router.navigateByUrl(url);
    return router.url;
  }

  it('sends "/" to the checks', async () => {
    expect(await navigate('/')).toBe('/checks');
  });

  it('sends an unknown address to the checks', async () => {
    expect(await navigate('/nowhere/at/all')).toBe('/checks');
  });

  it('keeps the sign-in screen where it is', async () => {
    expect(await navigate('/login')).toBe('/login');
  });

  it('keeps the reset-password screen where it is', async () => {
    expect(await navigate('/reset-password')).toBe('/reset-password');
  });
});
