import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { LIMITS } from '@silencewatch/shared';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/error-message';

/**
 * Where the emailed reset link lands.
 *
 * The link is a plain GET to this route; the password change is the POST this
 * page makes once the user has typed a new one. Mail scanners open every URL in
 * an inbound message, and a token consumed by a GET would be spent — and the
 * account's password changed — before anyone read the mail.
 */
@Component({
  selector: 'sw-reset-password',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    RouterLink,
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressBarModule,
  ],
  template: `
    <div class="wrap">
      <div class="card sw-card">
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" class="progress" />
        }

        <div class="body">
          @if (done()) {
            <span class="glyph ok" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
              </svg>
            </span>
            <h1>Password changed</h1>
            <p class="sw-muted">
              Every session was signed out, including any you did not recognise. Sign in with your
              new password.
            </p>
            <a mat-flat-button routerLink="/login" class="action">Sign in</a>
          } @else {
            <h1>Choose a new password</h1>
            <p class="sw-muted lead">
              This also signs out every device currently using the account.
            </p>

            <form [formGroup]="form" (ngSubmit)="submit()" class="sw-form">
              <mat-form-field appearance="outline">
                <mat-label>New password</mat-label>
                <input matInput type="password" formControlName="password" autocomplete="new-password" />
                <mat-hint>{{ minLength }} characters minimum</mat-hint>
                @if (form.controls.password.touched && form.controls.password.invalid) {
                  <mat-error>At least {{ minLength }} characters</mat-error>
                }
              </mat-form-field>

              @if (error()) {
                <p class="sw-error" role="alert">{{ error() }}</p>
              }

              <button mat-flat-button type="submit" [disabled]="busy()" class="submit">
                Change my password
              </button>
            </form>

            <a routerLink="/login" class="back sw-muted">Back to sign in</a>
          }
        </div>
      </div>
    </div>
  `,
  styles: `
    .wrap {
      display: grid;
      place-items: center;
      min-height: 100dvh;
      padding: 24px;
      background:
        radial-gradient(60rem 30rem at 50% -10%, var(--sw-accent-soft), transparent 70%),
        var(--sw-bg);
    }

    .card {
      position: relative;
      width: min(420px, 100%);
      overflow: hidden;
      box-shadow: var(--sw-shadow-lg);
    }

    .progress {
      position: absolute;
      inset: 0 0 auto;
    }

    .body {
      padding: 32px 28px 28px;
      text-align: center;
    }

    .glyph {
      display: grid;
      place-items: center;
      width: 52px;
      height: 52px;
      margin: 0 auto 18px;
      border-radius: 50%;
      background: var(--sw-up-soft);
      color: var(--sw-up);
    }

    h1 {
      font-size: 1.1875rem;
    }

    p {
      max-width: 40ch;
      margin: 10px auto 0;
      font-size: 0.9375rem;
      line-height: 1.55;
    }

    .lead {
      margin-bottom: 22px;
    }

    form {
      display: flex;
      flex-direction: column;
      text-align: left;
    }

    .submit {
      margin-top: 8px;
      font-weight: 600;
    }

    .action {
      display: inline-block;
      margin-top: 24px;
      min-width: 160px;
    }

    .action,
    .action:hover,
    .back:hover {
      text-decoration: none;
    }

    .back {
      display: inline-block;
      margin-top: 18px;
      font-size: 0.875rem;
    }
  `,
})
export class ResetPasswordComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly minLength = LIMITS.passwordMin;
  protected readonly busy = signal(false);
  protected readonly done = signal(false);
  protected readonly error = signal<string | null>(null);

  // Read from the raw query string: this page is reached from outside the
  // application, and the token should not linger in router state after use.
  private readonly token = new URLSearchParams(window.location.search).get('token') ?? '';

  protected readonly form = this.formBuilder.nonNullable.group({
    password: ['', [Validators.required, Validators.minLength(LIMITS.passwordMin)]],
  });

  protected submit(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    if (this.token === '') {
      this.error.set('That link is missing its reset code. Open the one from the email directly.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    this.auth.resetPassword(this.token, this.form.getRawValue().password).subscribe({
      next: () => {
        this.busy.set(false);
        this.done.set(true);
        // Drop the token from the address bar so it is not left in history or
        // in a bookmark.
        void this.router.navigate([], { replaceUrl: true });
      },
      error: (failure: unknown) => {
        this.busy.set(false);
        this.error.set(
          errorMessage(
            failure,
            'This reset link is no longer valid. Request a new one from the sign-in page.',
          ),
        );
      },
    });
  }
}
