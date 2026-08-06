# Releasing a new version

Shipping a release is four edits and a tag. CI does the rest: it builds the
image, publishes it to GHCR, creates the GitHub release, and — if the deploy
secrets are configured — updates the swarm without dropping a request.

This is the maintainer's page. Running an instance is
[docs/self-hosting.md](self-hosting.md).

## The whole thing

```
CHANGELOG.md  →  version bump  →  merge to main  →  git tag  →  CI ships it
```

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

Then keep the package manifests in step — cosmetic, since the running version
comes from the image's build argument, but a repository that says 0.1.0 while
shipping 0.2.0 is a bug report waiting to happen:

```bash
pnpm --recursive --include-workspace-root exec npm version 0.2.0 --no-git-tag-version
```

`docker-stack.yml` needs nothing: its version comes from
`SILENCEWATCH_VERSION`, which the deploy sets from the tag.

### 4. Merge to main

Through a pull request, with CI green. The tag has to point at a commit on
`main`: that is what the release notes, the image and the deployment all refer
back to.

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

1. builds and pushes `ghcr.io/liliang-dev/silencewatch:0.2.0` (and `latest`),
2. starts the image against a throwaway PostgreSQL and checks `/health` — a
   version that cannot boot is never released,
3. creates or updates the GitHub release,
4. deploys to the swarm over SSH and waits for the update to converge.

If the deploy step rolls back, the build goes red. A rolled-back release is a
failure, not a quiet no-op.

**Nothing published?** The tag was pushed before the workflow existed, or the
run was cancelled. Re-run it without moving the tag: **Actions → Release → Run
workflow**, and give it the existing tag.

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
