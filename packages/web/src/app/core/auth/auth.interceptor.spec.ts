import { HttpClient, provideHttpClient, withInterceptors } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import { AuthService } from './auth.service';
import { authInterceptor } from './auth.interceptor';
import { ReauthService } from './reauth.service';

describe('authInterceptor', () => {
  let client: HttpClient;
  let http: HttpTestingController;
  let navigate: ReturnType<typeof vi.spyOn>;
  let confirm: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    confirm = vi.fn();
    TestBed.configureTestingModule({
      providers: [
        provideHttpClient(withInterceptors([authInterceptor])),
        provideHttpClientTesting(),
        provideRouter([]),
        { provide: ReauthService, useValue: { confirm } },
      ],
    });
    client = TestBed.inject(HttpClient);
    http = TestBed.inject(HttpTestingController);
    navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
  });

  const unauthorized = { status: 401, statusText: 'Unauthorized' };

  it('sends no token of its own: the session is a cookie', () => {
    client.get('/api/v1/projects').subscribe();
    expect(http.expectOne('/api/v1/projects').request.headers.has('authorization')).toBe(false);
  });

  it('ends the session on a 401 from the API, and goes to the sign-in page', () => {
    const forget = vi.spyOn(TestBed.inject(AuthService), 'forget');
    client.get('/api/v1/projects').subscribe({ error: () => undefined });
    http.expectOne('/api/v1/projects').flush('no', unauthorized);

    expect(forget).toHaveBeenCalled();
    expect(navigate).toHaveBeenCalledWith(['/login'], expect.anything());
  });

  it('leaves a 401 from the sign-in endpoints alone: that is a wrong credential', () => {
    const forget = vi.spyOn(TestBed.inject(AuthService), 'forget');
    let status = 0;
    client
      .post('/api/auth/sign-in/email', {})
      .subscribe({ error: (error: { status: number }) => (status = error.status) });
    http.expectOne('/api/auth/sign-in/email').flush('no', unauthorized);

    expect(status).toBe(401);
    expect(forget).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });

  describe('a refusal that asks for a recent sign-in', () => {
    const askAgain = { status: 403, statusText: 'Forbidden' };
    const body = { statusCode: 403, message: 'Sign in again to do this.', details: { reauthRequired: true } };

    it('holds the request while the person signs in, then sends it again', () => {
      confirm.mockResolvedValue(true);
      const results: unknown[] = [];
      client.post('/api/v1/projects/p/api-keys', { name: 'ci' }).subscribe((value) => results.push(value));

      http.expectOne('/api/v1/projects/p/api-keys').flush(body, askAgain);
      return vi.waitFor(() => {
        const retry = http.expectOne('/api/v1/projects/p/api-keys');
        expect(retry.request.body).toEqual({ name: 'ci' });
        retry.flush({ id: 'k' });
        expect(results).toEqual([{ id: 'k' }]);
      });
    });

    it('answers with the refusal when the person declines', async () => {
      confirm.mockResolvedValue(false);
      let status = 0;
      client
        .post('/api/auth/delete-account', {})
        .subscribe({ error: (error: { status: number }) => (status = error.status) });

      http.expectOne('/api/auth/delete-account').flush(body, askAgain);
      await vi.waitFor(() => expect(status).toBe(403));
      http.expectNone('/api/auth/delete-account');
    });

    it('also recognises the one Better Auth gives for a passkey', async () => {
      confirm.mockResolvedValue(true);
      client.get('/api/auth/passkey/generate-register-options').subscribe();
      http
        .expectOne('/api/auth/passkey/generate-register-options')
        .flush({ code: 'SESSION_NOT_FRESH', message: 'Sign in again to do this.' }, askAgain);

      await vi.waitFor(() => http.expectOne('/api/auth/passkey/generate-register-options'));
      expect(confirm).toHaveBeenCalledTimes(1);
    });

    it('does not treat any other 403 as a reason to ask', async () => {
      let status = 0;
      client
        .get('/api/v1/projects/x')
        .subscribe({ error: (error: { status: number }) => (status = error.status) });
      http.expectOne('/api/v1/projects/x').flush({ message: 'Forbidden' }, askAgain);

      expect(status).toBe(403);
      expect(confirm).not.toHaveBeenCalled();
    });
  });
});
