import type { CheckDto } from '@silencewatch/shared';

/**
 * The environment filter of the checks table: what the checks have to choose between, which of them
 * a choice keeps, and whether the choice still applies after a refresh of the data.
 *
 * Nothing here is kept from one visit to the next: the table opens unfiltered, and the choices are
 * made again.
 */

/**
 * The environment filter value for checks that have none. An environment typed by a person is
 * never this, as it is not one a person would type.
 */
export const NO_ENVIRONMENT = '__none__';

/** The environments the checks have, in order, without the empty ones. */
export function environmentsOf(checks: readonly CheckDto[]): string[] {
  const names = new Set<string>();
  for (const check of checks) {
    const name = check.environment?.trim();
    if (name !== undefined && name !== '') names.add(name);
  }
  return [...names].sort((left, right) => left.localeCompare(right, 'en'));
}

export function matchesEnvironment(check: CheckDto, environment: string): boolean {
  if (environment === '') return true;
  const own = check.environment?.trim() ?? '';
  return environment === NO_ENVIRONMENT ? own === '' : own === environment;
}

/**
 * The environment filter that applies to these checks.
 *
 * A chosen environment the checks no longer have (another project is shown, or the last check of it
 * was renamed or deleted) is not an empty table: it is no filter, as the table would otherwise
 * show nothing with no way to see why.
 */
export function effectiveEnvironment(
  environment: string,
  environments: readonly string[],
  hasUnset: boolean,
): string {
  if (environment === '') return '';
  if (environment === NO_ENVIRONMENT) return hasUnset && environments.length > 0 ? environment : '';
  return environments.includes(environment) ? environment : '';
}
