import { computed, signal, type Signal } from '@angular/core';
import type { PageEvent } from '@angular/material/paginator';
import type { Sort } from '@angular/material/sort';

/**
 * The searching, sorting and paging every table in this application does.
 *
 * Four screens show a list of things that happened, and all four want the same
 * behaviour: type to narrow, click a header to reorder, page through the rest.
 * Written once per screen that would be four sets of signals to keep in step,
 * and four chances for "clearing the search leaves you on page 7" to be true on
 * one of them.
 *
 * All of it runs in the browser, on rows already loaded. That is a deliberate
 * limit rather than an oversight: these endpoints paginate by keyset cursor and
 * search nothing, so server-side filtering would mean a request per keystroke
 * against an API that cannot answer the question anyway. It holds because the
 * pages that use it load a bounded number of rows — a few hundred at most — and
 * each of them says so when it hits that bound.
 */
export interface TableRules<T> {
  /**
   * The columns the search box looks at, per row.
   *
   * What a person can search for should be what they can see, so this returns
   * the same strings the table renders — including derived ones like "orphaned"
   * that exist only as a tag.
   */
  readonly text: (row: T) => readonly (string | null | undefined)[];

  /** One comparable value per sortable column. */
  readonly sortValue: (row: T, column: string) => string | number;

  /**
   * The order before anyone clicks a header, and the one to come back to.
   *
   * Every table here defaults to something more useful than alphabetical — most
   * recent first, or most broken first — and that ordering is the reason the
   * page is worth opening.
   */
  readonly compare: (left: T, right: T) => number;

  /** Rows per page before the reader changes it. */
  readonly pageSize?: number;
}

const DEFAULT_PAGE_SIZE = 10;

/** Offered in every paginator, so the control means the same thing everywhere. */
export const PAGE_SIZES = [10, 25, 50, 100];

export class DataTable<T> {
  /** Everything loaded, which is what gets searched — not just the visible page. */
  readonly rows = signal<readonly T[]>([]);

  readonly search = signal('');

  /**
   * The tab strip, state chips and dropdowns above the table.
   *
   * Kept as a predicate rather than a set of named filters because no two of
   * these tables filter on the same thing, while all of them filter.
   */
  readonly filter = signal<(row: T) => boolean>(() => true);

  readonly sort = signal<Sort>({ active: '', direction: '' });
  readonly page = signal<PageEvent>({ pageIndex: 0, pageSize: DEFAULT_PAGE_SIZE, length: 0 });

  /** Rows left after the search box and the filter, in order. */
  readonly matching: Signal<readonly T[]>;

  /** The page of `matching` currently on screen. */
  readonly visible: Signal<readonly T[]>;

  /** True when something is being excluded, which is when "no results" needs explaining. */
  readonly narrowed = computed(
    () => this.search().trim() !== '' || this.matching().length !== this.rows().length,
  );

  constructor(private readonly rules: TableRules<T>) {
    this.page.set({ pageIndex: 0, pageSize: rules.pageSize ?? DEFAULT_PAGE_SIZE, length: 0 });

    this.matching = computed(() => {
      const terms = splitTerms(this.search());
      const keep = this.filter();

      const rows = this.rows().filter(
        (row) => keep(row) && matchesTerms(this.rules.text(row), terms),
      );

      const { active, direction } = this.sort();
      if (active === '' || direction === '') return [...rows].sort(this.rules.compare);

      const sign = direction === 'asc' ? 1 : -1;
      return [...rows].sort((left, right) => {
        const a = this.rules.sortValue(left, active);
        const b = this.rules.sortValue(right, active);
        // Ties fall back to the default order rather than to whatever the sort
        // happened to do, so a column of equal values is not shuffled.
        if (a === b) return this.rules.compare(left, right);
        return (a < b ? -1 : 1) * sign;
      });
    });

    this.visible = computed(() => {
      const rows = this.matching();
      const { pageIndex, pageSize } = this.page();
      const start = pageIndex * pageSize;
      // Typing into the search box while on page 7 would otherwise leave an
      // empty table with results behind it.
      return start >= rows.length ? rows.slice(0, pageSize) : rows.slice(start, start + pageSize);
    });
  }

  setRows(rows: readonly T[]): void {
    this.rows.set(rows);
  }

  onSearch(value: string): void {
    this.search.set(value);
    this.firstPage();
  }

  setFilter(predicate: (row: T) => boolean): void {
    this.filter.set(predicate);
    this.firstPage();
  }

  onSort(sort: Sort): void {
    this.sort.set(sort);
    this.firstPage();
  }

  onPage(event: PageEvent): void {
    this.page.set(event);
  }

  private firstPage(): void {
    this.page.update((page) => ({ ...page, pageIndex: 0 }));
  }
}

function splitTerms(search: string): readonly string[] {
  return search
    .toLowerCase()
    .split(/\s+/u)
    .filter((term) => term.length > 0);
}

/**
 * Every term has to appear somewhere in the row.
 *
 * So "prod down" narrows rather than widens — typing a second word and getting
 * more rows is the behaviour that makes people stop using a search box. Matching
 * is case-insensitive and on substrings, so "dow" finds DOWN.
 */
function matchesTerms(fields: readonly (string | null | undefined)[], terms: readonly string[]): boolean {
  if (terms.length === 0) return true;

  const haystack = fields
    .filter((field): field is string => typeof field === 'string')
    .join(' ')
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}
