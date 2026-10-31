# Changelog

All notable changes to SilenceWatch are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0, a minor bump may change behaviour. Anything that changes the meaning of
an existing configuration variable, an API response or the database schema is
called out under **Changed** with what to do about it.

## [Unreleased]

### Added

- **Spring Boot starter: jobs monitored on each instance** (starter 0.2.0). An application running
  as several instances declares each job once for all of them, and the check stays up while any
  instance reports it: right for a clustered Quartz job or a job behind a lock, but an instance
  whose scheduler is stuck went unnoticed while another worked. Jobs that have to run everywhere
  can now be listed in `silencewatch.per-instance-jobs`, with a stable `silencewatch.instance-id`:
  each instance then declares them in an environment of its own (`production.app-0`) and has its
  own checks. No default for the instance's name, since one that changes at every deploy would
  leave a check behind each time. Without it, the listed jobs stay shared, with a warning.
- **The same for the Python library and the Laravel package.** APScheduler runs in every process
  and a Laravel task without `->onOneServer()` on every server, with the same blind spot:
  `per_instance_jobs` / `instance_id` (Python) and `SILENCEWATCH_PER_INSTANCE_TASKS` /
  `SILENCEWATCH_INSTANCE_ID` (Laravel) do what the starter's settings do. Celery tasks and
  `->onOneServer()` tasks, which one worker or server runs at a time, are never watched per
  instance: the libraries say so and keep them shared.

### Changed

- The starter's README and documentation (in English and in French) say what a check means when
  an application runs as several instances, which they did not say at all. Two server tests hold
  it: replicas share one check that stays up while any reports, and per-instance checks keep one
  instance going quiet visible while another reports.

## [0.8.0] — 2026-10-30

**Set `ADMIN_EMAIL` before upgrading: the server no longer starts without it.** Put your
own address, the one of the account you sign in with if it exists already. In Compose and
Swarm the deploy stops and names the variable; on the hosted service, add it to the server's
env file before the release deploys.

### Added

- **Statistics, for the administrator only.** *Settings › Statistics* shows the instance's
  figures: registered accounts and checks (with what was added in the last 30 days and a small
  chart of their growth), how many checks were made by hand and how many were discovered by a
  client library, the signals received in the past 24 hours (hour by hour and by kind), the
  accounts active in the last 30 days, live subscriptions to each paid
  plan (only where the instance sells them), the alert emails sent and the alerts that failed in
  the last 30 days, day by day, the alert channels by type, and the sign-ups refused in the last
  30 days, by reason. Counts only: nothing names an account, a check or an address. The
  tab is shown to the administrator's account alone, and the route behind it
  (`GET /api/v1/admin/stats`) answers 404 to every other account, 401 to an API key, and is never
  cached (`Cache-Control: no-store`).
- **Refused sign-ups are recorded** in the audit trail as `signup.refused`, with the reason
  (sign-up closed, administrator's address without the setup link, email provider refused,
  network quotas) and nothing else: no address, no IP. They belong to no account and are only
  ever counted.

### Changed

- **`ADMIN_EMAIL` is required, and names the administrator.** The account with that address is
  the only one that sees the statistics and the server internals (`GET /api/v1/status`). It can
  be created only with the one-time link the server prints in its log, whether sign-up is open or
  not, so nobody else can register the address. The server prints a new link at every start
  until that account exists, and `silencewatch create-admin` prints one on demand.
- **Sign-up has two rules instead of four.** The administrator's address: with its link only.
  Every other address: while `SIGNUP_ENABLED=true`. With `SIGNUP_ENABLED=false`, the
  administrator's account is the only one that can be created. What these replace:
  - the first account of an empty instance is no longer whoever arrives first;
  - setup links are no longer made for other addresses: `create-admin` takes no `--email` and
    makes the administrator's link, and a link made by an earlier version for another address
    opens nothing. To let someone into a closed instance, open sign-up for the time it takes;
  - the first account no longer skips the abuse limits; the administrator's, created with its
    link, does.
- The self-hosting guide, the site's self-hosting pages (in English and in French), the README
  and `.env.example` say all this where people start, and `.env.example` lists `ADMIN_EMAIL`
  among the required settings.
- 0.8.0 in the manifests, the Compose file, the README and the release workflows' comments. A
  minor version because the server no longer starts without `ADMIN_EMAIL`.

## [0.7.0] — 2026-10-29

**Upgrade if you use Slack, Teams or Discord channels: no alert had ever been sent to them.**
The release is the outcome of a security audit and a penetration test (see **Security**), and
of what they found besides (see **Fixed**).

No configuration variable and no database schema changes. Two API answers change, which is why
this is a minor version: `GET /api/v1/status` now answers 404 to every account but the one that
runs the instance (`ADMIN_EMAIL`, or the first account), and revoking an API key through a
project it does not belong to answers 404 instead of 204.

### Security

- **An account whose passkeys were all gone could be taken over** (`AUTH_MODE=passkey`).
  Registering a passkey with an address finishes the account of that address when it was left
  with no way in, which is meant for a registration that stopped halfway. It was decided on
  passkeys and providers alone, so an account that had lost its passkeys (two tabs each
  removing one, a direct API call) went to whoever typed its address next, projects and history
  included. An account is now finished this way only if it has never signed in and holds no
  session and no recovery code. The server also refuses to remove the last passkey in this
  mode, which only the settings page did before.
- **A Microsoft sign-in is never taken as proof of the address** (`AUTH_MODE=full`). The
  linking rules already treated Microsoft as unable to vouch for an address, but a token that
  claimed `email_verified` was believed: an account it created counted as verified, so Google
  could later be linked to it, and it could join an account Google had made. The account a
  Microsoft sign-in creates is now always unverified.
- **The guard on alert targets refuses more of the addresses that lead inside a network**:
  IPv4-compatible IPv6 (`::127.0.0.1`), 6to4 (`2002::/16`), Teredo (`2001::/32`), local-use
  NAT64 (`64:ff9b:1::/48`) and site-local (`fec0::/10`). Each carries an IPv4 address and can
  reach it through a relay or a translator.
- **A check's name can no longer notify a whole Slack or Discord channel.** `<!channel>` in a
  name was sent to Slack as a mention, `@everyone` could reach Discord's. Slack text is now
  escaped as Slack asks, and Discord is told to notify nobody.
- **`GET /api/v1/status` answers only whoever runs the instance**: the account `ADMIN_EMAIL`
  names, or the first account when none is named. It describes every account at once (alert
  volumes, the last internal error, the runtime), so on an instance shared with customers any
  other account is now answered 404.
- **fastify 5.12.7** for GHSA-389g-gv7q-r4x8 (header validation bypassed by a header name in
  another case).
- **Plan limits held only one request at a time.** A check, a project, a channel or a starter
  sync counted what the account had, then created; requests sent together all counted before
  any created, and a free plan of five checks ended with eleven. Each account's
  count-then-create now runs under a lock, on every instance.
- **A heartbeat that is already known is answered whatever its address has spent on unknown
  keys.** A scanner behind the same address as real jobs (a shared NAT, or a proxy that
  `TRUST_PROXY` does not name) used to get every heartbeat from there refused for a minute,
  which is how false alerts start. Keys in the cache cost no lookup and are no longer
  throttled with it.
- **Refusals from the web server no longer log a stack trace.** A path climbing out of the web
  root, or one with a NUL in it, was answered 500 and logged in full, so anyone could fill the
  log at will. They are answered 403 or 400, and not logged.
