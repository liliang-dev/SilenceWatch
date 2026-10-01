# Changelog

All notable changes to SilenceWatch are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0, a minor bump may change behaviour. Anything that changes the meaning of
an existing configuration variable, an API response or the database schema is
called out under **Changed** with what to do about it.

## [Unreleased]

## [0.2.2] — 2026-10-01

A release-pipeline fix only: the application, the database schema and the
configuration are exactly what 0.2.0 shipped, so there is nothing to migrate,
no new setting, and going back to 0.2.0 is safe. Nobody running the image needs
to hurry; the people it matters to are those who deploy to a Swarm with the
release workflow.

There is no 0.2.1 release. The tag was cut before its changelog entry and the
version bump had landed, so the workflow built and pushed an image and then
refused to publish empty release notes. A published tag is never moved; this
is the next number, carrying the same fix.

### Fixed

- **The first automatic deployment no longer fails its own health check.** The
  release workflow probed `/health` once, two seconds after creating the
  services, when a freshly created service has no update status for the
  convergence wait to look at — so on a stack's first deploy it asked before
  PostgreSQL and the application had started, and failed on a port nobody was
  listening on yet. It now polls within the same seven-minute budget and, if
  the budget runs out, prints the service's task list. Upgrades were never
  affected.

## [0.2.0] — 2026-10-01

No database migration and no new setting: upgrading is the usual pull and
restart, and going back to 0.1.1 is safe. The reason to take it soon is the
Security section — the HTTP framework under every request was carrying
advisories, one of them an authentication bypass.

### Security

- **The HTTP server is on fastify 5.12.5.** Seven advisories applied below
  that: an authentication bypass through malformed URLs reaching encapsulated
  routes, three ways around request validation (an asynchronous validation
  result, a boolean `false` schema, header-name case normalisation),
  `X-Forwarded-*` spoofing under a hop-count `trustProxy`, and an HTTP/2 denial
  of service. Raising our own `fastify` dependency would have changed nothing:
  `@nestjs/platform-fastify` pins its own copy exactly — 5.11.3 across the
  whole Nest 11 line — and that copy is the one that answers requests. The
  version is forced past that pin in `pnpm-workspace.yaml`, and checked by
  asking which copy the adapter actually loads. Authentication here is a Nest
  guard rather than an encapsulated fastify hook, nothing serves HTTP/2, and
  `TRUST_PROXY` is documented as a list of addresses rather than a hop count,
  so we have not shown that any of these was exploitable in SilenceWatch — we
  did not try to — but they were in the layer that handles every request.
- **nodemailer is on 10.** Seven advisories: recipient-domain validation
  bypasses, quadratic-time address parsing, and a process-wide DNS cache that
  reused the TLS server name across connections. Three of them are fixed only
  in 10, which is why this is a major. If alerts leave over SMTP this is the one
  that touches you; the STARTTLS path was exercised against a relay that
  refuses plaintext until TLS is up.
