import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LIMITS, type ApiKeyDto, type AuditEventDto, type CreatedApiKeyDto } from '@silencewatch/shared';
import { catchError, forkJoin, of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/error-message';
import { ProjectStore } from '../../core/project.store';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { IconComponent } from '../../shared/icon.component';

/** Human wording for the audit actions, so the table reads as prose. */
const AUDIT_LABELS: Record<string, string> = {
  'auth.login': 'Signed in',
  'auth.login_failed': 'Sign-in failed',
  'auth.logout': 'Signed out',
  'auth.password_changed': 'Password changed',
  'auth.password_reset_requested': 'Password reset requested',
  'auth.password_reset_completed': 'Password reset',
  'auth.email_verified': 'Email confirmed',
  'account.registered': 'Account created',
  'api_key.created': 'API key created',
  'api_key.revoked': 'API key revoked',
  'channel.created': 'Alert channel added',
  'channel.updated': 'Alert channel changed',
  'channel.deleted': 'Alert channel removed',
  'channel.tested': 'Alert channel tested',
  'check.created': 'Check created',
  'check.deleted': 'Check deleted',
  'check.ping_key_rotated': 'Ping URL rotated',
  'project.created': 'Project created',
  'project.updated': 'Project changed',
  'quota.checks_paused': 'Checks paused by plan limit',
};

/**
 * Project and account settings: API keys (used by the client starters), the
 * password, and the record of what has been done to both.
 */
@Component({
  selector: 'sw-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatTooltipModule,
    RelativeTimePipe,
  ],
  template: `
    <div class="sw-page">
      <header class="sw-page-header">
        <div>
          <h1>Settings</h1>
          <p class="sw-muted">Keys for the client starters, and your account.</p>
        </div>
      </header>

      @if (error()) {
        <p class="sw-error" role="alert">{{ error() }}</p>
      }

      <section class="sw-card section">
        <div class="section-head">
          <h2>API keys</h2>
          <p class="sw-muted">
            Used by the REST API and by the client starters. A key is scoped to this project and cannot
            create other keys.
          </p>
        </div>

        <div class="section-body">
          @if (createdKey(); as created) {
            <!-- Shown once, and said so plainly: the secret is not stored in a
                 recoverable form and there is no second chance to copy it. -->
            <div class="new-key">
              <p class="new-key-title">Copy this key now — it is never shown again.</p>
              <div class="key-row">
                <code class="sw-mono">{{ created.token }}</code>
                <button mat-icon-button (click)="copy(created.token)" aria-label="Copy API key">
                  <sw-icon name="copy" />
                </button>
              </div>
            </div>
          }

          <form [formGroup]="keyForm" (ngSubmit)="createKey()" class="inline-form">
            <mat-form-field appearance="outline">
              <mat-label>Key name</mat-label>
              <input matInput formControlName="name" placeholder="spring-boot-starter" required />
            </mat-form-field>
            <button mat-flat-button type="submit" [disabled]="busy()" class="tall">Create key</button>
          </form>
        </div>

        @if (apiKeys().length === 0) {
          <p class="section-note sw-muted">No API key yet.</p>
        } @else {
          <div class="sw-scroll-x bordered">
            <table class="sw-table">
              <thead>
                <tr>
                  <th scope="col">Name</th>
                  <th scope="col">Prefix</th>
                  <th scope="col">Last used</th>
                  <th scope="col">Created</th>
                  <th scope="col"><span class="visually-hidden">Actions</span></th>
                </tr>
              </thead>
              <tbody>
                @for (key of apiKeys(); track key.id) {
                  <tr [class.revoked]="key.revokedAt">
                    <td>{{ key.name }}</td>
                    <td class="sw-mono sw-muted">{{ key.prefix }}…</td>
                    <td>{{ key.lastUsedAt | swRelativeTime }}</td>
                    <td class="sw-muted">{{ key.createdAt | swRelativeTime }}</td>
                    <td class="right">
                      @if (key.revokedAt) {
                        <span class="sw-tag">revoked</span>
                      } @else {
                        <button mat-button class="danger" (click)="revoke(key)">Revoke</button>
                      }
                    </td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <section class="sw-card section">
        <div class="section-head">
          <h2>Password</h2>
          <p class="sw-muted">Changing it signs you out everywhere, including here.</p>
        </div>
        <div class="section-body">
          <form [formGroup]="passwordForm" (ngSubmit)="changePassword()" class="password-form">
            <mat-form-field appearance="outline">
              <mat-label>Current password</mat-label>
              <input matInput type="password" formControlName="currentPassword" autocomplete="current-password" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>New password</mat-label>
              <input matInput type="password" formControlName="newPassword" autocomplete="new-password" />
              <mat-hint>{{ minLength }} characters minimum</mat-hint>
            </mat-form-field>
            <button mat-flat-button type="submit" [disabled]="busy()" class="tall">Change password</button>
          </form>
        </div>
      </section>

      <!-- Read-only, and admin-only on the server. The trail carries addresses
           and user agents; it is for the people already trusted with the
           project's keys, not for everyone in it. -->
      <section class="sw-card section">
        <div class="section-head">
          <h2>Security activity</h2>
          <p class="sw-muted">
            Who did what, kept for a year. Sign-ins and password changes are yours; key and
            channel changes belong to the project.
          </p>
        </div>

        @if (auditEvents().length === 0) {
          <p class="section-note sw-muted">Nothing recorded yet.</p>
        } @else {
          <div class="sw-scroll-x bordered">
            <table class="sw-table">
              <thead>
                <tr>
                  <th scope="col">When</th>
                  <th scope="col">Action</th>
                  <th scope="col">Who</th>
                  <th scope="col">Target</th>
                  <th scope="col">From</th>
                </tr>
              </thead>
              <tbody>
                @for (event of auditEvents(); track event.id) {
                  <tr>
                    <td [matTooltip]="event.occurredAt">{{ event.occurredAt | swRelativeTime }}</td>
                    <td>
                      <span class="action" [class.danger-text]="isFailure(event.action)">{{
                        label(event.action)
                      }}</span>
                    </td>
                    <td class="sw-muted">
                      {{ event.actorEmail ?? '—' }}
                      @if (event.actorIsApiKey) {
                        <span class="sw-tag">API key</span>
                      }
                    </td>
                    <td class="sw-muted">{{ event.targetLabel ?? '—' }}</td>
                    <td class="sw-mono sw-muted">{{ event.ip ?? '—' }}</td>
                  </tr>
                }
              </tbody>
            </table>
          </div>
        }
      </section>

      <section class="sw-card section">
        <div class="section-head">
          <h2>Account</h2>
        </div>
        <dl class="section-body facts">
          <div>
            <dt class="sw-label">Signed in as</dt>
            <dd>{{ auth.user()?.email }}</dd>
          </div>
          <div>
            <dt class="sw-label">Project</dt>
            <dd>{{ projects.selected()?.name ?? '—' }}</dd>
          </div>
          <div>
            <dt class="sw-label">Checks</dt>
            <dd class="sw-num">{{ projects.selected()?.checkCount ?? 0 }}</dd>
          </div>
        </dl>
      </section>
    </div>
  `,
  styles: `
    .section {
      margin-bottom: 20px;
      overflow: hidden;
    }

    .section-head {
      padding: 18px 20px 0;
    }

    .section-head p {
      max-width: 64ch;
      margin: 6px 0 0;
      font-size: 0.875rem;
    }

    .section-body {
      padding: 16px 20px 20px;
    }

    .section-note {
      padding: 0 20px 20px;
      font-size: 0.875rem;
    }

    .bordered {
      border-top: 1px solid var(--sw-border);
    }

    .inline-form,
    .password-form {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: flex-start;
    }

    .inline-form mat-form-field {
      flex: 1 1 260px;
      max-width: 360px;
    }

    .password-form mat-form-field {
      flex: 1 1 240px;
    }

    .tall {
      height: 52px;
    }

    .new-key {
      margin-bottom: 18px;
      padding: 14px 16px;
      border: 1px solid color-mix(in srgb, var(--sw-accent) 32%, transparent);
      border-radius: var(--sw-radius);
      background: var(--sw-accent-soft);
    }

    .new-key-title {
      margin: 0 0 8px;
      color: var(--sw-accent);
      font-size: 0.8125rem;
      font-weight: 600;
    }

    .key-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .key-row code {
      flex: 1 1 auto;
      min-width: 0;
      padding: 8px 10px;
      border-radius: var(--sw-radius-sm);
      background: var(--sw-surface);
      overflow-x: auto;
      white-space: nowrap;
    }

    td.right {
      text-align: right;
    }

    /* Material sets the label colour from its own token, so a plain "color"
       declaration here would lose to it. */
    .danger {
      --mat-text-button-label-text-color: var(--sw-down);
    }

    tr.revoked {
      opacity: 0.5;
    }

    .facts {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
      gap: 16px;
      margin: 0;
    }

    .facts dd {
      margin: 4px 0 0;
      font-weight: 500;
    }

    .action {
      font-weight: 500;
    }

    /* Failed sign-ins are the line somebody is scanning for. */
    .danger-text {
      color: var(--sw-down);
    }

    .visually-hidden {
      position: absolute;
      width: 1px;
      height: 1px;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
    }
  `,
})
export class SettingsComponent {
  private readonly api = inject(ApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly auth = inject(AuthService);
  protected readonly projects = inject(ProjectStore);

  protected readonly minLength = LIMITS.passwordMin;
  protected readonly apiKeys = signal<ApiKeyDto[]>([]);
  protected readonly auditEvents = signal<AuditEventDto[]>([]);
  protected readonly createdKey = signal<CreatedApiKeyDto | null>(null);
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly keyForm = this.formBuilder.nonNullable.group({
    name: ['', Validators.required],
  });

  protected readonly passwordForm = this.formBuilder.nonNullable.group({
    currentPassword: ['', Validators.required],
    newPassword: ['', [Validators.required, Validators.minLength(LIMITS.passwordMin)]],
  });

  constructor() {
    this.projects.load();
    effect(() => {
      const project = this.projects.selected();
      if (project !== null) {
        this.loadKeys(project.id);
        this.loadAudit(project.id);
      }
    });
  }

  private loadKeys(projectId: string): void {
    this.api.listApiKeys(projectId).subscribe({
      next: (keys) => this.apiKeys.set(keys),
      error: (failure: unknown) => this.error.set(errorMessage(failure, 'Could not load API keys.')),
    });
  }

  /**
   * Account events and project events in one list.
   *
   * They live in separate endpoints because they have separate access rules —
   * your own sign-ins are yours, the project's key changes need admin — but a
   * reader looking for "what happened" should not have to know that.
   */
  private loadAudit(projectId: string): void {
    forkJoin({
      account: this.api.listAccountAudit(40),
      project: this.api
        .listProjectAudit(projectId, 40)
        // A member without the admin role simply sees fewer rows, rather than
        // an error on a page that is otherwise about their own account.
        .pipe(catchError(() => of({ items: [] as AuditEventDto[], nextCursor: null }))),
    }).subscribe({
      next: ({ account, project }) => {
        const merged = [...account.items, ...project.items].sort((a, b) =>
          b.occurredAt.localeCompare(a.occurredAt),
        );
        this.auditEvents.set(merged.slice(0, 60));
      },
      error: () => this.auditEvents.set([]),
    });
  }

  /** "auth.login_failed" reads as noise; "Sign-in failed" reads as a sentence. */
  protected label(action: string): string {
    return AUDIT_LABELS[action] ?? action;
  }

  protected isFailure(action: string): boolean {
    return action === 'auth.login_failed' || action === 'quota.checks_paused';
  }

  protected createKey(): void {
    const project = this.projects.selected();
    if (project === null || this.keyForm.invalid || this.busy()) return;

    this.busy.set(true);
    this.error.set(null);

    this.api.createApiKey(project.id, { name: this.keyForm.getRawValue().name }).subscribe({
      next: (created) => {
        this.createdKey.set(created);
        this.apiKeys.update((keys) => [created, ...keys]);
        this.keyForm.reset({ name: '' });
        this.busy.set(false);
      },
      error: (failure: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(failure, 'Could not create the key.'));
      },
    });
  }