- **Revoking an API key through another project answers 404**, and records nothing. It changed
  nothing before either, but answered 204 and wrote the revocation into the caller's audit
  trail.
- **`Permissions-Policy`** turns off camera, microphone, geolocation, payment and USB for every
  page.

### Fixed

- **Slack, Teams and Discord alerts were never sent.** Their senders were built without their
  HTTP client: the class they share was not decorated, so Nest did not know what to give their
  constructor, and every alert and every test failed with "Cannot read properties of undefined
  (reading 'send')". Email and webhook channels were not affected. The test suite replaced the
  senders with a stand-in, which is why it never showed; a test now builds them as the
  application does.
- `//p/<key>`, what a base URL ending in a slash gives in a crontab, answered the web page with
  a 200, so the job believed its heartbeat went through. It is now refused like any other
  wrong URL.

- A malformed `cursor` on `GET /api/v1/checks/:id/incidents` answered 500; it is now ignored, as
  on the pings.
- The sign-in page's `next` refuses `/\host` and paths with control characters, which a browser
  can read as another site. The server already refused them as a sign-in callback.

### Added

- **A quick start for Spring Boot**, in the README and in the documentation of the starter (in
  English and in French): get a SilenceWatch, create a key, add the starter, look for the line
  `SilenceWatch is watching N job(s)` in the log, then stop the application to see the checks go
  late and down. The starter's README now says what it needs: Java 17 or later, scheduling switched
  on (`@EnableScheduling`), and the address of the instance when self-hosting. The demo
  application was run for this against the starter downloaded from Maven Central, on Spring Boot
  3.5 and on 4.1.

- **A guide on Spring `@Scheduled` jobs that stop without an error** (in English and in French):
  what Spring does with a failing job, how one blocked job freezes the others on the default
  single scheduler thread (reproduced on Spring Boot 3.5.7), and how to be alerted. It is linked
  from the Spring Boot page and from the home page.

### Changed

- **The Spring Boot starter's version in the repository is the one released, 0.1.0**, no longer
  `0.1.0-SNAPSHOT`: its `pom.xml`, and the demo application, which now takes the starter from
  Maven Central instead of asking for it to be installed first. The release workflow still takes
  the number of a release from its tag.

## [0.6.3] — 2026-10-28

Nothing to do to upgrade: no configuration variable, API response or database schema changes. The
release is two additions to the screens of the application.

### Added

- **The checks can be filtered by environment.** A picker beside the search box lists the
  environments of the project, with "All environments" and "No environment"; it is shown only when
  some checks have an environment. It narrows the table together with the state (down, late, up,
  paused), and the counters above count the chosen environment. While the table is narrowed, a line
  under the bar says so, with a "Show all" link. A choice the checks no longer have is no filter
  rather than an empty table. Nothing is kept from one visit to the next: the page opens
  unfiltered. On a phone the picker and the search box share one row under the state segments.
- **A click on a project of the settings shows it**, as the picker in the header does: the row is
  marked with a bar at its edge and a tint, as well as the "Selected" mark, and the name can be
  reached and pressed from the keyboard. The edit and delete buttons at the end of the row do not
  select it.

## [0.6.2] — 2026-10-27

Nothing to do to upgrade: no configuration variable, API response or database schema changes. The
release is the navigation of the application on a phone, and the alert channels, the projects and
the API keys, which are lists with a dialog to add one.

### Changed

- **On a phone, the bar at the bottom is gone: the three destinations are in the menu at the top
  right.** The button shows three bars instead of the initials, so it reads as a menu, and opens
  Checks, Alerts and Settings, each with an icon and the current page marked, then Sign out set
  apart; the address of the account has an @ icon in the same column. The pages gain the room
  the bar took (82px under the end of a page, now 28px). On a wider screen nothing changes: the
  links are in the header, and the menu holds Settings and Sign out, with their icons.
- **The project selector is lower on a phone** (34px, from 40px), so it is a little lower than
  the logo (36px) and the account button (40px) on either side of it.
- **The projects and the API keys of the settings are lists in the style of the channels.** Each
  project and each key has a tile with its icon, its name, and under it what matters: for a project
  its slug, how many checks it holds and, on the one being viewed, a "Selected" mark; for a key the
  visible start of the key, when it was created and when it was last used, which is what tells a
  key in use from one that can go. A revoked key stays in the list, faded, with its mark. The
  button that creates a project is at the top right of its card, and "revoke" is under the key on
  a phone, so a long name has the whole width. The table of keys, whose columns were stacked into
  cards on a phone, is gone.
- **The sentence under the title of the settings is shorter and says what the page is**: "All the
  settings for your account", in place of "Keys for the client starters, and your account".
- **A key is created from a dialog, and the "new project" and "new key" buttons are a round "+" on
  a phone.** The form that sat above the list of keys is replaced by a "New key" button, as for a
  channel; the key is still shown once, on the page, until it is copied.
- **A channel is added from a dialog, like a check.** The form that sat above the list is gone: the
  page has a button at the top right (a round "+" on a phone, where the dialog takes the whole
  screen) and, while a project has no channel, a button in the empty card. The list is the page.
- **The alert channels are laid out more simply.** Each one has the icon of its kind (an envelope
  for e-mail, a hash for Slack, a link for a webhook) in place of a letter, its name, then its
  kind and its destination on one quieter line, which is shortened with an ellipsis when it is
  long. "Send a test" is a text button with an icon instead of an outlined one, and on a phone a
  channel is two lines: the switch at the end of the first, "Send a test" and the bin on the
  second.
- **The rows of the account menu are one size.** The sign-out is a button and the other rows
  are links, and a button keeps its own font and line height, so it looked larger. Every row is
  44px, rounded and set in from the edge of the panel, with the divider taking less room.

## [0.6.1] — 2026-10-27

Nothing to do to upgrade: no configuration variable, API response or database schema changes. The
release is the look of the application and of the website, one fix on phones, and the layout of
the client packages in the repository.

### Added

- **Documentation pages for Laravel and for Django** (`django-celery-beat`), each as an overview and
  a reference page, in English and French, with links from the footer, the sidebar and the home
  page. The site now mentions the Laravel package where it listed the Spring Boot starter and the
  Python library.

### Changed

- **Every icon of the application and of the website is now a Heroicons icon** (MIT, Tailwind
  Labs), drawn light: the 24px outline set shown at 18px (20px in icon-only buttons, which
  Material would otherwise force to 24px), and the 16px solid set for pause and play. Inside a
  button the glyph is lined up by its ink rather than its box, so the padding at the icon's end
  matches the text's, the gap to the word is the same for every icon, and the icon sits level
  with the text. They are in the buttons, the navigation, the colour-mode choice and the search
  field of the application; the feature cards, the drawings, the theme picker and the buttons of
  the website. The application's own set of Material icons is gone, and so is the website's
  `@material-design-icons/svg` dependency, replaced by `heroicons`. Icons that are not ours stay
  as they are: the flags, the Google and Microsoft logos, the GitHub mark, and what Angular
  Material and Starlight draw inside their own components (the checkbox, the select arrows, the
  search box, the menu button).
- **The state chips (down, up, paused…) are centred on their capitals.** The word is in capitals,
  which sit above the middle of their line, so the dot beside it looked 1.5px too low (2.4px on
  the check page). The word is now trimmed to its capital height where the browser allows it, so
  the dot and the word share one centre; elsewhere the word is nudged down by the difference.
