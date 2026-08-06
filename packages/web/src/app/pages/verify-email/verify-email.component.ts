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
  template: `
    <div class="wrap">
      <div class="card sw-card">
        @if (state() === 'working') {
          <mat-progress-bar mode="indeterminate" class="progress" />
        }

        <div class="body">
          @switch (state()) {
            @case ('working') {
              <h1>Confirming your address…</h1>
              <p class="sw-muted">This takes a second.</p>
            }
            @case ('done') {
              <span class="glyph ok" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                  <path d="M9 16.17 4.83 12l-1.42 1.41L9 19 21 7l-1.41-1.41z" />
                </svg>
              </span>
              <h1>Address confirmed</h1>
              <p class="sw-muted">Your account is ready. Sign in and start watching your jobs.</p>
              <a mat-flat-button routerLink="/login" class="action">Sign in</a>
            }
            @case ('failed') {
              <span class="glyph bad" aria-hidden="true">
                <svg viewBox="0 0 24 24" width="26" height="26" fill="currentColor">
                  <path
                    d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m1 15h-2v-2h2zm0-4h-2V7h2z"
                  />
                </svg>
              </span>
              <h1>This link no longer works</h1>
              <p class="sw-muted">{{ error() }}</p>
              <a mat-flat-button routerLink="/login" class="action">Back to sign in</a>
            }
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
      padding: 36px 28px 32px;
      text-align: center;
    }

    .glyph {
      display: grid;
      place-items: center;
      width: 52px;
      margin: 0 auto 18px;
      border-radius: 50%;
    }

    .glyph.ok {
      background: var(--sw-up-soft);
      color: var(--sw-up);
    }

    .glyph.bad {
      background: var(--sw-down-soft);
      color: var(--sw-down);
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

    /* A button that happens to be an anchor: it should not carry link underlines. */
    .action,
    .action:hover {
      margin-top: 24px;
      min-width: 160px;
      text-decoration: none;
    }
  `,
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
