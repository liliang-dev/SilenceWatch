---
name: dependabot
description: >-
  Consolidate every open Dependabot pull request in this repository into one
  verified pull request against `dev`, then close the superseded bot PRs and
  merge once CI is green. Use this whenever the user mentions Dependabot, a
  dependency backlog, bumps, "the bot PRs", updating dependencies, a security
  advisory from GitHub, or asks why there are so many open pull requests — and
  also when they simply say "update the dependencies" or "clean up the PRs"
  without naming Dependabot. Prefer this over merging bot PRs one by one: each
  is tested against a base that moves, so merging them individually is how a
  green diff still breaks the build.
---

# Consolidating the Dependabot backlog

Dependabot opens one pull request per package. Each is built against the base as
it stood when its run started, so ten green pull requests are ten claims about
ten different repositories, none of which is the one you get after merging them
all. That is the problem this skill exists to solve: replace *n* independently
tested branches with **one branch tested once, as it will actually land**.

The second thing it exists for is honesty about what was left out. A backlog is
never fully applicable — some majors genuinely cannot be taken yet. Those are
worth as much as the ones you apply, provided the reason is recorded where the
next person will look.

## The shape of a run

1. Read every open Dependabot pull request and triage it.
2. Build one branch off `dev` and apply the safe bumps together.
3. Apply each major on its own, verifying between them.
4. Verify the whole thing the way CI will.
5. Open one pull request against `dev` saying what was applied and what was not.
6. Close the superseded bot pull requests, each with its reason.
7. Merge when every check is green.

Work through it in order. Steps 4 and 5 are where this earns its keep — resist
the urge to open the pull request before the suite has actually run.

## 1. Read the backlog

There is no `gh` CLI in this environment. Use the GitHub MCP tools
(`mcp__github__list_pull_requests` with `state: "open"`, then
`mcp__github__pull_request_read` for the diff of anything you are unsure about).
Filter to `dependabot[bot]` as the author.

For each one record: ecosystem, package, from → to, whether it is a security
update, and whether it is a major. Group them:

- **Routine** — patch and minor. Apply together; they rarely interact.
- **Majors** — each one is a migration. One at a time, full verification between.
- **Security** — a named advisory. These have a clock on them; say so in the
  pull request body, and if the fix cannot be applied, resolve the advisory
  another way (see *Overrides* below) rather than leaving it open.

If the backlog is large, say what you found before you start work. "Eleven open:
seven routine, three majors, one security" is a useful sentence.

## 2. One branch, the routine bumps first

```bash
git fetch origin dev
git switch -c deps/<yyyy-mm-dd> origin/dev
```

**Do not merge Dependabot's branches.** They conflict with each other by
construction — each carries its own lockfile resolved against a different base.
Re-apply the version change in the manifest instead and let the resolver do the
rest:

```bash
pnpm --filter <workspace> add -D <pkg>@<version>   # or edit package.json directly
pnpm install --no-frozen-lockfile
```

For GitHub Actions bumps, edit the SHA pin and the trailing `# vX.Y.Z` comment
together — the comment is the only human-readable record of what the SHA is.

## 3. Majors, one at a time

A major is a migration and deserves its own verification pass. After each one,
run the full pipeline from `references/verification.md`. If it fails:

- Try to fix it if the fix is small and belongs to us.
- Otherwise revert that bump alone, keep the rest, and **write down what broke
  and what would have to change** — that sentence is the deliverable for a
  rejected bump.

A rejected major should also get an `ignore` entry in `.github/dependabot.yml`,
so it is not re-proposed, tested and rejected again every week. Each entry names
the condition for deleting it. An ignore with no expiry condition is how a
project ends up three majors behind without anyone having decided to be:

```yaml
    ignore:
      # @angular/compiler-cli asks for `typescript: >=6.0 <6.1`. With 7 the
      # build fails inside readConfiguration before compiling anything.
      # Delete this when Angular's peer range admits 7.
      - dependency-name: typescript
        update-types: [version-update:semver-major]
```

## 4. Verify the way CI will

