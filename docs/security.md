# Security

What SilenceWatch defends against, and how. Written so that a reviewer can check
the claims against the code rather than take them on faith.

## Threat model

A SilenceWatch instance holds the schedule of everything a company runs, the ping
URLs that can silence its alerts, and credentials that can reach chat channels and
webhooks. It sits on the network of whoever deploys it. The interesting attacks
are therefore:

1. A stranger silencing alerts, or raising false ones
2. One tenant reading or modifying another tenant's checks
3. Using the alert machinery to reach inside the deployer's network (SSRF)
4. Stealing credentials — user passwords, API keys, webhook secrets
5. Denial of service through the one route that must never fall over

## Authentication

**Passwords** are hashed with Argon2id at the OWASP-recommended parameters
(m=19456 KiB, t=2, p=1), each with its own salt. Login spends the same CPU on an
unknown address as on a real one — an unknown email is checked against a decoy
hash — so response time is not a user-enumeration oracle. Ten failures lock an
account for fifteen minutes; the lock expires on its own, because a permanent lock
is a denial of service against the owner.

**Sessions** use a short-lived JWT (15 minutes by default) plus an opaque refresh
token stored only as SHA-256. Refresh tokens are single-use and rotated on every
refresh; presenting a revoked one is treated as theft and revokes every session of
that user. Changing a password revokes all sessions, including the current one.

The access token is verified against the session on every request — one indexed
primary-key lookup — so logout, password changes and theft response take effect
immediately rather than after the token expires.

**API keys** are `sw_<lookup id>_<secret>`. Only the lookup half is indexed; the
secret half is stored as SHA-256 and compared in constant time. A database dump
does not yield working keys. Keys are project-scoped, act with member rights, and
cannot create or list keys.

**Ping keys** are random UUIDv4 in the URL. They are the credential for a
heartbeat, which is why they are never written to access logs (request logging is
off entirely) and why unknown keys are answered identically whether they never
existed or were deleted.

## Tenant isolation

Every project-scoped operation goes through one method, `ProjectAccessService`, so
the rule is auditable in one place. A project the caller cannot see returns **404,
not 403** — a 403 would confirm the resource exists.

The end-to-end suite (`test/security.e2e-spec.ts`) asserts this from the outside:
cross-tenant reads, writes and deletes, API key scoping, privilege escalation
through keys, session revocation, and that error bodies never carry internals.

## SSRF

Alert channels are user-supplied URLs, which makes a naive implementation a proxy
into the network SilenceWatch runs on. `SafeHttpService`:

- vets resolved addresses **inside the DNS lookup used for the connection**, so a
  hostname that resolves to a public address on the first query and to
  `169.254.169.254` on the second (DNS rebinding) cannot slip through;
- blocks loopback, link-local (including cloud metadata), RFC 1918, CGNAT,
  multicast, reserved ranges, unique-local IPv6 and IPv4-mapped IPv6 forms;
- never follows redirects — a `302` to an internal host is the oldest trick there
  is;
- bounds timeouts and the amount of response body it reads.

`ALLOW_PRIVATE_NOTIFICATION_TARGETS=true` opts out, for operators whose alert
targets legitimately live on a private network. It is off by default.

## Injection and input handling

- Every request body, query and parameter is validated with the schemas in
  `@silencewatch/shared` — the same definitions the web UI and client libraries
  use, so a rule cannot drift between them.
- Every SQL statement is parameterised, including the hand-written ones on the
  ingestion and queue paths. The database also enforces schedule coherence,
  bounds and body length with CHECK constraints, so a bug in application code
  cannot produce a row that breaks detection.
- Ping bodies are truncated and stripped of NUL before storage.
- HTML email escapes every user-controlled value; the web UI relies on Angular's
  contextual escaping and never uses `innerHTML` with user data.

## Web hardening

A strict Content-Security-Policy (`default-src 'self'`, no `script-src-attr`,
`frame-ancestors 'none'`), `nosniff`, `no-referrer`, and HSTS in production. The
UI ships no external font, script or stylesheet — icons are inline SVG precisely
so the policy can stay strict. Authentication is bearer-token based with no
cookies, so there is no CSRF surface.

## Denial of service

- Heartbeats are rate-limited per ping key (120/minute by default), so a job stuck
  in a loop cannot saturate the database.
- Unknown ping keys are negatively cached and separately budgeted per IP, so
  walking the URL space costs the scanner more than it costs us.
- Authentication endpoints have their own tight per-IP, per-route budget.
- Request bodies are capped; the ingestion route caps them further and truncates
  rather than rejecting, so a chatty job is never turned into a false alert.
- Both background loops skip a tick rather than stacking, and every batch is
  bounded.

## Secrets

Secrets never leave the server: channel configuration is never returned by the API
(only a masked target), API keys are shown once at creation, and the support
bundle reports configuration as *set / not set*, never as values. Logs mask email
addresses and carry no ping URLs.

`SECRET_KEY` is the only root secret; all other keys are derived from it with HKDF
under distinct labels, so a signing key can never be used to verify a webhook
HMAC. Rotating it invalidates sessions.

## Reporting a vulnerability

Please do not open a public issue. Email **security@silencewatch.com** with a
description, reproduction steps and the version affected. You will get an
acknowledgement within 72 hours and an assessment within a week. We will credit
you in the release notes unless you would rather we did not.
