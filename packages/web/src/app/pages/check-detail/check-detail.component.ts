import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  effect,
  inject,
  input,
  signal,
} from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatMenuModule } from '@angular/material/menu';
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatSnackBar } from '@angular/material/snack-bar';
import { MatSortModule } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import { MatTabsModule } from '@angular/material/tabs';
import { MatTooltipModule } from '@angular/material/tooltip';
import { Router, RouterLink } from '@angular/router';
import type { CheckDto, IncidentDto, PingDto } from '@silencewatch/shared';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/error-message';
import { ProjectStore } from '../../core/project.store';
import { confirmWith } from '../../shared/confirm.dialog';
import { DataTable, PAGE_SIZES } from '../../shared/data-table';
import { DurationPipe, RelativeTimePipe } from '../../shared/relative-time.pipe';
import { StateChipComponent } from '../../shared/state-chip.component';
import { CheckFormDialog } from '../checks/check-form.dialog';
import { IconComponent } from '../../shared/icon.component';
import { describeSchedule } from '../../shared/schedule';
import { incidentRules, outageMs, pingRules } from './history-tables';

const REFRESH_INTERVAL_MS = 15_000;

/**
 * The server's own maximum. One request rather than a cursor loop: unlike the
 * checks list, this is a log — the interesting part is the recent end of it, and
 * "the last 200" is a defensible thing for a screen to show.
 */
const HISTORY_LIMIT = 200;

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
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatMenuModule,
    MatPaginatorModule,
    MatProgressBarModule,
    MatSortModule,
    MatTableModule,
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
  protected readonly loading = signal(true);
  protected readonly error = signal<string | null>(null);

  protected readonly pings = new DataTable<PingDto>(pingRules);
  protected readonly incidents = new DataTable<IncidentDto>(incidentRules);

  /** True when the log is longer than one request returns. */
  protected readonly pingsTruncated = signal(false);
  protected readonly incidentsTruncated = signal(false);

  protected readonly kindFilter = signal('');
  protected readonly incidentFilter = signal('');

  protected readonly pingColumns = ['receivedAt', 'kind', 'durationMs', 'exitCode', 'sourceIp', 'body'];
  protected readonly incidentColumns = ['startedAt', 'resolvedAt', 'duration', 'notificationsSent'];
  protected readonly pageSizes = PAGE_SIZES;

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

    this.api.listPings(checkId, HISTORY_LIMIT).subscribe({
      next: (page) => {
        this.pings.setRows(page.items);
        this.pingsTruncated.set(page.nextCursor !== null);
      },
    });

    this.api.listIncidents(checkId, HISTORY_LIMIT).subscribe({
      next: (page) => {
        this.incidents.setRows(page.items);
        this.incidentsTruncated.set(page.nextCursor !== null);
      },
    });
  }

  protected filterPingsBy(kind: string): void {
    this.kindFilter.set(kind);
    this.pings.setFilter((ping) => kind === '' || ping.kind === kind);
  }

  protected filterIncidentsBy(status: string): void {
    this.incidentFilter.set(status);
    this.incidents.setFilter((incident) => {
      if (status === 'ongoing') return incident.resolvedAt === null;
      if (status === 'resolved') return incident.resolvedAt !== null;
      return true;
    });
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
   * The confirmation spells out the consequence rather than asking "are you
   * sure", because it is specific and easy to miss: every job still calling the
   * old URL goes quiet, and this product turns quiet into an alert.
   */
  protected rotate(check: CheckDto): void {
    confirmWith(this.dialog, {
      title: 'Issue a new ping URL?',
      message:
        `The URL for "${check.name}" stops working immediately. Any job still calling it will be ` +
        'reported as down until you update it. History and incidents are kept.',
      confirmLabel: 'Issue a new URL',
    }).subscribe(() => {
      this.api.rotatePingKey(check.id).subscribe({
        next: (updated) => {
          this.check.set(updated);
          this.snackBar.open('New ping URL issued — update your jobs', 'OK', { duration: 6000 });
        },
        error: (failure: unknown) =>
          this.error.set(errorMessage(failure, 'Could not rotate the ping URL.')),
      });
    });
  }

  protected remove(check: CheckDto): void {
    const pings = this.pings.rows().length;
    const incidents = this.incidents.rows().length;

    confirmWith(this.dialog, {
      title: `Delete "${check.name}"?`,
      // The counts are the point of asking: "are you sure" tells nobody what
      // they are about to lose.
      message:
        `${count(pings, 'ping')} and ${count(incidents, 'incident')} are destroyed with it. ` +
        'This cannot be undone.',
      confirmLabel: 'Delete check',
      destructive: true,
    }).subscribe(() => {
      this.api.deleteCheck(check.id).subscribe({
        next: () => {
          this.snackBar.open('Check deleted', 'OK', { duration: 3000 });
          void this.router.navigate(['/checks']);
        },
        error: (failure: unknown) =>
          this.error.set(errorMessage(failure, 'Could not delete the check.')),
      });
    });
  }

  protected copy(text: string): void {
    void navigator.clipboard
      .writeText(text)
      .then(() => this.snackBar.open('Ping URL copied', 'OK', { duration: 2000 }))
      .catch(() => this.snackBar.open('Could not copy — select the URL manually', 'OK', { duration: 4000 }));
  }

  protected readonly schedule = describeSchedule;
  protected readonly outage = outageMs;
}

function count(value: number, noun: string): string {
  return `${value === 0 ? 'No' : value} ${value === 1 ? noun : `${noun}s`}`;
}
