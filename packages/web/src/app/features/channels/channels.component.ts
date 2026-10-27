import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { type ChannelType, type NotificationChannelDto } from '@silencewatch/shared';
import { ChannelsApi } from '../../core/api/channels.api';
import { errorMessage } from '../../core/http/error-message';
import type { MessageKey } from '../../core/i18n/messages';
import { I18n } from '../../core/i18n/i18n.service';
import { ProjectStore } from '../../core/project.store';
import { confirmWith } from '../../shared/confirm.dialog';
import { IconComponent } from '../../shared/icon.component';
import { ChannelFormDialog, type ChannelFormData } from './channel-form.dialog';

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
  imports: [IconComponent, MatButtonModule, MatSlideToggleModule],
  templateUrl: './channels.component.html',
  styleUrl: './channels.component.scss',
})
export class ChannelsComponent {
  private readonly channelsApi = inject(ChannelsApi);
  private readonly snackBar = inject(MatSnackBar);
  private readonly dialog = inject(MatDialog);
  protected readonly projects = inject(ProjectStore);
  protected readonly t = inject(I18n).t;

  protected readonly channels = signal<NotificationChannelDto[]>([]);
  protected readonly testing = signal<string | null>(null);
  protected readonly error = signal<string | null>(null);

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

  /** Stands in for a logo, which a channel's brand would own: enough to tell the rows apart at a glance. */
  protected icon(type: ChannelType): string {
    return `ch${type[0]?.toUpperCase()}${type.slice(1)}`;
  }

  private load(projectId: string): void {
    this.channelsApi.list(projectId).subscribe({
      next: (channels) => this.channels.set(channels),
      error: (failure: unknown) =>
        this.error.set(errorMessage(failure, this.t('channels.loadFailed'), this.t)),
    });
  }

  protected create(): void {
    const project = this.projects.selected();
    if (project === null) return;

    this.dialog
      .open(ChannelFormDialog, {
        data: { projectId: project.id } satisfies ChannelFormData,
        panelClass: 'sw-sheet',
      })
      .afterClosed()
      .subscribe((channel?: NotificationChannelDto) => {
        if (!channel) return;
        this.channels.update((channels) => [...channels, channel]);
        this.snackBar.open(this.t('channels.added'), this.t('common.ok'), { duration: 5000 });
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
