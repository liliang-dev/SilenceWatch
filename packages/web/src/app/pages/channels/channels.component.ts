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
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/error-message';
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
  private readonly api = inject(ApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly formBuilder = inject(FormBuilder);
  private readonly dialog = inject(MatDialog);
  protected readonly projects = inject(ProjectStore);

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
    return type === 'teams' ? 'Microsoft Teams' : type[0]?.toUpperCase() + type.slice(1);
  }

  /** Stands in for a logo: enough to tell the rows apart at a glance. */
  protected initial(type: ChannelType): string {
    return (type[0] ?? '?').toUpperCase();
  }

  private load(projectId: string): void {
    this.api.listChannels(projectId).subscribe({
      next: (channels) => this.channels.set(channels),
      error: (failure: unknown) => this.error.set(errorMessage(failure, 'Could not load channels.')),
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
          ? { url: target, ...(secret.trim() === '' ? {} : { secret: secret.trim() }) }
          : { url: target };

    this.busy.set(true);
    this.error.set(null);

    this.api.createChannel(project.id, { type, name, config } as never).subscribe({
      next: (channel) => {
        this.channels.update((channels) => [...channels, channel]);
        this.form.reset({ type, name: '', target: '', secret: '' });
        this.busy.set(false);
        this.snackBar.open('Channel added — send a test to make sure it works', 'OK', { duration: 5000 });
      },
      error: (failure: unknown) => {
        this.busy.set(false);
        this.error.set(errorMessage(failure, 'Could not add the channel.'));
      },
    });
  }

  protected toggle(channel: NotificationChannelDto, enabled: boolean): void {
    this.api.updateChannel(channel.projectId, channel.id, { enabled }).subscribe({
      next: (updated) =>
        this.channels.update((channels) =>
          channels.map((existing) => (existing.id === updated.id ? updated : existing)),
        ),
      error: (failure: unknown) => this.error.set(errorMessage(failure, 'Could not update the channel.')),
    });
  }

  protected test(channel: NotificationChannelDto): void {
    this.testing.set(channel.id);
    this.api.testChannel(channel.projectId, channel.id).subscribe({
      next: () => {
        this.testing.set(null);
        this.snackBar.open('Test alert sent', 'OK', { duration: 4000 });
      },
      error: (failure: unknown) => {
        this.testing.set(null);
        // The server returns the transport's own error, which is the useful part.
        this.error.set(errorMessage(failure, 'The test alert could not be delivered.'));
      },
    });
  }

  protected remove(channel: NotificationChannelDto): void {
    confirmWith(this.dialog, {
      title: `Delete "${channel.name}"?`,
      // Worth spelling out: deleting the last channel leaves the project
      // watching everything and telling nobody.
      message:
        'Alerts stop going to it immediately. Checks carry on being watched — if this is the ' +
        'only channel, nothing will be sent when one goes down.',
      confirmLabel: 'Delete channel',
      destructive: true,
    }).subscribe(() => {
      this.api.deleteChannel(channel.projectId, channel.id).subscribe({
        next: () =>
          this.channels.update((channels) =>
            channels.filter((existing) => existing.id !== channel.id),
          ),
        error: (failure: unknown) =>
          this.error.set(errorMessage(failure, 'Could not delete the channel.')),
      });
    });
  }
}
