import { ChangeDetectionStrategy, Component, effect, inject, signal } from '@angular/core';
import { FormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatSelectModule } from '@angular/material/select';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatSnackBar } from '@angular/material/snack-bar';
import { CHANNEL_TYPES, type ChannelType, type NotificationChannelDto } from '@silencewatch/shared';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/error-message';
import { ProjectStore } from '../../core/project.store';
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
  template: `
    <div class="sw-page">
      <header class="sw-page-header">
        <div>
          <h1>Alerting</h1>
          <p class="sw-muted">Every enabled channel is notified when a check goes down, and again when it recovers.</p>
        </div>
      </header>

      @if (error()) {
        <p class="sw-error" role="alert">{{ error() }}</p>
      }

      <section class="sw-card add">
        <h2 class="add-title">Add a channel</h2>
        <form [formGroup]="form" (ngSubmit)="add()" class="form">
          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="type">
            <mat-label>Type</mat-label>
            <mat-select formControlName="type">
              @for (type of channelTypes; track type) {
                <mat-option [value]="type">{{ label(type) }}</mat-option>
              }
            </mat-select>
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="name">
            <mat-label>Name</mat-label>
            <input matInput formControlName="name" placeholder="On-call" required />
          </mat-form-field>

          <mat-form-field appearance="outline" subscriptSizing="dynamic" class="target">
            <mat-label>{{ form.controls.type.value === 'email' ? 'Email address' : 'Webhook URL' }}</mat-label>
            <input
              matInput
              formControlName="target"
              required
              [placeholder]="
                form.controls.type.value === 'email' ? 'oncall@example.com' : 'https://hooks.example.com/services/…'
              "
            />
          </mat-form-field>

          @if (form.controls.type.value === 'webhook') {
            <mat-form-field appearance="outline" subscriptSizing="dynamic" class="target">
              <mat-label>Signing secret (optional)</mat-label>
              <input matInput formControlName="secret" />
              <mat-hint>Signs each payload with HMAC-SHA256 so you can verify it came from us</mat-hint>
            </mat-form-field>
          }

          <button mat-flat-button type="submit" [disabled]="busy()" class="submit">
            <sw-icon name="add" />
            Add channel
          </button>
        </form>
      </section>

      @if (channels().length === 0) {
        <div class="sw-card sw-empty">
          <h2>No channel configured</h2>
          <p>Until one exists, SilenceWatch detects outages but has nobody to tell.</p>
        </div>
      } @else {
        <div class="sw-card list">
          @for (channel of channels(); track channel.id) {
            <article class="channel" [class.off]="!channel.enabled">
              <span class="glyph" [class]="'glyph-' + channel.type" aria-hidden="true">{{ initial(channel.type) }}</span>

              <div class="channel-info">
                <div class="channel-title">
                  <strong>{{ channel.name }}</strong>
                  <span class="sw-tag">{{ label(channel.type) }}</span>
                  @if (!channel.enabled) {
                    <span class="sw-tag muted-tag">disabled</span>
                  }
                </div>
                <div class="target-text sw-mono sw-muted">{{ channel.target }}</div>
              </div>

              <div class="channel-actions">
                <mat-slide-toggle
                  [checked]="channel.enabled"
                  (change)="toggle(channel, $event.checked)"
                  [attr.aria-label]="'Enable ' + channel.name"
                />
                <button mat-stroked-button (click)="test(channel)" [disabled]="testing() === channel.id">
                  {{ testing() === channel.id ? 'Sending…' : 'Send test' }}
                </button>
                <button
                  mat-icon-button
                  class="sw-icon-button danger"
                  (click)="remove(channel)"
                  aria-label="Delete channel"
                >
                  <sw-icon name="delete" />
                </button>
              </div>
            </article>
          }
        </div>
      }
    </div>
  `,
  styles: `
    .add {
      padding: 20px;
      margin-bottom: 24px;
    }

    .add-title {
      margin-bottom: 16px;
      font-size: 0.9375rem;
    }

    .form {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: flex-start;
    }

    .type { flex: 0 0 150px; }
    .name { flex: 1 1 180px; }
    .target { flex: 2 1 280px; }

    .submit {
      gap: 6px;
    }

    /* -------------------------------------------------------------- list --- */

    .list {
      overflow: hidden;
    }

    .channel {
      display: flex;
      flex-wrap: wrap;
      gap: 16px;
      align-items: center;
      padding: 16px 20px;
      border-bottom: 1px solid var(--sw-border);
      transition: background-color 120ms ease;
    }

    .channel:last-child {
      border-bottom: 0;
    }

    .channel:hover {
      background: var(--sw-surface-2);
    }

    /* A disabled channel is a channel that will not fire; it should look like it. */
    .channel.off .glyph,
    .channel.off .channel-info {
      opacity: 0.55;
    }

    .glyph {
      display: grid;
      place-items: center;
      width: 34px;
      height: 34px;
      flex: none;
      border-radius: 9px;
      background: var(--sw-surface-3);
      color: var(--sw-text-muted);
      font-size: 0.8125rem;
      font-weight: 700;
    }

    .glyph-email {
      background: var(--sw-accent-soft);
      color: var(--sw-accent);
    }

    .channel-info {
      flex: 1 1 220px;
      min-width: 0;
    }

    .channel-title {
      display: flex;
      align-items: center;
      flex-wrap: wrap;
      gap: 8px;
    }

    .muted-tag {
      color: var(--sw-text-subtle);
    }

    .target-text {
      margin-top: 4px;
      word-break: break-all;
    }

    .channel-actions {
      display: flex;
      align-items: center;
      gap: 12px;
      margin-left: auto;
    }
  `,
})
export class ChannelsComponent {
  private readonly api = inject(ApiService);
  private readonly snackBar = inject(MatSnackBar);
  private readonly formBuilder = inject(FormBuilder);
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
    if (!window.confirm(`Delete the channel "${channel.name}"?`)) return;

    this.api.deleteChannel(channel.projectId, channel.id).subscribe({
      next: () =>
        this.channels.update((channels) => channels.filter((existing) => existing.id !== channel.id)),
      error: (failure: unknown) => this.error.set(errorMessage(failure, 'Could not delete the channel.')),
    });
  }
}
