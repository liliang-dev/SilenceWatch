#!/bin/sh
# Applies pending migrations, then starts the server.
#
# Migrations run at startup on purpose: upgrading a self-hosted SilenceWatch must
# be "pull the new image and restart", not a documented ritual. `migrate deploy`
# only applies migrations that already exist — it never generates or resets
# anything, so it is safe to run on every boot, including on several instances at
# once (PostgreSQL advisory locks make them queue rather than collide).
set -eu

if [ -z "${DATABASE_URL:-}" ]; then
  echo "SilenceWatch: DATABASE_URL is not set." >&2
  exit 1
fi

if [ "${RUN_MIGRATIONS:-true}" = "true" ]; then
  # The database often starts alongside this container, so a few retries are
  # normal rather than exceptional. The wording stays honest about what is being
  # retried: an earlier version called every failure "database not ready", which
  # hid a permissions problem behind a plausible-sounding message for a whole
  # debugging cycle.
  attempt=1
  max_attempts=${MIGRATION_ATTEMPTS:-10}

  while [ "$attempt" -le "$max_attempts" ]; do
    # `prisma` by name, not `npx prisma`: the image puts the server workspace's
    # .bin on PATH, and npx would go looking for a package to fetch on a
    # container that has no business reaching the network at startup.
    #
    # --config is not optional since Prisma 7: the connection URL left
    # schema.prisma and lives in the config file, which Prisma looks for in the
    # working directory — and this script runs from /app, not from the server
    # package. Without it every start fails with "datasource.url property is
    # required".
    if prisma migrate deploy \
        --schema packages/server/prisma/schema.prisma \
        --config packages/server/prisma.config.ts; then
      break
    fi

    if [ "$attempt" -eq "$max_attempts" ]; then
      echo "SilenceWatch: migrations failed after ${max_attempts} attempts. The error above is the reason." >&2
      exit 1
    fi

    delay=$((attempt * 2))
    echo "SilenceWatch: migration attempt ${attempt}/${max_attempts} failed (see the error above), retrying in ${delay}s…" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done
fi

exec "$@"
