import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { SessionDto } from '@silencewatch/shared';
import { AuthService } from './auth.service';

const session = (token: string): SessionDto => ({
  user: { id: 'u', email: 'a@example.test', name: null, createdAt: '2026-01-01T00:00:00Z' },
  accessToken: token,
  refreshToken: 'r',
  expiresIn: 900,
});

describe('AuthService.refresh', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  it('sends one request however many callers ask at once', () => {
    const tokens: string[] = [];
    for (let caller = 0; caller < 3; caller += 1) {
      auth.refresh().subscribe((s) => tokens.push(s.accessToken));
    }

    http.expectOne('/api/auth/refresh').flush(session('fresh'));
    http.verify();
    expect(tokens).toEqual(['fresh', 'fresh', 'fresh']);
    expect(auth.token).toBe('fresh');
  });

  it('asks again once the first request is over', () => {
    auth.refresh().subscribe();
    http.expectOne('/api/auth/refresh').flush(session('one'));

    auth.refresh().subscribe();
    http.expectOne('/api/auth/refresh').flush(session('two'));
    expect(auth.token).toBe('two');
  });

  it('lets every waiting caller see a failure, and then tries afresh', () => {
    const failures: number[] = [];
    for (let caller = 0; caller < 2; caller += 1) {
      auth.refresh().subscribe({ error: (e: { status: number }) => failures.push(e.status) });
    }
    http.expectOne('/api/auth/refresh').flush('no', { status: 401, statusText: 'Unauthorized' });
    expect(failures).toEqual([401, 401]);

    auth.refresh().subscribe();
    http.expectOne('/api/auth/refresh').flush(session('again'));
    expect(auth.token).toBe('again');
  });
});
