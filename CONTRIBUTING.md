# Contributing to SilenceWatch

Thank you for considering it. Bug reports, tests and documentation are as welcome
as code.

## Developer Certificate of Origin

Every commit must carry a `Signed-off-by` line:

```bash
git commit -s -m "Add Discord channel"
```

which appends:

```
Signed-off-by: Jane Developer <jane@example.com>
```

This is the [Developer Certificate of Origin](https://developercertificate.org/):
you are certifying that you wrote the contribution, or have the right to submit it
under the project's licence. It is checked automatically on every pull request.

The DCO is in place from day one so the project keeps the ability to relicense
later if it ever needs to — a decision that becomes impossible once contributions
arrive without a clear provenance trail.

Two kinds of commit are exempt, because in neither case is there a person able to
make the certification:

- **Merge commits.** They introduce no authored work of their own.
- **Commits authored by bots** such as Dependabot. A bot cannot certify that it
  wrote the code or had the right to submit it. Provenance for a dependency bump
  comes from the maintainer who reviews and merges it.

### Committing from the web editor

Edits made in GitHub's web interface do not go through `git commit -s`, so they
arrive without a sign-off and fail the check. Turning on **Settings → General →
"Require contributors to sign off on web-based commits"** makes GitHub append the
line itself on every web commit, for you and for anyone using the *Edit* button.
It applies to new commits only — anything already pushed still needs amending.

## Which licence applies

| What you are changing | Licence |
| --- | --- |
| `packages/server`, `packages/web` | AGPL-3.0 |
| `packages/shared`, `clients/**`, examples | Apache-2.0 |

The split is not cosmetic. Client libraries **must** stay Apache-2.0: an AGPL
library would contaminate the applications embedding it, and nobody would ship it.
A pull request moving client code under AGPL will not be merged.

## Before opening a pull request

Node 24 LTS and pnpm via `corepack enable` — on an older Node the first command
fails without saying that the Node version is why. See
[docs/development.md](docs/development.md#node).

```bash
pnpm test        # unit tests
pnpm run test:e2e  # needs TEST_DATABASE_URL
pnpm run lint
cd clients/spring-boot-starter && mvn test  # if you touched the starter
```

See [docs/development.md](docs/development.md) for setting up a database.

## What gets merged easily

- A test that reproduces a bug, with the fix
- A new alert channel — one class implementing `ChannelSender`
- A client library for another ecosystem, honouring the `/checks/sync` contract in
  [docs/api.md](docs/api.md) and the rules the Spring starter follows: never break
  the user's job, never block it, degrade silently
- Documentation that corrects something wrong or unclear

## What needs discussion first

- New runtime dependencies. PostgreSQL is the queue, the cache bus and the store;
  adding Redis, a broker or a scheduler means adding something that itself needs
  monitoring. Open an issue explaining why the database cannot do it.
- Anything on the ingestion path. It is deliberately bare, and it must stay that
  way.
- Features from the "not yet" list in the README. They are excluded for reasons,
  usually about false positives.

## Cutting a release

Maintainers only: [docs/releasing.md](docs/releasing.md). Changelog, version
bump, merge, tag — CI publishes the image and deploys.

## Reporting security issues

Do not open a public issue — see [docs/security.md](docs/security.md).
