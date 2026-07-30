import { execFileSync } from 'node:child_process';

/**
 * Applies migrations to the test database once, before any suite runs.
 *
 * `prisma migrate deploy` (not `db push`) on purpose: the end-to-end tests then
 * exercise the same DDL that production runs, including the partial indexes and
 * CHECK constraints that several behaviours depend on.
 */
export default function globalSetup(): void {
  const databaseUrl = process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL;
  if (databaseUrl === undefined || databaseUrl.length === 0) {
    throw new Error(
      'End-to-end tests need a database: set TEST_DATABASE_URL to a PostgreSQL instance ' +
        'whose contents may be destroyed.',
    );
  }

  execFileSync('npx', ['prisma', 'migrate', 'deploy'], {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'inherit',
  });
}
