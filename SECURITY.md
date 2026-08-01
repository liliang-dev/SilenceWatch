# Security policy

## Reporting a vulnerability

Please **do not open a public issue**.

Email **security@silencewatch.com** with:

- a description of the issue and its impact,
- steps to reproduce (a proof of concept helps),
- the version or commit affected,
- how you would like to be credited, if at all.

You will get an acknowledgement within 72 hours and an assessment within a week.
Fixes for confirmed issues are released as soon as they are ready, and the advisory
credits the reporter unless anonymity is preferred.

## Supported versions

The project is pre-1.0: only the latest release receives security fixes. Self-hosted
instances should track the latest image.

Until the first tagged release exists, `main` **is** the supported version — fixes
land there and nowhere else, so an instance built from an older commit is on its
own. [CHANGELOG.md](CHANGELOG.md) records what has changed since.

## Scope

In scope: the server (API, ingestion, detection, alerting), the web UI, the client
libraries, and the default self-hosting configuration in this repository.

Out of scope: findings that require an already-compromised host or database,
denial of service through sheer traffic volume against an unprotected instance
(deploy a proxy), and issues in third-party dependencies without a demonstrated
impact on SilenceWatch.

The threat model and the mitigations in place are documented in
[docs/security.md](docs/security.md).
