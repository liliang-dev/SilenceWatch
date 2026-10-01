# Verifying a dependency change in this repository

Run this after the routine bumps, and again after **each** major. It mirrors the
`node`, `java`, `docker` and `supply-chain` jobs in `.github/workflows/ci.yml`,
so a green run here means a green run there.

## The pipeline

```bash
# 1. Resolve, and generate the Prisma client the server's types come from.
pnpm install --no-frozen-lockfile
pnpm run prisma:generate

# 2. Shared types first — nothing downstream type-checks without them.
pnpm run build:shared

# 3. Type-check server and web.
pnpm run lint

# 4. Unit tests: shared, server, web.
pnpm test

# 5. End-to-end, against a real PostgreSQL.
TEST_DATABASE_URL=postgresql://silencewatch:silencewatch@localhost:5432/silencewatch_test \
  pnpm run test:e2e

# 6. The builds. Step 3 passing does not imply step 6 passing.
pnpm run build:server && pnpm run build:web

# 7. Advisories.
pnpm audit --audit-level=moderate

# 8. The lockfile you are about to commit is the one a clean install produces.
pnpm install --frozen-lockfile
```

If a Maven bump is in the backlog, add:

```bash
cd clients/spring-boot-starter && mvn -B install
cd examples/spring-boot-demo && mvn -B -q compile
```

The example application compiling against the published starter is the starter's
real contract; the unit tests alone do not cover it.

## Getting PostgreSQL up

The e2e suite needs a live database. In a container that ships one but does not
start it:

```bash
service postgresql start
until pg_isready -q; do sleep 1; done

sudo -u postgres psql -tc "SELECT 1 FROM pg_roles WHERE rolname='silencewatch'" | grep -q 1 \
  || sudo -u postgres psql -c "CREATE ROLE silencewatch LOGIN PASSWORD 'silencewatch' SUPERUSER"
sudo -u postgres psql -tc "SELECT 1 FROM pg_database WHERE datname='silencewatch_test'" | grep -q 1 \
  || sudo -u postgres createdb -O silencewatch silencewatch_test
```

PostgreSQL in these containers has a habit of stopping between commands. If a
run fails with `ECONNREFUSED 127.0.0.1:5432`, restart it and re-run rather than
concluding the bump broke something.

## Getting a Node the Angular CLI accepts

`ng build` and `ng test` refuse to start outside
`^22.22.3 || ^24.15.0 || >=26.0.0`, and there is no bypass flag — the check is in
`@angular/cli/bin/ng.js` before bootstrap. Skipping the build is not an option,
because the build is where TypeScript and Angular majors actually fail. Fetch a
matching runtime into the scratchpad:

```bash
cd "$SCRATCHPAD"
curl -fsSLO https://nodejs.org/dist/v24.15.0/node-v24.15.0-linux-x64.tar.xz
tar xf node-v24.15.0-linux-x64.tar.xz
export PATH="$SCRATCHPAD/node-v24.15.0-linux-x64/bin:$PATH"
```

Node 24 is what CI uses and what the image ships, so this also makes the local
run representative rather than merely passing.

## Known traps, and how each announced itself

| Change | `tsc` | What actually failed | Signal |
|---|---|---|---|
| zod 3 → 4 | clean | `.default()` stopped parsing its argument, so a union default became the *string* `"false"` | 103 red e2e tests, `invalid IP address: false` from fastify |
| TypeScript 6 → 7 | clean | `@angular/compiler-cli` pins `typescript: >=6.0 <6.1` | `ng build`: `TypeError: Cannot read properties of undefined (reading 'Error')` in `readConfiguration` |
| jose 5 → 6 | fails | package is ESM-only; Node 22 can `require()` it but Jest's runtime cannot | `TS1479`, then 6 of 7 e2e suites failing at import |
| `cache: pnpm` on a job that installs nothing | n/a | the post-job cache save fails the whole job | red job with a green build |
| `@fastify/static` 10.1.3 → 10.1.4 | clean | now depends on `content-disposition` ^3, ESM-only; Node can `require()` it, Jest cannot | `web-ui.e2e-spec.ts`: `Must use import to load ES Module` — and the bot's own PR red on it |
| Nest 11 → 12 | **76 × TS1479** | every `@nestjs/*` package is `type: module`; the server is CommonJS | a migration, not a bump; the only line that pins a fixed fastify |
| bumping our `fastify` while Nest pins its own | clean | the adapter builds the serving instance from *its* exact-pinned copy | `pnpm why fastify` lists two versions; the audit path goes through `@nestjs/platform-fastify` |
| an install refused by `minimumReleaseAge` | **clean — of the old tree** | nothing was installed, so the type-check never saw the bump | `ERR_PNPM_NO_MATURE_MATCHING_VERSION`, easy to lose in a piped tail |

