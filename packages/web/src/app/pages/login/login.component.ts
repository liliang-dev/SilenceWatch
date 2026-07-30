import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
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
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    MatButtonModule,
    MatProgressBarModule,
  ],
  template: `
    <div class="wrap">
      <mat-card appearance="outlined" class="card">
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" />
        }

        <mat-card-content>
          <div class="brand">
            <span class="pulse" aria-hidden="true"></span>
            <h1>SilenceWatch</h1>
          </div>
          <p class="sw-muted tagline">
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

          <button mat-button type="button" class="switch" (click)="toggleMode()">
            {{ mode() === 'login' ? 'Create an account' : 'I already have an account' }}
          </button>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .wrap {
      display: grid;
      place-items: center;
      min-height: 100dvh;
      padding: 24px;
    }

    .card {
      width: min(420px, 100%);
      overflow: hidden;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 10px;
      margin-top: 8px;
    }

    h1 {
      margin: 0;
      font-size: 1.35rem;
      font-weight: 600;
    }

    .pulse {
      width: 10px;
      height: 10px;
      border-radius: 50%;
      background: var(--sw-state-up);
    }

    .tagline {
      margin: 8px 0 24px;
      font-size: 0.9rem;
      line-height: 1.45;
    }

    form {
      display: flex;
      flex-direction: column;
    }

    .submit {
      margin-top: 8px;
      height: 44px;
    }

    .switch {
      width: 100%;
      margin-top: 12px;
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
