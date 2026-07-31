import { ChangeDetectionStrategy, Component, computed, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router } from '@angular/router';
import { LIMITS, type RegisterResponse, type SessionDto } from '@silencewatch/shared';
import type { Observable } from 'rxjs';
import { ProjectStore } from '../../core/project.store';
import { AuthService } from '../../core/auth.service';
import { errorMessage, isVerificationPending } from '../../core/error-message';
import { SignupChallengeService } from '../../core/signup-challenge.service';

@Component({
  selector: 'sw-login',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressBarModule,
  ],
  template: `
    <div class="wrap">
      <div class="panel">
        <div class="card sw-card">
          @if (busy()) {
            <mat-progress-bar mode="indeterminate" class="progress" />
          }

          <div class="card-body">
            <div class="brand">
              <span class="mark" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="18" height="18" fill="none">
                  <path
                    d="M2 12h4l2.5-6.5L13 18l2.5-6H22"
                    stroke="currentColor"
                    stroke-width="2.1"
                    stroke-linecap="round"
                    stroke-linejoin="round"
                  />
                </svg>
              </span>
              <h1>Silence<span class="wordmark-accent">Watch</span></h1>
            </div>

            @if (resetSentTo(); as address) {
              <!-- Deliberately the same words whether or not the address has an
                   account: the page must not become a membership oracle. -->
              <p class="tagline sw-muted">
                If <strong class="address">{{ address }}</strong> has an account, a reset link is on
                its way. It expires in an hour.
              </p>
              <div class="after-send">
                <p class="sw-subtle small">Check the spam folder before asking for another.</p>
                <button mat-button type="button" class="switch-back" (click)="backToSignIn()">
                  Back to sign in
                </button>
              </div>
            } @else if (sentTo(); as address) {
              <!-- The account exists but is unusable until the address answers.
                   Saying so plainly beats a spinner that never resolves. -->
              <p class="tagline sw-muted">
                We sent a confirmation link to <strong class="address">{{ address }}</strong
                >. Open it and you are in.
              </p>
              <div class="after-send">
                <p class="sw-subtle small">
                  Nothing arrived? Check the spam folder, then ask for another link — the previous
                  one stops working when a new one is sent.
                </p>
                <button mat-stroked-button type="button" [disabled]="busy()" (click)="resend()">
                  Send another link
                </button>
                <button mat-button type="button" class="switch-back" (click)="backToSignIn()">
                  Back to sign in
                </button>
              </div>
            } @else {
              <p class="tagline sw-muted">
                {{
                  mode() === 'login'
                    ? 'Sign in to see which of your jobs are still checking in.'
                    : 'Create an account. The first one on a fresh instance is always allowed.'
                }}
              </p>

              <form [formGroup]="form" (ngSubmit)="submit()">
              @if (mode() === 'register') {
                <mat-form-field appearance="outline">
                  <mat-label>Name</mat-label>
                  <input matInput formControlName="name" autocomplete="name" />
                </mat-form-field>
              }

              <mat-form-field appearance="outline">
                <mat-label>Email</mat-label>
                <input matInput type="email" formControlName="email" autocomplete="email" required />
                @if (form.controls.email.touched && form.controls.email.invalid) {
                  <mat-error>Enter a valid email address</mat-error>
                }
              </mat-form-field>

              <mat-form-field appearance="outline">
                <mat-label>Password</mat-label>
                <input
                  matInput
                  type="password"
                  formControlName="password"
                  [autocomplete]="mode() === 'login' ? 'current-password' : 'new-password'"
                  required
                />
                <mat-hint>{{ minLength }} characters minimum</mat-hint>
                @if (form.controls.password.touched && form.controls.password.invalid) {
                  <mat-error>At least {{ minLength }} characters</mat-error>
                }
              </mat-form-field>

              @if (error()) {
                <p class="sw-error" role="alert">
                  <span>
                    {{ error() }}
                    @if (verificationPending()) {
                      <button type="button" class="inline-link" (click)="resend()">
                        Send the link again
                      </button>
                    }
                  </span>
                </p>
              }

              <button mat-flat-button type="submit" [disabled]="busy()" class="submit">
                @if (working()) {
                  {{ workingLabel() }}
                } @else {
                  {{ mode() === 'login' ? 'Sign in' : 'Create account' }}
                }
              </button>
              </form>

              @if (mode() === 'login') {
                <button type="button" class="forgot" [disabled]="busy()" (click)="forgotPassword()">
                  Forgot your password?
                </button>
              }
            }
          </div>

          @if (sentTo() === null && resetSentTo() === null) {
            <div class="card-foot">
              <span class="sw-muted">{{
                mode() === 'login' ? 'No account yet?' : 'Already registered?'
              }}</span>
              <button type="button" class="switch" (click)="toggleMode()">
                {{ mode() === 'login' ? 'Create one' : 'Sign in' }}
              </button>
            </div>
          }
        </div>

        <p class="footnote sw-subtle">Dead man's switch monitoring for the jobs nobody watches.</p>
      </div>
    </div>
  `,
  styles: `
    .wrap {
      display: grid;
      place-items: center;
      min-height: 100dvh;
      padding: 24px;
      /* A single faint wash behind the card: enough to keep the page from
         reading as an unstyled form, quiet enough not to compete with it. */
      background:
        radial-gradient(60rem 30rem at 50% -10%, var(--sw-accent-soft), transparent 70%),
        var(--sw-bg);
    }

    .panel {
      width: min(420px, 100%);
    }

    .card {
      overflow: hidden;
      box-shadow: var(--sw-shadow-lg);
    }

    .progress {
      position: absolute;
      inset: 0 0 auto;
    }

    .card-body {
      position: relative;
      padding: 32px 28px 24px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .mark {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      border-radius: 10px;
      color: #fff;
      background: linear-gradient(145deg, var(--sw-accent), color-mix(in srgb, var(--sw-accent) 55%, #7c3aed));
    }

    h1 {
      margin: 0;
      font-size: 1.25rem;
      font-weight: 600;
      letter-spacing: -0.02em;
    }

    .wordmark-accent {
      color: var(--sw-text-muted);
      font-weight: 500;
    }

    .tagline {
      margin: 14px 0 24px;
      font-size: 0.9375rem;
      line-height: 1.5;
    }

    form {
      display: flex;
      flex-direction: column;
    }

    .submit {
      height: 46px;
      margin-top: 10px;
      font-weight: 600;
    }

    .card-foot {
      display: flex;
      align-items: center;
      justify-content: center;
      gap: 6px;
      padding: 16px;
      border-top: 1px solid var(--sw-border);
      background: var(--sw-surface-2);
      font-size: 0.875rem;
    }

    .switch {
      padding: 2px 4px;
      border: 0;
      background: none;
      color: var(--sw-accent);
      font: inherit;
      font-weight: 600;
      cursor: pointer;
    }

    .switch:hover {
      text-decoration: underline;
    }

    .footnote {
      margin: 20px 0 0;
      font-size: 0.8125rem;
      text-align: center;
    }

    /* ------------------------------------------------ verification sent --- */

    .address {
      color: var(--sw-text);
      /* break-all would split "new-user@exa / mple.test" mid-word; anywhere only
         breaks when there is no other option, so the address stays readable. */
      overflow-wrap: anywhere;
    }

    .after-send {
      display: flex;
      flex-direction: column;
      gap: 10px;
      align-items: stretch;
    }

    .small {
      margin: 0 0 6px;
      font-size: 0.8125rem;
      line-height: 1.5;
    }

    .switch-back {
      width: 100%;
    }

    .forgot {
      margin-top: 14px;
      padding: 4px;
      border: 0;
      background: none;
      color: var(--sw-text-muted);
      font: inherit;
      font-size: 0.8125rem;
      cursor: pointer;
    }

    .forgot:hover:not(:disabled) {
      color: var(--sw-accent);
      text-decoration: underline;
    }

    .inline-link {
      padding: 0 0 0 4px;
      border: 0;
      background: none;
      color: inherit;
      font: inherit;
      font-weight: 600;
      text-decoration: underline;
      cursor: pointer;
    }
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly projects = inject(ProjectStore);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);
  private readonly challenge = inject(SignupChallengeService);

  protected readonly minLength = LIMITS.passwordMin;
  protected readonly mode = signal<'login' | 'register'>('login');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  /** Set once a confirmation link has gone out; swaps the card for its "sent" state. */
  protected readonly sentTo = signal<string | null>(null);

  /** Same, for a password reset. Kept apart because the wording must differ. */
  protected readonly resetSentTo = signal<string | null>(null);

  /** True when the server refused a sign-in because the address is unconfirmed. */
  protected readonly verificationPending = signal(false);

  /** What the submit button is doing, when it is doing something slow. */
  protected readonly working = signal<'challenge' | 'request' | null>(null);

  protected readonly workingLabel = computed(() =>
    this.working() === 'challenge' ? 'Checking your browser…' : 'Working…',
  );

  protected readonly form = this.formBuilder.nonNullable.group({
    name: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(LIMITS.passwordMin)]],
  });

  protected toggleMode(): void {
    this.mode.update((mode) => (mode === 'login' ? 'register' : 'login'));
    this.error.set(null);
    this.verificationPending.set(false);
  }

  protected backToSignIn(): void {
    this.sentTo.set(null);
    this.resetSentTo.set(null);
    this.mode.set('login');
    this.error.set(null);
    this.form.patchValue({ password: '' });
  }

  /**
   * Asks for a reset link.
   *
   * Only the address is needed, so an invalid password does not block it — the
   * person who cannot remember their password is exactly who needs this button.
   */
  protected forgotPassword(): void {
    const email = this.form.getRawValue().email.trim();
    if (email === '') {
      this.form.controls.email.markAsTouched();
      this.error.set('Enter your email address first.');
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.auth.forgotPassword(email).subscribe({
      next: () => {
        this.busy.set(false);
        this.resetSentTo.set(email);
      },
      error: (failure: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(failure, 'Could not send the link right now. Try again shortly.'));
      },
    });
  }

  protected submit(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.verificationPending.set(false);

    if (this.mode() === 'login') {
      this.run(this.auth.login(this.form.getRawValue()));
      return;
    }

    void this.submitRegistration();
  }

  /**
   * Registration first asks the instance what work it wants. On a self-hosted
   * instance the answer is "none" and this costs one request; on the hosted one
   * it costs a fraction of a second of CPU, which is the point.
   */
  private async submitRegistration(): Promise<void> {
    this.working.set('challenge');
    const powSolution = await this.challenge.solve();
    this.working.set('request');

    const { name, email, password } = this.form.getRawValue();
    this.run(
      this.auth.register({
        email,
        password,
        ...(name.trim() === '' ? {} : { name }),
        ...(powSolution === undefined ? {} : { powSolution }),
      }),
    );
  }

  private run(request: Observable<SessionDto | RegisterResponse>): void {
    request.subscribe({
      next: (result) => {
        this.busy.set(false);
        this.working.set(null);

        // Registration with verification on returns no session: the account
        // exists, but nothing is signed in and there is nowhere to navigate to.
        if ('status' in result && result.status === 'verification_sent') {
          this.sentTo.set(result.email);
          return;
        }

        // A fresh session means a fresh project list.
        this.projects.clear();
        this.projects.load(true);
        void this.router.navigateByUrl(this.nextUrl());
      },
      error: (failure: unknown) => {
        this.busy.set(false);
        this.working.set(null);
        this.verificationPending.set(isVerificationPending(failure));
        this.error.set(
          errorMessage(failure, 'Sign-in failed. Check your credentials and try again.'),
        );
      },
    });
  }

  /**
   * Asks for another link. Deliberately optimistic: the endpoint answers the
   * same way whether or not the address exists, so there is no outcome to
   * report beyond "we did what you asked".
   */
  protected resend(): void {
    const email = this.sentTo() ?? this.form.getRawValue().email;
    if (email === '') return;

    this.busy.set(true);
    this.auth.resendVerification(email).subscribe({
      next: () => {
        this.busy.set(false);
        this.error.set(null);
        this.verificationPending.set(false);
        this.sentTo.set(email);
      },
      error: () => {
        this.busy.set(false);
        this.error.set('Could not send the link right now. Try again in a minute.');
      },
    });
  }

  private nextUrl(): string {
    const next = new URLSearchParams(window.location.search).get('next');
    // Only same-site paths: a "next" pointing elsewhere would be an open redirect.
    return next !== null && next.startsWith('/') && !next.startsWith('//') ? next : '/checks';
  }
}
