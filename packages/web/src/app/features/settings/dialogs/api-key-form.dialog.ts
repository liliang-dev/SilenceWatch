import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { LIMITS, type CreatedApiKeyDto } from '@silencewatch/shared';
import { ApiKeysApi } from '../../../core/api/api-keys.api';
import { errorMessage } from '../../../core/http/error-message';
import { I18n } from '../../../core/i18n/i18n.service';

export interface ApiKeyFormData {
  projectId: string;
}

/**
 * Naming a new API key.
 *
 * The dialog closes with the created key, whose secret the page then shows once:
 * it is the page, not this dialog, that has to keep it on screen until it is copied.
 */
@Component({
  selector: 'sw-api-key-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
  ],
  templateUrl: './api-key-form.dialog.html',
  styleUrl: './api-key-form.dialog.scss',
})
export class ApiKeyFormDialog {
  private readonly data = inject<ApiKeyFormData>(MAT_DIALOG_DATA);
  protected readonly dialogRef = inject<MatDialogRef<ApiKeyFormDialog, CreatedApiKeyDto>>(MatDialogRef);

  private readonly api = inject(ApiKeysApi);
  protected readonly t = inject(I18n).t;

  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = inject(FormBuilder).nonNullable.group({
    name: ['', [Validators.required, Validators.maxLength(LIMITS.nameMax)]],
  });

  protected save(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }

    this.busy.set(true);
    this.error.set(null);

    this.api.create(this.data.projectId, { name: this.form.getRawValue().name.trim() }).subscribe({
      next: (created) => this.dialogRef.close(created),
      error: (failure: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(failure, this.t('settings.keyCreateFailed'), this.t));
      },
    });
  }
}
