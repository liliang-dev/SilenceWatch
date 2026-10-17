import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { provideRouter } from '@angular/router';
import type { UserDto } from '@silencewatch/shared';
import { AuthService } from './auth.service';
import { SignInService } from './sign-in.service';

const user: UserDto = { id: 'u', email: 'a@example.test', name: null, createdAt: '2026-01-01T00:00:00Z' };

describe('SignInService', () => {
  let signIn: SignInService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    signIn = TestBed.inject(SignInService);
    http = TestBed.inject(HttpTestingController);
  });

  it('signs in with a password, then learns who it is', async () => {
    const done = signIn.withPassword('a@example.test', 'correct horse battery');
    const request = http.expectOne('/api/auth/sign-in/email');
    expect(request.request.body).toEqual({ email: 'a@example.test', password: 'correct horse battery' });
    request.flush({});
    await vi.waitFor(() => http.expectOne('/api/auth/me').flush(user));

    expect(await done).toEqual(user);
    expect(TestBed.inject(AuthService).user()).toEqual(user);
  });

  it('creates a password account without a name, which the server has no use for', async () => {
    const done = signIn.signUpWithPassword('a@example.test', 'correct horse battery');
    const request = http.expectOne('/api/auth/sign-up/email');
    expect(request.request.body).toEqual({ email: 'a@example.test', password: 'correct horse battery', name: '' });
    request.flush({});
    await vi.waitFor(() => http.expectOne('/api/auth/me').flush(user));
    await done;
  });

  it('exchanges a recovery code for a session', async () => {
    const done = signIn.withRecoveryCode('a@example.test', 'ABCD-EFGH-JKMN');
    const request = http.expectOne('/api/auth/recovery-codes/sign-in');
    expect(request.request.body).toEqual({ email: 'a@example.test', code: 'ABCD-EFGH-JKMN' });
    request.flush({});
    await vi.waitFor(() => http.expectOne('/api/auth/me').flush(user));
    await done;
  });

  it('keeps a setup link\'s token in a cookie only the sign-in endpoints will see, and can drop it', () => {
    // Read through the setter: a cookie scoped to /api/auth is not visible from the page's own path.
    const written: string[] = [];
    vi.spyOn(document, 'cookie', 'set').mockImplementation((value) => void written.push(value));

    signIn.rememberSetupToken('abc 123/token');
    expect(written[0]).toBe('sw_setup=abc%20123%2Ftoken; Path=/api/auth; Max-Age=1800; SameSite=Lax');

    signIn.forgetSetupToken();
    expect(written[1]).toMatch(/^sw_setup=; Path=\/api\/auth; Max-Age=0/);
  });
});
