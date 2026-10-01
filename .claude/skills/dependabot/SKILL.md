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
2. Fetch, branch off the **current** `origin/dev`, and apply the safe bumps together.
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

**Audit the untouched `dev` before reading a single diff:**

```bash
pnpm audit --audit-level=moderate     # what CI's supply-chain job enforces
pnpm audit --prod                     # the part of it that ships in the image
```

If `dev` is already red, the backlog is not the cause and no bot pull request can
be green — each carries the same failing audit. Once, sixty-one advisories had
accumulated unnoticed and the bot's own pull requests were red for it. Then split
the findings by the second command: advisories in build tooling are a formality,
advisories in the `--prod` tree are the actual work, and they are what the rest of
this run is ordered around.

Also check the environment before blaming anything on a dependency. These
containers get recycled: `node_modules`, the scratchpad's Node 24 and the
PostgreSQL role have each vanished between sessions, and a missing role surfaces
as Prisma's `P1000: Authentication failed`, which reads exactly like a regression
and is not one.

## 2. One branch, off the current `dev`

Start by fetching, and branch from `origin/dev` rather than from a local `dev`
or from whatever branch is checked out:

```bash
git fetch origin dev
git switch -c deps/<yyyy-mm-dd> origin/dev
git log --oneline -1 origin/dev    # note it: this is the base you tested against
```

This matters more here than anywhere else. The whole reason for consolidating is
that Dependabot tested each pull request against a base that has since moved —
building this one on a stale `dev` would reproduce exactly the failure the skill
exists to prevent, and it would do so while claiming to have fixed it.

Two ways the base goes stale without looking stale:

- A local `dev` that has not been pulled. It can be days behind and `git status`
  will not say so unless it is tracking.
- Reusing a branch whose pull request was already squash-merged. The squash put
  a *new* commit on `dev`, so the old branch is not an ancestor of anything; its
  commits reappear in the next pull request and its base is frozen at the merge.
  After a merge, restart the branch (`git switch -C <name> origin/dev`) rather
  than continuing on it.

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

**Prove every proposed line landed.** Once a `sed` with `|` as its delimiter and
`\|` for alternation matched nothing, exited 0, and a pull request claimed pins it
had not moved. Edit with a script that asserts it changed something, and then,
before committing, diff each bot branch's added lines against your tree:

```bash
mine=$(git diff origin/dev -- '*package.json' '.github/workflows/*' '*pom.xml' \
  | grep '^+[^+]' | sed 's/^+//;s/[[:space:]]*$//' | sort -u)
git diff origin/dev refs/dbot/<group> -- '*package.json' '.github/workflows/*' '*pom.xml' \
  | grep '^+[^+]' | sed 's/^+//;s/[[:space:]]*$//' \
  | while IFS= read -r l; do grep -Fxq "$l" <<<"$mine" || echo "DIFFERS: $l"; done
```

Every line it prints must be a deviation you chose and can name. Do this from the
working tree, not `HEAD`: before the first commit they are the same commit and the
diff is empty, which looks like success.

**Pick versions the install policy will actually allow.** `minimumReleaseAge`
refuses anything under three days old, and the newest release of a package is
often exactly that — several advisory fixes were published the same morning. List
what is eligible instead of guessing (`pnpm view <pkg> time --json`, keep the
entries older than three days) and bump to the newest of those. Read the install's
exit status too: when it refuses, nothing has been installed, and a type-check
that then passes is a type-check of the old tree.

## 3. Majors, one at a time

A major is a migration and deserves its own verification pass. After each one,
run the full pipeline from `references/verification.md`. If it fails:

- Try to fix it if the fix is small and belongs to us.
- Otherwise revert that bump alone, keep the rest, and **write down what broke
  and what would have to change** — that sentence is the deliverable for a
  rejected bump.

Before installing a major, spend twenty seconds on how it is *packaged*, because
that is where this repository's majors have actually failed:

```bash
pnpm view <pkg>@<new> --json | python3 -c "import sys,json;d=json.load(sys.stdin);\
print(d.get('type','commonjs'), json.dumps(d.get('exports'))[:200])"
```

`type: module` with no `require` condition means ESM-only. The server is
CommonJS and Jest cannot `require()` ESM without `--experimental-vm-modules`, so
an ESM-only dependency passes in production, where Node 22+ can, and fails the
suite. Seen three times: jose 6, `content-disposition` 3 (pulled in by
`@fastify/static` 10.1.4), and all of Nest 12. A package with both `import` and
`require` conditions (nodemailer 10) is fine. One condition lifts every one of
these blockers at once — the server and its tests running as ES modules — so
`.github/dependabot.yml` points them all at it.

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
is no direct bump to take, resolve it in `pnpm-workspace.yaml`. Three questions
decide how much care it needs.

