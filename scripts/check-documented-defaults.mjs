/**
 * Every default printed in docs/self-hosting.md has to be the default the
 * server actually applies.
 *
 * A wrong default in that table is worse than a missing one: it is followed.
 * Someone reads "SIGNUP_POW_DIFFICULTY | 0" and leaves it alone, believing they
 * know what their instance does. The table drifted from the schema once already
 * — the way it always drifts, one bump at a time — so it is now compared to it.
 *
 * The schema is parsed as text rather than imported: this runs before anything
 * is built, and it must not need a Prisma client or a database.
 */
import { readFileSync } from 'node:fs';

const CONFIG = 'packages/server/src/config/config.ts';
const DOC = 'docs/self-hosting.md';

const source = readFileSync(CONFIG, 'utf8');
const body = source.slice(source.indexOf('const envSchema'));

/** name -> declared default, '—' when optional, null when required. */
const schema = new Map();
for (const m of body.matchAll(/^ {4}([A-Z][A-Z0-9_]*): (.+?),?\s*$/gm)) {
  const [, name, expr] = m;
  // `prefault` is `default` that parses its argument; both declare the value an
  // operator sees when the variable is unset, which is what the table promises.
  const declared = /\.(?:default|prefault)\(([^)]*)\)/.exec(expr);
  schema.set(name, declared ? normalise(declared[1]) : expr.includes('optional(') ? '—' : null);
}

/** Numeric separators and quoting are formatting, not disagreement. */
function normalise(value) {
  const trimmed = value.trim().replace(/^['"]|['"]$/g, '').replaceAll('_', '');
  return trimmed === '' ? '—' : trimmed;
}

const problems = [];
let checked = 0;

// Only three-column tables — `| `VAR` | default | meaning |`. The two-column
// ones list meanings, not defaults, and reading them here would compare a
// sentence against a value.
for (const m of readFileSync(DOC, 'utf8').matchAll(
  /^\|\s*`([A-Z][A-Z0-9_]*)`\s*\|\s*`?([^|`]*)`?\s*\|[^|]*\|/gm,
)) {
  const [, name, raw] = m;
  // Deploy-time secrets (SWARM_*) are not application configuration.
  if (!schema.has(name)) continue;

  checked += 1;
  const documented = normalise(raw);
  const actual = schema.get(name);
  if (actual === null) {
    problems.push(`${name}: documented as "${documented}" but the schema gives it no default`);
  } else if (documented !== actual) {
    problems.push(`${name}: documented as "${documented}", schema says "${actual}"`);
  }
}

if (problems.length > 0) {
  console.error(`${DOC} disagrees with ${CONFIG}:\n`);
  for (const problem of problems) console.error(`  ${problem}`);
  console.error(`\nFix the table, or the schema — but they have to say the same thing.`);
  process.exit(1);
}

console.log(`ok   ${checked} documented defaults match the schema`);
