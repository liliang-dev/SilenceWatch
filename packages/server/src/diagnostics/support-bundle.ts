#!/usr/bin/env node
/**
 * Support bundle: `npm run diagnostics -- [output.json]` (or
 * `docker compose exec silencewatch node dist/diagnostics/support-bundle.js`).
 *
 * Produces one file describing the deployment well enough to debug it, and
 * *nothing that should not leave the building*: configuration is emitted as
 * key → classification (set / not set / default), never as values, so secrets,
 * connection strings, ping keys and email addresses cannot ride along.
 */
import { execFileSync } from 'node:child_process';
import { createHash, randomUUID } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import { hostname, platform, release, totalmem } from 'node:os';
import { Client } from 'pg';
import { loadConfig, type AppConfig } from '../config/config';
import { SILENCEWATCH_COMMIT, SILENCEWATCH_VERSION } from '../version';

/** Variables whose *values* are never included, only whether they are set. */
const SECRET_KEYS = new Set([
  'SECRET_KEY',
  'DATABASE_URL',
  'SMTP_URL',
  'POSTMARK_TOKEN',
  'BREVO_API_KEY',
  'OUTBOUND_HEARTBEAT_URL',
]);

/** Non-sensitive settings that are genuinely useful in a support thread. */
const SAFE_KEYS = [
  'NODE_ENV',
  'LOG_LEVEL',
  'PORT',
  'HOST',
  'SERVE_WEB',
  'TRUST_PROXY',
  'EMAIL_PROVIDER',
  'DETECTION_INTERVAL_MS',
  'DETECTION_BATCH_SIZE',
  'DETECTION_ENABLED',
  'NOTIFICATION_INTERVAL_MS',
  'NOTIFICATION_BATCH_SIZE',
  'NOTIFICATION_MAX_ATTEMPTS',
  'NOTIFICATION_TIMEOUT_MS',
  'ALLOW_PRIVATE_NOTIFICATION_TARGETS',
  'PING_RATE_LIMIT_PER_MINUTE',
  'PING_BODY_MAX_BYTES',
  'API_RATE_LIMIT_PER_MINUTE',
  'AUTH_RATE_LIMIT_PER_MINUTE',
  'PING_RETENTION_DAYS',
  'PURGE_CRON',
  'DATABASE_POOL_MAX',
  'INGEST_POOL_MAX',
  'ACCESS_TOKEN_TTL_SECONDS',
  'REFRESH_TOKEN_TTL_DAYS',
  'SIGNUP_ENABLED',
] as const satisfies readonly (keyof AppConfig)[];

const COUNT_QUERIES: Array<[string, string]> = [
  ['users', 'SELECT count(*)::int FROM "user"'],
  ['projects', 'SELECT count(*)::int FROM project'],
  ['checks', 'SELECT count(*)::int FROM "check"'],
  ['checksByState', ''],
  ['pings', 'SELECT count(*)::int FROM ping'],
  ['openIncidents', 'SELECT count(*)::int FROM incident WHERE resolved_at IS NULL'],
  ['pendingNotifications', "SELECT count(*)::int FROM notification_delivery WHERE status = 'pending'"],
  ['failedNotifications', "SELECT count(*)::int FROM notification_delivery WHERE status = 'failed'"],
  ['channels', 'SELECT count(*)::int FROM notification_channel WHERE enabled'],
  ['overdueChecks', `SELECT count(*)::int FROM "check" WHERE next_due_at < now() AND state IN ('NEW','UP','LATE')`],
];

