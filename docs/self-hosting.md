# Self-hosting SilenceWatch

Everything here works on one small VPS. The whole system is a Node process and a
PostgreSQL database; there is nothing else to install, scale or watch.

## Requirements

- Docker with Compose v2
- 1 vCPU and 1 GB of RAM handles thousands of checks comfortably
- PostgreSQL 14 or later (16 recommended). The Compose file brings its own

## Install

```bash
git clone https://github.com/liliang-dev/SilenceWatch.git
cd SilenceWatch
cp .env.example .env
```

Fill in at least:

```bash
SECRET_KEY=$(openssl rand -hex 32)        # all signing keys derive from this
POSTGRES_PASSWORD=$(openssl rand -hex 24)
BASE_URL=https://watch.example.com        # what your users actually type
```

Then:

```bash
docker compose up -d
```

Create the first account at `BASE_URL`. On an empty instance sign-up is always
allowed, whatever `SIGNUP_ENABLED` says — otherwise a fresh install could never be
bootstrapped. Once your team is in, set `SIGNUP_ENABLED=false` and restart.

## Configuration

Every setting is an environment variable. The server validates them at startup and
**refuses to boot on an unsafe or incoherent configuration** rather than running
in a degraded state you would discover during an incident.

### Required

| Variable        | Meaning                                                              |
| --------------- | -------------------------------------------------------------------- |
| `DATABASE_URL`  | PostgreSQL connection string                                          |
| `SECRET_KEY`    | Root secret, 32+ characters. Rotating it signs everyone out           |
| `BASE_URL`      | Public URL. Ping URLs and alert links are built from it               |

### Alerting

| Variable | Default | Meaning |
| --- | --- | --- |
| `EMAIL_PROVIDER` | `console` | `console`, `smtp`, `postmark`, `brevo` |
| `SMTP_URL` | — | `smtp://user:pass@host:587` (STARTTLS required) or `smtps://…:465` |
| `POSTMARK_TOKEN` / `BREVO_API_KEY` | — | API token for the matching provider |
| `EMAIL_FROM`, `EMAIL_FROM_NAME` | — | Sender identity |
| `NOTIFICATION_MAX_ATTEMPTS` | `6` | Retries before a delivery is abandoned |
| `NOTIFICATION_TIMEOUT_MS` | `10000` | Timeout for each outbound alert |
| `ALLOW_PRIVATE_NOTIFICATION_TARGETS` | `false` | Allow alerts to reach private addresses |

`console` prints alerts to the log instead of sending them, which is useful in
development and unacceptable in production — the server refuses to start with it
when `NODE_ENV=production`.

**Do not self-host SMTP for alerts.** Deliverability is a reputation game you have
no reason to play; the day an alert matters is the day you do not want it in a
spam folder. Relay through a provider or through a relay you already trust.

### Detection and retention

| Variable | Default | Meaning |
| --- | --- | --- |
| `DETECTION_INTERVAL_MS` | `10000` | How often the detection loop runs |
| `DETECTION_BATCH_SIZE` | `200` | Checks claimed per batch |
| `PING_RETENTION_DAYS` | `90` | Ping history kept (per-project override available) |
| `PURGE_CRON` | `17 3 * * *` | When the purge runs, in UTC |
| `PING_RATE_LIMIT_PER_MINUTE` | `120` | Per ping key, so a looping job cannot saturate the database |
| `PING_BODY_MAX_BYTES` | `10000` | Ping bodies are truncated to this |

### Behind a reverse proxy

Set `TRUST_PROXY=true` **only** when a proxy really is in front. It makes the
server read client IPs from `X-Forwarded-For`, which anyone can forge when there
is no proxy stripping it — and per-IP rate limiting is only as good as that value.

A minimal nginx front:

```nginx
location / {
    proxy_pass http://127.0.0.1:8080;
    proxy_set_header Host              $host;
    proxy_set_header X-Real-IP         $remote_addr;
    proxy_set_header X-Forwarded-For   $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
}
```

## Who watches the watchman

**SilenceWatch cannot monitor itself.** A monitoring server that dies quietly is
the one outage there is no recovering from: everything looks green because nothing
is looking.

Set `OUTBOUND_HEARTBEAT_URL` to a dead man's switch owned by *someone else* —
Healthchecks.io, Cronitor, or a colleague's SilenceWatch:

```bash
OUTBOUND_HEARTBEAT_URL=https://hc-ping.com/<your-uuid>
```

The server pings it every minute, **but only while the detection loop has
completed a pass recently**. If detection stalls while HTTP keeps answering — the
failure mode a naive uptime check misses entirely — the heartbeat stops and the
external watchdog fires.

`/health` follows the same rule: it returns 503 when the detection loop has
stalled, so an orchestrator restarts a process that is technically alive and
practically useless.

## Backups

Everything lives in PostgreSQL. Nothing is stored on disk by the application.

```bash
docker compose exec db pg_dump -U silencewatch silencewatch | gzip > silencewatch-$(date +%F).sql.gz
```

Restore:

```bash
gunzip -c silencewatch-2026-01-15.sql.gz | docker compose exec -T db psql -U silencewatch silencewatch
```

And — this being what the product is for — monitor the backup job with a check.

## Upgrading

```bash
git pull
docker compose build --pull
docker compose up -d
```

(Once a release image is published, this becomes `docker compose pull` with the
image line in the Compose file.)

Migrations are applied at startup. They are additive by design; when a release
needs a destructive change, the notes say so and give the steps.

## Diagnostics

For a support thread, produce a bundle:

```bash
docker compose exec silencewatch node packages/server/dist/diagnostics/support-bundle.js /tmp/bundle.json
docker compose cp silencewatch:/tmp/bundle.json .
```

It contains versions, the effective configuration **as set/not-set rather than
values**, table sizes, index presence, migration state and health — no secrets, no
ping keys, no email addresses. Read it before sending it anyway.

## Scaling up

Run more than one instance when a single process is no longer enough. Nothing
needs changing: the detection loop and the alert queue claim rows with
`FOR UPDATE SKIP LOCKED`, so instances share work without duplicating alerts, and
the ingestion cache is invalidated across instances through PostgreSQL
`LISTEN`/`NOTIFY`.

Beyond that the database is the limit. In order: raise `INGEST_POOL_MAX`, put the
`ping` table on faster storage, then lower `PING_RETENTION_DAYS`.
