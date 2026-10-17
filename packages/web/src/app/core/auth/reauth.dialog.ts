import { HttpErrorResponse } from '@angular/common/http';
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { LIMITS, type AuthConfigDto } from '@silencewatch/shared';
import { I18n } from '../i18n/i18n.service';
import { AuthConfigService } from './auth-config.service';
import { AuthService } from './auth.service';
import { PasskeyError, SignInService, type Provider } from './sign-in.service';

/**
 * "Sign in again to do this."
 *
 * What the server asks for before deleting an account, minting an API key or adding
 * a passkey: a sign-in from the last few minutes. It is the same sign-in as the
 * login page, offered in the way this instance has — a passkey, a password or a
 * provider — and it ends with a fresh session in place of the old one.
 *
 * A provider is reached by leaving the page, which loses whatever was being done;
 * the person is told so, because the alternative is a button that looks as if it
 * had done nothing.
 */
@Component({
  selector: 'sw-reauth',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatButtonModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  template: `
    <h2 mat-dialog-title>{{ t('reauth.title') }}</h2>
    <mat-dialog-content>
      <p class="lead">{{ t('reauth.body') }}</p>

      @if (config(); as options) {
        <div class="methods">
          @if (options.passkey) {
            <button mat-flat-button type="button" [disabled]="busy()" (click)="usePasskey()">
              {{ t('reauth.usePasskey') }}
            </button>
          }

          @if (options.password) {
            <form [formGroup]="form" (ngSubmit)="usePassword()" class="password">
              <mat-form-field appearance="outline">
                <mat-label>{{ t('login.password') }}</mat-label>
                <input
                  matInput
                  type="password"
                  formControlName="password"
                  autocomplete="current-password"
                  cdkFocusInitial
                />
              </mat-form-field>
              <button mat-flat-button type="submit" [disabled]="busy()">
                {{ t('reauth.confirm') }}
              </button>
            </form>
          }

          @for (provider of options.providers; track provider) {
            <button mat-stroked-button type="button" [disabled]="busy()" (click)="useProvider(provider)">
              {{ t(provider === 'google' ? 'login.withGoogle' : 'login.withMicrosoft') }}
            </button>
          }

          @if (options.providers.length > 0) {
            <p class="note">{{ t('reauth.providerNote') }}</p>
          }
        </div>
      }

      @if (error(); as message) {
        <p class="error" role="alert">{{ message }}</p>
      }
    </mat-dialog-content>
    <mat-dialog-actions align="end">
      <button mat-button type="button" [disabled]="busy()" (click)="dialogRef.close(false)">
        {{ t('common.cancel') }}
      </button>
    </mat-dialog-actions>
  `,
  styles: `
    .lead { margin: 0 0 16px; color: var(--sw-text-muted); line-height: 1.5; }
    .methods { display: flex; flex-direction: column; gap: 12px; }
    .password { display: flex; flex-direction: column; gap: 4px; }
    .note { margin: 0; font-size: 0.8125rem; color: var(--sw-text-subtle); }
    .error { margin: 12px 0 0; color: var(--sw-danger); font-size: 0.875rem; }
  `,
})
export class ReauthDialog implements OnInit {
  protected readonly dialogRef = inject<MatDialogRef<ReauthDialog, boolean>>(MatDialogRef);
  private readonly signIn = inject(SignInService);
  private readonly auth = inject(AuthService);
  private readonly configs = inject(AuthConfigService);
  protected readonly t = inject(I18n).t;

  protected readonly config = signal<AuthConfigDto | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    password: ['', [Validators.required, Validators.maxLength(LIMITS.passwordMax)]],
  });

  ngOnInit(): void {
    this.configs
      .load()
      .then((config) => this.config.set(config))
      .catch(() => this.error.set(this.t('error.offline')));
  }

  protected usePasskey(): void {
    void this.attempt(() => this.signIn.withPasskey());
  }

  protected usePassword(): void {
    const email = this.auth.user()?.email;
    if (this.form.invalid || email === undefined) return;
    void this.attempt(() => this.signIn.withPassword(email, this.form.getRawValue().password));
  }

  protected useProvider(provider: Provider): void {
    void this.attempt(() => this.signIn.withProvider(provider, window.location.pathname));
  }

  private async attempt(run: () => Promise<unknown>): Promise<void> {
    this.busy.set(true);
    this.error.set(null);
    try {
      await run();
      this.dialogRef.close(true);
    } catch (failure: unknown) {
      this.busy.set(false);
      // Whatever went wrong, the same words: this is a sign-in, and it must not say
      // which part of it was close.
      this.error.set(
        failure instanceof PasskeyError && failure.reason === 'cancelled'
          ? this.t('login.passkeyCancelled')
          : failure instanceof HttpErrorResponse && failure.status === 429
            ? this.t('error.tooManyAttempts')
            : this.t('login.failed'),
      );
    }
  }
}
