import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  startRegistration,
  type PublicKeyCredentialCreationOptionsJSON,
} from '@simplewebauthn/browser';
import { firstValueFrom } from 'rxjs';
import { ceremony } from './sign-in.service';

export interface PasskeyDto {
  id: string;
  name: string | null;
  createdAt: string | null;
  deviceType: string;
  backedUp: boolean;
}

/** The passkeys of the signed-in account, and the recovery codes that stand behind them. */
@Injectable({ providedIn: 'root' })
export class PasskeysService {
  private readonly http = inject(HttpClient);

  list(): Promise<PasskeyDto[]> {
    return firstValueFrom(this.http.get<PasskeyDto[]>('/api/auth/passkey/list-user-passkeys'));
  }

  /** Registers one more passkey. Asks for a recent sign-in, which the interceptor arranges. */
  async add(name?: string): Promise<void> {
    const options = await firstValueFrom(
      this.http.get<PublicKeyCredentialCreationOptionsJSON>(
        '/api/auth/passkey/generate-register-options',
      ),
    );
    const response = await ceremony(() => startRegistration({ optionsJSON: options }));
    await firstValueFrom(
      this.http.post('/api/auth/passkey/verify-registration', {
        response,
        ...(name === undefined ? {} : { name }),
      }),
    );
  }

  remove(id: string): Promise<unknown> {
    return firstValueFrom(this.http.post('/api/auth/passkey/delete-passkey', { id }));
  }

  /** How many recovery codes are still good. */
  async recoveryCodesLeft(): Promise<number> {
    const { remaining } = await firstValueFrom(
      this.http.get<{ remaining: number }>('/api/auth/recovery-codes/remaining'),
    );
    return remaining;
  }

  /** A new set, which replaces the old one. The only time it can be read. */
  async newRecoveryCodes(): Promise<string[]> {
    const { codes } = await firstValueFrom(
      this.http.post<{ codes: string[] }>('/api/auth/recovery-codes/generate', {}),
    );
    return codes;
  }
}
