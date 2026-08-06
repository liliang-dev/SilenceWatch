# Development

## Layout

```
packages/shared    validation schemas and DTO types, shared by server, UI and clients (Apache-2.0)
packages/server    NestJS + Fastify API, ingestion, detection, alerting (AGPL-3.0)
packages/web       Angular UI, built into packages/server/public (AGPL-3.0)
clients/spring-boot-starter   the Spring Boot starter (Apache-2.0)
```

## Node

**Node 24 LTS**, or anything else matching `engines.node` in `package.json`
(`^22.22.3 || ^24.15.0 || >=26.0.0`). This is not a preference: Angular's CLI
refuses to start below 22.22.3, and it is the version CI and the published image
run, so it is the one this project is actually tested on.

On an older Node the first failure is not a helpful one. Node 20 ships a
corepack whose shim loads `pnpm.cjs` in a `vm` context without a dynamic-import
callback, and pnpm 11 uses dynamic import, so the very first `pnpm` command dies
with:

```
TypeError [ERR_VM_DYNAMIC_IMPORT_CALLBACK_MISSING]: A dynamic import callback
was not specified.
```

That names neither Node nor the version requirement. Upgrading Node fixes it.
Upgrading only corepack (`npm i -g corepack@latest`) also clears that message,
and is the wrong fix — the Angular CLI then refuses the same Node one step
later.

## The package manager

pnpm, and specifically the version `package.json` pins in `packageManager` —
including its hash, which corepack checks the download against. You do not
install it:

```bash
corepack enable
```

Node ships corepack, and the first `pnpm` command fetches exactly that version.
`npm install` in this repository produces a tree that matches no lockfile.

Coming from a checkout that predates pnpm, delete the npm tree first — an
existing `node_modules` laid out by npm is not the layout pnpm expects:

```bash
rm -rf node_modules packages/*/node_modules
pnpm install
```

Two settings in `pnpm-workspace.yaml` will interrupt you eventually, so they are
worth knowing before they do:

- **Nothing a dependency ships runs at install time** unless it is named in
  `allowBuilds`. Adding a dependency that needs to compile or download something
  fails the install with its name; add it there, in the same commit, with a
  sentence saying why.
- **Nothing published in the last three days is installed.** `pnpm add
  something@latest` can fail with a version that plainly exists. That is the
  setting working — `--minimum-release-age=0` overrides it when the reason is
  good.

Both exist because an install script from a compromised package runs with your
credentials and your network, and the compromises that have actually happened
were caught within a day.

## Running it locally

```bash
pnpm install
docker run -d --name sw-postgres -p 5432:5432 \
  -e POSTGRES_PASSWORD=silencewatch -e POSTGRES_USER=silencewatch -e POSTGRES_DB=silencewatch \
  postgres:16-alpine

cat > packages/server/.env <<'EOF'
DATABASE_URL=postgresql://silencewatch:silencewatch@localhost:5432/silencewatch
SECRET_KEY=development-secret-key-at-least-32-chars
BASE_URL=http://localhost:8080
EMAIL_PROVIDER=console
LOG_LEVEL=debug
EOF

pnpm run build:shared
pnpm run prisma:migrate
pnpm run dev            # API on :8080
pnpm run dev:web        # UI on :4200, proxying /api and /p to :8080
```

`EMAIL_PROVIDER=console` prints alerts to the log. The server refuses to start
with it when `NODE_ENV=production`.

## Proving it works with curl

`scripts/smoke.sh` walks the whole product from the outside: register, create a
check, ping it, watch it go down, bring it back.

```bash
cd packages/server && BASE=http://localhost:8080 ./scripts/smoke.sh
```

## Tests

```bash
pnpm test              # shared, server and web unit tests, no database
pnpm run test:e2e      # needs TEST_DATABASE_URL
cd clients/spring-boot-starter && mvn test
```

The web tests run on Vitest through the Angular builder; they need no browser.

The end-to-end suite migrates and truncates the database it is pointed at, so give
it its own:

```bash
createdb silencewatch_test
TEST_DATABASE_URL=postgresql://…/silencewatch_test pnpm run test:e2e
```

It runs against a real PostgreSQL on purpose: the interesting logic (the detection
state machine, `FOR UPDATE SKIP LOCKED`, the sync upsert, partial indexes) lives in
SQL, and a mocked database would test none of it.

## Load testing the ingestion path

```bash
cd packages/server
BASE=http://localhost:8080 CHECKS=50 DURATION=20 CONNECTIONS=100 pnpm run loadtest
```

It creates checks, hammers their ping URLs, and **fails if a single heartbeat was
not accepted** — a dropped heartbeat is a false alert. Raise
`PING_RATE_LIMIT_PER_MINUTE` for the run, since the limiter is per ping key.

For reference, a shared 2-core sandbox with PostgreSQL on the same host sustains
~1,600 heartbeats/second with no drops (p50 30 ms at 64 connections). Real
hardware with a dedicated database does considerably better; the point of the
number is the shape, not the record.

## The Spring starter against a real server

`examples/spring-boot-demo` is a plain Spring Boot application with two scheduled
jobs and no monitoring code. It is the fastest way to see — or to verify — that
the starter does what it claims:

```bash
cd clients/spring-boot-starter && mvn install -DskipTests
cd ../../examples/spring-boot-demo
SILENCEWATCH_API_KEY=sw_… mvn spring-boot:run
```

The jobs appear within a second of startup, tagged `auto`, with their resolved
schedules. Stop the application and watch them go `LATE`, then `DOWN`.

## Migrations

Migrations are **hand-written SQL**. Several objects the product depends on have
no Prisma equivalent: the partial index driving detection, the unique partial index
guaranteeing one open incident per check, the CHECK constraints, and the
`NOTIFY` trigger used to invalidate the ingestion cache.

To change the schema:

1. edit `packages/server/prisma/schema.prisma`;
2. generate the SQL and review it:
   ```bash
   pnpm exec prisma migrate diff --from-url "$DATABASE_URL" \
     --to-schema-datamodel prisma/schema.prisma --script
   ```
3. save it as `prisma/migrations/<timestamp>_<name>/migration.sql`, adding by hand
   anything Prisma cannot express;
4. apply with `pnpm exec prisma migrate deploy` and run the end-to-end suite.

Do not use `prisma migrate dev`: it would offer to drop the objects it does not
know about.

## Conventions

- The ingestion path stays bare. No ORM, no pipes, no guards, no interceptors, no
  outbound call. If something has to happen on a heartbeat, it happens in the
  detection loop instead.
- Comments explain *why*. What the code does is visible in the code.
- Shared validation rules live in `packages/shared` so the server, the UI and the
  client libraries cannot disagree.
- New alert channels are one class implementing `ChannelSender`, registered in
  `SenderRegistry`.
