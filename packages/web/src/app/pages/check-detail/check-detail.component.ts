import { ChangeDetectionStrategy, Component, OnDestroy, effect, inject, input, signal } from '@angular/core';
import { MatButtonModule } from '@angular/material/button';
import { MatDialog } from '@angular/material/dialog';
import { MatMenuModule } from '@angular/material/menu';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import type { CheckDto, IncidentDto, PingDto } from '@silencewatch/shared';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/error-message';
import { ProjectStore } from '../../core/project.store';
import { DurationPipe, RelativeTimePipe } from '../../shared/relative-time.pipe';
import { StateChipComponent } from '../../shared/state-chip.component';
import { CheckFormDialog } from '../checks/check-form.dialog';
import { IconComponent } from '../../shared/icon.component';
import { describeSchedule } from '../../shared/schedule';

const REFRESH_INTERVAL_MS = 15_000;

/**
 * One check: its ping URL, what it did recently, and what broke when.
 *
 * The ping URL is the first thing shown because it is the first thing anyone
 * needs — pasting it into a crontab is the whole setup.
 */
@Component({
  selector: 'sw-check-detail',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    RouterLink,
    MatButtonModule,
    MatMenuModule,
    MatProgressBarModule,
    MatTabsModule,
    MatTooltipModule,
    StateChipComponent,
    RelativeTimePipe,
    DurationPipe,
  ],
  templateUrl: './check-detail.component.html',
  styleUrl: './check-detail.component.scss',
})
export class CheckDetailComponent implements OnDestroy {
  /** Bound from the route parameter by withComponentInputBinding(). */
  readonly id = input.required<string>();

  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  private readonly router = inject(Router);
  private readonly snackBar = inject(MatSnackBar);
  private readonly projects = inject(ProjectStore);

  protected readonly check = signal<CheckDto | null>(null);
  protected readonly pings = signal<PingDto[]>([]);
  protected readonly incidents = signal<IncidentDto[]>([]);
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  private readonly timer = setInterval(() => this.load(true), REFRESH_INTERVAL_MS);

  constructor() {
    this.projects.load();
    effect(() => {
      // Re-runs when the route id changes, including navigation between checks.
      this.id();
      this.load();
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected load(quiet = false): void {
    const checkId = this.id();
    if (!quiet) this.loading.set(true);

    this.api.getCheck(checkId).subscribe({
      next: (check) => {
        this.check.set(check);
        this.loading.set(false);
        this.error.set(null);
      },
      error: (failure: unknown) => {
        this.loading.set(false);
        this.error.set(errorMessage(failure, 'Could not load this check.'));
      },
    });

    this.api.listPings(checkId, 50).subscribe({ next: (page) => this.pings.set(page.items) });
    this.api.listIncidents(checkId, 20).subscribe({ next: (page) => this.incidents.set(page.items) });
  }

  protected edit(check: CheckDto): void {
    this.dialog
      .open(CheckFormDialog, { data: { projectId: check.projectId, check } })
      .afterClosed()
      .subscribe((updated?: CheckDto) => {
        if (updated) this.check.set(updated);
      });
  }

  protected togglePause(check: CheckDto): void {
    const paused = check.state !== 'PAUSED';
    this.api.updateCheck(check.id, { paused }).subscribe({
      next: (updated) => {
        this.check.set(updated);
        this.snackBar.open(paused ? 'Check paused' : 'Check resumed', 'OK', { duration: 3000 });
      },
      error: (failure: unknown) => this.error.set(errorMessage(failure, 'Could not update the check.')),
    });
  }

  /**
   * Issues a new ping URL.
   *
   * Confirmed in words rather than behind an "are you sure", because the
   * consequence is specific and easy to miss: every job still calling the old
   * URL goes quiet, and this product turns quiet into an alert.
   */
  protected rotate(check: CheckDto): void {
    const confirmed = window.confirm(
      `Issue a new ping URL for "${check.name}"?\n\n` +
        'The current URL stops working immediately. Any job still calling it will be reported ' +
        'as down until you update it. History and incidents are kept.',
    );
    if (!confirmed) return;

    this.api.rotatePingKey(check.id).subscribe({
      next: (updated) => {
        this.check.set(updated);
        this.snackBar.open('New ping URL issued — update your jobs', 'OK', { duration: 6000 });
      },
      error: (failure: unknown) =>
        this.error.set(errorMessage(failure, 'Could not rotate the ping URL.')),
    });
  }

  protected remove(check: CheckDto): void {
    // Deleting destroys the history, so make the user say the name.
    const confirmed = window.confirm(
      `Delete "${check.name}"? Its pings and incidents are destroyed with it. This cannot be undone.`,
    );
    if (!confirmed) return;

    this.api.deleteCheck(check.id).subscribe({
      next: () => {
        this.snackBar.open('Check deleted', 'OK', { duration: 3000 });
        void this.router.navigate(['/checks']);
      },
      error: (failure: unknown) => this.error.set(errorMessage(failure, 'Could not delete the check.')),
    });
  }

  protected copy(text: string): void {
    void navigator.clipboard
      .writeText(text)
      .then(() => this.snackBar.open('Ping URL copied', 'OK', { duration: 2000 }))
      .catch(() => this.snackBar.open('Could not copy — select the URL manually', 'OK', { duration: 4000 }));
  }

  protected readonly schedule = describeSchedule;

  protected outage(incident: IncidentDto): number {
    const end = incident.resolvedAt === null ? Date.now() : Date.parse(incident.resolvedAt);
    return end - Date.parse(incident.startedAt);
  }
}
