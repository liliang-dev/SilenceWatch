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

### Sign-up

| Variable | Default | Meaning |
| --- | --- | --- |
| `SIGNUP_ENABLED` | `true` | When false, only the first account can be created |
| `EMAIL_VERIFICATION_REQUIRED` | `false` | Require a proven address before sign-in |
| `EMAIL_VERIFICATION_TTL_HOURS` | `24` | How long a confirmation link stays valid |
| `UNVERIFIED_ACCOUNT_TTL_DAYS` | `7` | Unconfirmed accounts are deleted after this; 0 keeps them |
| `SIGNUP_POW_DIFFICULTY` | `0` | Proof-of-work bits required to register; 0 disables it |
| `SIGNUP_POW_TTL_SECONDS` | `600` | Lifetime of an issued challenge |
| `SIGNUP_BLOCK_DISPOSABLE_EMAIL` | `false` | Reject known throwaway mailbox domains |
| `SIGNUP_BLOCKED_EMAIL_DOMAINS` | — | Extra domains to reject, comma-separated |
| `SIGNUP_MAX_PER_NETWORK_PER_HOUR` | `0` | Accounts per hour per network prefix; 0 disables it |

Everything below the first line is **off by default and stays that way for most
self-hosters**. If your instance is on a private network, or you set
`SIGNUP_ENABLED=false` once the team is in, you have already solved the problem
these settings address — none of them is worth turning on.

They exist for instances whose sign-up form is reachable by strangers.
[`abuse-prevention.md`](abuse-prevention.md) explains what each one actually
buys, with measurements, including the ones that are not worth what people
expect.

Turning `EMAIL_VERIFICATION_REQUIRED` on also makes registration
enumeration-safe: the API stops revealing whether an address already has an
account. The server refuses to boot with it enabled and `EMAIL_PROVIDER=console`
— nobody could ever confirm an address, so every new account would be locked out
of an instance that otherwise looks healthy.

### Plans and quotas

**A self-hosted SilenceWatch has no limits, and nothing here needs setting.**
`QUOTAS_ENABLED` is off, `user.plan` stays null, and null means unlimited on
every axis. This section exists because the hosted deployment runs the same
code; it is documented so you can see that it does, and so you can use it if you
run SilenceWatch for other people.

| Variable | Default | Meaning |
| --- | --- | --- |
| `QUOTAS_ENABLED` | `false` | Master switch. Off means unlimited, always |
| `DEFAULT_PLAN` | `free` | Plan given to a new account when quotas are on |
| `PLAN_LIMITS` | `{}` | JSON: what each plan name is allowed |
| `QUOTA_RECONCILE_INTERVAL_MS` | `300000` | How often accounts are matched against their plan |

```bash
QUOTAS_ENABLED=true
PLAN_LIMITS='{
  "free":      {"checks": 10,   "projects": 3,  "channelsPerProject": 3, "retentionDays": 7},
  "supporter": {"checks": 10,   "projects": 3,  "channelsPerProject": 3, "retentionDays": 30},
  "pro":       {"checks": 100,  "projects": 20, "retentionDays": 90},
  "max":       {"checks": 1000}
}'
```

An omitted key is unlimited: `max` above has no project ceiling and no retention
cap. An **unknown** plan name is also unlimited — a typo in this JSON, or a plan
renamed on the billing side, should briefly give someone too much rather than
lock a paying customer out of their own monitoring.

Which plan an account is on is the `plan` column on `user`. This repository never
writes it and knows nothing about prices, payment or subscriptions; whatever does
your billing sets the column, and the reconciler picks the change up within
`QUOTA_RECONCILE_INTERVAL_MS`.

Checks are counted across **every project the account owns**, so a second project
does not reset the allowance. On a downgrade the excess checks are paused —
newest first, deliberately paused checks untouched, and the account emailed the
list — and they resume on their own when the account moves back under its limit.

### Security and recovery

| Variable | Default | Meaning |
| --- | --- | --- |
| `PASSWORD_RESET_TTL_MINUTES` | `60` | Lifetime of a reset link |
| `AUDIT_RETENTION_DAYS` | `365` | How long the audit trail is kept |

The audit trail records sign-ins and failed sign-ins, password changes and
resets, API key and alert channel changes, check deletions, ping-key rotations
and quota pauses. It is readable in **Settings → Security activity** by project
admins, and never contains a token, a key or a channel's configuration.

A leaked ping URL no longer means recreating the check: **Check → ⋯ → Rotate ping
URL** issues a new one and keeps the history. Every job still calling the old URL
will be reported as down, which is the point — update them first.

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

