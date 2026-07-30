# SilenceWatch

**Open-source heartbeat monitoring for cron jobs, workers and scheduled tasks.
Your jobs check in when they run; when one goes quiet, you hear about it.
Self-host it, or use the hosted service.**

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
0 2 * * *  /usr/local/bin/backup.sh && curl -fsS -m 10 --retry 3 https://silencewatch.com/p/<ping-key>
```

That is the entire integration for a shell script. For Java, there is something
better — see below.

## What makes it different

Every competitor serves the Java ecosystem badly. SilenceWatch ships a **Spring
Boot starter that discovers and declares every scheduled job in your application
automatically**:

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

Restart the application. Every `@Scheduled` method and every Quartz job now
appears in SilenceWatch, with its real schedule, and sends a heartbeat around each
run — including its duration and whether it threw. No check to create by hand, no
ping URL to copy, nothing to keep in sync when the code changes.

See [`clients/spring-boot-starter`](clients/spring-boot-starter/README.md), and
[`examples/spring-boot-demo`](examples/spring-boot-demo/README.md) for a runnable
application that declares its jobs this way.

## Self-hosting

One command, one container, one database:

```bash
git clone https://github.com/silencewatch/silencewatch.git
cd silencewatch
cp .env.example .env         # set SECRET_KEY and POSTGRES_PASSWORD
docker compose up -d
```

Open <http://localhost:8080> and create the first account — on an empty instance
it is always allowed, and it becomes the owner. Schema migrations run
automatically at startup, so upgrading is "pull the new image and restart".

Full guide: [docs/self-hosting.md](docs/self-hosting.md).

**The self-hosted edition is never crippled.** There is no reserved feature, no
"enterprise edition", no seat limit. The hosted service at
[silencewatch.com](https://silencewatch.com) sells not running a server, not
features.

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

In: heartbeat ingestion (push), silence detection, alerting by email, webhook,
Slack, Teams and Discord, checks/projects/users, ping and incident history, API
keys and a REST API, the Spring Boot starter, one-command self-hosting.

Not yet: pull monitoring (SilenceWatch calling your endpoints — it needs
multi-region probes to avoid false positives), public status pages, on-call
rotations, SMS and phone calls, fine-grained performance metrics.

## Licensing

| Component                                                          | Licence        |
| ------------------------------------------------------------------ | -------------- |
| Server (backend + frontend)                                         | **AGPL-3.0**   |
| Client libraries, Spring Boot starter, integrations, CLI, examples   | **Apache-2.0** |

> The server is licensed under AGPL-3.0. Client libraries and integrations are
> licensed under Apache-2.0.

This split is deliberate and non-negotiable: an AGPL client library would
contaminate the applications that embed it, no company would ship it, and the
project's whole differentiator would die with it.

The name "SilenceWatch" and the logo are not covered by these licences — see
[TRADEMARK.md](TRADEMARK.md).

## Contributing

Pull requests need a `Signed-off-by` line (DCO). See
[CONTRIBUTING.md](CONTRIBUTING.md).

## Documentation

- [Self-hosting](docs/self-hosting.md) — deployment, backups, upgrades, and how to
  monitor the monitor
- [REST API](docs/api.md) — endpoints, authentication, the `/checks/sync` contract
- [Security](docs/security.md) — the threat model and what is done about it
- [Development](docs/development.md) — running it locally, tests, load tests
