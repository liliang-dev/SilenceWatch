import { ChangeDetectionStrategy, Component, OnDestroy, computed, inject, signal } from '@angular/core';
import { FormsModule } from '@angular/forms';
import { MatButtonModule } from '@angular/material/button';
import { MatButtonToggleModule } from '@angular/material/button-toggle';
import { MatDialog } from '@angular/material/dialog';
import { MatFormFieldModule } from '@angular/material/form-field';
import { MatInputModule } from '@angular/material/input';
import { MatProgressBarModule } from '@angular/material/progress-bar';
import { MatTooltipModule } from '@angular/material/tooltip';
import { RouterLink } from '@angular/router';
import type { CheckDto, CheckState } from '@silencewatch/shared';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/error-message';
import { ProjectStore } from '../../core/project.store';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { StateChipComponent } from '../../shared/state-chip.component';
import { CheckFormDialog } from './check-form.dialog';
import { IconComponent } from '../../shared/icon.component';

const REFRESH_INTERVAL_MS = 15_000;

/**
 * The screen this product exists for: what is running, what is late, what is
 * down. Sorted so that anything broken is at the top and nothing has to be
 * hunted for.
 */
@Component({
  selector: 'sw-checks',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [
    IconComponent,
    RouterLink,
    FormsModule,
    MatButtonModule,
    MatButtonToggleModule,
    MatFormFieldModule,
    MatInputModule,
    MatProgressBarModule,
    MatTooltipModule,
    StateChipComponent,
    RelativeTimePipe,
  ],
  template: `
    <div class="sw-page">
      <header class="sw-page-header">
        <div>
          <h1>Checks</h1>
          <p class="sw-muted summary">{{ summary() }}</p>
        </div>
        <button mat-flat-button (click)="create()" [disabled]="projects.selected() === null">
          <sw-icon name="add" />
          New check
        </button>
      </header>

      <div class="filters">
        <mat-button-toggle-group [(ngModel)]="stateFilter" (ngModelChange)="reload()" hideSingleSelectionIndicator>
          <mat-button-toggle value="">All</mat-button-toggle>
          <mat-button-toggle value="DOWN">Down</mat-button-toggle>
          <mat-button-toggle value="LATE">Late</mat-button-toggle>
          <mat-button-toggle value="UP">Up</mat-button-toggle>
          <mat-button-toggle value="PAUSED">Paused</mat-button-toggle>
        </mat-button-toggle-group>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search">
          <sw-icon name="search" matPrefix />
          <input
            matInput
            type="search"
            placeholder="Search by name"
            [(ngModel)]="search"
            (keyup.enter)="reload()"
            (search)="reload()"
          />
        </mat-form-field>
      </div>

      @if (loading() && checks().length === 0) {
        <mat-progress-bar mode="indeterminate" />
      }

      @if (error()) {
        <p class="sw-error" role="alert">{{ error() }}</p>
      }

      @if (!loading() && checks().length === 0) {
        <div class="sw-empty">
          <h2>Nothing is being watched yet</h2>
          <p>
            Create a check, then have your job call its ping URL when it runs — or add the
            Spring Boot starter and every scheduled task will declare itself.
          </p>
        </div>
      } @else {
        <div class="sw-scroll-x">
          <table class="checks">
            <thead>
              <tr>
                <th scope="col">Check</th>
                <th scope="col">State</th>
                <th scope="col">Schedule</th>
                <th scope="col">Last ping</th>
                <th scope="col">Expected</th>
              </tr>
            </thead>
            <tbody>
              @for (check of checks(); track check.id) {
                <tr [class.is-down]="check.state === 'DOWN'">
                  <td>
                    <a [routerLink]="['/checks', check.id]" class="name">{{ check.name }}</a>
                    <div class="meta sw-muted">
                      @if (check.environment) {
                        <span class="tag">{{ check.environment }}</span>
                      }
                      @if (check.source === 'auto') {
                        <span class="tag" matTooltip="Declared automatically by a client library">auto</span>
                      }
                      @if (check.orphanedAt) {
                        <span
                          class="tag orphan"
                          matTooltip="The client stopped declaring this job. History is kept; delete it when you are sure."
                          >orphaned</span
                        >
                      }
                    </div>
                  </td>
                  <td><sw-state-chip [state]="check.state" /></td>
                  <td class="sw-mono">{{ schedule(check) }}</td>
                  <td [matTooltip]="check.lastPingAt ?? 'No ping received yet'">
                    {{ check.lastPingAt | swRelativeTime }}
                  </td>
                  <td [matTooltip]="check.nextDueAt ?? ''">
                    {{ check.nextDueAt | swRelativeTime }}
                  </td>
                </tr>
              }
            </tbody>
          </table>
        </div>
      }
    </div>
  `,
  styles: `
    .summary {
      margin: 4px 0 0;
      font-size: 0.9rem;
    }

    .filters {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-bottom: 16px;
    }

    .search {
      flex: 1 1 260px;
      max-width: 360px;
    }

    table.checks {
      border-collapse: collapse;
      min-width: 720px;
    }

    th {
      text-align: left;
      padding: 8px 12px;
      font-size: 0.75rem;
      font-weight: 600;
      letter-spacing: 0.04em;
      text-transform: uppercase;
      color: var(--mat-sys-on-surface-variant);
      border-bottom: 1px solid var(--mat-sys-outline-variant);
    }

    td {
      padding: 12px;
      border-bottom: 1px solid var(--mat-sys-outline-variant);
      vertical-align: top;
      font-size: 0.9rem;
    }

    tr.is-down td:first-child {
      box-shadow: inset 3px 0 0 var(--sw-state-down);
    }

    .name {
      font-weight: 500;
      text-decoration: none;
    }

    .name:hover {
      text-decoration: underline;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 4px;
    }

    .tag {
      padding: 1px 7px;
      border-radius: 4px;
      font-size: 0.7rem;
      background: var(--mat-sys-surface-container-highest);
    }

    .tag.orphan {
      color: var(--sw-state-late);
    }
  `,
})
export class ChecksComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  protected readonly projects = inject(ProjectStore);

  protected readonly checks = signal<CheckDto[]>([]);
  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  protected stateFilter = '';
  protected search = '';

  private readonly timer = setInterval(() => this.reload(true), REFRESH_INTERVAL_MS);

  protected readonly summary = computed(() => {
    const checks = this.checks();
    if (checks.length === 0) return 'No check yet';

    const down = checks.filter((check) => check.state === 'DOWN').length;
    const late = checks.filter((check) => check.state === 'LATE').length;
    if (down === 0 && late === 0) return `${checks.length} check(s), all reporting`;
    return `${down} down, ${late} late, out of ${checks.length}`;
  });

  constructor() {
    this.projects.load();
    this.reload();
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  /** @param quiet true for the background refresh, which must not flash a spinner. */
  protected reload(quiet = false): void {
    if (!quiet) this.loading.set(true);

    this.api
      .listChecks({
        ...(this.stateFilter === '' ? {} : { state: this.stateFilter }),
        ...(this.search.trim() === '' ? {} : { search: this.search.trim() }),
        limit: 200,
      })
      .subscribe({
        next: (page) => {
          this.checks.set([...page.items].sort(byUrgency));
          this.loading.set(false);
          this.error.set(null);
        },
        error: (failure: unknown) => {
          this.loading.set(false);
          this.error.set(errorMessage(failure, 'Could not load checks.'));
        },
      });
  }

  protected create(): void {
    const project = this.projects.selected();
    if (project === null) return;

    this.dialog
      .open(CheckFormDialog, { data: { projectId: project.id } })
      .afterClosed()
      .subscribe((created?: CheckDto) => {
        if (created) this.reload();
      });
  }

  protected schedule(check: CheckDto): string {
    return check.scheduleType === 'cron'
      ? `${check.cronExpression} (${check.timezone})`
      : `every ${formatSeconds(check.periodSeconds ?? 0)}`;
  }
}

/** Broken first, then late, then everything else: the screen answers the question. */
const STATE_ORDER: Record<CheckState, number> = { DOWN: 0, LATE: 1, NEW: 2, UP: 3, PAUSED: 4 };

function byUrgency(left: CheckDto, right: CheckDto): number {
  const difference = STATE_ORDER[left.state] - STATE_ORDER[right.state];
  return difference !== 0 ? difference : left.name.localeCompare(right.name);
}

function formatSeconds(seconds: number): string {
  if (seconds % 86_400 === 0) return `${seconds / 86_400}d`;
  if (seconds % 3_600 === 0) return `${seconds / 3_600}h`;
  if (seconds % 60 === 0) return `${seconds / 60}m`;
  return `${seconds}s`;
}
