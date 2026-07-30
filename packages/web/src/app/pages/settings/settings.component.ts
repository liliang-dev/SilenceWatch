import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatCardModule } from '@angular/material/card';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSnackBar } from '@angular/material/snack-bar';
import { LIMITS, type ApiKeyDto, type CreatedApiKeyDto } from '@silencewatch/shared';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/error-message';
import { ProjectStore } from '../../core/project.store';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { IconComponent } from '../../shared/icon.component';

/**
 * Project and account settings: API keys (used by the client starters), and the
 * password.
 */
@Component({
  selector: 'sw-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    ReactiveFormsModule,
    MatButtonModule,
    MatCardModule,
    MatFormFieldModule,
    MatInputModule,
    RelativeTimePipe,
  ],
  template: `
    <div class="sw-page">
      <header class="sw-page-header">
        <h1>Settings</h1>
      </header>

      @if (error()) {
        <p class="sw-error" role="alert">{{ error() }}</p>
      }

      <mat-card appearance="outlined" class="section">
        <mat-card-header>
          <mat-card-title>API keys</mat-card-title>
          <mat-card-subtitle>
            Used by the REST API and by the client starters. A key is scoped to this project and
            cannot create other keys.
          </mat-card-subtitle>
        </mat-card-header>

        <mat-card-content>
          @if (createdKey(); as created) {
            <div class="new-key">
              <p><strong>Copy this key now — it is never shown again.</strong></p>
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
            <button mat-flat-button type="submit" [disabled]="busy()">Create key</button>
          </form>

          @if (apiKeys().length === 0) {
            <p class="sw-muted">No API key yet.</p>
          } @else {
            <div class="sw-scroll-x">
              <table>
                <thead>
                  <tr>
                    <th scope="col">Name</th>
                    <th scope="col">Prefix</th>
                    <th scope="col">Last used</th>
                    <th scope="col">Created</th>
                    <th scope="col"></th>
                  </tr>
                </thead>
                <tbody>
                  @for (key of apiKeys(); track key.id) {
                    <tr [class.revoked]="key.revokedAt">
                      <td>{{ key.name }}</td>
                      <td class="sw-mono">{{ key.prefix }}…</td>
                      <td>{{ key.lastUsedAt | swRelativeTime }}</td>
                      <td>{{ key.createdAt | swRelativeTime }}</td>
                      <td class="right">
                        @if (key.revokedAt) {
                          <span class="sw-muted">revoked</span>
                        } @else {
                          <button mat-button (click)="revoke(key)">Revoke</button>
                        }
                      </td>
                    </tr>
                  }
                </tbody>
              </table>
            </div>
          }
        </mat-card-content>
      </mat-card>

      <mat-card appearance="outlined" class="section">
        <mat-card-header>
          <mat-card-title>Password</mat-card-title>
          <mat-card-subtitle>Changing it signs you out everywhere, including here.</mat-card-subtitle>
        </mat-card-header>
        <mat-card-content>
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
            <button mat-flat-button type="submit" [disabled]="busy()">Change password</button>
          </form>
        </mat-card-content>
      </mat-card>

      <mat-card appearance="outlined" class="section">
        <mat-card-header>
          <mat-card-title>Account</mat-card-title>
        </mat-card-header>
        <mat-card-content>
          <p class="sw-muted">Signed in as {{ auth.user()?.email }}</p>
          <p class="sw-muted">
            Project: {{ projects.selected()?.name ?? '—' }} · Checks:
            {{ projects.selected()?.checkCount ?? 0 }}
          </p>
        </mat-card-content>
      </mat-card>
    </div>
  `,
  styles: `
    .section {
      margin-bottom: 20px;
    }

    .inline-form {
      display: flex;
      gap: 12px;
      align-items: flex-start;
      margin: 8px 0 16px;
    }

    .inline-form button,
    .password-form button {
      height: 56px;
    }

    .password-form {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: flex-start;
    }

    .new-key {
      margin-bottom: 16px;
      padding: 12px 16px;
      border-radius: 8px;
      background: var(--mat-sys-primary-container);
      color: var(--mat-sys-on-primary-container);
    }

    .key-row {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .key-row code {
      overflow-x: auto;
      white-space: nowrap;
    }

    th {
      text-align: left;
      padding: 8px 12px;
      font-size: 0.75rem;
      text-transform: uppercase;
      letter-spacing: 0.04em;
      color: var(--mat-sys-on-surface-variant);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    td {
      padding: 10px 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      font-size: 0.875rem;
    }

    td.right {
      text-align: right;
    }

    tr.revoked {
      opacity: 0.55;
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
      if (project !== null) this.loadKeys(project.id);
    });
  }

  private loadKeys(projectId: string): void {
    this.api.listApiKeys(projectId).subscribe({
      next: (keys) => this.apiKeys.set(keys),
      error: (failure: unknown) => this.error.set(errorMessage(failure, 'Could not load API keys.')),
    });
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