- `@nestjs/platform-fastify` 11.2.6 (a path-scoped middleware bypass, fixed in
  11.2.4), `@angular/router` 22.2.0, and overrides for `fast-uri` (twelve
  host-confusion and SSRF advisories, reached through fastify's serialiser),
  `brace-expansion` and `js-yaml`. `mysql2` is the odd one out: the Prisma CLI
  bundles it, and the image keeps that CLI to run migrations. SilenceWatch talks
  to PostgreSQL and never opens a MySQL connection, so that advisory was
  unreachable here and is overridden only so the audit can be clean.
- Nothing a dependency ships runs at install time unless it is named in
  `allowBuilds`, and that list is four packages. A postinstall script from a
  compromised package is how the npm ecosystem's actual compromises have
  worked, and it runs with whatever the developer or the build has.
- Nothing published in the last three days is installed. Dependabot is set to
  the same three days, so the two agree instead of fighting.
- CI fails on an advisory of moderate severity or above, and on the
  install-script allowlist growing past five entries.

### Added

- **Projects can be created, renamed and deleted** from Settings → Projects.
  Deleting one says how many checks go with it — "36 pings and 15 incidents are
  destroyed with it" — instead of asking whether you are sure.
- **Settings is five tabs** — Projects, API keys, Password, Security activity,
  Account — instead of four unrelated concerns stacked on one page.
- **The Checks list, a check's Recent pings and Incidents, and Security activity
  are tables you can search, filter, sort and page.** Search covers a check's
  name, environment, source and state; a ping's body, exit code and source
  address; an event's action, actor and target. Urgency stays the default order
  on Checks, because a list sorted by name is one where the outage is somewhere
  in the middle.
- **Confirmations are modals that name what is lost**, replacing the browser's
  native dialogs for rotating a ping URL, deleting a check or a channel, and
  revoking an API key.

### Changed

- **An account can no longer delete its last project.** `DELETE
  /api/v1/projects/:id` answers `409` instead of leaving an account that every
  screen assumes has one. Create another project first. The UI disables the
  button; the server is what enforces it.
- Validation errors are worded by zod 4 — `Invalid option: expected one of
  "interval"|"cron"`. The shape of the error body is unchanged; if you match on
  the text, match on `details[].path` instead.
- The interface is English whatever the browser's language: relative times
  ("3 minutes ago") and the sort order of accented names no longer follow the
  machine's locale, so a French browser stops reading "il y a 3 minutes" next to
  "never" and "just now".
- New logo, and one purple across the whole product. The mark is the brand
  waveform, traced from the artwork rather than redrawn — the vertices, the
  baseline and the stroke width are measured from it — on `#8b4bf1`, which is
  the same value the light theme uses for every button and link. That is the
  lightness at which white on the mark and the mark's colour on white both
  clear 4.5:1, so the logo and the interface no longer need two purples that
  merely resemble each other. The dark theme lightens the accent to `#bc95fc`
  and leaves the mark alone. Alert and account emails moved with it — three of
  them were still on a blue that matched nothing.

- **The project builds with pnpm.** `npm install` no longer produces a tree that
  matches a lockfile; `corepack enable` then `pnpm install` does. The version of
  pnpm is pinned with its hash in `package.json`, so CI, the image and a
  contributor's laptop all run the same one. Nothing about running SilenceWatch
  changes — the image is built the same way and contains no package manager.
- The container image installs its production dependencies from the lockfile
  rather than pruning the build tree. Copying selected directories out of a
  pnpm `node_modules` copies links whose targets are left behind, and the
  version of that trick for npm had already produced one release that started,
  migrated, and died on a missing package.
- Dependency majors taken since 0.1.1: `zod` 4, `cron-parser` 5, `@fastify/cors`
  11, `nodemailer` 10 and `vitest` 5 (the Angular 22.2 builder admits it); Angular
  itself moves from 22.1 to 22.2, which the router advisory needs. Nest 12 is not
  among them: it is ESM-only and the server is CommonJS, so it is a migration of
  the server, not an update. `@fastify/static` is held at 10.1.3 for the same
  reason, and the Dependabot configuration records the one condition that lifts
  both.
- Pull requests go to `dev`, and `main` receives `dev` as a merge commit once it
  is green. CI also runs on pushes to `dev` and `main`, not only on pull
  requests. See CONTRIBUTING.md.

### Fixed

- **The Checks page showed every project's checks at once** and ignored the
  project picker. It follows the selected project now, live, without a reload.
- Recent pings, Incidents and Security activity quietly showed only the newest
  50, 20 and 60 rows, so searching for something older could only ever fail, and
  look as though it had not happened. They load up to 200 and say so when there
  is more.
- Fifteen documented settings now actually reach the server. `SIGNUP_ENABLED`,
  the whole sign-up integrity block, quotas, `AUDIT_RETENTION_DAYS`,
  `EMAIL_FROM_NAME` and `ALLOW_PRIVATE_NOTIFICATION_TARGETS` were described in
  `.env.example` but forwarded by neither `docker-compose.yml` nor
  `docker-stack.yml`, so setting them changed nothing and the server kept its
  default — `SIGNUP_ENABLED=false` left registration open. CI now fails if a
  name `.env.example` documents is missing from either file.
- `PLAN_LIMITS` accepts a blank value, like the other optional settings. It
  could not be given a Compose default at all: `${PLAN_LIMITS:-{}}` ends the
  interpolation at the first brace.

## [0.1.1] — 2026-08-03

### Fixed

- A setting left blank no longer stops the server. `SMTP_URL`, `POSTMARK_TOKEN`,
  `BREVO_API_KEY` and `OUTBOUND_HEARTBEAT_URL` are optional, but Compose and
  Swarm turn `KEY: ${KEY:-}` into `KEY=""` — present and invalid rather than
  absent — so a deployment that deliberately set none of them refused to start
  on `OUTBOUND_HEARTBEAT_URL: Invalid url`. Blank now means unset; a value that
  is present and wrong is still rejected.

### Added

- `docker-stack.yml`, a Docker Swarm deployment that upgrades without dropping
  requests: two replicas, `start-first`, and the image's health check decide
  when the old version stops. PostgreSQL is pinned to a node and updates
  `stop-first`, because two of it on one data directory corrupt it.
- HTTPS, behind a Compose profile so the one-command path is unchanged.
  `docker compose --profile tls up -d` adds Caddy, which obtains and renews a
  certificate on its own. `docker compose up -d` still needs the same two
  values it always did.
- The release workflow deploys to a swarm over SSH once a tag's image is
  published and verified, and fails on a rollback rather than reporting a
  success that did not happen.
- Status badges in the README: CI, CodeQL, the release workflow and the
  published version.

### Changed

- The release workflow updates an existing GitHub release instead of failing
  when one is already there, and labels the image with the commit it was
  actually built from rather than the branch it was dispatched from.
- `.env.example` no longer suggests `TRUST_PROXY=true`, which production
  refuses: it now says to name the proxy's network, and both Docker networks
  declare a fixed subnet so there is one to name.

### Security

- `fast-uri` updated (#33).

## [0.1.0] — 2026-08-02

First tagged release. Everything below was developed before the project had
versions, so it is recorded as one entry rather than invented history.

### Security

- Outbound HTTP now vets a host given as an IP address before opening the
  socket. Node skips the DNS lookup entirely when there is nothing to resolve,
  so the SSRF guard — which lived inside that lookup — never ran for a URL
  naming its target numerically. The creation preflight had the same gap for a
  bracketed IPv6 host, which it treated as an unresolvable name and allowed.
- Heartbeat ingestion now enforces its budget for unknown ping keys. The budget
  was computed and discarded, and since `/p/*` bypasses the request pipeline,
  nothing else bounded it: walking the URL space bought unlimited unauthenticated
  database lookups on the pool that heartbeats depend on. A source that has spent
  its budget is answered `429`, never `404` — telling a job with a valid URL that
  its check does not exist would be a lie about the one thing this path reports.
- Verification, resend and password-reset email are now throttled per recipient
  address. The per-IP limit counts senders, and it is the recipient who is
  attacked. The cooldown keys on a delivery that actually happened, so a failed
  send does not lock the retry out.
- Changing a password now clears the login lockout, as resetting one already did.
- Every GitHub Actions workflow is pinned to a commit SHA rather than a moving
  tag.

### Added

- `project.deleted` in the audit trail, recorded against the account rather than
  the project — a trail readable only through the project would have died with
  it. Deleting a project takes every check, ping and incident with it, and left
  no trace at all.
- `auth.logout`, `check.created` and `project.updated` audit events, which were
  declared but never written.
- Code of conduct, issue templates, `CODEOWNERS`, Dependabot and CodeQL.

### Fixed

- An audit-trail cursor reached `BigInt()` unvalidated, turning a malformed query
  string into a 500.
- `engines.node` declared `>=20.11`, which Angular 21 does not support. It now
  states the range the dependencies actually require.

### Changed

- The test harness applies `trustProxy` the way the server does. Every injected
  request previously looked like `127.0.0.1`, so no per-source control was
  actually being tested.

[Unreleased]: https://github.com/liliang-dev/SilenceWatch/compare/0.2.2...HEAD
[0.2.2]: https://github.com/liliang-dev/SilenceWatch/compare/0.2.0...0.2.2
[0.2.0]: https://github.com/liliang-dev/SilenceWatch/releases/tag/0.2.0
[0.1.1]: https://github.com/liliang-dev/SilenceWatch/releases/tag/0.1.1
[0.1.0]: https://github.com/liliang-dev/SilenceWatch/releases/tag/0.1.0