Read `references/verification.md` and run it. The short version: a clean
type-check proves almost nothing here. Two real failures from this repository's
history got through `tsc` and were caught only by the build and the end-to-end
suite:

- **zod 4** changed `.default()` so it no longer parses its argument. On a
  string-union setting the typed default silently became the *string* `"false"`.
  Nothing failed to compile; 103 end-to-end tests went red and fastify reported
  `invalid IP address: false`. Had it shipped, an operator would have believed a
  CIDR was configured while the instance trusted no proxy.
- **TypeScript 7** type-checks the whole workspace cleanly and then kills
  `ng build` inside `readConfiguration`, because `@angular/compiler-cli` pins
  `typescript: >=6.0 <6.1`.

So: build the Angular app, run the e2e suite against a real PostgreSQL, and
build the container image if the Dockerfile or a runtime dependency moved.

When a peer range refuses a bump, that is an answer, not an obstacle. Never
loosen a peer range or add `--force` to make a major fit.

## 5. Overrides, for advisories the parent has not picked up

When a security advisory reaches you through a transitive dependency and there
is no direct bump to take, resolve it in `pnpm-workspace.yaml`:

```yaml
overrides:
  # GHSA-…— reached only through <parent>, which is a dev dependency, so
  # nothing we ship contains it. Overridden anyway: the fix is a patch release,
  # and an advisory left open is an advisory nobody reads.
  uuid@<11.1.1: '^11.1.1'
```

Confirm with `pnpm audit --audit-level=moderate` before and after — "no known
vulnerabilities found" is the evidence, not the intention. Delete an override as
soon as its parent ships the fix; one that outlives its reason silently pins a
version nobody is choosing.

## 6. One pull request, against `dev`

Never against `main` — `main` receives exactly one kind of pull request, and
this is not it. Sign every commit off (`git commit -s`); the DCO check reads the
whole range, and a missing sign-off anywhere fails it.

The body needs four things:

- **Applied** — package, from → to, one line each.
- **Left out, and why** — the exact error, quoted. This is the section people
  come back for.
- **Advisories resolved**, with the `pnpm audit` result.
- **How it was verified** — the commands that actually ran, with their counts.

Write it so a reader can decide without re-running anything.

## 7. Close the superseded bot pull requests

Only after your pull request exists. Close each one with a comment that says
which of the two happened: *applied in #N*, or *tested and rejected, here is the
error and here is the condition for revisiting*. Closing without a reason is how
the same major gets proposed and re-tested by someone else next month.

Every comment ends with the attribution footer:

```
---
_Generated by [Claude Code](https://claude.ai/code)_
```

## 8. Merge only on green

Check every run, not just the ones that finished first
(`mcp__github__pull_request_read` with `method: "get_check_runs"`). Merge when
all of them are `success` — a check still `in_progress` is not a pass, and one
red check means the consolidation did not work and needs another pass.

Use **squash** for this merge: it is a feature branch going into `dev`, one
subject, one commit. (The opposite rule applies to the `dev → main` promotion,
which must be a merge commit — squashing there detaches the branches and
produces `add/add` conflicts on untouched files at the next release.)

If a repository ruleset blocks the merge, report the rule rather than working
around it.

## Things that will bite

- **Node version.** Angular's CLI refuses anything outside
  `^22.22.3 || ^24.15.0 || >=26.0.0`, and a container's default node is often
  just below. If `ng build` refuses to start, fetch a matching node into the
  scratchpad rather than skipping the build — the build is the point.
- **`minimumReleaseAge` and Dependabot's `cooldown` must agree.** This repo
  holds packages for three days (`minimumReleaseAge: 4320` in
  `pnpm-workspace.yaml`, `cooldown.default-days: 3` in `dependabot.yml`). If
  they drift, Dependabot proposes a version the install refuses, which reads as
  a broken pipeline rather than as the policy working.
- **The install-script allowlist.** `allowBuilds` in `pnpm-workspace.yaml` is a
  control only while it is short. CI fails the build past five entries. If a
  bump needs a new one, that is a decision to explain, not a line to add.
- **`--frozen-lockfile` at the end.** Re-run it before opening the pull request:
  it proves the lockfile you committed is the one a clean install produces.
