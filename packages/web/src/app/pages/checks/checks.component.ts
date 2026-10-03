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
import { MatPaginatorModule } from '@angular/material/paginator';
import { MatSortModule } from '@angular/material/sort';
import { MatTableModule } from '@angular/material/table';
import type { CheckDto, CheckState } from '@silencewatch/shared';
import { EMPTY, type Subscription, expand, reduce } from 'rxjs';
import { byUrgency, checkRules } from './checks-table';
import { DataTable, PAGE_SIZES } from '../../shared/data-table';
import { ApiService } from '../../core/api.service';
import { errorMessage } from '../../core/error-message';
import type { MessageKey } from '../../core/i18n/messages';
import { I18n } from '../../core/i18n/i18n.service';
import { ProjectStore } from '../../core/project.store';
import { PAGINATOR_INTL } from '../../shared/paginator-intl';
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
  providers: [PAGINATOR_INTL],
  templateUrl: './checks.component.html',
  styleUrl: './checks.component.scss',
})
export class ChecksComponent implements OnDestroy {
  private readonly api = inject(ApiService);
  private readonly dialog = inject(MatDialog);
  protected readonly projects = inject(ProjectStore);
  private readonly i18n = inject(I18n);
  protected readonly t = this.i18n.t;

  protected readonly loading = signal(false);
  protected readonly error = signal<string | null>(null);

  /**
   * The table, holding every check in the project — which is what it searches,
   * sorts and pages through.
   *
   * Held whole in the browser deliberately. The server searches `name` only and
   * orders by creation date with a keyset cursor — it can offer neither the
   * four-column search nor the column sorting this table needs, and asking it
   * per keystroke would be a request per keystroke. The cost is bounded below.
   */
  protected readonly table = new DataTable<CheckDto>(checkRules(this.t));

  protected readonly stateFilter = signal('');

  protected readonly columns = ['name', 'environment', 'source', 'state', 'schedule', 'lastPingAt', 'nextDueAt'];
  protected readonly pageSizes = PAGE_SIZES;

  /** True when the project has more checks than one load will hold. */
  protected readonly truncated = signal(false);

  /** Every check loaded, before the search box and the state filter. */
  protected readonly population = this.table.rows;

  private readonly timer = setInterval(() => this.reload(true), REFRESH_INTERVAL_MS);

  /** The load in flight, if any. */
  private inFlight: Subscription | null = null;

  protected readonly subtitle = computed(() => {
    const all = this.population();
    if (all.length === 0) return this.t('checks.subtitleEmpty');

    const broken = all.filter((check) => check.state === 'DOWN' || check.state === 'LATE').length;
    return broken === 0
      ? this.i18n.plural('checks.subtitleOk', all.length)
      : // Counted by how many are broken; the noun follows the total in English
        // ("1 of 5 checks needs attention"), and French simply does not use it.
        this.i18n.plural('checks.subtitleBroken', broken, {
          broken,
          count: all.length,
          noun: this.i18n.plural('checks.noun', all.length),
        });
  });

  protected readonly counters = computed<Counter[]>(() => {
    const all = this.population();
    const count = (state: CheckState): number => all.filter((check) => check.state === state).length;

    const down = count('DOWN');
    const late = count('LATE');

    return [
      // A zero here is good news; painting it red would teach people to ignore red.
      {
        label: 'checks.counterDown',
        filter: 'DOWN',
        value: down,
        tone: down === 0 ? 'zero' : 'down',
      },
      {
        label: 'checks.counterLate',
        filter: 'LATE',
        value: late,
        tone: late === 0 ? 'zero' : 'late',
      },
      {
        label: 'checks.counterReporting',
        filter: 'UP',
        value: count('UP'),
        tone: 'up',
      },
      {
        label: 'checks.counterAll',
        filter: '',
        value: all.length,
        tone: 'neutral',
      },
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
    this.inFlight?.unsubscribe();
  }

  protected filterBy(state: string): void {
    this.stateFilter.set(state);
    this.table.setFilter((check) => state === '' || check.state === state);
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

    // One load at a time. The background refresh fires every few seconds whether
    // or not the last answer has come back, so against a server that has stopped
    // answering it used to stack a new request behind every stalled one — and
    // release them all at once when it recovered. A refresh that finds one still
    // running has nothing to add; a deliberate load (a new project, a created
    // check) replaces it, because what it was fetching is already stale.
    if (this.inFlight !== null && !this.inFlight.closed) {
      if (quiet) return;
      this.inFlight.unsubscribe();
    }

    if (!quiet) this.loading.set(true);

    let pages = 0;
    this.inFlight = this.api
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
          this.table.setRows([...items].sort(byUrgency));
          this.truncated.set(more);
          this.loading.set(false);
          this.error.set(null);
        },
        error: (failure: unknown) => {
          this.loading.set(false);
          this.error.set(errorMessage(failure, this.t('checks.loadFailed'), this.t));
        },
      });
  }

  protected create(): void {
    const project = this.projects.selected();
    if (project === null) return;

    this.dialog
      .open(CheckFormDialog, {
        data: { projectId: project.id },
        panelClass: 'sw-sheet',
      })
      .afterClosed()
      .subscribe((created?: CheckDto) => {
        if (created) this.reload();
      });
  }

  protected readonly schedule = (check: CheckDto): string => describeSchedule(check, this.t);
}

interface Counter {
  /** A message key: the label is looked up where it is drawn, so it follows the language. */
  readonly label: MessageKey;
  /** Value written into `stateFilter` when the counter is clicked. */
  readonly filter: string;
  readonly value: number;
  readonly tone: 'down' | 'late' | 'up' | 'zero' | 'neutral';
}