The pattern worth carrying: **the failure is almost never where the diff is.**
A dependency bump changes behaviour at runtime and at build time, and the type
checker is the one tool that sees neither.

## Booting what the container boots

Docker's registry is unreachable from this environment, so the `Container image`
job in CI is the only place the image is ever built. Most of what it proves can be
reproduced without Docker, and an override that crosses a pin deserves it: the
`--prod` install is a different tree from the one the tests ran in, and it is the
one that ships.

```bash
# What the runtime stage COPYs before installing, in a fresh directory.
R=$SCRATCHPAD/image-$(date +%s); mkdir -p $R/packages/{shared,server,web}
cp package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc $R/
for w in shared server web; do cp packages/$w/package.json $R/packages/$w/; done
cp -r packages/server/prisma packages/server/prisma.config.ts $R/packages/server/
( cd $R && pnpm install --frozen-lockfile --prod --filter '@silencewatch/server...' )
cp -r packages/shared/dist $R/packages/shared/; cp -r packages/server/dist packages/server/public $R/packages/server/

# Then the entrypoint's two steps, with the production tree's own prisma.
cd $R && export PATH=$R/packages/server/node_modules/.bin:$PATH NODE_ENV=production
prisma migrate deploy --schema packages/server/prisma/schema.prisma --config packages/server/prisma.config.ts
node packages/server/dist/main.js
```

Use a **fresh database**, so `migrate deploy` applies every migration rather than
reporting that there is nothing to do. `NODE_ENV=production` matters: the server
refuses the `console` mail provider there, which is the configuration operators
actually run. A throwaway directory per run — never `rm` a glob after a `cd`; the
sandbox refuses it, rightly, and a fresh path needs no cleanup.

Then drive it. A browser scenario that signs up, creates a check, sends pings,
opens an incident and watches the alert arrive covers what the suites cannot: the
built SPA against the built server, as shipped. For the alert, a ten-line
STARTTLS-only SMTP sink with a self-signed certificate (`NODE_EXTRA_CA_CERTS`
trusts it) exercises the path operators run — `requireTLS` on port 587 — through
the real `EmailService`, which is what a nodemailer major actually changes.

## Verifying an override that ships

Most overrides need nothing beyond `pnpm audit` going quiet: the package sits
inside a build tool and never reaches the image. Two facts change that, and both
are worth checking before adding the line rather than after.

**Is the parent in the production install?** `prisma`, `@prisma/client` and
`@prisma/adapter-pg` are `dependencies`, not `devDependencies` — the container
entrypoint runs `prisma migrate deploy` at start, so `pnpm install --prod` keeps
them and everything under them.

```bash
python3 -c "
import json; d=json.load(open('packages/server/package.json'))
print([p for p in d['dependencies'] if 'prisma' in p])"
grep -n -- '--prod' Dockerfile
```

**Does the override cross an exact pin?** A range gets picked up eventually on
its own; an exact pin does not, and stepping over it is a bet on an API.

```bash
grep -o '"<pkg>": *"[^"]*"' node_modules/.pnpm/<parent>@*/node_modules/<parent>/package.json
```

`"deepmerge-ts": "7.1.5"` — no caret — is what turned GHSA-ggr8-5vv4-36mx from a
one-line override into something to test. `@prisma/config` had been told to use
that version and no other.

When both are true, exercise the parent along the path the override crosses:

```bash
pnpm --filter @silencewatch/server exec prisma version        # reads prisma.config.ts
pnpm run prisma:generate                                      # reads it again, writes the client
DATABASE_URL=... pnpm --filter @silencewatch/server exec prisma migrate deploy
```

Then the end-to-end suite, against the client that was just generated. And on a
shipped path, let the `Container image` job be the last word: it builds the
`--prod` install where the override actually lands, starts the container, and
asks it for `/health`.

A clean audit proves the version changed. Only these prove the software still
runs — and on a runtime dependency that is the difference between closing an
advisory and causing an outage.

## What a rejected bump needs

Not "does not work". Record:

1. The exact command and the exact error.
2. Whether the blocker is ours or the ecosystem's.
3. The condition under which it becomes applicable — a version, a peer range, a
   migration we would have to do first.

That third line is what turns a rejection into something actionable next month,
and it is what goes into both the pull request body and the `ignore` entry in
`.github/dependabot.yml`.
