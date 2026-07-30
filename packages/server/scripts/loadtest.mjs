#!/usr/bin/env node
/**
 * Load test for the ingestion path — the one route that must never fall over.
 *
 * Creates a project, a set of checks, then hammers their ping URLs with
 * autocannon and reports latency percentiles and the error count. Anything other
 * than zero non-2xx responses is a failure: a dropped heartbeat is a false alert.
 *
 *   BASE=http://localhost:8080 CHECKS=50 DURATION=20 CONNECTIONS=100 \
 *     node scripts/loadtest.mjs
 *
 * Rate limiting is per ping key, so the test spreads load over CHECKS keys and
 * raises PING_RATE_LIMIT_PER_MINUTE if needed — see the README.
 */
import autocannon from 'autocannon';

const BASE = process.env.BASE ?? 'http://localhost:8080';
const CHECKS = Number(process.env.CHECKS ?? 50);
const DURATION = Number(process.env.DURATION ?? 15);
const CONNECTIONS = Number(process.env.CONNECTIONS ?? 100);
const PASSWORD = 'load-test-password-long-enough';

async function api(path, { method = 'GET', token, body } = {}) {
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      ...(token === undefined ? {} : { authorization: `Bearer ${token}` }),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  if (!response.ok) {
    throw new Error(`${method} ${path} -> ${response.status} ${await response.text()}`);
  }
  return response.json();
}

async function setup() {
  const email = `loadtest-${Date.now()}@example.test`;
  const session = await api('/api/auth/register', {
    method: 'POST',
    body: { email, password: PASSWORD, name: 'Load test' },
  });
  const token = session.accessToken;
  const [project] = await api('/api/v1/projects', { token });

  process.stdout.write(`Creating ${CHECKS} checks…\n`);
  const checks = [];
  for (let index = 0; index < CHECKS; index += 1) {
    checks.push(
      await api(`/api/v1/projects/${project.id}/checks`, {
        method: 'POST',
        token,
        body: {
          name: `Load test job ${index}`,
          scheduleType: 'interval',
          periodSeconds: 3_600,
          graceSeconds: 300,
          environment: 'loadtest',
        },
      }),
    );
  }
  return checks.map((check) => `/p/${check.pingKey}`);
}

async function run(paths) {
  process.stdout.write(
    `Hammering ${paths.length} ping URLs for ${DURATION}s with ${CONNECTIONS} connections…\n`,
  );

  const result = await autocannon({
    url: BASE,
    connections: CONNECTIONS,
    duration: DURATION,
    // One request definition per check, cycled by autocannon.
    requests: paths.map((path) => ({ method: 'GET', path })),
  });

  const nonSuccess = result.non2xx + result.errors + result.timeouts;
  process.stdout.write(
    [
      '',
      `requests/s   avg ${result.requests.average.toFixed(0)}  max ${result.requests.max}`,
      `latency (ms) p50 ${result.latency.p50}  p97.5 ${result.latency.p97_5}  p99 ${result.latency.p99}  max ${result.latency.max}`,
      `throughput   ${(result.throughput.average / 1_048_576).toFixed(2)} MB/s`,
      `responses    2xx ${result['2xx']}  non-2xx ${result.non2xx}  errors ${result.errors}  timeouts ${result.timeouts}`,
      '',
    ].join('\n'),
  );

  if (nonSuccess > 0) {
    process.stdout.write(
      `FAIL: ${nonSuccess} heartbeat(s) were not accepted. A dropped heartbeat is a false alert.\n`,
    );
    process.exitCode = 1;
    return;
  }
  process.stdout.write('OK: every heartbeat was accepted.\n');
}

const paths = await setup();
await run(paths);
