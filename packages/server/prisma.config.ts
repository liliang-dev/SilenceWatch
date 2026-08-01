/**
 * Configuration for the Prisma CLI: migrations, introspection and diffing.
 *
 * Prisma 7 no longer accepts a connection URL in schema.prisma. The schema now
 * describes only the shape of the data, and the URL — which is deployment
 * state, not schema — lives here for the CLI and is passed to the client at
 * construction time as a driver adapter (see database/prisma.service.ts).
 *
 * `process.env` rather than Prisma's `env()` helper: that helper throws when the
 * variable is absent, and `prisma generate` legitimately runs without a database
 * — the Docker build does exactly that. Commands that genuinely need a URL
 * report a clear error of their own when it is missing.
 */
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL },
});
