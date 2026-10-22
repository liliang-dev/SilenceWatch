# REST API

Base URL: `https://<your-instance>/api`. Everything below is versioned under
`/api/v1`, except authentication (`/api/auth`) and `/health`.

## Authentication

Two credentials, one header.

**API keys** (`sw_…`) are scoped to a single project and are what machines use:

```bash
curl -H "Authorization: Bearer sw_3f9a2b1c8d7e6f50_XXXXXXXX…" \
     https://watch.example.com/api/v1/checks
```

A key can manage the checks of its own project and nothing else. It can never read
another project, and it can never create or list API keys — a leaked CI key cannot
mint itself more access.

**User sessions** are what the web UI uses: a cookie set by signing in, which the page
cannot read. They are for browsers, not for scripts — a script uses an API key. A
write made with a session cookie must carry an `Origin` header naming the instance
(`BASE_URL`) or one of `AUTH_TRUSTED_ORIGINS`; a browser does this by itself, and the
server answers `403` otherwise. A call without a session answers `401`.

How people sign in is the instance's `AUTH_MODE`, and only the endpoints of that mode
exist (everything else under `/api/auth` answers 404). They are
[Better Auth](https://www.better-auth.com)'s, with the shapes it documents; what the
web UI calls is:

| Endpoint | Purpose | Modes |
| --- | --- | --- |
| `GET /api/auth/config` | What the sign-in page offers: mode, providers, whether sign-up is open. Public | all |
| `GET /api/auth/me` | The current user | all |
| `POST /api/auth/sign-out` | End the session | all |
| `POST /api/auth/sign-up/email` · `sign-in/email` · `change-password` | Create an account, sign in, change the password | `password` |
| `GET /api/auth/passkey/generate-register-options` · `POST …/verify-registration` | Register a passkey (and create the account, if none is signed in) | `passkey`, `full` |
| `GET /api/auth/passkey/generate-authenticate-options` · `POST …/verify-authentication` | Sign in with a passkey | `passkey`, `full` |
| `GET /api/auth/passkey/list-user-passkeys` · `POST …/update-passkey` · `POST …/delete-passkey` | Manage passkeys | `passkey`, `full` |
| `POST /api/auth/recovery-codes/generate` · `GET …/remaining` · `POST …/sign-in` | Recovery codes | `passkey` |
| `POST /api/auth/sign-in/social` · `GET /api/auth/callback/{google,microsoft}` | Provider sign-in, by redirect | `full` |
| `POST /api/auth/delete-account` | Delete the account and its data, at once and for good | all |

**A recent sign-in.** Deleting the account, creating or revoking an API key, adding or
removing a passkey and making recovery codes need a sign-in from the last ten
minutes. Without one the answer is `403` with `details.reauthRequired: true` (or the
code `SESSION_NOT_FRESH` from Better Auth's own endpoints); signing in again makes
the call possible.

**Failed sign-ins** answer `401` with the same message whether the address has an
account, the password is wrong, or the account is locked after repeated failures.
Sign-in endpoints are rate limited per address (`AUTH_RATE_LIMIT_PER_MINUTE`) and
answer `429` with `Retry-After`.

**Deleting an account.** `POST /api/auth/delete-account` requires a user session (an
API key is refused) and a recent sign-in, and answers 204. It removes the user, its
sessions, passkeys and recovery codes, and every project it is the only member of,
with those projects' checks, ping and incident history, API keys and channels. A
project shared with other members only loses this member; if the account is the
project's only owner while other members remain, the request is refused with 409 and
nothing is deleted. The security log keeps a record, with the account's address, for
its retention period.

**Subscriptions** (the hosted service only). `GET /api/v1/billing` answers every
instance, with `{"enabled": false}` where nothing is sold, and otherwise the plans,
what the account uses and the state of its subscription. `POST /api/v1/billing/checkout`
(`{"plan": "pro"}`, with an optional `"lang": "fr"` or `"en"` for Stripe's page) and `POST /api/v1/billing/portal` answer `{"url": "…"}`: Stripe's
payment page, and Stripe's customer portal. They require a user session (an API key
is refused) and answer 404 where nothing is sold. `POST /api/v1/billing/webhook` is
Stripe's, authenticated by its signature alone. See the self-hosting reference.

## Heartbeats

Heartbeats are **not** part of `/api`. They live at `/p/:pingKey`, are
unauthenticated (the key is the credential), and accept GET and POST because
`curl` in a crontab is the most common client.

| Route | Meaning |
| --- | --- |
| `GET\|POST /p/<key>` | The run succeeded |
| `GET\|POST /p/<key>/start` | The run started — enables duration measurement |
| `GET\|POST /p/<key>/fail` | The run failed; the check goes down immediately |
| `GET\|POST /p/<key>/<exitCode>` | `0` succeeds, anything else fails |

Optional `?duration_ms=1234` reports the execution time when the client measures
it itself. A request body (up to `PING_BODY_MAX_BYTES`, truncated, never rejected)
is stored with the ping — handy for the last lines of a job's output.

Responses are plain text and minimal: `OK`, `PAUSED`, `NOT FOUND` (404),
`RATE LIMITED` (429), `BAD REQUEST` (400), `UNAVAILABLE` (503). A mistyped key
stays a 404 on purpose: it must never look like success to the script calling it.

Two rate limits apply, both answering 429 with `Retry-After`. One is per key
(`PING_RATE_LIMIT_PER_MINUTE`), which bounds a runaway job. The other is per
source address, and is charged only by keys that turn out not to exist — so it
is spent by something walking the URL space and never by a working client.
Once it is spent, that address is refused until the window turns over, whatever
key it presents. Note the asymmetry: a refusal is a 429 and never a 404,
because telling a job with a valid URL that its check does not exist would send
it looking for a problem that is not there.

## Checks

| Endpoint | Notes |
| --- | --- |
| `GET /api/v1/checks` | Across every project you can see. Filters: `state`, `environment`, `tag`, `search`, `orphaned`, `limit`, `cursor` |
| `GET /api/v1/projects/:projectId/checks` | One project |
| `POST /api/v1/projects/:projectId/checks` | Create |
| `GET /api/v1/checks/:checkId` | Read |
| `PATCH /api/v1/checks/:checkId` | Update, pause (`{"paused": true}`) or resume |
| `DELETE /api/v1/checks/:checkId` | Delete, with its history. Requires the admin role |
| `GET /api/v1/checks/:checkId/pings` | Ping history, newest first |
| `GET /api/v1/checks/:checkId/incidents` | Incident history |

Creating an interval check:

```bash
curl -X POST https://watch.example.com/api/v1/projects/$PROJECT/checks \
  -H "Authorization: Bearer $API_KEY" -H 'Content-Type: application/json' \
  -d '{
    "name": "Nightly backup",
    "scheduleType": "interval",
    "periodSeconds": 86400,
    "graceSeconds": 3600,
    "environment": "production"
  }'
```

Or a cron check:

```json
{
  "name": "Nightly backup",
  "scheduleType": "cron",
  "cronExpression": "0 2 * * *",
  "timezone": "Europe/Paris",
  "graceSeconds": 3600
}
```

A schedule is one or the other, never both. Cron expressions may have 5 fields
(Unix) or 6 (leading seconds, as Spring and Quartz write them), and support `?`,
`L`, `5L` and `MON#2`. Quartz's `W` (nearest weekday) is rejected: the server
cannot compute its occurrences, and a check whose deadline cannot be computed is
worse than no check.

The response includes `pingUrl` — the only thing your job needs.

## `POST /api/v1/checks/sync`

The endpoint the client libraries (the Spring Boot starter, the Python library) call at
startup, and the contract any new client library should implement. `source` names the
client (`spring-boot-starter`, `python-celery`, `python-apscheduler`…), at most 60
characters, and is kept for the logs.

```http
POST /api/v1/checks/sync
Authorization: Bearer <api-key>
Content-Type: application/json

{
  "environment": "production",
  "source": "spring-boot-starter",
  "prune": true,
  "checks": [
    {
      "key": "com.acme.jobs.BackupJob#run",
      "name": "BackupJob.run",
      "cron": "0 0 2 * * *",
      "timezone": "Europe/Paris",
      "grace_seconds": 300
    },
    {
      "key": "com.acme.jobs.PollJob#poll",
      "name": "PollJob.poll",
      "interval_seconds": 900
    }
  ]
}
```

```json
{
  "checks": [
    {
      "key": "com.acme.jobs.BackupJob#run",
      "id": "5a1c…",
      "pingKey": "8f2e…",
      "pingUrl": "https://watch.example.com/p/8f2e…",
      "created": true
    }
  ],
  "orphaned": ["com.acme.jobs.OldJob#run"]
}
```

Rules that matter:

- **Upsert by `(project, key, environment)`.** The key is the client's stable
  identity, so restarts and redeployments land on the same check and keep their
  history. Environment is part of the identity so a staging deployment declaring
  the same jobs does not overwrite production's.
- **Checks missing from the payload are flagged `orphaned`, never deleted.** An
  automatic delete would destroy a check's history at the first refactoring. They
  are shown as orphaned in the UI, and deleting them is your decision.
- **An unchanged schedule does not move the deadline.** A restarting application
  must not grant all of its jobs a fresh grace period.
- **The payload is atomic.** One invalid schedule fails the request rather than
  applying half of it.

With a user session instead of an API key, pass `?projectId=…`.

## Notification channels

| Endpoint | Notes |
| --- | --- |
| `GET /api/v1/projects/:projectId/channels` | List. Configuration is never returned — only a masked target |
| `POST /api/v1/projects/:projectId/channels` | Create (`email`, `webhook`, `slack`, `teams`, `discord`) |
| `PATCH /api/v1/projects/:projectId/channels/:id` | Rename or enable/disable |
| `DELETE /api/v1/projects/:projectId/channels/:id` | Delete |
| `POST /api/v1/projects/:projectId/channels/:id/test` | Send a sample alert now, and report the failure verbatim |

Webhook payloads carry a signature when the channel has a secret:

```
X-SilenceWatch-Event: check.down
X-SilenceWatch-Timestamp: 1769812345
X-SilenceWatch-Signature: sha256=<hex>
```

with `signature = HMAC_SHA256(secret, "<timestamp>.<raw body>")`. Verify it, and
reject timestamps that are too old to be honest.

## Errors

Every error has the same shape:

```json
{
  "statusCode": 400,
  "error": "BAD_REQUEST",
  "message": "Validation failed",
  "details": [{ "path": "periodSeconds", "message": "Number must be greater than or equal to 30" }]
}
```

`404` is used where `403` would confirm that something exists: asking for another
tenant's project returns "not found", because "forbidden" would be an answer.

## Rate limits

- Heartbeats: `PING_RATE_LIMIT_PER_MINUTE` per ping key (120 by default)
- Authentication: `AUTH_RATE_LIMIT_PER_MINUTE` per IP and route (10)
- Test alerts: one per channel per `TEST_ALERT_COOLDOWN_SECONDS` (60) and `TEST_ALERT_MAX_PER_HOUR` (20) per account, answered 429 with `Retry-After`
- Everything else: `API_RATE_LIMIT_PER_MINUTE` per IP (600)

Rejections carry `Retry-After`.
