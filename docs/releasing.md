# Releasing a new version

Shipping a release is four edits and a tag. CI does the rest: it builds the
image, publishes it to GHCR, creates the GitHub release, and — if the deploy
secrets are configured — updates the swarm without dropping a request.

This is the maintainer's page. Running an instance is
[docs/self-hosting.md](self-hosting.md).

## The whole thing

```
CHANGELOG.md + version bump  ──▶  dev  ──▶  main  ──▶  git tag  ──▶  CI ships it
```

`dev` is where every change is collected; `main` receives it in one pull
request. See [CONTRIBUTING.md](../CONTRIBUTING.md#where-pull-requests-go).

### 1. Pick the number

Semantic versioning, no `v` prefix — the tag is `0.2.0`, not `v0.2.0`. CI
refuses anything that is not `N.N.N`.

Pre-1.0, a minor bump may change behaviour. Anything that changes the meaning of
a configuration variable, an API response or the database schema goes under
**Changed** with what to do about it.

### 2. Write the changelog

In `CHANGELOG.md`, rename `## [Unreleased]` to the version and the date, add a
fresh empty `## [Unreleased]` above it, and update the two link definitions at
the bottom:

```markdown
## [Unreleased]

## [0.2.0] — 2026-09-01
```

```markdown
[Unreleased]: https://github.com/liliang-dev/SilenceWatch/compare/0.2.0...HEAD
[0.2.0]: https://github.com/liliang-dev/SilenceWatch/releases/tag/0.2.0
```

Write it for someone deciding whether to upgrade, not for someone reading the
diff. This section becomes the GitHub release notes verbatim, read from the
changelog **at the tag** — so it has to be merged before the tag is created, and
the workflow fails outright rather than publishing an empty release.

### 3. Bump the version

One line in `docker-compose.yml`:

```yaml
image: ghcr.io/liliang-dev/silencewatch:0.2.0
```

This is the file users copy, and it is pinned rather than `latest` so a restart
never changes which version is running. Forgetting it is the mistake that
matters: the release exists, and everyone following the install instructions
still gets the previous one.

The README names the version too — "This pulls `ghcr.io/…/silencewatch:0.2.0`" —
and is the first thing a newcomer reads, so it goes in the same edit. Find every
place that still says the old number instead of trusting this list:

```bash
grep -rn "0\.1\.1" . --exclude-dir=node_modules --exclude-dir=.git \
  --exclude=pnpm-lock.yaml --exclude=CHANGELOG.md
```

What remains should be only the rollback example at the bottom of this page,
which names the *previous* version on purpose.

Then keep the package manifests in step — cosmetic, since the running version
comes from the image's build argument, but a repository that says 0.1.0 while
shipping 0.2.0 is a bug report waiting to happen:

```bash
pnpm --recursive --include-workspace-root exec npm version 0.2.0 --no-git-tag-version
```

`docker-stack.yml` needs nothing: its version comes from
`SILENCEWATCH_VERSION`, which the deploy sets from the tag.

### 4. Merge `dev` into `main`

Everything above lands on `dev` first, like any other change — including the
changelog and the version bump, which are what makes the pull request into
`main` read as "release 0.2.0" rather than as a pile of unrelated work.

Then one pull request, `dev` → `main`, with CI green. The tag has to point at a
commit on `main`: that is what the release notes, the image and the deployment
all refer back to.

### 5. Tag it

```bash
git checkout main
git pull
git tag 0.2.0
git push origin 0.2.0
```

Or on GitHub: **Releases → Draft a new release → Choose a tag → Create new tag →
Publish**. Either works; the tag push is what starts the workflow.

An annotated tag (`git tag -a 0.2.0 -m "0.2.0"`) is fine too. Do not move a tag
that has already been published — it changes what a version means for everyone
who already pulled it. Made a mistake? Release the next number.

### 6. Watch it

[Actions → Release](https://github.com/liliang-dev/SilenceWatch/actions/workflows/release.yml).
It takes a few minutes and does, in order:

1. checks that the tagged commit is releasable — the four manifests say the
   tag's version and `CHANGELOG.md` has its section — before anything is built,
2. builds and pushes `ghcr.io/liliang-dev/silencewatch:0.2.0` (and `latest`),
3. starts the image against a throwaway PostgreSQL and checks `/health` — a
   version that cannot boot is never released,
4. creates or updates the GitHub release,
5. deploys to the swarm over SSH and waits for the update to converge.

If the deploy step rolls back, the build goes red. A rolled-back release is a
failure, not a quiet no-op.

**Nothing published?** The tag was pushed before the workflow existed, or the
run was cancelled. Re-run it without moving the tag: **Actions → Release → Run
workflow**, and give it the existing tag.

## Releasing the Spring Boot starter

The starter (`clients/spring-boot-starter`) has a version of its own, and is
published to **Maven Central** so that anyone can add it with one dependency. It is
tagged apart from the application, and named after its language: `java-0.1.0`, not
`0.1.0` (the Python library is `python-0.1.0`). The
[Java release](../.github/workflows/java-release.yml) workflow answers to
that tag only, and the Release workflow never sees it.

### Once: the accounts and the key

1. **A Central Portal account** at <https://central.sonatype.com>, and the
   namespace `com.silencewatch` **verified**: Central asks you to prove you own
   `silencewatch.com` by adding a DNS record it gives you. Nothing can be
   published under the group until that is done.
2. **A user token** (Account → Generate User Token): a username and a password
   that stand for the account, and that can be revoked.
3. **A signing key**: `gpg --full-generate-key`, then publish the public key
   (`gpg --keyserver keyserver.ubuntu.com --send-keys <id>`), because Central
   checks signatures against a public keyserver. Export the private key with
   `gpg --armor --export-secret-keys <id>`.
4. **A GitHub environment** named `maven-central` (Settings → Environments), with
   four secrets: `MAVEN_CENTRAL_USERNAME` and `MAVEN_CENTRAL_PASSWORD` (the token),
   `MAVEN_GPG_PRIVATE_KEY` (the armored key) and `MAVEN_GPG_PASSPHRASE`. Add
   yourself as a required reviewer if you want a click before each release.

### Each release

1. Put the version in the install snippets of `clients/spring-boot-starter/README.md`
   (`<version>0.1.0</version>` and the Gradle line), and land it on `main`.
2. Tag it, from the commit on `main`:

   ```bash
   git tag java-0.1.0
   git push origin java-0.1.0
   ```

3. Watch [Actions → Java release](https://github.com/liliang-dev/SilenceWatch/actions/workflows/java-release.yml).
   It checks that the commit is on `main` and that the README gives the version,
   takes the number from the tag (the repository keeps `0.1.0-SNAPSHOT`), runs the
   tests, builds the jar with its sources and javadoc, signs everything, and
   uploads it to the Portal.
4. **Publish it by hand**: open <https://central.sonatype.com/publishing/deployments>,
   check the deployment and press **Publish**. This last click is deliberately not
   automated: a version published to Central can never be changed or removed, and
   a mistake can only be answered with the next number. A few minutes later the
   dependency resolves from Maven Central.

Until step 1 of "Once" is done, the dependency in the README cannot be resolved by
anyone: the starter builds and passes its tests, but is not published.

## Releasing the Python library

The library (`clients/python`) has a version of its own, and is published to **PyPI**
under the name `silencewatch`. It is tagged apart from the application and the
starter: `python-0.1.0`. The [Python release](../.github/workflows/python-release.yml)
workflow answers to that tag only.

### Once: PyPI

1. **A PyPI account** at <https://pypi.org>, with two-factor authentication.
2. **A trusted publisher**, so that there is no token to store: in PyPI, *Publishing*
   → *Add a new pending publisher*, with the project name `silencewatch`, the owner
   `liliang-dev`, the repository `SilenceWatch`, the workflow `python-release.yml` and the
   environment `pypi`. PyPI then trusts the identity of that workflow run, and only that.
3. **A GitHub environment** named `pypi` (Settings → Environments). Add yourself as a
   required reviewer if you want a click before each release.

### Each release

1. In `clients/python`, set `__version__` in `src/silencewatch/_version.py`, rename
   `## [Unreleased]` in `CHANGELOG.md` to the version, and put the version in the
   install snippets of the README if it names one. Land it on `main`.
2. Tag it, from the commit on `main`:

   ```bash
   git tag python-0.1.0
   git push origin python-0.1.0
   ```

3. Watch [Actions → Python release](https://github.com/liliang-dev/SilenceWatch/actions/workflows/python-release.yml).
   It checks that the commit is on `main` and that the package and the changelog give
   the version of the tag, runs the lint, the types and the tests, builds the wheel and
   the source archive, checks their metadata, and publishes them.

A version published to PyPI can never be replaced: a mistake is answered with the next
number. Until step 2 of "Once" is done, `pip install silencewatch` finds nothing.

## Releasing the Laravel package

The package (`clients/laravel`) has a version of its own, and is published to
**Packagist** as `silencewatch/laravel`. It is tagged apart: `laravel-0.1.0`. The
[Laravel release](../.github/workflows/laravel-release.yml) workflow answers to that tag
only.

Packagist does not take an upload: it reads a git repository whose root is the package,
and takes its versions from that repository's tags. So the workflow copies
`clients/laravel`, with its history, to a **read-only mirror**,
`liliang-dev/silencewatch-laravel`, and tags it there `0.1.0`. Nothing is developed in the
mirror; its issues and pull requests can be turned off.

### Once: the mirror and Packagist

1. **The mirror**: an empty public repository `liliang-dev/silencewatch-laravel` on
   GitHub — no README, no licence, no first commit: the workflow writes all of it.
2. **A deploy key**: `ssh-keygen -t ed25519 -f laravel-mirror -N "" -C laravel-release`.
   In the mirror, *Settings → Deploy keys → Add deploy key*, paste
   `laravel-mirror.pub`, and tick **Allow write access**.
3. **A GitHub environment** named `packagist` in *this* repository (Settings →
   Environments), with one secret, `LARAVEL_MIRROR_DEPLOY_KEY`: the content of the
   private key `laravel-mirror`. Then delete both files. Add yourself as a required
   reviewer if you want a click before each release.
4. **The first release** (below), so that the mirror has a `composer.json` at its root.
5. **Packagist**: sign in at <https://packagist.org> with GitHub, *Submit*, and give
   `https://github.com/liliang-dev/silencewatch-laravel`. Packagist installs its own hook
   on the mirror when you signed in with GitHub, so later tags appear on their own.

### Each release

1. In `clients/laravel`, set `VERSION` in `src/Client.php` and rename `## [Unreleased]` in
   `CHANGELOG.md` to the version. Land it on `main`.
2. Tag it, from the commit on `main`:

   ```bash
   git tag laravel-0.1.0
   git push origin laravel-0.1.0
   ```

3. Watch [Actions → Laravel release](https://github.com/liliang-dev/SilenceWatch/actions/workflows/laravel-release.yml).
   It checks that the commit is on `main` and that the package and the changelog give the
   version of the tag, runs the tests, then pushes the package's history to the mirror's
   `main` (a fast-forward, never forced) and the tag `0.1.0`. A tag that already exists in
   the mirror is refused rather than moved.

Packagist shows the version a few minutes later. A tag people have installed must not
change: a mistake is answered with the next number.

## Deploying by hand

For a fork without the deploy secrets, or when you want to choose the moment.

### Swarm, no downtime

On the manager node:

```bash
cd /opt/silencewatch
set -a; . ./.env; set +a
SILENCEWATCH_VERSION=0.2.0 docker stack deploy -c docker-stack.yml silencewatch
```

Then watch it converge:

```bash
docker service ps silencewatch_silencewatch
docker service inspect --format '{{.UpdateStatus.State}}' silencewatch_silencewatch
```

`completed` is done. `rolling_back` or `paused` means the new tasks never became
healthy — `docker service logs silencewatch_silencewatch` says why, and the old
version is still serving in the meantime.

Keeping `SILENCEWATCH_VERSION` in `.env` instead of on the command line works,
and makes the deploy command identical every time.

### Compose, brief outage

```bash
cd /opt/silencewatch
docker compose pull
docker compose up -d
```

A few seconds of downtime while the container is replaced. For a single-node
instance that is usually the right trade.

### If the release changes configuration

Both paths read `/opt/silencewatch/.env`, and neither invents values that are
not in it. When the changelog adds a setting, edit `.env` **before** deploying —
the server refuses to start on an invalid configuration and says which key is
wrong, so a missed one is a failed deploy rather than a broken instance.

Migrations run at startup, on their own, on both paths.

## Rolling back

Deploy the previous version. It is the same command with an older number:

```bash
SILENCEWATCH_VERSION=0.1.1 docker stack deploy -c docker-stack.yml silencewatch
```

Migrations are additive, so an older image runs against a newer schema. The one
exception is a release whose notes say otherwise — those say what to do instead,
and it is why the notes are written before the tag exists.

Take a backup first anyway. [docs/self-hosting.md](self-hosting.md#backups) is
one command.