  protected revoke(key: ApiKeyDto): void {
    if (!window.confirm(`Revoke "${key.name}"? Anything using it stops working immediately.`)) return;

    this.api.revokeApiKey(key.projectId, key.id).subscribe({
      next: () => {
        this.apiKeys.update((keys) =>
          keys.map((existing) =>
            existing.id === key.id ? { ...existing, revokedAt: new Date().toISOString() } : existing,
          ),
        );
        this.snackBar.open('Key revoked', 'OK', { duration: 3000 });
      },
      error: (failure: unknown) => this.error.set(errorMessage(failure, 'Could not revoke the key.')),
    });
  }

  protected changePassword(): void {
    if (this.passwordForm.invalid || this.busy()) {
      this.passwordForm.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    this.auth.changePassword(this.passwordForm.getRawValue()).subscribe({
      next: () => {
        this.busy.set(false);
        this.snackBar.open('Password changed — sign in again', 'OK', { duration: 5000 });
        this.auth.logout();
      },
      error: (failure: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(failure, 'Could not change the password.'));
      },
    });
  }

  protected copy(text: string): void {
    void navigator.clipboard
      .writeText(text)
      .then(() => this.snackBar.open('Copied', 'OK', { duration: 2000 }))
      .catch(() => this.snackBar.open('Could not copy — select the text manually', 'OK', { duration: 4000 }));
  }
}
