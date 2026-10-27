import { ChangeDetectionStrategy, Component, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { CHANNEL_TYPES, type ChannelType, type NotificationChannelDto } from '@silencewatch/shared';
import { ChannelsApi } from '../../core/api/channels.api';
import { errorMessage } from '../../core/http/error-message';
import { I18n } from '../../core/i18n/i18n.service';
import type { MessageKey } from '../../core/i18n/messages';

export interface ChannelFormData {
  projectId: string;
}

/**
 * Add an alert channel, in a dialog like the one that adds a check: the form is
 * only wanted for a moment, and the list under it is the page.
 */
@Component({
  selector: 'sw-channel-form',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    ReactiveFormsModule,
    MatDialogModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatButtonModule,
  ],
  templateUrl: './channel-form.dialog.html',
  styleUrl: './channel-form.dialog.scss',
})
export class ChannelFormDialog {
  private readonly data = inject<ChannelFormData>(MAT_DIALOG_DATA);
  protected readonly dialogRef = inject<MatDialogRef<ChannelFormDialog, NotificationChannelDto>>(MatDialogRef);

  private readonly channelsApi = inject(ChannelsApi);
  private readonly formBuilder = inject(FormBuilder);
  protected readonly t = inject(I18n).t;

  protected readonly channelTypes = CHANNEL_TYPES;
  protected readonly busy = signal(false);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    type: ['email' as ChannelType, Validators.required],
    name: ['', Validators.required],
    target: ['', Validators.required],
    secret: [''],
  });

  protected label(type: ChannelType): string {
    return this.t(`channels.type${type[0]?.toUpperCase()}${type.slice(1)}` as MessageKey);
  }

  protected save(): void {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }

    const { type, name, target, secret } = this.form.getRawValue();
    const config =
      type === 'email'
        ? { address: target }
        : type === 'webhook'
          ? {
              url: target,
              ...(secret.trim() === '' ? {} : { secret: secret.trim() }),
            }
          : { url: target };

    this.busy.set(true);
    this.error.set(null);

    this.channelsApi.create(this.data.projectId, { type, name, config } as never).subscribe({
      next: (channel) => this.dialogRef.close(channel),
      error: (failure: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(failure, this.t('channels.addFailed'), this.t));
      },
    });
  }
}
