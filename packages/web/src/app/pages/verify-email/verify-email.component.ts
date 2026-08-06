import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { Router, RouterLink } from '@angular/router';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/error-message';

/**
 * The page the emailed confirmation link lands on.
 *
 * The link is a GET to this route and nothing more; the state change is the
 * POST this component makes. Corporate mail scanners, link previewers and
 * antivirus proxies fetch every URL in an inbound message, and a single-use
 * token consumed by a GET would be spent before the recipient saw the mail —
 * with a failure that looks exactly like an attack.
 */
@Component({
  selector: 'sw-verify-email',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [RouterLink, MatButtonModule, MatProgressBarModule],
  templateUrl: './verify-email.component.html',
  styleUrl: './verify-email.component.scss',
})
export class VerifyEmailComponent {
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);

  protected readonly state = signal<'working' | 'done' | 'failed'>('working');
  protected readonly error = signal('');

  constructor() {
    // Read from the raw query string rather than through route inputs: this
    // page is reached from outside the application, and the token must not
    // survive in the router's state after being spent.
    const token = new URLSearchParams(window.location.search).get('token') ?? '';

    if (token === '') {
      this.fail('That link is missing its confirmation code. Open the one from the email directly.');
      return;
    }

    this.auth.verifyEmail(token).subscribe({
      next: () => {
        this.state.set('done');
        // Drop the token from the address bar so it is not left in history, in
        // a bookmark, or in whatever the next page sends as a referrer.
        void this.router.navigate([], { replaceUrl: true });
      },
      error: (failure: unknown) =>
        this.fail(
          errorMessage(
            failure,
            'This confirmation link is no longer valid. Request a new one from the sign-in page.',
          ),
        ),
    });
  }

  private fail(message: string): void {
    this.error.set(message);
    this.state.set('failed');
  }
}
