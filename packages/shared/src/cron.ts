/**
 * Dependency-free syntactic validation for cron expressions and IANA time zones.
 *
 * The server additionally computes occurrences with `cron-parser`; this module
 * exists so that the same rules can be enforced in the browser, in DTO
 * validation and in the API without pulling a scheduler into the shared package.
 *
 * The accepted dialect is deliberately the intersection of what the ecosystems
 * SilenceWatch serves produce and what the server can actually evaluate:
 *
 *  - 5 fields (Unix crontab) or 6 fields with leading seconds (Spring, Quartz);
 *  - `*`, ranges, lists, steps, and month/day names;
 *  - `?` (Quartz), `L` and `5L` (last day / last Friday), `MON#2` (nth weekday);
 *  - the `@daily` family of macros.
 *
 * Quartz's `W` (nearest weekday) is **not** accepted: the server cannot compute
 * its occurrences, and silently accepting a schedule that can never produce a
 * deadline would create a check that alerts at the wrong time — or never.
 */

const MACROS = new Set([
  '@yearly',
  '@annually',
  '@monthly',
  '@weekly',
  '@daily',
  '@midnight',
  '@hourly',
]);

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
const DAY_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];

interface FieldSpec {
  min: number;
  max: number;
  names?: readonly string[];
  /** `?` is accepted by Quartz for day-of-month / day-of-week. */
  allowQuestionMark?: boolean;
  /** `L` alone (last day of month) or `5L` (last Friday of the month). */
  allowLast?: boolean;
  /** `MON#2` — the second Monday of the month. */
  allowNth?: boolean;
}

const SECOND: FieldSpec = { min: 0, max: 59 };
const MINUTE: FieldSpec = { min: 0, max: 59 };
const HOUR: FieldSpec = { min: 0, max: 23 };
const DAY_OF_MONTH: FieldSpec = { min: 1, max: 31, allowQuestionMark: true, allowLast: true };
const MONTH: FieldSpec = { min: 1, max: 12, names: MONTH_NAMES };
const DAY_OF_WEEK: FieldSpec = {
  min: 0,
  max: 7,
  names: DAY_NAMES,
  allowQuestionMark: true,
  allowLast: true,
  allowNth: true,
};

const FIVE_FIELDS: readonly FieldSpec[] = [MINUTE, HOUR, DAY_OF_MONTH, MONTH, DAY_OF_WEEK];
const SIX_FIELDS: readonly FieldSpec[] = [SECOND, ...FIVE_FIELDS];

function parseValue(token: string, spec: FieldSpec): number | null {
  const lowered = token.toLowerCase();
  if (spec.names) {
    const index = spec.names.indexOf(lowered);
    if (index !== -1) return spec.names === MONTH_NAMES ? index + 1 : index;
  }
  if (!/^\d{1,2}$/.test(token)) return null;
  const value = Number(token);
  return value >= spec.min && value <= spec.max ? value : null;
}

function isValidField(field: string, spec: FieldSpec): boolean {
  if (field.length === 0) return false;
  if (field === '?') return spec.allowQuestionMark === true;

  return field.split(',').every((entry) => {
    if (entry.length === 0) return false;

    // `L` on its own: last day of the month (day-of-month) or Saturday
    // (day-of-week, per Quartz).
    if (entry.toUpperCase() === 'L') return spec.allowLast === true;

    // `5L` / `friL`: the last given weekday of the month.
    const last = /^(.+)L$/i.exec(entry);
    if (last !== null) {
      return spec.allowLast === true && parseValue(last[1] as string, spec) !== null;
    }

    // `MON#2`: the second Monday. The occurrence is 1..5.
    const nth = /^(.+)#([1-5])$/.exec(entry);
    if (nth !== null) {
      return spec.allowNth === true && parseValue(nth[1] as string, spec) !== null;
    }

    const [range, step, ...extra] = entry.split('/');
    if (extra.length > 0 || range === undefined) return false;
    if (step !== undefined && !/^\d{1,3}$/.test(step)) return false;
    if (step !== undefined && Number(step) < 1) return false;

    if (range === '*') return true;

    const bounds = range.split('-');
    if (bounds.length === 1) return parseValue(bounds[0] as string, spec) !== null;
    if (bounds.length !== 2) return false;

    const from = parseValue(bounds[0] as string, spec);
    const to = parseValue(bounds[1] as string, spec);
    return from !== null && to !== null;
  });
}

/** True when `expression` is a syntactically valid 5 or 6 field cron expression or macro. */
export function isValidCronExpression(expression: string): boolean {
  const trimmed = expression.trim();
  if (trimmed.length === 0 || trimmed.length > 200) return false;
  if (trimmed.startsWith('@')) return MACROS.has(trimmed.toLowerCase());

  const fields = trimmed.split(/\s+/);
  const specs = fields.length === 6 ? SIX_FIELDS : fields.length === 5 ? FIVE_FIELDS : null;
  if (!specs) return false;

  return fields.every((field, index) => isValidField(field, specs[index] as FieldSpec));
}

/** True when `timezone` is an IANA time zone the runtime can resolve. */
export function isValidTimezone(timezone: string): boolean {
  if (!/^[A-Za-z0-9+_\-/]{1,64}$/.test(timezone)) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}
