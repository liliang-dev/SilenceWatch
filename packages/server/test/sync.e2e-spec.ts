import type { CreatedApiKeyDto, SyncResultDto } from '@silencewatch/shared';
import { auth, createTestApp, registerUser, type TestApp } from './utils/test-app';

/**
 * `/checks/sync` is the contract behind the Spring Boot starter: the whole
 * differentiator rests on it being idempotent, stable across restarts, and
 * incapable of destroying history.
 */
describe('POST /api/v1/checks/sync', () => {
  let context: TestApp;
  let apiKey: string;
  let projectId: string;
  let userToken: string;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
    const user = await registerUser(context);
    userToken = user.token;
    projectId = user.projectId;

    const key = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/api-keys`,
      headers: auth(userToken),
      payload: { name: 'spring-boot-starter' },
    });
    apiKey = key.json<CreatedApiKeyDto>().token;
  });

  async function sync(payload: Record<string, unknown>, token = apiKey): Promise<SyncResultDto> {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/checks/sync',
      headers: auth(token),
      payload,
    });
    if (response.statusCode !== 200) {
      throw new Error(`sync failed: ${response.statusCode} ${response.body}`);
    }
    return response.json<SyncResultDto>();
  }

  const backupJob = {
    key: 'com.acme.jobs.BackupJob#run',
    name: 'BackupJob.run',
    cron: '0 2 * * *',
    timezone: 'Europe/Paris',
    grace_seconds: 300,
  };
  const exportJob = {
    key: 'com.acme.jobs.ExportJob#run',
    name: 'ExportJob.run',
    interval_seconds: 900,
  };

  it('creates checks from a declaration and returns their ping URLs', async () => {
    const result = await sync({
      environment: 'production',
      source: 'spring-boot-starter',
      checks: [backupJob, exportJob],
    });

    expect(result.checks).toHaveLength(2);
    expect(result.checks.every((check) => check.created)).toBe(true);
    expect(result.orphaned).toEqual([]);

    const backup = result.checks.find((check) => check.key === backupJob.key);
    expect(backup?.pingUrl).toBe(`http://test.silencewatch.local/p/${backup?.pingKey as string}`);

    const stored = await context.prisma.check.findFirstOrThrow({ where: { key: backupJob.key } });
    expect(stored.source).toBe('auto');
    expect(stored.environment).toBe('production');
    expect(stored.scheduleType).toBe('cron');
    expect(stored.cronExpression).toBe('0 2 * * *');
    expect(stored.timezone).toBe('Europe/Paris');
    expect(stored.graceSeconds).toBe(300);
    expect(stored.state).toBe('NEW');
  });

  it('is idempotent: a restart keeps the same check, id and ping key', async () => {
    const first = await sync({ environment: 'production', checks: [backupJob] });
    const second = await sync({ environment: 'production', checks: [backupJob] });

    expect(second.checks[0]?.id).toBe(first.checks[0]?.id);
    expect(second.checks[0]?.pingKey).toBe(first.checks[0]?.pingKey);
    expect(second.checks[0]?.created).toBe(false);
    expect(await context.prisma.check.count()).toBe(1);
  });

  it('keeps history and the deadline across a redeploy', async () => {
    const created = await sync({ environment: 'production', checks: [backupJob] });
    const pingKey = created.checks[0]?.pingKey as string;

    await context.app.inject({ method: 'GET', url: `/p/${pingKey}` });
    const afterPing = await context.prisma.check.findFirstOrThrow({ where: { key: backupJob.key } });

    await sync({ environment: 'production', checks: [backupJob] });
    const afterResync = await context.prisma.check.findFirstOrThrow({ where: { key: backupJob.key } });

    expect(await context.prisma.ping.count()).toBe(1);
    expect(afterResync.state).toBe('UP');
    // An unchanged schedule must not hand the job a fresh grace period.
    expect(afterResync.nextDueAt?.getTime()).toBe(afterPing.nextDueAt?.getTime());
  });

  it('moves the deadline when the declared schedule changes', async () => {
    const created = await sync({ environment: 'production', checks: [backupJob] });
    const before = await context.prisma.check.findFirstOrThrow({ where: { key: backupJob.key } });

    await sync({
      environment: 'production',
      checks: [{ ...backupJob, cron: '*/30 * * * *', name: 'BackupJob.run (faster)' }],
    });
    const after = await context.prisma.check.findFirstOrThrow({ where: { key: backupJob.key } });

    expect(after.id).toBe(created.checks[0]?.id);
    expect(after.cronExpression).toBe('*/30 * * * *');
    expect(after.name).toBe('BackupJob.run (faster)');
    expect(after.nextDueAt?.getTime()).not.toBe(before.nextDueAt?.getTime());
  });

  it('flags disappeared checks as orphaned and never deletes them', async () => {
    await sync({ environment: 'production', checks: [backupJob, exportJob] });

    // The export job was removed from the codebase.
    const result = await sync({ environment: 'production', checks: [backupJob] });

    expect(result.orphaned).toEqual([exportJob.key]);
    const orphan = await context.prisma.check.findFirstOrThrow({ where: { key: exportJob.key } });
    expect(orphan.orphanedAt).not.toBeNull();
    // Deleting it would have destroyed the history at the first refactoring.
    expect(await context.prisma.check.count()).toBe(2);
  });

  it('clears the orphan flag when a check comes back', async () => {
    await sync({ environment: 'production', checks: [backupJob, exportJob] });
    await sync({ environment: 'production', checks: [backupJob] });
    await sync({ environment: 'production', checks: [backupJob, exportJob] });

    const restored = await context.prisma.check.findFirstOrThrow({ where: { key: exportJob.key } });
    expect(restored.orphanedAt).toBeNull();
  });

  it('never orphans another environment\'s checks', async () => {
    await sync({ environment: 'production', checks: [backupJob, exportJob] });
    await sync({ environment: 'staging', checks: [backupJob] });

    const production = await context.prisma.check.findMany({ where: { environment: 'production' } });
    expect(production).toHaveLength(2);
    expect(production.every((check) => check.orphanedAt === null)).toBe(true);
  });

  it('leaves manually created checks alone', async () => {
    const manual = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/checks`,
      headers: auth(userToken),
      payload: {
        name: 'Manual job',
        scheduleType: 'interval',
        periodSeconds: 3_600,
        graceSeconds: 60,
        environment: 'production',
      },
    });
    expect(manual.statusCode).toBe(201);

    await sync({ environment: 'production', checks: [backupJob] });

    const stored = await context.prisma.check.findFirstOrThrow({ where: { name: 'Manual job' } });
    expect(stored.orphanedAt).toBeNull();
    expect(stored.source).toBe('api');
  });

  it('honours prune=false', async () => {
    await sync({ environment: 'production', checks: [backupJob, exportJob] });
    const result = await sync({ environment: 'production', prune: false, checks: [backupJob] });

    expect(result.orphaned).toEqual([]);
    const stored = await context.prisma.check.findFirstOrThrow({ where: { key: exportJob.key } });
    expect(stored.orphanedAt).toBeNull();
  });

  it('generates stable slugs that survive a rename', async () => {
    const first = await sync({ environment: 'production', checks: [backupJob] });
    const slugAfterCreate = (
      await context.prisma.check.findFirstOrThrow({ where: { id: first.checks[0]?.id } })
    ).slug;

    await sync({ environment: 'production', checks: [{ ...backupJob, name: 'Renamed' }] });
    const afterRename = await context.prisma.check.findFirstOrThrow({
      where: { id: first.checks[0]?.id },
    });

    expect(afterRename.slug).toBe(slugAfterCreate);
    expect(slugAfterCreate).toMatch(/^backupjob-run-[0-9a-f]{8}$/);
  });

  it('handles a large declaration in one round trip', async () => {
    const checks = Array.from({ length: 200 }, (_unused, index) => ({
      key: `com.acme.jobs.Job${index}#run`,
      name: `Job${index}.run`,
      interval_seconds: 3_600,
    }));

    const result = await sync({ environment: 'production', checks });
    expect(result.checks).toHaveLength(200);
    expect(await context.prisma.check.count()).toBe(200);
  });

  it('rejects invalid declarations without partially applying them', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/checks/sync',
      headers: auth(apiKey),
      payload: {
        environment: 'production',
        checks: [backupJob, { key: 'com.acme.Broken#run', name: 'Broken', cron: '99 99 * * *' }],
      },
    });

    expect(response.statusCode).toBe(400);
    expect(await context.prisma.check.count()).toBe(0);
  });

  it('rejects duplicate keys in one payload', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/checks/sync',
      headers: auth(apiKey),
      payload: { environment: 'production', checks: [backupJob, backupJob] },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ message: string }>().message).toMatch(/Duplicate check key/);
  });

  it('rejects a check declaring both a cron and an interval', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/v1/checks/sync',
      headers: auth(apiKey),
      payload: {
        environment: 'production',
        checks: [{ ...backupJob, interval_seconds: 900 }],
      },
    });
    expect(response.statusCode).toBe(400);
  });

  it('requires a project when called with a user session', async () => {
    const withoutProject = await context.app.inject({
      method: 'POST',
      url: '/api/v1/checks/sync',
      headers: auth(userToken),
      payload: { environment: 'production', checks: [backupJob] },
    });
    expect(withoutProject.statusCode).toBe(400);

    const withProject = await context.app.inject({
      method: 'POST',
      url: `/api/v1/checks/sync?projectId=${projectId}`,
      headers: auth(userToken),
      payload: { environment: 'production', checks: [backupJob] },
    });
    expect(withProject.statusCode).toBe(200);
  });

  it('applies a default grace period when the client omits one', async () => {
    await sync({ environment: 'production', checks: [exportJob] });
    const stored = await context.prisma.check.findFirstOrThrow({ where: { key: exportJob.key } });
    expect(stored.graceSeconds).toBe(300);
  });

  it('ingests heartbeats on the ping key it just handed out', async () => {
    const result = await sync({ environment: 'production', checks: [backupJob] });
    const pingKey = result.checks[0]?.pingKey as string;

    const start = await context.app.inject({ method: 'GET', url: `/p/${pingKey}/start` });
    const success = await context.app.inject({ method: 'GET', url: `/p/${pingKey}/0?duration_ms=1500` });

    expect(start.statusCode).toBe(200);
    expect(success.statusCode).toBe(200);

    const stored = await context.prisma.check.findFirstOrThrow({ where: { key: backupJob.key } });
    expect(stored.state).toBe('UP');
    expect(stored.lastDurationMs).toBe(1500);
  });
});