- **The French "Mettre en pause" button is now "Pause"**, as in English: shorter, and it no longer
  wraps on a phone.
- **The logo is larger on a phone** (36px, from 28px), next to the project switcher and the
  account button, which are 40px.
- **The footer of the website is four short lists under their own headings** (Product,
  Integrations, Open source, Legal) instead of one run of fifteen links, in two columns on a
  phone, with the licence note set apart below. The integrations are listed by language (Java,
  PHP, Python); each link opens the page that says which frameworks the library covers.
- **The Spring Boot, Django and Laravel pages name their language**: "Java Spring Boot", "Python
  Django" and "PHP Laravel", in the title, the description and the first sentence, in English and
  in French.
- **The client packages are laid out by language, and tagged by language and package.**
  `clients/spring-boot-starter` is now `clients/java/spring-boot` and `clients/laravel` is
  `clients/php/laravel`; the Python library stays in `clients/python`, as it is one package for
  every scheduler. Release tags follow: `java-spring-boot-N.N.N` and `php-laravel-N.N.N` (the
  Laravel entry under 0.6.0 says `laravel-N.N.N`, which was never used), and `python-N.N.N` as
  before. The starter's first release, tagged `java-0.1.0`, is untouched. Nothing published
  changes; the 0.1.0 starter's POM keeps pointing at its old folder.

### Fixed

- **Choosing a tab in Settings no longer sends the tab strip back to its start.** On a phone,
  tapping a tab far along the strip, such as Account, scrolled the strip back to the first one;
  it now stays where it was.
- **On a phone, the Edit and Pause buttons of a check no longer wrap.** They share the width in
  proportion to their words instead of equally.
- **The Laravel release workflow no longer fails on `fatal: tag '0.1.0' already exists`.** It made
  the mirror's tag locally, in a checkout that holds every tag of this repository, including the
  application's `0.1.0`. The tag is now only pushed to the mirror, by refspec. Nothing had been
  pushed to the mirror when it failed.
- **The continuous integration no longer fails on Python 3.9**: `ubuntu-latest` moved to 26.04,
  which has no 3.9 build, so that job runs on `ubuntu-24.04`.

## [0.6.0] — 2026-10-24

**Back up the database before deploying this one, and keep a copy of `SECRET_KEY` with the backups.**
The channels' webhook URLs and secrets are now encrypted under `SECRET_KEY`, which happens at the
first start and cannot be undone by an older version (see **Security** and **Changed**). No
migration, no new setting.

### Security

- **Notification channel configuration is encrypted in the database.** A webhook URL is a
  secret by its path (Slack, Discord, Teams) and a webhook channel has a signing secret; both
  were readable in a backup or a dump. The whole configuration of a channel is now sealed with
  AES-256-GCM under a key derived from `SECRET_KEY`, bound to the channel it belongs to. The
  API and the web UI are unchanged. No migration: the column is the same JSON, holding the
  sealed form.

### Changed

- **`SECRET_KEY` now also protects the channels.** Rotating it was already signing everyone
  out; it now also needs `OLD_SECRET_KEY=<previous value> silencewatch reseal` once, or the
  channels cannot send (the list still loads, and the failed delivery says what to do). Keep a
  copy of `SECRET_KEY` with your database backups.
- **A channel configuration stored by an earlier version is sealed at the first start**, with
  nothing to do. It is one way: an older version cannot read a sealed channel, so back up the
  database before upgrading, and do not roll back to a version without this change.
  During a rolling update, an alert picked up by an instance not yet replaced fails and is
  retried by the next attempt, which the new instance serves.

### Added

- **A Laravel package**, `silencewatch/laravel` on Packagist (`clients/laravel`): installed with
  an API key, it declares every task of the Laravel 12 or 13 schedule with its real cron
  expression and reports each run, background tasks included, by listening to the scheduler's
  own events. `php artisan silencewatch:sync` declares from a deploy script. Tested in CI on the
  oldest and newest Laravel it allows; published by the `laravel-N.N.N` tags through a read-only
  mirror that Packagist watches, see `docs/releasing.md`.
- **The Python library reads django-celery-beat** (library 0.1.1, tagged `python-0.1.1`): the periodic tasks kept in the database are
  declared and watched by the Celery integration, with nothing to configure, and a change made
  while the workers run is declared again within a minute.
- `silencewatch reseal`, to seal every channel configuration under the current key, or to bring
  them across a `SECRET_KEY` change.
- **`examples/python-demo`**: a runnable Celery application and a runnable APScheduler one, each
  with two scheduled jobs and no monitoring code, next to the Spring Boot demo. CI checks that
  both still declare their jobs with the library in this repository.

## [0.5.3] — 2026-10-23

**Back up the database before deploying this one.** It applies two migrations at start:
`20261023120000_user_disabled` adds a nullable column and is harmless, and
`20261023130000_drop_legacy_auth` **drops** what the sign-in system before Better Auth
left behind, which cannot be undone (see **Changed**). No setting changes.

### Changed

- **The old sign-in tables are dropped.** Migration `20261023130000_drop_legacy_auth`
  removes `email_verification`, `password_reset` and `session_legacy`, and the columns
  `user.password_hash` and `user.email_verified_at`. Nothing has read them since Better
  Auth replaced the old sign-in: passwords live in `account.password`, and the address
  flag is `user.email_verified`. It was written with the move to Better Auth and kept out of the history
  until it was safe to apply; it now runs with the others. Nothing to do beyond the backup.

### Added

- **Support commands on the command line.** `cli.js` gains `show` (the account: plan,
  subscription, sign-in methods, sessions, lockout, projects), `unlock`, `end-sessions`,
  `verify-email` and `set-plan --plan <name>`, next to `create-admin`, `reset-password`
  and `recovery-codes`. Run it with no arguments for the list. Each change writes an
  `operator.change` line to the audit trail, and `reset-password` and `recovery-codes`
  now do too. See [Authentication](docs/authentication.md#support-commands).
- **`disable` and `enable` for an account that looks like abuse.** A disabled account
  cannot sign in by any method, loses its sessions, and the API keys of the projects it
  alone owns are refused; nothing is deleted, and its checks keep running. Adds a
  nullable `disabled_at` column to `user` (migration `20261023120000_user_disabled`,
  additive).
- **`silencewatch`, a short name for that command line**, on the image's PATH:
  `docker compose exec silencewatch silencewatch show --email …`. The long
  `node packages/server/dist/auth/cli.js` form still works.

### Security

- zod is forced to 4.6.6 or later in the application and the site (GHSA-mrhx-c7xc-m3w5,
  memory exhaustion validating an oversized input). The copy the application's own
  validation uses was already past it; the old one came in through Angular and Astro.
- nodemailer 10.1.7 (three moderate advisories on how addresses are parsed, GHSA-8c8m-p3m8-cjg8,
  GHSA-m943-m63m-w62w and GHSA-85x2-q946-cp5h; this one ships in the image), fast-uri
  3.1.9 and 4.2.3 (GHSA-w74x-v6f9-j3xg, GHSA-wjr9-j795-jxcr, reached through Fastify and
  Better Auth) and, on the site, undici 8.12.2.

### Dependencies

Better Auth 1.7.11, Prisma 7.10.1, jose 6.2.13, `@simplewebauthn/browser` 14 (the
passkey sign-in was run end to end in a real browser with it), Angular animations
22.2.3, ts-jest, and the CodeQL, artifact-upload and PyPI publishing actions.

## [0.5.2] — 2026-10-23

No migration and no change to an existing setting: replace the image and restart. One thing
to do in Stripe on the hosted service (the last item under **Added**).

### Changed

- **The Spring Boot starter is released with a `java-N.N.N` tag** (it was `starter-N.N.N`), named
  after its language like the Python library's `python-N.N.N`. The workflow is now
  `java-release.yml`. Nothing was published under the old name; `docs/releasing.md` has the steps.
- **The application and the website open in the dark theme** for someone who has not chosen
  one. "System" (follow the device) is now a choice like Light and Dark, so it is remembered;
  until a choice is made, nothing is stored and dark applies. People who had left the default
  alone therefore see dark too, and can pick System in Settings. On the website the picker's
  "Auto" is still there, and a visitor who has never used it gets dark.
- **A check's period and grace period are written as a number and a unit** (seconds, minutes,
  hours, days, weeks; the grace period stops at days, as it is capped at a week) instead of a
  number of seconds. A saved value opens in the largest unit that fits it: 3600 is "1 hour".
  Nothing changes in the API, which still takes seconds. A period that is a whole number of
  weeks is shown as `2w` in the lists.

