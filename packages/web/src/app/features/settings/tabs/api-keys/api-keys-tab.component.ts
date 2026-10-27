import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSnackBar } from '@angular/material/snack-bar';
import type { ApiKeyDto, CreatedApiKeyDto } from '@silencewatch/shared';
import { ApiKeysApi } from '../../../../core/api/api-keys.api';
import { errorMessage } from '../../../../core/http/error-message';
import { I18n } from '../../../../core/i18n/i18n.service';
import { ProjectStore } from '../../../../core/project.store';
import { confirmWith } from '../../../../shared/confirm.dialog';
import { IconComponent } from '../../../../shared/icon.component';
import { RelativeTimePipe } from '../../../../shared/relative-time.pipe';
import { ApiKeyFormDialog, type ApiKeyFormData } from '../../dialogs/api-key-form.dialog';
import { SettingsFeedback } from '../../settings-feedback';

/** The selected project's API keys, used by the client starters. */
@Component({
  selector: 'sw-api-keys-tab',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [IconComponent, MatButtonModule, RelativeTimePipe],
  templateUrl: './api-keys-tab.component.html',
  styleUrls: ['../../section.scss', './api-keys-tab.component.scss'],
})
export class ApiKeysTabComponent {
  private readonly api = inject(ApiKeysApi);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  private readonly feedback = inject(SettingsFeedback);
  protected readonly projects = inject(ProjectStore);
  protected readonly t = inject(I18n).t;

  protected readonly apiKeys = signal<ApiKeyDto[]>([]);
  protected readonly createdKey = signal<CreatedApiKeyDto | null>(null);

  constructor() {
    effect(() => {
      const project = this.projects.selected();
      if (project !== null) this.loadKeys(project.id);
    });
  }

  private loadKeys(projectId: string): void {
    this.api.list(projectId).subscribe({
      next: (keys) => this.apiKeys.set(keys),
      error: (failure: unknown) =>
        this.feedback.show(errorMessage(failure, this.t('settings.keysLoadFailed'), this.t)),
    });
  }

  protected createKey(): void {
    const project = this.projects.selected();
    if (project === null) return;

    this.feedback.clear();
    this.dialog
      .open(ApiKeyFormDialog, {
        data: { projectId: project.id } satisfies ApiKeyFormData,
        panelClass: 'sw-sheet',
      })
      .afterClosed()
      .subscribe((created?: CreatedApiKeyDto) => {
        if (!created) return;
        this.createdKey.set(created);
        this.apiKeys.update((keys) => [created, ...keys]);
      });
  }

  protected revoke(key: ApiKeyDto): void {
    confirmWith(this.dialog, {
      title: this.t('settings.revokeTitle', { name: key.name }),
      message: this.t('settings.revokeMessage'),
      confirmLabel: this.t('settings.revokeConfirm'),
      destructive: true,
    }).subscribe(() => {
      this.api.revoke(key.projectId, key.id).subscribe({
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
          this.feedback.show(errorMessage(failure, this.t('settings.keyRevokeFailed'), this.t)),
      });
    });
  }

  protected copy(text: string): void {
    void navigator.clipboard
      .writeText(text)
      .then(() =>
        this.snackBar.open(this.t('settings.copied'), this.t('common.ok'), { duration: 2000 }),
      )
      .catch(() =>
        this.snackBar.open(this.t('settings.copyFailed'), this.t('common.ok'), { duration: 4000 }),
      );
  }
}
