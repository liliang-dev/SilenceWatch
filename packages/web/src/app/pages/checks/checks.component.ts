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
import { MatPaginatorModule, type PageEvent } from '@angular/material/paginator';
import { MatSortModule, type Sort } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import type { CheckDto, CheckState } from '@silencewatch/shared';
import { concatMap, EMPTY, expand, reduce } from 'rxjs';
import { byUrgency, matchesSearch, sortValue, sourceLabel } from './checks-table';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/error-message';
import { ProjectStore } from '../../core/project.store';
import { RelativeTimePipe } from '../../shared/relative-time.pipe';
import { StateChipComponent } from '../../shared/state-chip.component';
import { CheckFormDialog } from './check-form.dialog';
import { IconComponent } from '../../shared/icon.component';
import { describeSchedule } from '../../shared/schedule';

const REFRESH_INTERVAL_MS = 15_000;

/** The server's own maximum, so a project of any normal size is one request. */
const PAGE_SIZE = 200;

/** 2000 checks. Past that the table is not the right tool anyway. */
const MAX_PAGES = 10;

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
    MatPaginatorModule,
    MatProgressBarModule,
    MatSortModule,
    MatTableModule,
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

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  /**
   * Every check in the project, which is what the table sorts, searches and
   * pages through.
   *
   * Held whole in the browser deliberately. The server searches `name` only and
   * orders by creation date with a keyset cursor — it can offer neither the
   * four-column search nor the column sorting this table needs, and asking it
   * per keystroke would be a request per keystroke. The cost is bounded below.
   */
  protected readonly population = signal<CheckDto[]>([]);

  protected readonly stateFilter = signal('');
  protected readonly search = signal('');
  protected readonly sort = signal<Sort>({ active: '', direction: '' });
  protected readonly page = signal<PageEvent>({ pageIndex: 0, pageSize: 25, length: 0 });

  protected readonly columns = ['name', 'environment', 'source', 'state', 'schedule', 'lastPingAt', 'nextDueAt'];
  protected readonly pageSizes = [10, 25, 50, 100];
  protected readonly sourceLabel = sourceLabel;

  /** True when the project has more checks than one load will hold. */
  protected readonly truncated = signal(false);

  /**
   * The rows the table shows: searched, filtered by state, sorted, then paged —
   * in that order, because sorting a page would sort the wrong ten rows.
   */
  protected readonly matching = computed<CheckDto[]>(() => {
    const search = this.search().trim();
    const state = this.stateFilter();

    const rows = this.population().filter(
      (check) =>
        (state === '' || check.state === state) && matchesSearch(check, search),
    );

    const { active, direction } = this.sort();
    if (active === '' || direction === '') return rows;

    const sign = direction === 'asc' ? 1 : -1;
    return [...rows].sort((left, right) => {
      const a = sortValue(left, active);
      const b = sortValue(right, active);
      if (a === b) return left.name.localeCompare(right.name);
      return (a < b ? -1 : 1) * sign;
    });
  });

  protected readonly visible = computed<CheckDto[]>(() => {
    const rows = this.matching();
    const { pageIndex, pageSize } = this.page();
    const start = pageIndex * pageSize;
    // A filter that shrinks the result below the current page would otherwise
    // show an empty table with rows behind it.
    return start >= rows.length ? rows.slice(0, pageSize) : rows.slice(start, start + pageSize);
  });

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
    this.stateFilter.update((current) => (current === state ? current : state));
    this.page.update((page) => ({ ...page, pageIndex: 0 }));
  }

  protected onSearch(value: string): void {
    this.search.set(value);
    this.page.update((page) => ({ ...page, pageIndex: 0 }));
  }

  protected onSort(sort: Sort): void {
    this.sort.set(sort);
    this.page.update((page) => ({ ...page, pageIndex: 0 }));
  }

  protected onPage(event: PageEvent): void {
    this.page.set(event);
  }

  /**
   * Loads the project's checks, following the server's cursor to the end.
   *
   * Bounded at MAX_PAGES: an unbounded loop against a paginated endpoint is one
   * bad response away from hammering the server, and a table nobody can read is
   * not worth that risk. When the bound is hit the page says so rather than
   * quietly showing a prefix — a monitoring screen that silently omits checks
   * is exactly the failure this product exists to prevent.
   *
   * @param quiet true for the background refresh, which must not flash a spinner.
   */
  protected reload(quiet = false): void {
    const project = this.projects.selected();
    if (project === null) return;

    if (!quiet) this.loading.set(true);

    let pages = 0;
    this.api
      .listProjectChecks(project.id, { limit: PAGE_SIZE })
      .pipe(
        expand((page) => {
          pages += 1;
          if (page.nextCursor === null || pages >= MAX_PAGES) return EMPTY;
          return this.api.listProjectChecks(project.id, {
            limit: PAGE_SIZE,
            cursor: page.nextCursor,
          });
        }),
        reduce(
          (all, page) => {
            all.items.push(...page.items);
            all.more = page.nextCursor !== null;
            return all;
          },
          { items: [] as CheckDto[], more: false },
        ),
      )
      .subscribe({
        next: ({ items, more }) => {
          this.population.set([...items].sort(byUrgency));
          this.truncated.set(more);
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