### Added

- **A Python library**, `silencewatch` on PyPI (`clients/python`), that does for Python what the
  Spring Boot starter does for Java: it reads the Celery beat schedule or the APScheduler jobs of
  an application, declares them with their real schedule, and sends a heartbeat around each run.
  No dependency, never fails or blocks a job, survives the fork of Celery's workers. It is laid out
  so that the next scheduler is one module, and `clients/README.md` states the contract every
  client follows. Its documentation, its tests, a CI job on Python 3.9 to 3.13, a release workflow
  for the `python-N.N.N` tags and a page on the website, in English and French, come with it. The
  library has its own changelog and version (0.1.0); publishing it needs a PyPI account, see
  `docs/releasing.md`.
- **Opening a payment page is idempotent.** Two identical requests within a minute (a double
  click, a retry after a dropped connection) get the same Stripe session instead of two.
  Changing the plan or the language between two clicks is a different request and opens a
  new page.
- **Stripe: `customer.subscription.paused` and `customer.subscription.resumed`** are handled.
  A subscription that Stripe pauses (a trial that ended with no payment method) takes the
  paid plan away, and resuming it gives it back. **Add the two events to the webhook endpoint
  in Stripe**; an endpoint with the first three keeps working, and only misses these two cases.

## [0.5.1] — 2026-10-22

No configuration change and no migration: replace the image and restart. Nothing to do on
an instance that signs in with a passkey, a password, Google or Microsoft.

### Fixed

- **A sign-up refused because the connection already has an account** (`SIGNUP_MAX_ACCOUNTS_PER_ADDRESS`)
  said "Too many attempts, wait a moment", which sent people to wait when waiting changes nothing.
  The sign-up page now shows the server's own reason, in English and French: an account already
  exists from this network, sign in to it, or get in touch if the connection is shared.
- **Icons sat low next to their word** in buttons, the project switcher, the back link and the
  colour-mode tiles (about 1.3px below the middle of the letters, so the word read slightly high),
  and a label that wrapped on a phone (a long French one) put its icon above the text. The
  Google and Microsoft buttons of the sign-in page had both problems.

### Changed

- **One look for the application and the website**, light and dark: a lavender-grey page with
  white surfaces and a visible edge, soft glows and a dot grid behind everything, and a darker
  purple for text and links. The dark theme is the same scheme made dark. The old page was
  near-white under pale cards, so content did not stand out.
- **On a phone, the new-check button is a round "+"** on the title's row, centred between the
  title and its subtitle, so it no longer takes a row of its own.
- The colour-mode choices in Settings show the icon beside the word on a phone, as the language
  choices do.

### Added

- The website serves `/.well-known/microsoft-identity-association.json`, which Microsoft asks for
  to verify the publisher domain of the sign-in application. It holds only the application's
  public client id.

## [0.5.0] — 2026-10-21

