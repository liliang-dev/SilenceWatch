# Changelog

All notable changes to SilenceWatch are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0, a minor bump may change behaviour. Anything that changes the meaning of
an existing configuration variable, an API response or the database schema is
called out under **Changed** with what to do about it.

## [Unreleased]

### Added

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
  that nothing writes to without billing.
- A pricing page on the site, in both languages, built from one list of plans.
- A plan limit that blocks an action is now explained in the language of the page, with the
  numbers, instead of in the server's English.

- Limits on what a free account can cost, for the hosted service. **A test alert** (the button
  on a channel) is limited to one per channel per minute and 20 per account per hour, and
  answers 429 with the time to wait (`TEST_ALERT_COOLDOWN_SECONDS`, `TEST_ALERT_MAX_PER_HOUR`);
  both apply everywhere, and can be turned off with 0. **One account per connection**
  (`SIGNUP_MAX_ACCOUNTS_PER_ADDRESS`, off by default, needs `EMAIL_VERIFICATION_REQUIRED`):
  counts the accounts that exist from an IPv4 address or IPv6 /64, using a keyed hash and
  never the address. **Alerts per channel per hour** (`ALERT_MAX_PER_CHANNEL_PER_HOUR`, off by
  default) so that a flapping check or a channel aimed at someone else's mailbox cannot send
  without end. A project holds at most 25 live API keys, and an account keeps its 20 newest
  sessions. Two additive columns and an index.

### Fixed

- Resolved incidents were never deleted; they are now purged with the ping history, and a
  revoked or expired API key is deleted after 30 days.

### Changed

- The site no longer says the hosted service *is* free: it has a free plan, and paid plans.

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

[Unreleased]: https://github.com/liliang-dev/SilenceWatch/compare/0.4.1...HEAD
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
