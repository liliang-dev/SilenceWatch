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
  templateUrl: './reset-password.component.html',
  styleUrl: './reset-password.component.scss',
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
