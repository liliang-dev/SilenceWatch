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
  templateUrl: './login.component.html',
  styleUrl: './login.component.scss',
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
