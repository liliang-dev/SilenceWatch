# Changelog

All notable changes to SilenceWatch are recorded here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses
[semantic versioning](https://semver.org/spec/v2.0.0.html).

Pre-1.0, a minor bump may change behaviour. Anything that changes the meaning of
an existing configuration variable, an API response or the database schema is
called out under **Changed** with what to do about it.

## [Unreleased]

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

[Unreleased]: https://github.com/liliang-dev/SilenceWatch/compare/0.1.0...HEAD
[0.1.0]: https://github.com/liliang-dev/SilenceWatch/releases/tag/0.1.0
