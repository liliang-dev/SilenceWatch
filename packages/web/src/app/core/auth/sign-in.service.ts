import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import type { UserDto } from '@silencewatch/shared';
import {
  browserSupportsWebAuthn,
  startAuthentication,
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
  type PublicKeyCredentialRequestOptionsJSON,
} from '@simplewebauthn/browser';
import { firstValueFrom } from 'rxjs';
import { AuthService } from './auth.service';

export type Provider = 'google' | 'microsoft';

/** Why a passkey ceremony ended without a credential, as far as the page can tell. */
export class PasskeyError extends Error {
  constructor(
    readonly reason: 'unsupported' | 'cancelled' | 'failed',
    options?: { cause?: unknown },
  ) {
    super(reason, options);
  }
}

/** The one cookie a setup link leaves: see `rememberSetupToken`. */
const SETUP_COOKIE = 'sw_setup';

/** Set after a recovery code, read once by the passkey offer. */
export const RECOVERED_KEY = 'silencewatch.recovered';

/**
 * Every way of getting a session, and none of the rest of the session's life.
 *
 * Each method either resolves with the user now signed in, or rejects: with the
 * HTTP error the server gave, or with a `PasskeyError` when the browser's own
 * prompt ended it. What to say about a failure is the caller's decision, because
 * it depends on whether the person was signing in (where the answer must be the
 * same whatever went wrong) or creating an account (where it can be specific).
 */
@Injectable({ providedIn: 'root' })
export class SignInService {
  private readonly http = inject(HttpClient);
  private readonly auth = inject(AuthService);

  readonly passkeysSupported = browserSupportsWebAuthn();

  async withPassword(email: string, password: string): Promise<UserDto> {
    await firstValueFrom(this.http.post('/api/auth/sign-in/email', { email, password }));
    return this.adopt();
  }

  async signUpWithPassword(email: string, password: string): Promise<UserDto> {
    await firstValueFrom(this.http.post('/api/auth/sign-up/email', { email, password, name: '' }));
    return this.adopt();
  }

  /** Signs in with whichever passkey the browser offers; no address is needed. */
  async withPasskey(): Promise<UserDto> {
    const options = await firstValueFrom(
      this.http.get<PublicKeyCredentialRequestOptionsJSON>(
        '/api/auth/passkey/generate-authenticate-options',
      ),
    );
    const response = await ceremony(() => startAuthentication({ optionsJSON: options }));
    await firstValueFrom(this.http.post('/api/auth/passkey/verify-authentication', { response }));
    return this.adopt();
  }

  /** Creates the account by registering its first passkey. */
  async signUpWithPasskey(email: string): Promise<UserDto> {
    const options = await firstValueFrom(
      this.http.get<PublicKeyCredentialCreationOptionsJSON>(
        '/api/auth/passkey/generate-register-options',
        { params: { context: email } },
      ),
    );
    const response = await ceremony(() => startRegistration({ optionsJSON: options }));
    await firstValueFrom(
      this.http.post('/api/auth/passkey/verify-registration', { response, createSession: true }),
    );
    return this.adopt();
  }

  async withRecoveryCode(email: string, code: string): Promise<UserDto> {
    await firstValueFrom(this.http.post('/api/auth/recovery-codes/sign-in', { email, code }));
    // Someone who needed a code has lost the device that held their passkey, so the
    // next page offers to make one on the device in their hand.
    try {
      sessionStorage.setItem(RECOVERED_KEY, '1');
    } catch {
      // Without it they are simply not asked.
    }
    return this.adopt();
  }

  /**
   * Leaves for the provider, which sends the browser back to `returnTo` with a
   * session. Resolves only if the redirect could not start.
   */
  async withProvider(provider: Provider, returnTo = '/'): Promise<void> {
    const { url } = await firstValueFrom(
      this.http.post<{ url: string }>('/api/auth/sign-in/social', {
        provider,
        callbackURL: returnTo,
        // A refused sign-in lands on the sign-in page, which says so.
        errorCallbackURL: '/login?failed=1',
        newUserCallbackURL: returnTo,
      }),
    );
    window.location.assign(url);
  }

  /**
   * Keeps a setup link's token where the sign-in endpoints will find it, and only
   * they: a provider sign-in leaves the page and comes back as a plain navigation,
   * which carries cookies and nothing else.
   */
  rememberSetupToken(token: string): void {
    const secure = window.location.protocol === 'https:' ? '; Secure' : '';
    document.cookie = `${SETUP_COOKIE}=${encodeURIComponent(token)}; Path=/api/auth; Max-Age=1800; SameSite=Lax${secure}`;
  }

  forgetSetupToken(): void {
    document.cookie = `${SETUP_COOKIE}=; Path=/api/auth; Max-Age=0; SameSite=Lax`;
  }

  /** Learns who the new session belongs to. */
  private async adopt(): Promise<UserDto> {
    if (!(await this.auth.restore())) throw new Error('signed in, but the session is not there');
    return this.auth.user() as UserDto;
  }
}

/**
 * Runs a browser prompt and says why it ended, if it did not produce a credential.
 * Dismissing the prompt is not an error worth alarming anyone with.
 */
export async function ceremony<T>(run: () => Promise<T>): Promise<T> {
  if (!browserSupportsWebAuthn()) throw new PasskeyError('unsupported');
  try {
    return await run();
  } catch (error: unknown) {
    const name = (error as { name?: string } | null)?.name;
    const cancelled = name === 'NotAllowedError' || name === 'AbortError';
    throw new PasskeyError(cancelled ? 'cancelled' : 'failed', { cause: error });
  }
}