**Sign-in is replaced by [Better Auth](https://www.better-auth.com), so read
[Upgrading](#upgrading-from-the-previous-version--mise-à-jour-depuis-la-version-précédente)
before deploying.** Everyone is signed out, and accounts made before have no way to sign in until
they are given one. The rest is additive: three migrations that only add and rename, none of
which drops what held an account (going back to 0.4.1 is possible, but the sign-ins made in
between do not exist there). Every other new feature is **off unless you turn it on**, except the test-alert
limit. That is why this is a minor version.

### Added

- **`AUTH_MODE`** chooses how people sign in, and only what it names exists: `passkey` (the
  default; a passkey, with eight single-use recovery codes), `password` (an address and
  12 characters at least), or `full` (Google, Microsoft, and a passkey added after the first
  sign-in). Any other value stops the server at startup and lists the valid ones. In
  `passkey` and `full` the server also refuses to start without `https://` (or `localhost`),
  with a passkey domain (`AUTH_RP_ID`) that does not match `BASE_URL`, or with extra origins
  (`AUTH_TRUSTED_ORIGINS`) outside it; `full` refuses to start without its four provider
  credentials. See [docs/authentication.md](docs/authentication.md).
- **A single sign-in page** that shows what the instance offers, works on a phone, and answers
  every failed sign-in the same way (wrong password, unknown address, locked account).
- **A Sign-in tab in Settings**: passkeys (several per account, added and removed there),
  recovery codes, or the password, according to the mode. A passkey is offered once after a
  first sign-in, and again after a recovery code.
- **The first account** can be named with `ADMIN_EMAIL`. While there is no account, and
  `ADMIN_EMAIL` is set or `SIGNUP_ENABLED=false`, sign-up is closed except to a **one-time link**
  printed in the server log (30 minutes, one use, that address only). The same link can be made
  at any time with `create-admin`, to let one more person into an instance that is closed.
- **Command-line recovery**, in the server container: `node packages/server/dist/auth/cli.js`
  with `create-admin`, `reset-password` (password mode) and `recovery-codes` (passkey mode).
  These are not endpoints.
- **A recent sign-in** (the last ten minutes) is now required to delete an account, to create
  or revoke an API key, and to add or remove a passkey. The page asks the person to sign in
  again, with the method the instance has, and carries on.
- New audit entries: passkey added and removed, recovery codes made and used.
- In `full` mode each provider is optional: its sign-in button, endpoint and callback exist only when both its id and secret are set, and at least one provider is required.
- Settings: `AUTH_MODE`, `AUTH_RP_ID`, `AUTH_RP_NAME`, `AUTH_TRUSTED_ORIGINS`, `ADMIN_EMAIL`,
  `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`,
  `MICROSOFT_TENANT_ID`.
- Subscriptions for the hosted service, through Stripe: a **Subscription** tab in Settings
  to see the plan and what the account uses, choose a plan on Stripe's payment page, and
  manage it (card, invoices, plan change, cancellation) in Stripe's customer portal. A payment
  moves the account to the plan it bought, a cancellation moves it back to the plan everyone
  starts on, and the quota reconciler pauses or resumes checks to match. Events from Stripe
  are verified by signature, applied once however many times they are delivered, and an older
  one never undoes a newer one. Deleting an account ends its subscription first.
  **Off, and invisible, unless `BILLING_ENABLED` is set** (it also needs `QUOTAS_ENABLED`):
  a self-hosted instance has no route, no tab and no contact with Stripe. Stripe is reached
  with `fetch`, so there is no new dependency. New settings: `BILLING_ENABLED`,
  `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `STRIPE_PLANS`, `BILLING_CURRENCY`,
  `BILLING_AUTOMATIC_TAX`, `STRIPE_API_URL`; two new tables (`subscription`, `stripe_event`)
  that nothing writes to without billing. Stripe's payment page can ask the buyer to accept
  the terms of sale (`BILLING_TERMS_URL`, `BILLING_TERMS_URL_FR`), and, for a service sold to
  professionals only, to state that they act as one in the same box
  (`BILLING_PROFESSIONAL_ONLY`); the application passes its language along.
- A pricing page on the site, in both languages, built from one list of plans.
- Limits on what a free account can cost, for the hosted service. **One account per
  connection** (`SIGNUP_MAX_ACCOUNTS_PER_ADDRESS`, off by default): counts the accounts that exist from an IPv4 address or IPv6
  /64, using a keyed hash and never the address. **Alerts per channel per hour**
  (`ALERT_MAX_PER_CHANNEL_PER_HOUR`, off by default) so that a flapping check or a channel
  aimed at someone else's mailbox cannot send without end. A project holds at most 25 live
  API keys, and an account keeps its 20 newest sessions.
- A plan limit that blocks an action is now explained in the language of the page, with the
  numbers, instead of in the server's English.

### Changed

- **Sessions are cookies**, not tokens. A session lasts 30 days and slides (using it after a
  day moves its end forward). The cookie is `HttpOnly`, `SameSite=Lax`, and `Secure` over
  HTTPS; a write made with it has to name `BASE_URL` (or an `AUTH_TRUSTED_ORIGINS` entry) in its
  `Origin`, and the sign-in endpoints refuse a foreign origin even without a cookie. **API keys
  and heartbeat URLs are untouched.**
- **Passwords are hashed with scrypt** (Better Auth's default) instead of Argon2id. Accounts
  made before this version have no password Better Auth can read: see Upgrading.
- Passwords: 12 characters at least, as before; 10 failures in a row still lock an account for
  15 minutes; the per-address rate limit is now Better Auth's, still set by
  `AUTH_RATE_LIMIT_PER_MINUTE`.
- The first account of an empty instance is no longer "always allowed" when the operator has
  named it or closed sign-up: it needs the link above. With neither, it is still whoever
  arrives first.
- Deleting an account no longer asks for the password: it needs a recent sign-in.
- The audit trail's `auth.password_reset_*` and `auth.email_verified` actions no longer exist.
- The server is compiled as `module: node20`, because Better Auth ships ES modules only. It
  runs on Node 22.22.3+ and 24.15+ as before.
- **A test alert** (the button on a channel) is limited to one per channel per minute and 20
  per account per hour, and answers 429 with the time to wait, on every instance. It sends a
  real message to an address or URL of the user's choosing. `TEST_ALERT_COOLDOWN_SECONDS` and
  `TEST_ALERT_MAX_PER_HOUR` change it; 0 turns each off.
- The site no longer says the hosted service *is* free: it has a free plan, and paid plans.

### Removed

- **Email verification, password reset by email and the sign-up proof of work**, with their
  settings (`EMAIL_VERIFICATION_REQUIRED`, `EMAIL_VERIFICATION_TTL_HOURS`,
  `UNVERIFIED_ACCOUNT_TTL_DAYS`, `PASSWORD_RESET_TTL_MINUTES`, `SIGNUP_POW_DIFFICULTY`,
  `SIGNUP_POW_TTL_SECONDS`), their routes and their screens. SilenceWatch sends no email to
  prove an address; alert emails are unchanged. A password is reset from the command line.
- The access and refresh tokens, `ACCESS_TOKEN_TTL_SECONDS` and `REFRESH_TOKEN_TTL_DAYS`, and
  the endpoints `/api/auth/register`, `login`, `refresh`, `logout`, `password`,
  `verify-email`, `resend-verification`, `forgot-password`, `reset-password` and
  `signup-challenge`. The dependency `@node-rs/argon2` goes with them; `jose` stays at version 6,
  which Better Auth requires.

### Fixed

- Resolved incidents were never deleted; they are now purged with the ping history, and a
  revoked or expired API key is deleted after 30 days.

### Database

One migration, `20261020120000_better_auth`, that only adds and renames: the tables `account`,
`verification`, `passkey` and `recovery_code`, a new `session` (the old one is kept as
`session_legacy`), and `email_verified` and `image` on `user`. **Nothing that held an account
is dropped.** The old tables and columns (`email_verification`, `password_reset`,
`session_legacy`, `user.password_hash`, `user.email_verified_at`) are unused and stay until you
apply the migration waiting in `packages/server/prisma/pending/`, outside the history on
purpose; its README says when and how.

### Upgrading from the previous version — Mise à jour depuis la version précédente

1. **Choose a mode** and set `AUTH_MODE` in `.env` (and in `docker-stack.yml` environments if
   you use Swarm: both Compose files pass the new variables through). The default, `passkey`,
   needs `https://` or `localhost`: an instance on a plain-`http://` address that is not
   `localhost` must set `AUTH_MODE=password` or it will not start, and says why.
2. **Everyone is signed out** when the new version starts: the old sessions are not read.
3. **Existing accounts keep their projects, checks and keys, but no way to sign in.** The old
   password hash is not carried over. Give each person one:
   - `password`: `docker compose exec silencewatch node packages/server/dist/auth/cli.js reset-password --email …`
     prints a new password, once;
   - `passkey`: `… cli.js recovery-codes --email …` prints codes; they sign in with one and add
     a passkey;
   - `full`: Google refuses an address nothing has proven, so run
     `UPDATE "user" SET email_verified = true WHERE email = '…';` for the people you know,
     and they sign in with Google. For everyone else, start in `password` or `passkey`
     mode and move to `full` later (see
     [docs/authentication.md](docs/authentication.md#changing-the-mode-later)).
4. **Remove the variables that no longer exist** from `.env` (listed under Removed). Left in
   place they are ignored.
5. **Scripts that signed in** to the API with `/api/auth/login` and a Bearer token should use an
   API key instead (`Authorization: Bearer sw_…`, per project). Sign-in endpoints are for
   browsers.
6. **A reverse proxy** must pass the `Origin` header (nginx and Caddy do by default) and must
   not rewrite `Host` to something that is not `BASE_URL`. If it serves the UI from another
   origin, name it in `AUTH_TRUSTED_ORIGINS`.
7. Optional, later: apply `prisma/pending/20261020120000_drop_legacy_auth` once you are sure you
   will not go back (see the README in that folder).

## [0.4.1] — 2026-10-04

Nothing changes for the application or the server: no database migration and no new
setting, only the project site.

### Fixed

- The heartbeat under the home page's hero no longer jumps back at the end of each cycle;
  it now runs round without a seam.

### Changed

- The home page's closing section reads "Get alerted by email or on any webhook." and no
  longer carries buttons or the self-hosting line.

## [0.4.0] — 2026-10-04

No database migration, so going back to 0.3.2 is safe, and no new setting: upgrading is a
change of image tag.

The reasons to take it: two security fixes (the sign-in, registration and password-reset
rate limit could be dodged by adding a query string to the address, and a page left open
past its access token's lifetime could sign the user out everywhere), and a server and
web application reorganised into smaller modules, which changes nothing a user can see.

One behaviour changed, which is why this is a minor version: `GET /api/v1/status` (the
server's internals: process, pools, caches) now answers only a user session, where it used
to answer an API key too. A script that read it with a key should use `/health`, or a
session. Everything else a key could reach is unchanged, and a new test now tries every
route with one project's key against another account's objects.


### Added

- **An uptime badge in the README.** A scheduled workflow (`.github/workflows/uptime.yml`)
  asks the hosted service's `/health` every five minutes and keeps the results on an
  `uptime` branch; the badge shows the share that answered over the last 30 days. No
  account with a monitoring service is involved. It starts working after the first
  scheduled run on `main`.

### Changed

- **Internal reorganisation, no change in behaviour, API or appearance.** The shared
  schemas and the server configuration are split into one file per domain or concern;
  the server's authentication code is split into sessions, registration, password and
  account modules, and the CRUD modules (projects, checks, channels, access) keep their
  queries in repositories; the web application is organised in `features/` with their
  own routes, one API class per resource, a Settings page made of six tab components,
  and the global stylesheet in parts. Every screen was compared before and after.
- **The site's language can be changed on a phone from the home page too**: the header
  keeps the language picker there (the other pages have it in the menu). The menu no
  longer repeats the "Login" button the header already shows.
- **The site no longer shows an "Edit page" link** under its pages.

### Fixed

- **A tab left open past its access token's lifetime could sign the user out everywhere.**
  Refresh tokens rotate, and the server treats the reuse of a spent one as theft. When
  a page made several requests at the moment the access token expired (the Settings
  page makes four), each one asked for its own refresh and the second presented a
  token the first had already spent. Refreshes are now made one at a time and shared.
- **The login, registration and password-reset rate limit could be dodged by adding a
  query string** (`/api/auth/login?1`, `?2`, …): each variant had its own budget. The
  limit now counts the path alone.
- **`GET /api/v1/status` (server internals) answered an API key.** It is now reserved
  to a user session. An API key reaches only the checks of its own project, as before:
  a test now tries every route with one project's key against another account's
  objects.

## [0.3.2] — 2026-10-04

No database migration, so going back to 0.3.1 is safe, and no new setting: upgrading
is a change of image tag.

What changes for the application: it shows the second logo on a dark page, and the
last two hand-drawn icons of the interface (the email confirmation and password
reset pages) are Material Icons like the others. Nothing in the API changed. The
rest of this release is the showcase site, which a self-hosted instance does not run.

### Changed

- **A reworked home page for the site, with motion.** A flat page (no gradient
  backgrounds) in which the slogan's second half is underlined by a drawn
  heartbeat; a live demo loops through a job going late, then down, an alert
  arriving and the next ping bringing it back (the same screen as the application,
  in CSS only); a strip of everything that can call a URL scrolls past; sections
  rise in as they come into view and the cards light up under the pointer. Text
  blocks that had nothing beside them now have an illustration (the logo sits at the
  centre of the one about what can be monitored), the copy is kept short, and the
  icons come from Google's Material Icons (Apache-2.0, the set Angular Material
  uses), inlined at build time. The calls to action read "Try it out" ("Essayer"),
  next to the "Login" button of the header, and the page says the service is free
  without describing a plan or a subscription: there is none. With reduced motion
  requested, or without script, nothing moves and nothing is hidden; the demo then
  stands still on its most telling frame. No library and no request to another site
  were added at run time. The text lives in `site/src/content/home.ts`, once for
  both languages, and an "Is SilenceWatch free?" question joins the FAQ.
- **The application's last two hand-drawn icons (the tick and the error mark of the
  email confirmation and password reset pages) are now Material Icons too**, like
  every other icon of the interface, through the same inline `sw-icon` component.
- **The site's header shows a "Login" button ("Connexion" in French) on every page**, phones
  included (on the narrowest ones the site name makes way for it, the logo stays).
- **A second logo for dark mode.** The application and the site show the pale tile
  on a light page and the purple one on a dark page, following the theme — the
  device's, or the one chosen in Settings → Preferences, which wins. The favicon
  follows the browser's own theme instead, since a tab is drawn on the browser's
  chrome rather than on the page; `favicon.ico` and the iPhone icon stay the light
  tile. The new files, `logo-dark.svg` and `logo-dark-96.png`, are listed among the
  brand files that are not under the licence.

## [0.3.1] — 2026-10-03

No database migration, so going back to 0.3.0 is safe, and no new setting: upgrading
is a change of image tag.

The reasons to take it: an account can now be deleted from Settings, by its owner,
without database access; a wrong current password in Settings no longer signs you
out; and the application has its new logo. If you script against the API, one
behaviour changed: `POST /api/auth/password` answers a wrong current password with
**403** instead of 401 (see **Fixed**), and the new `POST /api/auth/delete-account`
does the same. The rest of this release is the showcase site, which a self-hosted
instance does not run.

### Added

- **Deleting your account, from Settings → Account.** A "Delete account" section
  opens a confirmation that says, in the user's language, that the account and all
  its data are deleted immediately and for good, says how many projects and checks
  that is, and asks for two things a stray click cannot supply: a word typed out
  (`DELETE`, or `SUPPRIMER` in French) and the account's password. It removes the
  user, its sessions, and every project it is the only member of, with their
  checks, ping and incident history, API keys and alert channels. A project shared
  with other members only loses this member; an account that is the only owner of
  a project other people belong to is refused, whole, with a 409, rather than
  leaving that project without an owner. Behind it is `POST /api/auth/delete-account`
  (a user session and the password; an API key is refused), whose failed attempts
  count towards the same lockout as a login. The security log records it, with the
  address, for its retention period. Until now an account could not be deleted
  without database access.
- **Legal pages on the site, in French and English: legal notice, privacy policy
  and terms of use**, linked from the footer. The privacy policy is written from
  what the application actually stores (accounts, sessions, the security log,
  heartbeat history, alert deliveries, and how long each is kept), names the
  processors (OVH, Mailjet) and lists the one cookie, `sw_refresh`, which is
  strictly necessary. The legal notice names the host (OVH) and a contact address;
  the publisher, a private individual, stays anonymous as French law allows
  (LCEN, art. 6-III-2), and `site/src/legal.ts` is where a fuller identity goes
  the day the service is run as a business.

### Fixed

- **A wrong current password no longer signs you out of the interface.** Changing
  the password answered a wrong current password with a 401, which is also what
  tells the browser its session expired: it refreshed the session, sent the same
  wrong password a second time (counting twice towards the lockout) and then sent
  the user to the login page. It now answers 403, which leaves the session alone and
  shows "Current password is incorrect" in place.

### Changed

- **A new logo, everywhere the application and the site show one.** The pale
  rounded tile with a monitor and a heartbeat replaces the purple square with a
  white trace: in the application header and on the sign-in page (an image now, not
  a drawing in the page's colours), as the favicon (`favicon.svg`, plus a
  `favicon.ico` for browsers that ignore an SVG one, and an `apple-touch-icon.png`
  for an iPhone's home screen), on the site, and on the sharing cards. It is cut out
  of its white margin, with transparent corners rather than white ones. The new
  files are listed among the brand files that are not under the licence.
- **The site is in English by default; French is under `/fr/`.** It was the other
  way round. A browser whose first language is French is taken to the matching
  French page once, unless the visitor picked a language with the picker (the
  choice is remembered in the browser). Search engines and link previews see
  English, which is also `x-default` for `hreflang`. The French addresses move:
  `/job-monitoring/` is now `/fr/job-monitoring/`, and the English ones lose their
  `/en/` (`/en/job-monitoring/` is `/job-monitoring/`). Nobody has bookmarked these
  yet, so there is no redirect from the old ones.
- **The footer no longer lists "Cron job monitoring"** beside "Job monitoring": it
  said the same thing twice. The page itself stays, linked from the pages that
  discuss cron.

## [0.3.0] — 2026-10-03

No database migration, so going back to 0.2.3 is safe, and nothing to do for an
existing self-hosted instance: the new `SILENCEWATCH_SITE_DOMAIN` setting is
optional and, left unset, changes nothing. The licence is now Apache-2.0 for the
whole project (the name and the logo excepted).

The reasons to take it are in the interface: it can be read in French, and be
set to light or dark, from a new Preferences tab in Settings, and the end of
every page is no longer hidden under the tab bar on a phone. The hosted service
also moves to `app.silencewatch.com` with this release; a self-hoster is not
concerned.

### Added

- **A showcase site and user documentation**, in French and English, in `site/`
  (Astro and Starlight; a project of its own, outside the application's workspace,
  lockfile and image). Its slogan is "Vos Jobs ne vous préviennent pas quand ils
  s'arrêtent. Nous oui." ("Your jobs don't tell you when they stop. We do."), and
  it is written around *job monitoring* — cron is one way of scheduling a job, so
  "cron and job monitoring" would say the same thing twice; cron monitoring is a
  page of its own beneath it. Pages for what people search for — job monitoring,
  cron monitoring, Spring Boot `@Scheduled` and Quartz monitoring, what a dead
  man's switch is, self-hosting, monitoring a backup or a Kubernetes CronJob, a
  cron job that does not run — and a documentation section:
  getting started, the ping API, copy-paste examples (crontab, systemd, Docker,
  Kubernetes, GitHub Actions, Python, Node, PowerShell), schedules and states,
  alert channels (with signature verification), the Spring Boot starter, and the
  API, self-hosting and security reference generated from `docs/`. It is built to
  be found: one canonical address per page, `hreflang` between the languages, a
  sitemap, `robots.txt`, structured data (organisation, software, breadcrumbs,
  FAQ), a social-sharing image per language, no third-party request and no
  client-side framework. `scripts/check-seo.mjs` fails the build on a title over
  65 characters, a bad description, a wrong canonical, a missing `hreflang`,
  invalid structured data, a duplicate title or any internal link that leads
  nowhere; CI runs it on every pull request. It ships on its own, from
  `.github/workflows/site.yml`, whenever `site/` or `docs/` reaches `main`: built,
  checked, and swapped into the `silencewatch_site` volume with one atomic rename.
- **A Preferences section in Settings: the language, and light or dark.** The
  interface is now available in French as well as English, and the colour mode can
  be set to light, dark, or "System", which follows the device as it always did and
  stays the default. Each choice is a card with a flag or an icon (the flags are
  drawn, not typed: Windows does not render flag emoji). A French browser gets
  French on the first visit; anything else gets English. The choice applies at once
  without a reload — texts, dates ("il y a 3 minutes"), the window title, the
  table footers and the `lang` attribute — and is kept in the browser, so it is
  per device, not per account. A saved colour mode is applied before the first
  paint by a small script, `theme-init.js`, so a dark choice does not flash white
  on load. The messages the server sends are translated where they are the ones a
  person meets (wrong password, expired link, last project…); a validation detail
  or a sentence the table does not know stays as it arrives,
  in English. The translations are two JSON files read with
  [Transloco](https://jsverse.gitbook.io/transloco), each fetched only when its
  language is in use. One dependency, `@jsverse/transloco` (MIT), which brings two
  small packages of its own, one of them a pinned beta, `@jsverse/utils`; it adds
  about 18 kB (raw) to the first load. Transloco's ICU MessageFormat plugin is
  deliberately not used: it builds each message with `new Function`, which the
  Content-Security-Policy (`script-src 'self'`) forbids, so plurals are separate
  keys instead.

### Fixed

- **The security documentation no longer says authentication uses no cookies.** It
  does: the refresh token is an HttpOnly, `SameSite=Strict` cookie limited to
  `/api/auth` (a change made earlier, whose page was not updated). The page now
  says so, and why that leaves no cross-site request to forge. It matters more now
  that the same text is published on the site.
- **The end of a page is no longer hidden under the tab bar on a phone.** The room
  for the bar was reserved as padding on `<body>`, which is `height: 100%`, so
  the content overflowed past that padding instead of being pushed up by it and
  the last ~40px of every page stayed under the bar, out of reach however far you
  scrolled. The room is now on the page itself. Measured after scrolling to the
  very end, on every signed-in screen at 360 and 390 pixels wide: 13 of 18 views
  had content hidden before (by 42px), none have now (24px of clearance).

### Changed

- **The hosted application moves to `app.silencewatch.com`; the bare domain
  becomes the showcase site.** Ping URLs the hosted service hands out now start
  with `https://app.silencewatch.com/p/`, and so do the links in its emails.
  `docker-stack.yml` serves a second name when `SILENCEWATCH_SITE_DOMAIN` is set
  — the static site, `www.` redirected to it, and the addresses the application
  used to answer on the bare domain (`/p/…`, `/api/…`, `/login`, …) redirected to
  `SILENCEWATCH_DOMAIN` with a 308. Left unset, nothing changes for a
  self-hoster. CI now validates the generated Caddyfile both ways, and checks the
  site's redirect, root and headers. **To do on the server when upgrading:** point
  `SILENCEWATCH_DOMAIN` and `BASE_URL` at the application's new name and set
  `SILENCEWATCH_SITE_DOMAIN`; see the self-hosting guide.
- **The Spring Boot starter's default `base-url` is `https://app.silencewatch.com`**
  (it was the bare domain). Anyone who set it explicitly is unaffected.
- **The tabs in Settings scroll sideways under a finger, a trackpad, the wheel or a
  dragged mouse.** Six tabs do not fit a phone, and Angular Material's answer was
  two small arrow buttons that move the strip a third at a time and nothing that
  moves it under your finger. The strip is now an ordinary scrolling row with its
  scrollbar hidden: swipe it on a touchscreen; on a computer, turn the wheel over
  it (it hands back to the page when it reaches an end) or drag it with the mouse
  (letting go over a tab does not select it). The edge that has more behind it
  fades. The arrow keys still move between tabs and now bring the tab into view.
  On a screen wide enough for all six, nothing changes.
- **The tab bar on a phone is slimmer.** It was 66px tall and sits over every
  screen; it is now 58px, with a 20px icon in place of 22px, and the room reserved
  for it at the foot of a page went from 90px to 82px so the last line still ends
  24px clear of it.
- **The whole project is licensed under Apache-2.0, except the name and the logo.**
  The server and the web interface were AGPL-3.0 and everything else Apache-2.0;
  there is now one licence over all of it. In practice: you can use, modify, host
  and redistribute SilenceWatch, commercially and as a service included, without
  publishing your changes. What stays outside the licence is the brand — the name
  "SilenceWatch" and the logo — and a fork is expected to be renamed and given its
  own logo. [TRADEMARK.md](TRADEMARK.md) says what can be done without asking and
  lists exactly which files are excluded; [NOTICE](NOTICE) lists third-party
  software, one package of which (elkjs, brought in by Prisma's tooling) is under
  the Eclipse Public License 2.0, unmodified. There is a single `LICENSE` text now
  (the official one, where the old copy had been reflowed) and no
  `LICENSE.Apache-2.0`; the package manifests, the image label and the contributing
  guide follow. A new CI check keeps the licence, the manifests and the brand
  exclusion saying the same thing. Releases up to and including 0.2.3 stay under
  the licences they were published with.

## [0.2.3] — 2026-10-02

No database migration, so going back to 0.2.2 is safe. One new optional setting,
`DATABASE_STATEMENT_TIMEOUT_MS`, whose default needs no action. On a Swarm
deployment Caddy restarts once, for a few seconds, and its certificates are not
reissued.

The reason to take it is the first fix below: the Checks page could stall for
minutes in a desktop browser while the server sat idle. The interface on a phone
is the other half of the release.

### Fixed
- **A page waiting on a server that never answers now says so instead of
  spinning.** Every read had no time limit, so a connection that went silent —
  a proxy that lost its upstream, a socket the network dropped without a word —
  left the Checks page on its loading bar for as long as the browser cared to
  wait, which is minutes. A read now gives up after 30 seconds, aborts the
  request, and shows "The server is taking too long to answer". Writes are left
  alone: one that timed out in the browser may still have succeeded.
- **The Checks page asks for one thing at a time.** Its background refresh fires
  every 15 seconds whether or not the last answer had come back, so against a
  stalled server it stacked a request behind every stalled one and released them
  all together when the server recovered.
- **The Swarm stack no longer offers HTTP/3.** Caddy advertised it to every
  browser (`Alt-Svc: h3=":443"; ma=2592000`, which a browser remembers for thirty
  days), but QUIC is UDP and the routing mesh in front of Caddy is the one place
  a UDP flow is not dependable. The symptom matches what was reported: on one
  desktop browser the Checks page stalled with its requests unsent — no protocol,
  nothing transferred — and recovered after about five minutes, which is how long
  Chrome keeps QUIC marked broken before trying it again; the same site on a
  phone, and `curl`, which never tries QUIC, were fine throughout. Caddy now
  serves HTTP/1.1 and HTTP/2 only, answers `Alt-Svc: clear` so browsers that
  already learned the old advertisement forget it on their next visit, and
  `443/udp` is no longer published. Nothing to configure. Caddy restarts once on
  the deploy that carries this, a few seconds of interruption; its certificates
  are in a volume and are not reissued. Turning QUIC off in the affected
  browser (`chrome://flags/#enable-quic`) made the stalls stop, which is what
  points at this; if they continue after this release, the logging added below is
  how to find out what it was instead. Docker Compose is unchanged — it publishes
  UDP through Docker's own proxy, not the routing mesh.

### Changed
- **The interface works on a phone.** It used to come apart: the Checks table
  showed two columns and scrolled the state — the one that matters — off the
  edge, forms were clipped, and the three destinations were a second row of small
  links. Under 820px (which includes a tablet held upright) the header is one
  row with the project at full width and the three destinations move to a tab bar
  under the thumb; tables become lists of cards, the state beside the name and
  the facts below it; the check form takes the whole screen with its buttons
  pinned at the foot, while confirmations stay small; and everything you press is
  44px, with 16px fields so iOS does not zoom in on focus. Sorting is a column
  header, so on a phone each list keeps the order it was designed to be read in.
  Wider screens are unchanged. Checked in a real browser at 360, 390, 768, 844×390
  and 1280 pixels on every screen and dialog, not yet on a physical device.
- **A hint longer than one line no longer overlaps the next field.** It did on
  every screen, not only a phone: the form field reserved one line for it.
- **Database queries are bounded, and idle connections are probed.** A query on
  the API's connection pool is cancelled after 30 seconds
  (`DATABASE_STATEMENT_TIMEOUT_MS`), and all three database connections — API,
  ingestion, and the listener that invalidates the ingest cache — now send TCP
  keep-alive probes. Before this, a connection the network had dropped never
  failed on its own: the request using it waited for TCP to give up, and the
  listener never noticed it was deaf.
- **The server logs what it cannot otherwise explain afterwards.** A request that
  takes two seconds or more is logged by route pattern — never by URL, since
  heartbeat URLs are secrets — and so is any stretch of 500 ms or more in which
  the event loop did not turn. A healthy server writes neither. When the
  application seems to freeze, these say whether the process was stuck or
  something around it was.

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

### Changed

- **A release that is not ready now fails before anything is published.** The
  workflow checks, first of all, that the four package manifests carry the
  tag's version and that `CHANGELOG.md` has its section. Both used to be
  noticed at the last step, after the image was already in the registry — which
  is how 0.2.1 left an image behind with no release to go with it. A premature
  tag now fails in seconds with nothing built and nothing pushed.

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

[Unreleased]: https://github.com/liliang-dev/SilenceWatch/compare/0.8.0...HEAD
[0.8.0]: https://github.com/liliang-dev/SilenceWatch/compare/0.7.0...0.8.0
[0.7.0]: https://github.com/liliang-dev/SilenceWatch/compare/0.6.3...0.7.0
[0.6.3]: https://github.com/liliang-dev/SilenceWatch/compare/0.6.2...0.6.3
[0.6.2]: https://github.com/liliang-dev/SilenceWatch/compare/0.6.1...0.6.2
[0.6.1]: https://github.com/liliang-dev/SilenceWatch/compare/0.6.0...0.6.1
[0.6.0]: https://github.com/liliang-dev/SilenceWatch/compare/0.5.3...0.6.0
[0.5.3]: https://github.com/liliang-dev/SilenceWatch/compare/0.5.2...0.5.3
[0.5.2]: https://github.com/liliang-dev/SilenceWatch/compare/0.5.1...0.5.2
[0.5.1]: https://github.com/liliang-dev/SilenceWatch/compare/0.5.0...0.5.1
[0.5.0]: https://github.com/liliang-dev/SilenceWatch/compare/0.4.1...0.5.0
[0.4.1]: https://github.com/liliang-dev/SilenceWatch/compare/0.4.0...0.4.1
[0.4.0]: https://github.com/liliang-dev/SilenceWatch/compare/0.3.2...0.4.0
[0.3.2]: https://github.com/liliang-dev/SilenceWatch/compare/0.3.1...0.3.2
[0.3.1]: https://github.com/liliang-dev/SilenceWatch/compare/0.3.0...0.3.1
[0.3.0]: https://github.com/liliang-dev/SilenceWatch/compare/0.2.3...0.3.0
[0.2.3]: https://github.com/liliang-dev/SilenceWatch/compare/0.2.2...0.2.3
[0.2.2]: https://github.com/liliang-dev/SilenceWatch/compare/0.2.0...0.2.2
[0.2.0]: https://github.com/liliang-dev/SilenceWatch/releases/tag/0.2.0
[0.1.1]: https://github.com/liliang-dev/SilenceWatch/releases/tag/0.1.1
[0.1.0]: https://github.com/liliang-dev/SilenceWatch/releases/tag/0.1.0
