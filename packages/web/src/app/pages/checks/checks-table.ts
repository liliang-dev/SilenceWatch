import type { CheckDto, CheckState } from '@silencewatch/shared';

/**
 * The sorting, searching and grouping rules of the checks table.
 *
 * Kept out of the component because they are decisions about the product, not
 * about Angular: which order answers "is anything broken?", and what a person
 * means when they type "prod" into the box.
 */

/** Broken first, then late, then everything else: the screen answers the question. */
const STATE_ORDER: Record<CheckState, number> = { DOWN: 0, LATE: 1, NEW: 2, UP: 3, PAUSED: 4 };

/**
 * The default order, and the one to come back to.
 *
 * A sortable table invites sorting by name, and a list of checks sorted by name
 * is a list in which the outage is somewhere in the middle. So urgency stays
 * the default: a column sort is something you ask for, never something you get
 * by opening the page.
 */
export function byUrgency(left: CheckDto, right: CheckDto): number {
  const difference = STATE_ORDER[left.state] - STATE_ORDER[right.state];
  return difference !== 0 ? difference : left.name.localeCompare(right.name);
}

/** What the Source column says, and therefore what "auto" or "orphaned" match. */
export function sourceLabel(check: CheckDto): string {
  return check.orphanedAt === null ? check.source : `${check.source} orphaned`;
}

/**
 * One value per sortable column.
 *
 * `state` sorts by urgency rather than alphabetically — sorting states as text
 * puts DOWN between an ordering nobody wants. Dates sort as numbers, and a
 * check that has never reported sorts as the oldest possible, because "never"
 * is the extreme of "long ago" and not a missing value to drop at one end.
 */
export function sortValue(check: CheckDto, column: string): string | number {
  switch (column) {
    case 'name':
      return check.name.toLowerCase();
    case 'environment':
      return (check.environment ?? '').toLowerCase();
    case 'source':
      return sourceLabel(check);
    case 'state':
      return STATE_ORDER[check.state];
    case 'lastPingAt':
      return check.lastPingAt === null ? 0 : Date.parse(check.lastPingAt);
    case 'nextDueAt':
      return check.nextDueAt === null ? Number.MAX_SAFE_INTEGER : Date.parse(check.nextDueAt);
    default:
      return check.name.toLowerCase();
  }
}

/**
 * Free-text search across the four columns a person actually scans.
 *
 * Every term has to match somewhere, so "prod down" narrows rather than widens
 * — typing more words getting you more rows is the behaviour that makes people
 * stop using a search box. Matching is case-insensitive and on substrings, so
 * "env" finds "environment" and "dow" finds DOWN.
 */
export function matchesSearch(check: CheckDto, search: string): boolean {
  const terms = search.toLowerCase().split(/\s+/u).filter((term) => term.length > 0);
  if (terms.length === 0) return true;

  const haystack = [
    check.name,
    check.environment ?? '',
    sourceLabel(check),
    check.state,
  ]
    .join(' ')
    .toLowerCase();

  return terms.every((term) => haystack.includes(term));
}
