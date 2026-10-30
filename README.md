# 🇫🇷 SilenceWatch

**Open-source heartbeat monitoring for cron jobs, workers and scheduled tasks.
Your jobs check in when they run; when one goes quiet, you hear about it.
Self-host it, or use the hosted service.**

[![CI](https://github.com/liliang-dev/SilenceWatch/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/liliang-dev/SilenceWatch/actions/workflows/ci.yml?query=branch%3Amain)
[![CodeQL](https://github.com/liliang-dev/SilenceWatch/actions/workflows/codeql.yml/badge.svg?branch=main)](https://github.com/liliang-dev/SilenceWatch/actions/workflows/codeql.yml?query=branch%3Amain)
[![Latest release](https://img.shields.io/github/v/release/liliang-dev/SilenceWatch?include_prereleases&sort=semver&label=release)](https://github.com/liliang-dev/SilenceWatch/releases)
[![Uptime](https://img.shields.io/endpoint?url=https%3A%2F%2Fraw.githubusercontent.com%2Fliliang-dev%2FSilenceWatch%2Fuptime%2Fbadge.json&cacheSeconds=300)](https://app.silencewatch.com)

<!--
  The first two badges are served by GitHub itself and report the workflows in
  this repository. `?branch=main` matters: without it a badge shows the most
  recent run on any branch, so a failing pull request would make a healthy main
  look broken.

  There is no badge for the Release workflow, on purpose. It runs on tags, not
  on main, so a badge scoped to main would report the last manual dispatch from
  main — a failure from before the first release — for as long as nobody
  dispatches it again, whatever the tagged runs did.

  The release badge counts prereleases on purpose — 0.1.0 is published as one,
  and a badge that reads "no releases" while a release exists is worse than
  absent. Its colour is chosen by shields.io from the version itself, not set
  here — orange while the version is below 1.0 or a prerelease, blue from 1.0 —
  so it is not a status and is deliberately not forced to green, which beside
  the CI badges would read as one. It is served by shields.io.

  The uptime badge is served by shields.io too. It shows the share of
  the last 30 days' probes (one every five minutes, by .github/workflows/uptime.yml)
  in which app.silencewatch.com/health answered. It reads `badge.json` on the
  `uptime` branch, which that workflow creates on its first run — until then the
  badge shows an error.
-->

---

## The problem

A scheduled job that silently stops running looks exactly like a scheduled job
with nothing to do. No error is raised, no alert fires, nobody notices — sometimes
for weeks. Backups, ETLs, exports and billing runs are the usual victims, and they
are usually noticed by the person who needed yesterday's data.

SilenceWatch is a dead man's switch. Each monitored task sends a **heartbeat** (a
plain HTTP call) when it runs. You declare how often it should run and how late it
may be. If the heartbeat does not arrive in time, you get told.

```bash
# in a crontab
0 2 * * *  /usr/local/bin/backup.sh && curl -fsS -m 10 --retry 3 https://app.silencewatch.com/p/<ping-key>
```

That is the entire integration for a shell script. For Java, Python and PHP, there is
something better — see below.

## Quick start: Spring Boot in five minutes

You have a Spring Boot application with `@Scheduled` methods or Quartz jobs. Nothing else is
needed: no check to create, no URL to paste into a job.

1. **Get a SilenceWatch.** Create an account on the hosted service,
   [app.silencewatch.com](https://app.silencewatch.com) (there is a free plan), or
   [self-host it](#self-hosting) with `docker compose up -d`.
2. **Create an API key**: *Settings → API keys → New key*. It is shown once; copy it.
3. **Add the starter** to your build, and the key to your configuration:

   ```xml
   <dependency>
     <groupId>com.silencewatch</groupId>
     <artifactId>silencewatch-spring-boot-starter</artifactId>
     <version>0.1.0</version>
   </dependency>
   ```

   ```yaml
   silencewatch:
     api-key: ${SILENCEWATCH_API_KEY}
     # base-url: https://silencewatch.example.com   # only when you self-host
   ```

4. **Start the application** with `SILENCEWATCH_API_KEY` set. The log says
   `SilenceWatch is watching 2 job(s)`, and each job is in *Checks*, tagged `auto`, with its real
   schedule. A heartbeat is sent around every run, with its duration and whether it failed.
5. **Try it.** Stop the application: the checks go *late*, then *down*. Add an alert channel
   (*Alerting → New channel*, then *Send test*) to be told.

It needs Java 17 or later, and scheduling switched on (`@EnableScheduling`, which your
`@Scheduled` methods already need to run). It has been run against Spring Boot 3.5 and 4.1.

To see it without touching your own code, run the [demo application](examples/spring-boot-demo/README.md):
two scheduled jobs, one of which fails every third run.

## What makes it different

Most monitoring tools ask you to create a check for every job and paste its ping
URL into the job. SilenceWatch also ships **client libraries that read your scheduler
and do it for you**: add the dependency and an API key, restart, and every
scheduled job appears in SilenceWatch with its real schedule and sends a heartbeat
around each run, with its duration and whether it failed. No check to create by
hand, no ping URL to copy, nothing to keep in sync when the code changes.

| Language | Package | Reads |
| --- | --- | --- |
| Java | `silencewatch-spring-boot-starter` (Maven Central) | `@Scheduled` methods and Quartz jobs |
| Python | `silencewatch` (PyPI) | Celery beat, django-celery-beat and APScheduler |
| PHP | `silencewatch/laravel` (Packagist) | the Laravel 12 and 13 scheduler |

All three work the same way:

1. **At startup, one call declares every job found**, with its real cron expression
   or interval. Each job has a stable identity, so its history survives restarts and
   deploys. A job that disappears from the code is flagged *orphaned*, never deleted.
2. **Around each run, a heartbeat is sent**: when it starts, then whether it
   succeeded or failed, with the duration.

And they follow the same rules, so they are safe to put in production: they **never
fail or block your job**, they **do nothing when there is no key or no network**,
and they bring no heavy dependency.

### Java: Spring Boot

```xml
<dependency>
  <groupId>com.silencewatch</groupId>
  <artifactId>silencewatch-spring-boot-starter</artifactId>
  <version>0.1.0</version>
</dependency>
```

```yaml
silencewatch:
  api-key: ${SILENCEWATCH_API_KEY}
```

At startup, the starter finds every `@Scheduled` method and every Quartz job.
See [`clients/java/spring-boot`](clients/java/spring-boot/README.md) and the runnable
[`examples/spring-boot-demo`](examples/spring-boot-demo/README.md).

### Python: Celery, APScheduler and Django

```bash
pip install "silencewatch[celery]"   # or [apscheduler], [django-celery-beat]
export SILENCEWATCH_API_KEY=sw_...
```

```python
from silencewatch.integrations.celery import instrument

instrument(app)
```

One line reads the Celery beat schedule, the jobs of an APScheduler scheduler, or
the periodic tasks that django-celery-beat keeps in the database (a task added in the
Django admin is picked up within a minute). See
[`clients/python`](clients/python/README.md) and the runnable
[`examples/python-demo`](examples/python-demo/README.md).

### PHP: Laravel

```bash
composer require silencewatch/laravel
```

```dotenv
SILENCEWATCH_API_KEY=sw_...
```

Nothing else to write: the package listens to the events Laravel's scheduler already
fires, so your tasks are not wrapped or changed. `php artisan silencewatch:sync`
declares the schedule at the end of a deploy. See
[`clients/php/laravel`](clients/php/laravel/README.md).

The client libraries are listed, with the contract they share, in
[`clients`](clients/README.md). Anything else can check in with a plain HTTP call.

## Self-hosting

One command, one container, one database:

```bash
git clone https://github.com/liliang-dev/SilenceWatch.git
cd SilenceWatch
cp .env.example .env         # set SECRET_KEY, POSTGRES_PASSWORD and ADMIN_EMAIL
docker compose up -d
```

This pulls `ghcr.io/liliang-dev/silencewatch:0.7.0`; nothing is built locally.

Create your account with the one-time link the server prints in its log
(`docker compose logs silencewatch`): it is the only way to create the account of
`ADMIN_EMAIL`, the administrator's, which alone sees the instance's statistics.
Passkeys need `https://` or `localhost`; on a plain-`http://` address set
`AUTH_MODE=password`. Schema migrations
run automatically at startup, so upgrading is: bump the tag in `docker-compose.yml`,
`docker compose pull`, `docker compose up -d`.

Full guide: [docs/self-hosting.md](docs/self-hosting.md).

**The self-hosted edition is never crippled.** There is no reserved feature, no
"enterprise edition", no seat limit. The hosted service at
[silencewatch.com](https://silencewatch.com) sells not running a server, not
features. The site there also carries the user documentation; the hosted
application itself is at [app.silencewatch.com](https://app.silencewatch.com).

## How it works

Two paths matter, and they are built very differently on purpose.

**Ingestion** (`GET`/`POST /p/:pingKey`) is the path that must never fall over. It
is bare: no ORM, no validation pipes, no guards, no interceptors, no outbound
call. One prepared statement updates the check and records the ping, and the
handler answers `OK`. It accepts GET and POST because people put `curl` in a
crontab, and it has variants for run start, explicit failure and exit codes:

```
GET|POST /p/<key>            the run succeeded
GET|POST /p/<key>/start      the run started (gives you durations)
GET|POST /p/<key>/fail       the run failed
GET|POST /p/<key>/<exit>     exit code — 0 succeeds, anything else fails
```

**Detection** runs every 10 seconds and never scans all checks. A partial index on
`next_due_at` makes each pass cost what the *late* checks cost. Rows are claimed
with `FOR UPDATE SKIP LOCKED`, so running two instances never doubles an alert.

Past its deadline a check goes `LATE`; past its deadline plus its grace period it
goes `DOWN`, an incident opens, and every enabled channel is notified. A heartbeat
brings it back `UP`, resolves the incident and sends a recovery alert — but only
to people who were told about the outage in the first place.

## Stack

- **Backend** — NestJS on Fastify (throughput matters on the ingestion route)
- **Database** — PostgreSQL, and nothing else. It is also the work queue
  (`FOR UPDATE SKIP LOCKED`) and the cache-invalidation bus (`LISTEN`/`NOTIFY`)
- **ORM** — Prisma for CRUD and migrations, and never on the ingestion path
- **Frontend** — Angular + Angular Material, served by the same process
- **Deployment** — Docker Compose on a single VPS

No Redis, no Kafka, no Kubernetes, no microservices. Every component added is a
component to monitor, which would be ironic for this product.

## Scope

Heartbeat ingestion (push), silence detection, alerting by email, webhook, Slack,
Teams and Discord, checks/projects/users, ping and incident history, API keys and a
REST API, client libraries for Java, Python and PHP, one-command self-hosting.

## Licensing

SilenceWatch is licensed under the **[Apache License 2.0](LICENSE)** — the server,
the web interface, the shared types, the client libraries, the Spring Boot starter
and the examples alike. You may use, modify, host and redistribute it, commercially
included, and nothing in it asks you to publish your own code.

The **name "SilenceWatch" and the logo are not covered** by that licence: they are
the project's brand, and the code does not carry them with it. In short — run it,
modify it, say that you use it, freely; if you fork and distribute it, give it its
own name and logo. [TRADEMARK.md](TRADEMARK.md) has the detail and lists exactly
which files are excluded; [NOTICE](NOTICE) lists third-party software.

Releases up to and including 0.2.3 were published with the server and the web
interface under AGPL-3.0 and the rest under Apache-2.0. Those releases stay
available under the licence they were published with; the Apache License 2.0
applies to what is released after them.

## Contributing

Pull requests go to **`dev`**, not `main`, and need a `Signed-off-by` line (DCO). See
[CONTRIBUTING.md](CONTRIBUTING.md), and
[CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md) for how people are expected to treat
each other here.

Found a security issue? Do not open an issue — [SECURITY.md](SECURITY.md) says
where it goes instead.

## Documentation

- [Self-hosting](docs/self-hosting.md) — deployment, backups, upgrades, and how to
  monitor the monitor
- [REST API](docs/api.md) — endpoints, authentication, the `/checks/sync` contract
- [Authentication](docs/authentication.md) — passkeys, passwords or Google and
  Microsoft, the administrator account, and what to do when someone is locked out
- [Security](docs/security.md) — the threat model and what is done about it
- [Abuse prevention](docs/abuse-prevention.md) — what actually stops bot sign-ups,
  measured rather than assumed
- [Development](docs/development.md) — running it locally, tests, load tests
- [Releasing](docs/releasing.md) — cutting a new version, and deploying one by
  hand
