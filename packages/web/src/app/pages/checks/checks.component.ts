import {
  ChangeDetectionStrategy,
  Component,
  OnDestroy,
  computed,
  effect,
  inject,
  signal,
} from '@angular/core';
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
import { describeSchedule } from '../../shared/schedule';

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
          <p class="sw-muted">{{ subtitle() }}</p>
        </div>
        <button mat-flat-button (click)="create()" [disabled]="projects.selected() === null">
          <sw-icon name="add" />
          New check
        </button>
      </header>

      <!-- The count of what is broken, before anything else on the page. -->
      <div class="counters">
        @for (counter of counters(); track counter.label) {
          <button
            type="button"
            class="counter"
            [class]="'is-' + counter.tone"
            [class.selected]="stateFilter === counter.filter"
            [attr.aria-pressed]="stateFilter === counter.filter"
            (click)="filterBy(counter.filter)"
          >
            <span class="counter-value">{{ counter.value }}</span>
            <span class="counter-label">{{ counter.label }}</span>
          </button>
        }
      </div>

      <div class="toolbar">
        <mat-button-toggle-group
          [(ngModel)]="stateFilter"
          (ngModelChange)="reload()"
          hideSingleSelectionIndicator
          class="states"
        >
          <mat-button-toggle value="">All</mat-button-toggle>
          <mat-button-toggle value="DOWN">Down</mat-button-toggle>
          <mat-button-toggle value="LATE">Late</mat-button-toggle>
          <mat-button-toggle value="UP">Up</mat-button-toggle>
          <mat-button-toggle value="PAUSED">Paused</mat-button-toggle>
        </mat-button-toggle-group>

        <mat-form-field appearance="outline" subscriptSizing="dynamic" class="search">
          <sw-icon name="search" matPrefix class="search-icon" />
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
        <mat-progress-bar mode="indeterminate" class="loading" />
      }

      @if (error()) {
        <p class="sw-error" role="alert">{{ error() }}</p>
      }

      @if (!loading() && checks().length === 0) {
        <div class="sw-card sw-empty">
          <h2>Nothing is being watched yet</h2>
          <p>
            Create a check, then have your job call its ping URL when it runs — or add the Spring Boot
            starter and every scheduled task will declare itself.
          </p>
          <button mat-flat-button class="empty-action" (click)="create()" [disabled]="projects.selected() === null">
            <sw-icon name="add" />
            New check
          </button>
        </div>
      } @else {
        <div class="sw-card sw-scroll-x">
          <table class="sw-table checks">
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
                <tr [class]="'row-' + check.state.toLowerCase()">
                  <td>
                    <a [routerLink]="['/checks', check.id]" class="name">{{ check.name }}</a>
                    @if (check.environment || check.source === 'auto' || check.orphanedAt) {
                      <div class="meta">
                        @if (check.environment) {
                          <span class="sw-tag">{{ check.environment }}</span>
                        }
                        @if (check.source === 'auto') {
                          <span class="sw-tag" matTooltip="Declared automatically by a client library">auto</span>
                        }
                        @if (check.orphanedAt) {
                          <span
                            class="sw-tag orphan"
                            matTooltip="The client stopped declaring this job. History is kept; delete it when you are sure."
                            >orphaned</span
                          >
                        }
                      </div>
                    }
                  </td>
                  <td><sw-state-chip [state]="check.state" /></td>
                  <td class="sw-mono sw-muted">{{ schedule(check) }}</td>
                  <td [matTooltip]="check.lastPingAt ?? 'No ping received yet'">
                    {{ check.lastPingAt | swRelativeTime }}
                  </td>
                  <td class="sw-muted" [matTooltip]="check.nextDueAt ?? ''">
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
    /* ------------------------------------------------------------ counters --- */

    .counters {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(132px, 1fr));
      gap: 12px;
      margin-bottom: 20px;
    }

    .counter {
      display: flex;
      flex-direction: column;
      gap: 2px;
      padding: 14px 16px;
      border: 1px solid var(--sw-border);
      border-radius: var(--sw-radius-lg);
      background: var(--sw-surface);
      box-shadow: var(--sw-shadow-sm);
      font: inherit;
      text-align: left;
      cursor: pointer;
      transition:
        border-color 120ms ease,
        transform 120ms ease;
    }

    .counter:hover {
      border-color: var(--sw-border-strong);
      transform: translateY(-1px);
    }

    .counter.selected {
      border-color: color-mix(in srgb, var(--counter-color, var(--sw-accent)) 55%, transparent);
      box-shadow: 0 0 0 1px color-mix(in srgb, var(--counter-color, var(--sw-accent)) 40%, transparent);
    }

    .counter-value {
      font-size: 1.625rem;
      font-weight: 600;
      line-height: 1.15;
      font-variant-numeric: tabular-nums;
      letter-spacing: -0.02em;
      color: var(--counter-color, var(--sw-text));
    }

    .counter-label {
      font-size: 0.75rem;
      font-weight: 500;
      color: var(--sw-text-muted);
    }

    /* A zero is good news and should not be painted like a problem. */
    .counter.is-down { --counter-color: var(--sw-down); }
    .counter.is-late { --counter-color: var(--sw-late); }
    .counter.is-up { --counter-color: var(--sw-up); }
    .counter.is-zero { --counter-color: var(--sw-text-subtle); }

    /* ------------------------------------------------------------- toolbar --- */

    .toolbar {
      display: flex;
      flex-wrap: wrap;
      gap: 12px;
      align-items: center;
      margin-bottom: 16px;
    }

    .states {
      border-radius: var(--sw-radius-sm);
      background: var(--sw-surface);
    }

    .search {
      flex: 1 1 240px;
      max-width: 340px;
    }

    .search-icon {
      margin: 0 8px 0 2px;
      color: var(--sw-text-subtle);
    }

    .loading {
      margin-bottom: 12px;
      border-radius: 999px;
    }

    .empty-action {
      margin-top: 20px;
    }

    /* --------------------------------------------------------------- table --- */

    .checks {
      min-width: 760px;
    }

    /* A stripe on the row, not a colour on the text: the state chip already
       carries the colour, and two of them would only compete. */
    .checks tbody tr.row-down td:first-child {
      box-shadow: inset 3px 0 0 var(--sw-down);
    }

    .checks tbody tr.row-late td:first-child {
      box-shadow: inset 3px 0 0 var(--sw-late);
    }

    .name {
      color: var(--sw-text);
      font-weight: 500;
    }

    .name:hover {
      color: var(--sw-accent);
      text-decoration: none;
    }

    .meta {
      display: flex;
      flex-wrap: wrap;
      gap: 6px;
      margin-top: 6px;
    }

    .sw-tag.orphan {
      border-color: color-mix(in srgb, var(--sw-late) 35%, transparent);
      background: var(--sw-late-soft);
      color: var(--sw-late);
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

  /**
   * Every check matching the search, whatever its state — what the counters are
   * counting. Kept apart from `checks` so that filtering the table down to the
   * broken ones does not make "3 down" become "3 down out of 3".
   */
  private readonly population = signal<CheckDto[]>([]);

  protected stateFilter = '';
  protected search = '';

  private readonly timer = setInterval(() => this.reload(true), REFRESH_INTERVAL_MS);

  protected readonly subtitle = computed(() => {
    const all = this.population();
    if (all.length === 0) return 'Nothing is being watched in this project yet';

    const broken = all.filter((check) => check.state === 'DOWN' || check.state === 'LATE').length;
    return broken === 0
      ? `${all.length} ${plural(all.length, 'check')}, everything is reporting on time`
      : `${broken} of ${all.length} ${plural(all.length, 'check')} ${plural(broken, 'needs', 'need')} attention`;
  });

  protected readonly counters = computed<Counter[]>(() => {
    const all = this.population();
    const count = (state: CheckState): number => all.filter((check) => check.state === state).length;

    const down = count('DOWN');
    const late = count('LATE');

    return [
      // A zero here is good news; painting it red would teach people to ignore red.
      { label: 'Down', filter: 'DOWN', value: down, tone: down === 0 ? 'zero' : 'down' },
      { label: 'Late', filter: 'LATE', value: late, tone: late === 0 ? 'zero' : 'late' },
      { label: 'Reporting', filter: 'UP', value: count('UP'), tone: 'up' },
      { label: 'All checks', filter: '', value: all.length, tone: 'neutral' },
    ];
  });

  constructor() {
    this.projects.load();
    // Reacts to the picker in the header. Without this the page loaded once and
    // never again — and because it asked the account-wide endpoint, it was
    // showing every project's checks at once regardless of what was selected.
    effect(() => {
      const project = this.projects.selected();
      if (project !== null) this.reload();
    });
  }

  ngOnDestroy(): void {
    clearInterval(this.timer);
  }

  protected filterBy(state: string): void {
    if (this.stateFilter === state) return;
    this.stateFilter = state;
    this.reload();
  }

  /** @param quiet true for the background refresh, which must not flash a spinner. */
  protected reload(quiet = false): void {
    const project = this.projects.selected();
    if (project === null) return;

    if (!quiet) this.loading.set(true);

    const search = this.search.trim();
    const searchQuery = search === '' ? {} : { search };

    this.api.listProjectChecks(project.id, { ...searchQuery, limit: 200 }).subscribe({
      next: (page) => {
        const items = [...page.items].sort(byUrgency);
        this.population.set(items);
        // Unfiltered request: the table shows the same rows, so skip the second one.
        if (this.stateFilter === '') {
          this.checks.set(items);
          this.loading.set(false);
        }
        this.error.set(null);
      },
      error: (failure: unknown) => {
        this.loading.set(false);
        this.error.set(errorMessage(failure, 'Could not load checks.'));
      },
    });

    // A state filter has to be applied by the server: filtering the page we just
    // fetched would silently hide the broken checks that fell outside of it.
    if (this.stateFilter !== '') {
      const scoped = { ...searchQuery, state: this.stateFilter, limit: 200 };
      this.api.listProjectChecks(project.id, scoped).subscribe({
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

  protected readonly schedule = describeSchedule;
}

interface Counter {
  readonly label: string;
  /** Value written into `stateFilter` when the counter is clicked. */
  readonly filter: string;
  readonly value: number;
  readonly tone: 'down' | 'late' | 'up' | 'zero' | 'neutral';
}

function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many;
}

/** Broken first, then late, then everything else: the screen answers the question. */
const STATE_ORDER: Record<CheckState, number> = { DOWN: 0, LATE: 1, NEW: 2, UP: 3, PAUSED: 4 };

function byUrgency(left: CheckDto, right: CheckDto): number {
  const difference = STATE_ORDER[left.state] - STATE_ORDER[right.state];
  return difference !== 0 ? difference : left.name.localeCompare(right.name);
}

