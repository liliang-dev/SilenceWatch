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

Sign-in is [Better Auth](https://www.better-auth.com), and `AUTH_MODE` decides which
methods exist at all: passkeys (the default), passwords, or Google and Microsoft
beside passkeys. The methods a mode does not name have no endpoint, and the server
answers 404 to every Better Auth route the web UI does not use. How each works,
and what to do when someone is locked out, is in
[`authentication.md`](authentication.md); what it means for the threat model is
here.

**Passkeys** are phishing-resistant by construction: the browser signs a challenge
for the one domain the passkey was made for (`AUTH_RP_ID`), with the user verified
on the device, and nothing a user could type into a fake page unlocks it. The server
stores a public key, so a database dump signs nobody in. **Recovery codes** are 60
bits, single-use, stored only as a keyed HMAC-SHA-256 (the key is derived from
`SECRET_KEY`, so the dump alone is not enough to test a guess), and spent by a
conditional update, so two requests carrying the same code cannot both succeed. The
passkey and recovery-code endpoints are rate limited, and recovery counts towards the
same lockout as a password.

**Passwords** (12 characters at least, no composition rules) are hashed with scrypt,
Better Auth's default, each with its own salt. Sign-in answers identically for an
unknown address, a wrong password and a locked account — and spends the time of a real
check in each case, so response time is not a user-enumeration oracle. Ten failures
lock an account for fifteen minutes; the lock expires on its own, because a permanent
lock is a denial of service against the owner. Together with the rate limit per
address, that is what stands between a password and online guessing. No mail is sent
to reset one: the person who runs the server does it from the command line.

**Google and Microsoft** are reached by redirect only; the endpoint that accepts a
token handed straight to the API is switched off. Accounts are linked by address only
where the provider can vouch for it: Google, and only when Google itself has verified
the address. The address in a Microsoft token is whatever the administrator of that
tenant set, so it is never taken as proof (an account is identified by Microsoft's
immutable `oid`), and a Microsoft sign-in is never merged into an account made another
way. An account made by typing an address is likewise never merged into one that
arrives later with a provider: that would hand it to whoever typed the address first.

**Sessions** are rows in the database, found by an opaque token in a cookie signed
with `SECRET_KEY`. They last 30 days and slide: using one after a day moves its end
forward, so an abandoned one dies. An account keeps at most 20; the oldest are ended.
Signing out, or deleting the account, ends the session on the spot — it is looked up
on every request, so revocation does not wait for anything to expire.

The cookie is `HttpOnly` (script on the page cannot read it, so a successful XSS can
act as the user while the page is open but cannot walk away with a long-lived
credential), `SameSite=Lax`, and `Secure` with the `__Secure-` prefix over HTTPS.
Because a cookie is sent whatever page asked for the request, **a write that carries
one must come from `BASE_URL` or an `AUTH_TRUSTED_ORIGINS` entry**: the `Origin` header
is checked, and the sign-in endpoints refuse an origin that is not ours even without a
cookie, so no other site can sign a visitor in to an account of its own.

**Deleting the account, creating or revoking an API key, adding or removing a passkey
and making new recovery codes need a sign-in from the last ten minutes.** A session
that lasts a month proves little about who is at the keyboard now; this makes the
destructive and the access-granting actions ask again.

The **first account** is the one nobody can invite, and no email proves its address,
so while it is unclaimed sign-up is closed except to a one-time link that reaches only
the person who can read the server log. The token in it is high-entropy, stored only
as its SHA-256, sent in the part of the URL a browser never transmits, valid for 30
minutes and spent on use.

The client address that rate limits and sign-up rules depend on is written by the
server into a header of its own on every request, replacing whatever the caller sent;
it is Fastify's address, which honours `TRUST_PROXY` (see
[`self-hosting.md`](self-hosting.md#behind-a-reverse-proxy)).

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
so the policy can stay strict. API keys travel in the `Authorization` header,
which a cross-site request cannot set. The one cookie that matters is the session,
described above: `SameSite=Lax` keeps the browser from attaching it to a write that
starts on another site, and the `Origin` check refuses the ones that arrive anyway.
The only other cookie is short-lived and holds a sign-up link's token, scoped to the
sign-in endpoints.

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

Please do not open a public issue. Email **contact@silencewatch.com** with a
description, reproduction steps and the version affected. You will get an
acknowledgement within 72 hours and an assessment within a week. We will credit
you in the release notes unless you would rather we did not.
