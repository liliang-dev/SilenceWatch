import { HttpClient } from '@angular/common/http';
import { Injectable, computed, inject, signal } from '@angular/core';
import { Router } from '@angular/router';
import type { UserDto } from '@silencewatch/shared';
import { Observable, tap } from 'rxjs';

/**
 * Who is signed in.
 *
 * The session is a cookie the page cannot read, so "am I signed in?" is answered
 * by asking the server, and a 401 means no. That is all this holds: the user the
 * server said it was, and the few calls that end or change a session. How a person
 * signs in is `SignInService`.
 */
@Injectable({ providedIn: 'root' })
export class AuthService {
  private readonly http = inject(HttpClient);
  private readonly router = inject(Router);

  private readonly currentUser = signal<UserDto | null>(null);
  private restoring: Promise<boolean> | null = null;

  readonly user = this.currentUser.asReadonly();
  readonly isAuthenticated = computed(() => this.currentUser() !== null);

  /**
   * Looks for a session behind the cookie. One request at a time, however many
   * callers ask: on a reload, the guard and the shell both want to know.
   */
  restore(): Promise<boolean> {
    this.restoring ??= new Promise<boolean>((resolve) => {
      this.http.get<UserDto>('/api/auth/me').subscribe({
        next: (user) => {
          this.currentUser.set(user);
          resolve(true);
        },
        error: () => {
          this.currentUser.set(null);
          resolve(false);
        },
      });
    }).finally(() => (this.restoring = null));
    return this.restoring;
  }

  /**
   * Changes the password. The other sessions end with the old one; this one stays,
   * because the person who just typed the current password is plainly here.
   */
  changePassword(request: { currentPassword: string; newPassword: string }): Observable<unknown> {
    return this.http.post('/api/auth/change-password', { ...request, revokeOtherSessions: true });
  }

  /**
   * Deletes the account and everything in it. A sign-in from the last few
   * minutes is what the server insists on, and the interceptor asks for one if
   * it is refused for lack of it. Every session ends with the account.
   */
  deleteAccount(): Observable<void> {
    return this.http.post<void>('/api/auth/delete-account', {}).pipe(tap(() => this.forget()));
  }

  logout(): void {
    this.forget();
    // Fire and forget: the page is already signed out, and the response is what
    // tells the browser to drop the cookie.
    this.http.post('/api/auth/sign-out', {}).subscribe({ error: () => undefined });
    void this.router.navigate(['/login']);
  }

  /** Clears local state without calling the server. Used when the server has said the session is over. */
  forget(): void {
    this.currentUser.set(null);
  }
}
