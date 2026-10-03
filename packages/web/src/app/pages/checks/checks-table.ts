import type { CheckDto, CheckState } from '@silencewatch/shared';
import type { Translate } from '../../core/i18n/i18n.service';
import type { TableRules } from '../../shared/data-table';

/**
 * The sorting, searching and grouping rules of the checks table.
 *
 * Kept out of the component because they are decisions about the product, not
 * about Angular: which order answers "is anything broken?", and what a person
 * means when they type "prod" into the box.
 */

/** Broken first, then late, then everything else: the screen answers the question. */
const STATE_ORDER: Record<CheckState, number> = {
  DOWN: 0,
  LATE: 1,
  NEW: 2,
  UP: 3,
  PAUSED: 4,
};

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
  // Pinned like the rest of the interface: a machine's locale should not
  // decide where an accented name lands in the table.
  return difference !== 0 ? difference : left.name.localeCompare(right.name, 'en');
}

/** The words on a source tag, in the language on screen. */
export function sourceWord(check: CheckDto, t: Translate): string {
  return t(check.source === 'auto' ? 'checks.sourceAuto' : 'checks.sourceManual');
}

/**
 * What the Source column says, and therefore what "auto" or "orphaned" match.
 *
 * The stored value is part of it as well as the translated word: someone who
 * knows the API types `manual` whatever language the page is in, and someone
 * reading a French page types `orphelin`.
 */
export function sourceLabel(check: CheckDto, t: Translate): string {
  const words = `${check.source} ${sourceWord(check, t)}`;
  return check.orphanedAt === null ? words : `${words} orphaned ${t('checks.sourceOrphaned')}`;
}

export function checkRules(t: Translate): TableRules<CheckDto> {
  return {
    // The four columns a person scans. Not the schedule: nobody searches for
    // "0 2 * * *", and including it makes "5" match half the table. The state is
    // searchable by its stored name and by the word shown for it.
    text: (check) => [
      check.name,
      check.environment,
      sourceLabel(check, t),
      check.state,
      t(`state.${check.state}`),
    ],

    /**
     * `state` sorts by urgency rather than alphabetically — sorting states as text
     * puts DOWN between an ordering nobody wants. Dates sort as numbers, and a
     * check that has never reported sorts as the oldest possible, because "never"
     * is the extreme of "long ago" and not a missing value to drop at one end.
     */
    sortValue: (check, column) => {
      switch (column) {
        case 'name':
          return check.name.toLowerCase();
        case 'environment':
          return (check.environment ?? '').toLowerCase();
        case 'source':
          return sourceLabel(check, t);
        case 'state':
          return STATE_ORDER[check.state];
        case 'lastPingAt':
          return check.lastPingAt === null ? 0 : Date.parse(check.lastPingAt);
        case 'nextDueAt':
          return check.nextDueAt === null ? Number.MAX_SAFE_INTEGER : Date.parse(check.nextDueAt);
        default:
          return check.name.toLowerCase();
      }
    },

    compare: byUrgency,
  };
}