**Does it ship?** Follow the path `pnpm audit` prints and check the parent
against the Dockerfile's production install. Most advisories here arrive through
build tooling — `@angular/build`, `@nestjs/cli`, `vite`, `autocannon` — and
nothing in the image contains them, so the override is a formality, taken
because CI fails from `moderate` up rather than because anyone is at risk. Some
do ship: `prisma` and `@prisma/client` are runtime dependencies on purpose,
because the entrypoint runs `prisma migrate deploy`, and `--prod` keeps them.
Say which case it is in the comment. Someone deciding later whether the override
can go needs that sentence more than you need it now.

**Does the override cross an exact pin?** The parent's own manifest tells you.
A parent asking for `^7.1.0` will take `7.2.0` on its own eventually and the
override merely hurries it; a parent pinning `7.1.5` exactly has been told to
use that version and no other, and forcing a major past it is a bet that the
API it relies on did not change. That bet is testable, so test it — exercise
the parent along the path the override crosses:

```
$ prisma version          → Loaded Prisma config from prisma.config.ts.
$ prisma generate         → ✔ Generated Prisma Client
$ prisma migrate deploy   → No pending migrations to apply.
```

A clean `pnpm audit` proves the version changed. It says nothing about whether
the software still works, and when the overridden package ships inside a runtime
dependency that distinction is the whole point: `prisma migrate deploy` is what
starts the container, so an override that breaks it turns a theoretical advisory
into a real outage.

**Which copy does the runtime load?** Bumping your own dependency fixes nothing
if a framework carries a second copy of it. `@nestjs/platform-fastify` pins
`fastify` exactly — 5.11.3 across the whole Nest 11 line — and it is the adapter
that builds the instance serving requests, so our own `fastify ^5.12.5` was a
second copy used for types while the authentication-bypass advisory sat in the
one that mattered. Look for the duplicate, and resolve from the parent's own
directory rather than from yours:

```bash
pnpm why <pkg>                      # more than one version = a second copy
node -e "console.log(require(require.resolve('<pkg>/package.json',
  {paths:['<the parent, under node_modules/.pnpm>']})).version)"
```

Read a version off `node_modules/.pnpm` with care: it keeps directories for
versions the lockfile no longer references, so a glob finds the stale one first.
The lockfile and `require.resolve` are the truth.

Write one override selector **per major** of a package that exists in several
(`brace-expansion@>=2.0.0 <2.1.7: ^2.1.7`, not `<5`): they are separate codebases
that share a name, and one broad selector drags the older users across a major
for nothing.

Overrides also expire. Now and then remove them all, install, and look at what
the resolver picks unaided: three of four had become dead weight and one had not,
and the file's own rule is to delete them the moment the parent ships the fix.

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

A pull request that targets `main` is not like the others. Dependabot's
*security* updates ignore `target-branch` and go to the default branch, so one can
appear beside a backlog that is all aimed at `dev`. It cannot be consolidated —
`main` only ever receives `dev`, as a merge commit — and applying it there on its
own is usually worse than nothing: the bot picks the first fixed version of the
one package, which may leave later advisories open and does nothing about a
framework's exact pin. Close it with that explanation, and then say plainly in
your report that **`main` stays vulnerable until `dev` is promoted** and by what
distance (`git rev-list --count origin/main..origin/dev`). A fix that lives only
on `dev` protects nobody running the published image. Promoting is the
maintainer's decision, not part of this run.

Every comment ends with the attribution footer:

```
---
_Generated by [Claude Code](https://claude.ai/code)_
```

## 8. Merge only on green, and only against the `dev` you tested

Verification can take a while, and `dev` moves while it runs. Before merging,
check whether the base is still the one you branched from:

```bash
git fetch origin dev
git log --oneline -1 origin/dev          # same commit as in step 2?
```

If it moved, bring it in and **run the verification again** — a lockfile
resolved against last hour's `dev` is exactly the stale-base problem in a new
costume, and merging on the strength of the earlier run would be asserting
something you did not test:

```bash
git merge origin/dev        # or rebase, if the branch has no shared history yet
pnpm install --no-frozen-lockfile   # the lockfile may need to re-resolve
```

Then check every run, not just the ones that finished first
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
