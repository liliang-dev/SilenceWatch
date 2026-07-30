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
  # normal rather than exceptional.
  attempt=1
  max_attempts=${MIGRATION_ATTEMPTS:-10}

  while [ "$attempt" -le "$max_attempts" ]; do
    if npx --no-install prisma migrate deploy --schema packages/server/prisma/schema.prisma; then
      break
    fi

    if [ "$attempt" -eq "$max_attempts" ]; then
      echo "SilenceWatch: migrations failed after ${max_attempts} attempts." >&2
      exit 1
    fi

    delay=$((attempt * 2))
    echo "SilenceWatch: database not ready, retrying in ${delay}s (${attempt}/${max_attempts})…" >&2
    sleep "$delay"
    attempt=$((attempt + 1))
  done
fi

exec "$@"
