import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type {
  ChangePasswordRequest,
  LoginRequest,
  RegisterRequest,
  SessionDto,
  UserDto,
} from '@silencewatch/shared';
import { Observable, tap } from 'rxjs';

/**
 * Session handling.
 *
 * The access token is kept in memory only: a token in localStorage is a token an
 * XSS can read. The refresh token — single-use, rotated on every refresh, and
 * revocable server-side — is what survives a page reload, which is the trade
 * this design accepts deliberately.
 */
const REFRESH_TOKEN_KEY = 'silencewatch.refresh';

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

  get storedRefreshToken(): string | null {
    return localStorage.getItem(REFRESH_TOKEN_KEY);
  }

  register(request: RegisterRequest): Observable<SessionDto> {
    return this.http
      .post<SessionDto>('/api/auth/register', request)
      .pipe(tap((session) => this.adopt(session)));
  }

  login(request: LoginRequest): Observable<SessionDto> {
    return this.http
      .post<SessionDto>('/api/auth/login', request)
      .pipe(tap((session) => this.adopt(session)));
  }

  refresh(): Observable<SessionDto> {
    const refreshToken = this.storedRefreshToken ?? '';
    return this.http
      .post<SessionDto>('/api/auth/refresh', { refreshToken })
      .pipe(tap((session) => this.adopt(session)));
  }

  changePassword(request: ChangePasswordRequest): Observable<void> {
    // Every session dies with the password, including this one.
    return this.http.post<void>('/api/auth/password', request).pipe(tap(() => this.forget()));
  }

  logout(): void {
    const refreshToken = this.storedRefreshToken;
    this.forget();
    if (refreshToken !== null) {
      // Fire and forget: the local session is already gone either way.
      this.http.post('/api/auth/logout', { refreshToken }).subscribe({ error: () => undefined });
    }
    void this.router.navigate(['/login']);
  }

  /** Clears local state without calling the server. Used when a refresh fails. */
  forget(): void {
    this.accessToken.set(null);
    this.currentUser.set(null);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  private adopt(session: SessionDto): void {
    this.accessToken.set(session.accessToken);
    this.currentUser.set(session.user);
    localStorage.setItem(REFRESH_TOKEN_KEY, session.refreshToken);
  }
}
