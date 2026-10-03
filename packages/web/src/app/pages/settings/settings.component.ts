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
import { Router } from '@angular/router';
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
import type { MessageKey } from '../../core/i18n/messages';
import { I18n, type Language } from '../../core/i18n/i18n.service';
import { ThemeService, type ThemeChoice } from '../../core/theme.service';
import { ProjectStore } from '../../core/project.store';
import { MatTooltipModule } from '@angular/material/tooltip';
import { PAGINATOR_INTL } from '../../shared/paginator-intl';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { FlagComponent } from '../../shared/flag.component';
import { ScrollTabsDirective } from '../../shared/scroll-tabs.directive';
import { IconComponent } from '../../shared/icon.component';
import { confirmWith } from '../../shared/confirm.dialog';
import { DeleteAccountDialog, type DeleteAccountData } from './delete-account.dialog';
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
    FlagComponent,
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
    ScrollTabsDirective,
  ],
  providers: [PAGINATOR_INTL],
  templateUrl: './settings.component.html',
  styleUrl: './settings.component.scss',
})
export class SettingsComponent {
  private readonly api = inject(ApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  protected readonly auth = inject(AuthService);
  protected readonly projects = inject(ProjectStore);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;
  protected readonly plural = this.i18n.plural;
  protected readonly theme = inject(ThemeService);
  protected readonly language = this.i18n.language;

  /** Named in their own language, as language pickers do: you find yours by its own word. */
  protected readonly languages: ReadonlyArray<{
    code: Language;
    flag: 'fr' | 'gb';
    name: string;
  }> = [
    { code: 'fr', flag: 'fr', name: 'Français' },
    { code: 'en', flag: 'gb', name: 'English' },
  ];

  protected readonly themes: ReadonlyArray<{
    choice: ThemeChoice;
    icon: string;
    label: MessageKey;
  }> = [
    { choice: 'system', icon: 'monitor', label: 'prefs.themeSystem' },
    { choice: 'light', icon: 'sun', label: 'prefs.themeLight' },
    { choice: 'dark', icon: 'moon', label: 'prefs.themeDark' },
  ];

  protected readonly minLength = LIMITS.passwordMin;
  protected readonly apiKeys = signal<ApiKeyDto[]>([]);
  protected readonly audit = new DataTable<AuditEventDto>(auditRules(this.t));
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
          this.snackBar.open(
            this.t('settings.projectCreated', { name: project.name }),
            this.t('common.ok'),
            {
              duration: 4000,
            },
          );
        },
        error: (failure: unknown) => {
          this.projectBusy.set(false);
          this.error.set(errorMessage(failure, this.t('settings.projectCreateFailed'), this.t));
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
          this.snackBar.open(this.t('settings.projectRenamed'), this.t('common.ok'), {
            duration: 3000,
          });
        },
        error: (failure: unknown) =>
          this.error.set(errorMessage(failure, this.t('settings.projectRenameFailed'), this.t)),
      });
    });
  }

  /** Resolves with the name, or undefined when the dialog was dismissed. */
  private openProjectForm(data: ProjectFormData) {
    // One field: a compact card, not the whole screen the longer forms get on a phone.
    return this.dialog
      .open(ProjectFormDialog, {
        data,
        autoFocus: false,
        panelClass: 'sw-confirm',
      })
      .afterClosed();
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
      title: this.t('settings.projectDeleteTitle', { name: project.name }),
      message:
        checks === 0
          ? this.t('settings.projectDeleteEmpty')
          : this.i18n.plural('settings.projectDeleteMessage', checks),
      confirmLabel: this.t('settings.projectDeleteConfirm'),
      destructive: true,
    }).subscribe(() => {
      this.api.deleteProject(project.id).subscribe({
        next: () => {
          this.projects.remove(project.id);
          this.snackBar.open(
            this.t('settings.projectDeleted', { name: project.name }),
            this.t('common.ok'),
            {
              duration: 4000,
            },
          );
        },
        error: (failure: unknown) =>
          this.error.set(errorMessage(failure, this.t('settings.projectDeleteFailed'), this.t)),
      });
    });
  }

  private loadKeys(projectId: string): void {
    this.api.listApiKeys(projectId).subscribe({
      next: (keys) => this.apiKeys.set(keys),
      error: (failure: unknown) =>
        this.error.set(errorMessage(failure, this.t('settings.keysLoadFailed'), this.t)),
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

  protected readonly label = (action: string): string => auditLabel(action, this.t);
  protected readonly isFailure = isFailure;

  protected setLanguage(language: Language): void {
    void this.i18n.set(language);
  }

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
        this.error.set(errorMessage(failure, this.t('settings.keyCreateFailed'), this.t));
      },
    });
  }

  protected revoke(key: ApiKeyDto): void {
    confirmWith(this.dialog, {
      title: this.t('settings.revokeTitle', { name: key.name }),
      message: this.t('settings.revokeMessage'),
      confirmLabel: this.t('settings.revokeConfirm'),
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
          this.snackBar.open(this.t('settings.keyRevoked'), this.t('common.ok'), {
            duration: 3000,
          });
        },
        error: (failure: unknown) =>
          this.error.set(errorMessage(failure, this.t('settings.keyRevokeFailed'), this.t)),
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
        this.snackBar.open(this.t('settings.passwordChanged'), this.t('common.ok'), {
          duration: 5000,
        });
        this.auth.logout();
      },
      error: (failure: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(failure, this.t('settings.passwordChangeFailed'), this.t));
      },
    });
  }

  /**
   * Opens the confirmation. The dialog makes the request itself, so it closes
   * with `true` only once the account is gone, and this just says so and leaves.
   */
  protected deleteAccount(): void {
    const projects = this.projects.all();
    const data: DeleteAccountData = {
      projects: projects.length,
      checks: projects.reduce((total, project) => total + (project.checkCount ?? 0), 0),
    };

    this.dialog
      .open(DeleteAccountDialog, { data, autoFocus: false, panelClass: 'sw-confirm' })
      .afterClosed()
      .subscribe((deleted) => {
        if (deleted !== true) return;
        this.snackBar.open(this.t('deleteAccount.done'), this.t('common.ok'), { duration: 6000 });
        void this.router.navigate(['/login']);
      });
  }

  protected copy(text: string): void {
    void navigator.clipboard
      .writeText(text)
      .then(() =>
        this.snackBar.open(this.t('settings.copied'), this.t('common.ok'), {
          duration: 2000,
        }),
      )
      .catch(() =>
        this.snackBar.open(this.t('settings.copyFailed'), this.t('common.ok'), {
          duration: 4000,
        }),
      );
  }
}