Set `TRUST_PROXY` **only** when a proxy really is in front, and set it to the
proxy's address or CIDR rather than `true`:

```bash
TRUST_PROXY=10.0.0.0/8
```

A bare `true` trusts the hop count from anything that can reach the server, so
anyone bypassing the proxy can claim any client address they like — and every
per-address control (rate limits, sign-up velocity, the audit trail) is only as
good as that value. **Production refuses to boot on `TRUST_PROXY=true`** for
exactly this reason.

Getting it wrong in either direction is otherwise silent, so the server samples
its first requests and says so in the log: trusting a proxy whose header never
arrives, or refusing to trust one whose header always does. The second is the
quieter failure — it throttles the entire internet as if it were one visitor.

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

Edit the image tag in `docker-compose.yml` to the release you want, then:

```bash
docker compose pull
docker compose up -d
```

The tag is pinned rather than `latest` on purpose: a restart should not change
which version is running, and a bug report needs a version to name. Published
images are listed under
[Releases](https://github.com/liliang-dev/SilenceWatch/releases).

Working from a checkout instead, with the `build` stanza uncommented:

```bash
git pull
docker compose build --pull
docker compose up -d
```

Migrations are applied at startup. They are additive by design; when a release
needs a destructive change, the notes say so and give the steps.

## Docker Swarm, and upgrading without downtime

Compose restarts the container, so an upgrade is a short outage. Swarm can start
the new version, wait for it to report healthy, and only then stop the old one.
`docker-stack.yml` in the repository root is that deployment.

It is not `docker-compose.yml` with a `deploy:` block added. `docker stack
deploy` silently ignores `depends_on`, `restart`, and the short form of `tmpfs`,
so the two files differ where it matters — a read-only container whose `/tmp`
mount was dropped does not start at all.

### What makes it seamless

Two replicas, `order: start-first`, and the image's own `HEALTHCHECK`. Swarm
brings a new task up, waits for `/health`, shifts traffic, and stops the old
one; with a single replica there is still a moment when the only healthy task is
the one being replaced.

Running two instances is safe here by design rather than by luck: the detection
loop and the alert queue claim rows with `FOR UPDATE SKIP LOCKED`, so they share
work instead of alerting twice, and the ingest cache is invalidated across
instances with `LISTEN`/`NOTIFY`.

**The precondition is that migrations stay additive.** During the changeover the
old and new versions run against the same schema for a few seconds. That holds
for every release whose notes do not say otherwise — when one does, deploy it as
a brief planned outage instead.

If the new version never reports healthy, Swarm puts the old one back on its own
(`failure_action: rollback`), and the deploy job fails on the version check
rather than reporting a success that did not happen.

### One-time setup

```bash
docker swarm init                                    # if it is not already one
docker node update --label-add silencewatch.db=true "$(docker node ls -q)"
sudo install -d -m 750 /opt/silencewatch
sudo cp .env /opt/silencewatch/.env                  # SECRET_KEY, POSTGRES_PASSWORD, BASE_URL…
sudo chmod 600 /opt/silencewatch/.env
```

The node label is not optional. Without it a reschedule would start PostgreSQL
on another machine against an empty local volume — an instance that looks
healthy and has lost every check, ping and account. For the same reason the
database updates `stop-first`: two PostgreSQL processes on one data directory
corrupt it, so it takes a brief pause where the application does not.

Deploy by hand with:

```bash
set -a; . /opt/silencewatch/.env; set +a
SILENCEWATCH_VERSION=0.1.0 docker stack deploy -c docker-stack.yml silencewatch
```

### Deploying on release

`.github/workflows/release.yml` does the same over SSH once a tag's image is
published and verified. It needs four repository secrets:

| Secret | What it holds |
| --- | --- |
| `SWARM_SSH_HOST` | the manager node's hostname |
| `SWARM_SSH_USER` | a user in the `docker` group |
| `SWARM_SSH_KEY` | that user's private deploy key |
| `SWARM_SSH_KNOWN_HOSTS` | output of `ssh-keyscan -H <host>` |

The last one is what makes the connection safe. Without a known host key the
alternative is `StrictHostKeyChecking=no`, which hands the deploy key to
whatever answers on that address.

The env file path defaults to `/opt/silencewatch/.env` and can be moved with a
repository variable, `SWARM_ENV_FILE`. Its values stay on the server: CI reads
their names from the stack file and never sees them.

The job runs in a GitHub environment called `production`, which is where a
required reviewer goes if releases should stop shipping unattended.

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
