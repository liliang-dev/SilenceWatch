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
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { FormsModule } from '@angular/forms';
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
import { confirmWith } from '../../shared/confirm.dialog';
import { DataTable, PAGE_SIZES } from '../../shared/data-table';
import { auditLabel, auditRules, auditScope, isFailure } from './audit-table';
import { ProjectFormDialog, type ProjectFormData } from './project-form.dialog';

/** The audit endpoints' own maximum, from each of the two lists. */
const AUDIT_LIMIT = 200;

/**
 * Project and account settings: API keys (used by the client starters), the
 * password, and the record of what has been done to both.
 */
@Component({
  selector: 'sw-settings',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    FormsModule,
    ReactiveFormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatPaginatorModule,
    MatSortModule,
    MatTableModule,
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
  protected readonly audit = new DataTable<AuditEventDto>(auditRules);
  protected readonly auditFilter = signal('');
  protected readonly auditColumns = ['occurredAt', 'action', 'actor', 'target', 'ip'];
  protected readonly pageSizes = PAGE_SIZES;
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

    confirmWith(this.dialog, {
      title: `Delete "${project.name}"?`,
      message:
        checks === 0
          ? 'This project has no checks. Deleting it cannot be undone.'
          : `This deletes ${checks} check${checks === 1 ? '' : 's'} with every ping and incident recorded against them. It cannot be undone.`,
      confirmLabel: 'Delete project',
      destructive: true,
    }).subscribe(() => {
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
   *
   * Both are asked for the server's maximum. The old page took 40 of each and
   * showed the 60 most recent, which meant a search for a sign-in from last
   * month could only ever fail — and fail silently, looking like it had not
   * happened.
   */
  private loadAudit(projectId: string): void {
    forkJoin({
      account: this.api.listAccountAudit(AUDIT_LIMIT),
      project: this.api
        .listProjectAudit(projectId, AUDIT_LIMIT)
        // A member without the admin role simply sees fewer rows, rather than
        // an error on a page that is otherwise about their own account.
        .pipe(catchError(() => of({ items: [] as AuditEventDto[], nextCursor: null }))),
    }).subscribe({
      next: ({ account, project }) => {
        const merged = [...account.items, ...project.items].sort((a, b) =>
          b.occurredAt.localeCompare(a.occurredAt),
        );
        this.audit.setRows(merged);
      },
      error: () => this.audit.setRows([]),
    });
  }

  protected readonly label = auditLabel;
  protected readonly isFailure = isFailure;

  protected filterAuditBy(scope: string): void {
    this.auditFilter.set(scope);
    this.audit.setFilter((event) => {
      if (scope === 'failures') return isFailure(event.action);
      if (scope === '') return true;
      return auditScope(event) === scope;
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
    confirmWith(this.dialog, {
      title: `Revoke "${key.name}"?`,
      message:
        'Anything using this key stops working immediately — a starter holding it will fail to ' +
        'declare its jobs, and the checks it declared will go quiet. Revoking cannot be undone; ' +
        'issue a new key instead.',
      confirmLabel: 'Revoke key',
      destructive: true,
    }).subscribe(() => {
      this.api.revokeApiKey(key.projectId, key.id).subscribe({
        next: () => {
          this.apiKeys.update((keys) =>
            keys.map((existing) =>
              existing.id === key.id
                ? { ...existing, revokedAt: new Date().toISOString() }
                : existing,
            ),
          );
          this.snackBar.open('Key revoked', 'OK', { duration: 3000 });
        },
        error: (failure: unknown) =>
          this.error.set(errorMessage(failure, 'Could not revoke the key.')),
      });
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
