import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type {
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  RegisterResponse,
  SessionDto,
  UserDto,
} from '@silencewatch/shared';
import { Observable, tap } from 'rxjs';

/**
 * Session handling.
 *
 * Neither token is reachable from script. The access token lives in memory for
 * the life of the page; the refresh token is an HttpOnly cookie the browser
 * attaches to `/api/auth` and this code never sees. That is the change from the
 * earlier design, which kept the refresh token in `localStorage` where an
 * injected script could take a thirty-day credential and walk away with it.
 *
 * The consequence is that "am I signed in?" can no longer be answered by
 * looking: the application asks the server on boot, and a 401 means no.
 */

@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly accessToken = signal<string | null>(null);
  private readonly currentUser = signal<UserDto | null>(null);

  readonly user = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.accessToken() !== null);

  get token(): string | null {
    return this.accessToken();
  }

  /**
   * Whether a session was restored on boot. Null while that is still in flight,
   * so guards can wait instead of bouncing a signed-in user to the login page.
   */
  private readonly restored = signal<boolean | null>(null);
  readonly isRestoring = computed(() => this.restored() === null);

  /**
   * Attempts to adopt the session behind the refresh cookie. Called once at
   * startup; resolves to false when there is nothing to restore.
   */
  restore(): Promise<boolean> {
    return new Promise((resolve) => {
      this.refresh().subscribe({
        next: () => {
          this.restored.set(true);
          resolve(true);
        },
        error: () => {
          this.restored.set(false);
          resolve(false);
        },
      });
    });
  }

  /**
   * Registers. On an instance that requires email verification the response
   * carries no session — the account exists but cannot be used yet — so the
   * caller has to look at `status` rather than assume it is signed in.
   */
  register(request: RegisterRequest): Observable<RegisterResponse> {
    return this.http
      .post<RegisterResponse>('/api/auth/register', request)
      .pipe(tap((result) => (result.status === 'active' ? this.adopt(result) : undefined)));
  }

  verifyEmail(token: string): Observable<void> {
    return this.http.post<void>('/api/auth/verify-email', { token });
  }

  /** Always succeeds, whatever the address: the server says nothing about it. */
  resendVerification(email: string): Observable<void> {
    return this.http.post<void>('/api/auth/resend-verification', { email });
  }

  login(request: LoginRequest): Observable<SessionDto> {
    return this.http
      .post<SessionDto>('/api/auth/login', request)
      .pipe(tap((session) => this.adopt(session)));
  }

  /** The cookie is the credential; the body is empty on purpose. */
  refresh(): Observable<SessionDto> {
    return this.http
      .post<SessionDto>('/api/auth/refresh', {})
      .pipe(tap((session) => this.adopt(session)));
  }

  forgotPassword(email: string): Observable<void> {
    return this.http.post<void>('/api/auth/forgot-password', { email });
  }

  resetPassword(token: string, newPassword: string): Observable<void> {
    return this.http.post<void>('/api/auth/reset-password', { token, newPassword });
  }

  changePassword(request: ChangePasswordRequest): Observable<void> {
    // Every session dies with the password, including this one.
    return this.http.post<void>('/api/auth/password', request).pipe(tap(() => this.forget()));
  }

  logout(): void {
    this.forget();
    // Fire and forget: the local session is already gone, and the response is
    // what clears the cookie.
    this.http.post('/api/auth/logout', {}).subscribe({ error: () => undefined });
    void this.router.navigate(['/login']);
  }

  /** Clears local state without calling the server. Used when a refresh fails. */
  forget(): void {
    this.accessToken.set(null);
    this.currentUser.set(null);
    this.restored.set(false);
  }

  private adopt(session: SessionDto): void {
    this.accessToken.set(session.accessToken);
    this.currentUser.set(session.user);
    this.restored.set(true);
  }
}
