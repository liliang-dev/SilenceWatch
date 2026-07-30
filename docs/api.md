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

**User sessions** are what the web UI uses: `POST /api/auth/login` returns a
short-lived access token (JWT) and a refresh token. Refresh tokens are single-use
and rotated; replaying one is treated as theft and revokes every session of that
user.

| Endpoint | Purpose |
| --- | --- |
| `POST /api/auth/register` | Create an account (plus a first project) |
| `POST /api/auth/login` | Exchange credentials for tokens |
| `POST /api/auth/refresh` | Rotate the refresh token |
| `POST /api/auth/logout` | Revoke the presented refresh token |
| `GET /api/auth/me` | The current user |
| `POST /api/auth/password` | Change the password (revokes all sessions) |

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

The endpoint the client starters call at startup, and the contract any new client
library should implement.

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
- Everything else: `API_RATE_LIMIT_PER_MINUTE` per IP (600)

Rejections carry `Retry-After`.
