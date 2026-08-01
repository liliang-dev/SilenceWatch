# SilenceWatch — one image containing the API, the detection loop and the web UI.
#
# Self-hosting has to be one command, so this image is deliberately whole: no
# sidecar to build the frontend, no init container to migrate the database. The
# only thing it needs is a PostgreSQL it can reach.

# --------------------------------------------------------------------- build ---
FROM node:24-bookworm-slim AS builder

# openssl so Prisma resolves the same engine target here as in the runtime
# image; the explicit binaryTargets in schema.prisma is the real guarantee, this
# just stops `native` from meaning two different things.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=development

# Manifests first: this layer only changes when dependencies do, so the (slow)
# install is reused across source-only rebuilds.
COPY package.json package-lock.json ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
# The server's postinstall generates the Prisma client, which needs the schema.
COPY packages/server/prisma packages/server/prisma

RUN npm ci --no-audit --no-fund

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web

# Shared types, then the server (which needs them), then the UI — whose output
# lands in packages/server/public and is served by the same process.
RUN npm run build:shared \
 && npm run build:server \
 && npm run build:web

# Drop everything only needed to build. Prisma's CLI stays: it applies migrations
# at startup.
RUN npm prune --omit=dev --no-audit --no-fund

# ------------------------------------------------------------------- runtime ---
FROM node:24-bookworm-slim AS runtime

# openssl is required by Prisma's query engine; curl gives the image a working
# HEALTHCHECK without adding a shell script.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/packages/shared/package.json ./packages/shared/package.json
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/server/package.json ./packages/server/package.json
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/prisma ./packages/server/prisma
COPY --from=builder /app/packages/server/public ./packages/server/public
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# Strip carriage returns before making it executable. A checkout on Windows can
# turn this script into CRLF, and the container then fails to start with
# "no such file or directory" naming a file that is right there — the kernel is
# looking for an interpreter called "/bin/sh\r". .gitattributes prevents the bad
# checkout; this makes the image correct even when someone builds from one.
RUN sed -i 's/\r$//' /usr/local/bin/docker-entrypoint.sh \
 && chmod +x /usr/local/bin/docker-entrypoint.sh

# Migrations run at container start, so the migration engine has to be in *this*
# image — not merely in the stage that built it. Resolving it here, as root and
# with the network available, means container start needs neither.
#
# The listing is deliberate: when this breaks, the build log shows what is
# actually on disk instead of leaving it to be guessed from a runtime error.
RUN set -eu; \
    npx --no-install prisma version; \
    echo '--- node_modules/@prisma/engines ---'; \
    ls -la node_modules/@prisma/engines || true; \
    engine="$(find node_modules/@prisma/engines /root/.cache/prisma -type f -name 'schema-engine-*' -print -quit 2>/dev/null || true)"; \
    if [ -z "$engine" ]; then \
        echo 'No schema engine found: migrations would fail at container start.' >&2; \
        exit 1; \
    fi; \
    echo "Using schema engine: $engine"; \
    mkdir -p /app/engines; \
    cp "$engine" /app/engines/schema-engine; \
    chmod 0755 /app/engines/schema-engine

# Pointing the CLI straight at the binary removes its discovery and download
# logic from the startup path entirely — which is what makes a read-only
# filesystem and an air-gapped host viable.
ENV PRISMA_SCHEMA_ENGINE_BINARY=/app/engines/schema-engine

# Runs as the unprivileged `node` user that the base image already provides.
USER node

EXPOSE 8080

# The container is unhealthy when the detection loop stalls, not merely when the
# process is alive — see the /health handler.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:${PORT}/health || exit 1

# Build metadata, surfaced by /health and by the support bundle.
ARG SILENCEWATCH_VERSION=0.1.0
ARG SILENCEWATCH_COMMIT=unknown
ENV SILENCEWATCH_VERSION=${SILENCEWATCH_VERSION} \
    SILENCEWATCH_COMMIT=${SILENCEWATCH_COMMIT}

LABEL org.opencontainers.image.title="SilenceWatch" \
      org.opencontainers.image.description="Heartbeat monitoring for cron jobs, workers and scheduled tasks" \
      org.opencontainers.image.source="https://github.com/liliang-dev/SilenceWatch" \
      org.opencontainers.image.licenses="AGPL-3.0-only"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "packages/server/dist/main.js"]
