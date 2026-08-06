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
  templateUrl: './checks.component.html',
  styleUrl: './checks.component.scss',
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

