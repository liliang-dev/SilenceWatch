import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router } from '@angular/router';
import { LIMITS } from '@silencewatch/shared';
import { ProjectStore } from '../../core/project.store';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/error-message';

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
                <p class="sw-error" role="alert">{{ error() }}</p>
              }

              <button mat-flat-button type="submit" [disabled]="busy()" class="submit">
                {{ mode() === 'login' ? 'Sign in' : 'Create account' }}
              </button>
            </form>
          </div>

          <div class="card-foot">
            <span class="sw-muted">{{ mode() === 'login' ? 'No account yet?' : 'Already registered?' }}</span>
            <button type="button" class="switch" (click)="toggleMode()">
              {{ mode() === 'login' ? 'Create one' : 'Sign in' }}
            </button>
          </div>
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
  `,
})
export class LoginComponent {
  private readonly auth = inject(AuthService);
  private readonly projects = inject(ProjectStore);
  private readonly router = inject(Router);
  private readonly formBuilder = inject(FormBuilder);

  protected readonly minLength = LIMITS.passwordMin;
  protected readonly mode = signal<'login' | 'register'>('login');
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    name: [''],
    email: ['', [Validators.required, Validators.email]],
    password: ['', [Validators.required, Validators.minLength(LIMITS.passwordMin)]],
  });

  protected toggleMode(): void {
    this.mode.update((mode) => (mode === 'login' ? 'register' : 'login'));
    this.error.set(null);
  }

  protected submit(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    const { name, email, password } = this.form.getRawValue();
    const request =
      this.mode() === 'login'
        ? this.auth.login({ email, password })
        : this.auth.register({ email, password, ...(name.trim() === '' ? {} : { name }) });

    request.subscribe({
      next: () => {
        this.busy.set(false);
        // A fresh session means a fresh project list.
        this.projects.clear();
        this.projects.load(true);
        void this.router.navigateByUrl(this.nextUrl());
      },
      error: (failure: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(failure, 'Sign-in failed. Check your credentials and try again.'));
      },
    });
  }

  private nextUrl(): string {
    const next = new URLSearchParams(window.location.search).get('next');
    // Only same-site paths: a "next" pointing elsewhere would be an open redirect.
    return next !== null && next.startsWith('/') && !next.startsWith('//') ? next : '/checks';
  }
}