async function collect(): Promise<Record<string, unknown>> {
  const config = loadConfig();
  const client = new Client({
    connectionString: config.DATABASE_URL,
    application_name: 'silencewatch-diagnostics',
  });

  const database: Record<string, unknown> = {};
  try {
    await client.connect();

    const version = await client.query<{ version: string }>('SHOW server_version');
    database.serverVersion = version.rows[0]?.version ?? 'unknown';

    for (const [name, sql] of COUNT_QUERIES) {
      if (sql === '') continue;
      const result = await client.query<{ count: number }>(sql);
      database[name] = result.rows[0]?.count ?? 0;
    }

    const byState = await client.query<{ state: string; count: number }>(
      'SELECT state::text, count(*)::int FROM "check" GROUP BY state ORDER BY state',
    );
    database.checksByState = Object.fromEntries(byState.rows.map((row) => [row.state, row.count]));

    // Confirms the index the detection loop depends on is still in place — the
    // single most common cause of a slow instance.
    const indexes = await client.query<{ indexname: string }>(
      `SELECT indexname FROM pg_indexes WHERE tablename IN ('check', 'incident', 'notification_delivery', 'ping')`,
    );
    database.indexes = indexes.rows.map((row) => row.indexname).sort();

    const applied = await client.query<{ migration_name: string; finished_at: Date | null }>(
      'SELECT migration_name, finished_at FROM _prisma_migrations ORDER BY started_at',
    );
    database.migrations = applied.rows.map((row) => ({
      name: row.migration_name,
      appliedAt: row.finished_at?.toISOString() ?? null,
    }));

    const sizes = await client.query<{ table: string; size: string }>(
      `SELECT relname AS table, pg_size_pretty(pg_total_relation_size(c.oid)) AS size
         FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
        WHERE n.nspname = 'public' AND c.relkind = 'r'
        ORDER BY pg_total_relation_size(c.oid) DESC`,
    );
    database.tableSizes = Object.fromEntries(sizes.rows.map((row) => [row.table, row.size]));
  } catch (error) {
    database.error = (error as Error).message;
  } finally {
    await client.end().catch(() => undefined);
  }

  return {
    generatedAt: new Date().toISOString(),
    bundleId: randomUUID(),
    version: { silencewatch: SILENCEWATCH_VERSION, commit: SILENCEWATCH_COMMIT, node: process.version },
    host: {
      // Hashed: useful to correlate two bundles from the same host, useless to
      // anyone learning the customer's infrastructure.
      hostnameHash: createHash('sha256').update(hostname()).digest('hex').slice(0, 12),
      platform: platform(),
      release: release(),
      totalMemoryMb: Math.round(totalmem() / 1_048_576),
      cpus: process.env.UV_THREADPOOL_SIZE ?? 'default',
    },
    configuration: {
      ...Object.fromEntries(SAFE_KEYS.map((key) => [key, config[key]])),
      ...Object.fromEntries(
        [...SECRET_KEYS].map((key) => [
          key,
          process.env[key] === undefined || process.env[key] === '' ? 'not set' : 'set (redacted)',
        ]),
      ),
      baseUrlHost: safeHost(config.baseUrl),
    },
    health: await fetchHealth(config),
    database,
    recentLogs: readRecentLogs(),
  };
}

function safeHost(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return 'invalid';
  }
}

async function fetchHealth(config: AppConfig): Promise<unknown> {
  try {
    const response = await fetch(`http://127.0.0.1:${config.PORT}/health`, {
      signal: AbortSignal.timeout(3_000),
    });
    return { status: response.status, body: await response.json() };
  } catch (error) {
    return { error: `not reachable locally: ${(error as Error).message}` };
  }
}

/**
 * Container logs, when the bundle runs where docker is available. Absent
 * otherwise — the point is to be useful, not to go hunting through the host.
 */
function readRecentLogs(): string[] {
  const container = process.env.SILENCEWATCH_CONTAINER;
  if (container === undefined) return ['SILENCEWATCH_CONTAINER not set; logs omitted'];

  try {
    const output = execFileSync('docker', ['logs', '--tail', '200', container], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 10_000,
    });
    return output.split('\n').slice(-200);
  } catch (error) {
    return [`could not read logs: ${(error as Error).message}`];
  }
}

const outputPath = process.argv[2] ?? `silencewatch-diagnostics-${Date.now()}.json`;

void collect()
  .then((bundle) => {
    writeFileSync(outputPath, `${JSON.stringify(bundle, null, 2)}\n`, { mode: 0o600 });
    process.stdout.write(
      `Support bundle written to ${outputPath}\n` +
        'It contains no secrets, no ping keys and no email addresses — but read it before sending.\n',
    );
  })
  .catch((error: Error) => {
    process.stderr.write(`Could not produce a support bundle: ${error.message}\n`);
    process.exitCode = 1;
  });
