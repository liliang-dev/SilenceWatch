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

The pattern worth carrying: **the failure is almost never where the diff is.**
A dependency bump changes behaviour at runtime and at build time, and the type
checker is the one tool that sees neither.

## What a rejected bump needs

Not "does not work". Record:

1. The exact command and the exact error.
2. Whether the blocker is ours or the ecosystem's.
3. The condition under which it becomes applicable — a version, a peer range, a
   migration we would have to do first.

That third line is what turns a rejection into something actionable next month,
and it is what goes into both the pull request body and the `ignore` entry in
`.github/dependabot.yml`.
