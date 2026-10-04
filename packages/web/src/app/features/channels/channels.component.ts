import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CHANNEL_TYPES, type ChannelType, type NotificationChannelDto } from '@silencewatch/shared';
import { ChannelsApi } from '../../core/api/channels.api';
import { errorMessage } from '../../core/http/error-message';
import type { MessageKey } from '../../core/i18n/messages';
import { I18n } from '../../core/i18n/i18n.service';
import { ProjectStore } from '../../core/project.store';
import { confirmWith } from '../../shared/confirm.dialog';
import { IconComponent } from '../../shared/icon.component';

/**
 * Where alerts go.
 *
 * Every channel can be tested from here, on purpose: an alerting channel nobody
 * has ever exercised is a channel that fails during the incident it was set up
 * for.
 */
@Component({
  selector: 'sw-channels',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    ReactiveFormsModule,
    MatButtonModule,
    MatFormFieldModule,
    MatInputModule,
    MatSelectModule,
    MatSlideToggleModule,
  ],
  templateUrl: './channels.component.html',
  styleUrl: './channels.component.scss',
})
export class ChannelsComponent {
  private readonly channelsApi = inject(ChannelsApi);
  private readonly snackBar = inject(MatSnackBar);
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialog = inject(MatDialog);
  protected readonly projects = inject(ProjectStore);
  protected readonly t = inject(I18n).t;

  protected readonly channelTypes = CHANNEL_TYPES;
  protected readonly channels = signal<NotificationChannelDto[]>([]);
  protected readonly busy = signal(false);
  protected readonly testing = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

  protected readonly form = this.formBuilder.nonNullable.group({
    type: ['email' as ChannelType, Validators.required],
    name: ['', Validators.required],
    target: ['', Validators.required],
    secret: [''],
  });

  constructor() {
    this.projects.load();
    effect(() => {
      const project = this.projects.selected();
      if (project !== null) this.load(project.id);
    });
  }

  protected label(type: ChannelType): string {
    return this.t(`channels.type${type[0]?.toUpperCase()}${type.slice(1)}` as MessageKey);
  }

  /** Stands in for a logo: enough to tell the rows apart at a glance. */
  protected initial(type: ChannelType): string {
    return (type[0] ?? '?').toUpperCase();
  }

  private load(projectId: string): void {
    this.channelsApi.list(projectId).subscribe({
      next: (channels) => this.channels.set(channels),
      error: (failure: unknown) =>
        this.error.set(errorMessage(failure, this.t('channels.loadFailed'), this.t)),
    });
  }

  protected add(): void {
    const project = this.projects.selected();
    if (project === null || this.form.invalid || this.busy()) {
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

    this.channelsApi.create(project.id, { type, name, config } as never).subscribe({
      next: (channel) => {
        this.channels.update((channels) => [...channels, channel]);
        this.form.reset({ type, name: '', target: '', secret: '' });
        this.busy.set(false);
        this.snackBar.open(this.t('channels.added'), this.t('common.ok'), {
          duration: 5000,
        });
      },
      error: (failure: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(failure, this.t('channels.addFailed'), this.t));
      },
    });
  }

  protected toggle(channel: NotificationChannelDto, enabled: boolean): void {
    this.channelsApi.update(channel.projectId, channel.id, { enabled }).subscribe({
      next: (updated) =>
        this.channels.update((channels) =>
          channels.map((existing) => (existing.id === updated.id ? updated : existing)),
        ),
      error: (failure: unknown) =>
        this.error.set(errorMessage(failure, this.t('channels.updateFailed'), this.t)),
    });
  }

  protected test(channel: NotificationChannelDto): void {
    this.testing.set(channel.id);
    this.channelsApi.test(channel.projectId, channel.id).subscribe({
      next: () => {
        this.testing.set(null);
        this.snackBar.open(this.t('channels.testSent'), this.t('common.ok'), {
          duration: 4000,
        });
      },
      error: (failure: unknown) => {
        this.testing.set(null);
        // The server returns the transport's own error, which is the useful part.
        this.error.set(errorMessage(failure, this.t('channels.testFailed'), this.t));
      },
    });
  }

  protected remove(channel: NotificationChannelDto): void {
    confirmWith(this.dialog, {
      title: this.t('channels.deleteTitle', { name: channel.name }),
      // Worth spelling out: deleting the last channel leaves the project
      // watching everything and telling nobody.
      message: this.t('channels.deleteMessage'),
      confirmLabel: this.t('channels.deleteConfirm'),
      destructive: true,
    }).subscribe(() => {
      this.channelsApi.delete(channel.projectId, channel.id).subscribe({
        next: () =>
          this.channels.update((channels) =>
            channels.filter((existing) => existing.id !== channel.id),
          ),
        error: (failure: unknown) =>
          this.error.set(errorMessage(failure, this.t('channels.deleteFailed'), this.t)),
      });
    });
  }
}
