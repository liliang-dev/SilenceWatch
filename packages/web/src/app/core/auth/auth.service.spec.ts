import { provideHttpClient } from '@angular/common/http';
import { HttpTestingController, provideHttpClientTesting } from '@angular/common/http/testing';
import { TestBed } from '@angular/core/testing';
import { Router, provideRouter } from '@angular/router';
import type { UserDto } from '@silencewatch/shared';
import { AuthService } from './auth.service';

const user: UserDto = {
  id: 'u',
  email: 'a@example.test',
  name: null,
  createdAt: '2026-01-01T00:00:00Z',
  admin: false,
};

describe('AuthService', () => {
  let auth: AuthService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({
      providers: [provideHttpClient(), provideHttpClientTesting(), provideRouter([])],
    });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });

  describe('restore', () => {
    it('adopts the user the server says the cookie belongs to', async () => {
      const restored = auth.restore();
      http.expectOne('/api/auth/me').flush(user);

      expect(await restored).toBe(true);
      expect(auth.user()).toEqual(user);
      expect(auth.isAuthenticated()).toBe(true);
    });

    it('says no, and holds nobody, when there is no session', async () => {
      const restored = auth.restore();
      http.expectOne('/api/auth/me').flush('no', { status: 401, statusText: 'Unauthorized' });

      expect(await restored).toBe(false);
      expect(auth.user()).toBeNull();
      expect(auth.isAuthenticated()).toBe(false);
    });

    it('sends one request however many callers ask at once', async () => {
      const callers = [auth.restore(), auth.restore(), auth.restore()];
      http.expectOne('/api/auth/me').flush(user);
      http.verify();

      expect(await Promise.all(callers)).toEqual([true, true, true]);
    });

    it('asks again once the first answer is in', async () => {
      const first = auth.restore();
      http.expectOne('/api/auth/me').flush(user);
      await first;

      const second = auth.restore();
      http.expectOne('/api/auth/me').flush('no', { status: 401, statusText: 'Unauthorized' });
      expect(await second).toBe(false);
    });
  });

  describe('logout', () => {
    it('forgets the user at once, tells the server, and goes to the sign-in page', async () => {
      const navigate = vi.spyOn(TestBed.inject(Router), 'navigate').mockResolvedValue(true);
      const restored = auth.restore();
      http.expectOne('/api/auth/me').flush(user);
      await restored;

      auth.logout();

      expect(auth.isAuthenticated()).toBe(false);
      expect(http.expectOne('/api/auth/sign-out').request.method).toBe('POST');
      expect(navigate).toHaveBeenCalledWith(['/login']);
    });
  });

  describe('changePassword', () => {
    it('signs the other devices out, and keeps this one', () => {
      auth.changePassword({ currentPassword: 'old-old-old-old', newPassword: 'new-new-new-new' }).subscribe();

      const request = http.expectOne('/api/auth/change-password');
      expect(request.request.body).toEqual({
        currentPassword: 'old-old-old-old',
        newPassword: 'new-new-new-new',
        revokeOtherSessions: true,
      });
    });
  });

  describe('deleteAccount', () => {
    it('forgets the user once the account is gone', async () => {
      const restored = auth.restore();
      http.expectOne('/api/auth/me').flush(user);
      await restored;

      auth.deleteAccount().subscribe();
      http.expectOne('/api/auth/delete-account').flush(null, { status: 204, statusText: 'No Content' });

      expect(auth.isAuthenticated()).toBe(false);
    });
  });
});
