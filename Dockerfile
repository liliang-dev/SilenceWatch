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

# pnpm comes from the `packageManager` field, which pins a version *and* its
# hash. corepack downloads that exact tarball and refuses anything else, so the
# package manager is as pinned as the packages it installs.
RUN corepack enable

WORKDIR /app
ENV NODE_ENV=development

# Manifests first: this layer only changes when dependencies do, so the (slow)
# install is reused across source-only rebuilds. pnpm-workspace.yaml carries the
# workspace layout and the supply-chain policy, and .npmrc the registry — an
# install without them is not the install this project describes.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
# The server's postinstall generates the Prisma client, which needs both.
COPY packages/server/prisma packages/server/prisma
COPY packages/server/prisma.config.ts packages/server/

# --frozen-lockfile is the point of having one: resolve exactly what is
# recorded, and fail rather than quietly update it. It is pnpm's default in CI
# and stated here because a Docker build is not detected as CI.
RUN pnpm install --frozen-lockfile

COPY tsconfig.base.json ./
COPY packages/shared packages/shared
COPY packages/server packages/server
COPY packages/web packages/web

# Shared types, then the server (which needs them), then the UI — whose output
# lands in packages/server/public and is served by the same process.
RUN pnpm run build:shared \
 && pnpm run build:server \
 && pnpm run build:web

# ------------------------------------------------------------------- runtime ---
FROM node:24-bookworm-slim AS runtime

# openssl is required by Prisma's query engine; curl gives the image a working
# HEALTHCHECK without adding a shell script.
RUN apt-get update \
 && apt-get install -y --no-install-recommends openssl curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*

RUN corepack enable

WORKDIR /app
ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=8080

# The dependency tree is installed here rather than copied from the builder.
#
# pnpm's node_modules is a tree of symlinks into a content-addressed store, so
# copying selected directories out of it — which is what this file used to do —
# copies links whose targets are left behind. Installing from the same lockfile
# instead produces exactly the production set, with nothing from the build
# toolchain in it, and no assumption about which packages happened to be
# hoisted where.
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml .npmrc ./
COPY packages/shared/package.json packages/shared/
COPY packages/server/package.json packages/server/
COPY packages/web/package.json packages/web/
COPY packages/server/prisma packages/server/prisma
COPY packages/server/prisma.config.ts packages/server/

# `@silencewatch/server...` is the server and everything it depends on, which
# pulls in the shared workspace package and leaves the Angular toolchain out.
RUN pnpm install --frozen-lockfile --prod --filter '@silencewatch/server...'

# Compiled output on top. `@silencewatch/shared` in the server's node_modules is
# a link to packages/shared, so its dist has to be here and not merely built.
COPY --from=builder /app/packages/shared/dist ./packages/shared/dist
COPY --from=builder /app/packages/server/dist ./packages/server/dist
COPY --from=builder /app/packages/server/public ./packages/server/public
COPY deploy/docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh

# The server's binaries, so the entrypoint can call `prisma` by name. pnpm puts
# them under the workspace that declared them rather than at the root.
ENV PATH=/app/packages/server/node_modules/.bin:$PATH

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
    prisma version; \
    engine="$(find node_modules /root/.cache/prisma -type f -name 'schema-engine-*' -print -quit 2>/dev/null || true)"; \
    if [ -z "$engine" ]; then \
        echo 'No schema engine found: migrations would fail at container start.' >&2; \
        find node_modules -type d -name engines -path '*prisma*' >&2 || true; \
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
