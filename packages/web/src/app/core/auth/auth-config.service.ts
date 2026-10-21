import { HttpClient } from '@angular/common/http';
import { Injectable, inject, signal } from '@angular/core';
import type { AuthConfigDto } from '@silencewatch/shared';
import { firstValueFrom } from 'rxjs';

/**
 * How this instance lets people in, as the server states it.
 *
 * Asked once and kept: it cannot change without a restart, and everything that
 * draws a sign-in control (the login page, the re-authentication dialog, the
 * settings) needs the same answer.
 */
@Injectable({ providedIn: 'root' })
export class AuthConfigService {
  private readonly http = inject(HttpClient);
  private readonly current = signal<AuthConfigDto | null>(null);
  private pending: Promise<AuthConfigDto> | null = null;

  /** Null until the first answer has arrived. */
  readonly config = this.current.asReadonly();

  load(): Promise<AuthConfigDto> {
    this.pending ??= firstValueFrom(this.http.get<AuthConfigDto>('/api/auth/config'))
      .then((config) => {
        this.current.set(config);
        return config;
      })
      .catch((error: unknown) => {
        // Asked again next time, rather than remembering an outage.
        this.pending = null;
        throw error;
      });
    return this.pending;
  }
}
