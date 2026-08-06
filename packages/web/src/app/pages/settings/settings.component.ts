import {
  ChangeDetectionStrategy,
  Component,
  effect,
  inject,
  signal,
  viewChild,
} from '@angular/core';
import { FormBuilder, FormGroupDirective, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import {
  LIMITS,
  type ApiKeyDto,
  type AuditEventDto,
  type CreatedApiKeyDto,
  type ProjectDto,
} from '@silencewatch/shared';
import { catchError, forkJoin, of } from 'rxjs';
import { ApiService } from '../../core/api.service';
import { AuthService } from '../../core/auth.service';
import { errorMessage } from '../../core/error-message';
import { ProjectStore } from '../../core/project.store';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { IconComponent } from '../../shared/icon.component';
import { ConfirmDialog, type ConfirmData } from '../../shared/confirm.dialog';
import { ProjectFormDialog, type ProjectFormData } from './project-form.dialog';

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
    MatTabsModule,
    MatTooltipModule,
    RelativeTimePipe,
  ],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private readonly api = inject(ApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialog = inject(MatDialog);
  protected readonly auth = inject(AuthService);
  protected readonly projects = inject(ProjectStore);

  protected readonly minLength = LIMITS.passwordMin;
  protected readonly apiKeys = signal<ApiKeyDto[]>([]);
  protected readonly auditEvents = signal<AuditEventDto[]>([]);
  protected readonly createdKey = signal<CreatedApiKeyDto | null>(null);
  protected readonly busy = signal(false);
  protected readonly projectBusy = signal(false);
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

  /* --------------------------------------------------------- projects --- */

  protected createProject(): void {
    this.openProjectForm({}).subscribe((name) => {
      if (name === undefined) return;

      this.projectBusy.set(true);
      this.error.set(null);
      this.api.createProject(name).subscribe({
        next: (project) => {
          this.projects.add(project);
          this.projectBusy.set(false);
          this.snackBar.open(`"${project.name}" created`, 'OK', { duration: 4000 });
        },
        error: (failure: unknown) => {
          this.projectBusy.set(false);
          this.error.set(errorMessage(failure, 'Could not create the project.'));
        },
      });
    });
  }

  protected renameProject(project: ProjectDto): void {
    this.openProjectForm({ project }).subscribe((name) => {
      if (name === undefined) return;

      this.api.updateProject(project.id, { name }).subscribe({
        next: (updated) => {
          this.projects.replace(updated);
          this.snackBar.open('Project renamed', 'OK', { duration: 3000 });
        },
        error: (failure: unknown) =>
          this.error.set(errorMessage(failure, 'Could not rename the project.')),
      });
    });
  }

  /** Resolves with the name, or undefined when the dialog was dismissed. */
  private openProjectForm(data: ProjectFormData) {
    return this.dialog.open(ProjectFormDialog, { data, autoFocus: false }).afterClosed();
  }

  /**
   * Deleting a project destroys every check, ping and incident in it, so the
   * confirmation says how many rather than asking "are you sure?".
   *
   * The button is also disabled on the last project, but that is the courtesy
   * — the server refuses it with a 409 regardless, which is what actually
   * guarantees an account is never left without one.
   */
  protected deleteProject(project: ProjectDto): void {
    const checks = project.checkCount ?? 0;
    const data: ConfirmData = {
      title: `Delete "${project.name}"?`,
      message:
        checks === 0
          ? 'This project has no checks. Deleting it cannot be undone.'
          : `This deletes ${checks} check${checks === 1 ? '' : 's'} with every ping and incident recorded against them. It cannot be undone.`,
      confirmLabel: 'Delete project',
      destructive: true,
    };

    this.dialog
      .open(ConfirmDialog, { data, autoFocus: false })
      .afterClosed()
      .subscribe((confirmed) => {
        if (confirmed !== true) return;

        this.api.deleteProject(project.id).subscribe({
          next: () => {
            this.projects.remove(project.id);
            this.snackBar.open(`"${project.name}" deleted`, 'OK', { duration: 4000 });
          },
          error: (failure: unknown) =>
            this.error.set(errorMessage(failure, 'Could not delete the project.')),
        });
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
