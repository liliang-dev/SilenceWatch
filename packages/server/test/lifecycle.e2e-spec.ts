import type { CheckDto, PageDto, PingDto } from '@silencewatch/shared';
import { auth, createTestApp, registerUser, type TestApp } from './utils/test-app';

/**
 * The product's core promise, end to end against a real PostgreSQL: a job checks
 * in, stops checking in, someone hears about it, and the recovery closes the loop.
 */
describe('check lifecycle', () => {
  let context: TestApp;
  let token: string;
  let projectId: string;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
    const user = await registerUser(context);
    token = user.token;
    projectId = user.projectId;
  });

  async function createCheck(overrides: Record<string, unknown> = {}): Promise<CheckDto> {
    const response = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/checks`,
      headers: auth(token),
      payload: {
        name: 'Nightly backup',
        scheduleType: 'interval',
        periodSeconds: 3_600,
        graceSeconds: 300,
        environment: 'production',
        ...overrides,
      },
    });
    expect(response.statusCode).toBe(201);
    return response.json<CheckDto>();
  }

  async function addEmailChannel(): Promise<void> {
    const response = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/channels`,
      headers: auth(token),
      payload: { type: 'email', name: 'On-call', config: { address: 'oncall@example.test' } },
    });
    expect(response.statusCode).toBe(201);
  }

  async function getCheck(checkId: string): Promise<CheckDto> {
    const response = await context.app.inject({
      method: 'GET',
      url: `/api/v1/checks/${checkId}`,
      headers: auth(token),
    });
    return response.json<CheckDto>();
  }

  /** Moves a check's deadline into the past instead of waiting for real time. */
  async function expireDeadline(checkId: string, secondsAgo: number): Promise<void> {
    await context.prisma.$executeRawUnsafe(
      `UPDATE "check" SET next_due_at = now() - make_interval(secs => $2) WHERE id = $1::uuid`,
      checkId,
      secondsAgo,
    );
  }

  it('starts a check as NEW with a deadline in the future', async () => {
    const check = await createCheck();

    expect(check.state).toBe('NEW');
    expect(check.pingUrl).toBe(`http://test.silencewatch.local/p/${check.pingKey}`);
    expect(new Date(check.nextDueAt as string).getTime()).toBeGreaterThan(Date.now());
    expect(check.slug).toBe('nightly-backup');
  });

  it('records a heartbeat and marks the check UP', async () => {
    const check = await createCheck();

    const response = await context.app.inject({ method: 'GET', url: `/p/${check.pingKey}` });
    expect(response.statusCode).toBe(200);
    expect(response.body).toBe('OK');

    const updated = await getCheck(check.id);
    expect(updated.state).toBe('UP');
    expect(updated.lastPingAt).not.toBeNull();
  });

  it('accepts POST, start, fail and exit-code variants', async () => {
    const check = await createCheck();

    expect(
      (
        await context.app.inject({
          method: 'POST',
          url: `/p/${check.pingKey}/start`,
          payload: 'starting',
          headers: { 'content-type': 'text/plain' },
        })
      ).statusCode,
    ).toBe(200);

    expect((await context.app.inject({ method: 'POST', url: `/p/${check.pingKey}` })).statusCode).toBe(
      200,
    );
    expect((await context.app.inject({ method: 'GET', url: `/p/${check.pingKey}/0` })).statusCode).toBe(
      200,
    );
    expect((await context.app.inject({ method: 'GET', url: `/p/${check.pingKey}/17` })).statusCode).toBe(
      200,
    );

    const pings = await context.app.inject({
      method: 'GET',
      url: `/api/v1/checks/${check.id}/pings`,
      headers: auth(token),
    });
    const kinds = pings.json<PageDto<PingDto>>().items.map((ping) => ping.kind);
    expect(kinds).toEqual(['fail', 'success', 'success', 'start']);

    // A non-zero exit code is an explicit failure and takes the check down.
    expect((await getCheck(check.id)).state).toBe('DOWN');
  });

  it('derives the run duration from /start, and never invents one', async () => {
    const check = await createCheck();

    await context.app.inject({ method: 'GET', url: `/p/${check.pingKey}/start` });
    await new Promise((resolve) => setTimeout(resolve, 60));
    await context.app.inject({ method: 'GET', url: `/p/${check.pingKey}` });
    // A later ping with no /start must not inherit the previous duration.
    await context.app.inject({ method: 'GET', url: `/p/${check.pingKey}` });

    const pings = (
      await context.app.inject({
        method: 'GET',
        url: `/api/v1/checks/${check.id}/pings`,
        headers: auth(token),
      })
    ).json<PageDto<PingDto>>().items;

    expect(pings[0]?.durationMs).toBeNull();
    expect(pings[1]?.durationMs).toBeGreaterThanOrEqual(50);
    expect(pings[2]?.durationMs).toBeNull();
  });

  it('accepts a client-reported duration', async () => {
    const check = await createCheck();
    await context.app.inject({ method: 'POST', url: `/p/${check.pingKey}/0?duration_ms=4321` });

    expect((await getCheck(check.id)).lastDurationMs).toBe(4321);
  });

  it('truncates ping bodies instead of rejecting them', async () => {
    const check = await createCheck();
    await context.app.inject({
      method: 'POST',
      url: `/p/${check.pingKey}`,
      payload: 'x'.repeat(50_000),
      headers: { 'content-type': 'text/plain' },
    });

    const ping = (
      await context.app.inject({
        method: 'GET',
        url: `/api/v1/checks/${check.id}/pings`,
        headers: auth(token),
      })
    ).json<PageDto<PingDto>>().items[0];

    expect(ping?.body?.length).toBe(context.config.PING_BODY_MAX_BYTES);
  });

  it('answers 404 for an unknown ping key and 400 for a malformed one', async () => {
    expect(
      (
        await context.app.inject({
          method: 'GET',
          url: '/p/00000000-0000-4000-8000-000000000000',
        })
      ).statusCode,
    ).toBe(404);

    expect((await context.app.inject({ method: 'GET', url: '/p/not-a-uuid' })).statusCode).toBe(400);
  });

  it('goes LATE inside the grace period and DOWN after it', async () => {
    const check = await createCheck({ graceSeconds: 300 });
    await context.app.inject({ method: 'GET', url: `/p/${check.pingKey}` });

    // Deadline missed by a minute: still inside the 5 minute grace period.
    await expireDeadline(check.id, 60);
    await context.detection.tick();
    expect((await getCheck(check.id)).state).toBe('LATE');

    // Grace exhausted.
    await expireDeadline(check.id, 400);
    await context.detection.tick();
    expect((await getCheck(check.id)).state).toBe('DOWN');
  });

  it('opens exactly one incident and alerts every channel once', async () => {
    await addEmailChannel();
    const check = await createCheck({ graceSeconds: 0 });

    await expireDeadline(check.id, 10);
    await context.detection.tick();
    // Extra ticks must not open a second incident or resend the alert.
    await context.detection.tick();
    await context.detection.tick();

    const incidents = await context.prisma.incident.findMany({ where: { checkId: check.id } });
    expect(incidents).toHaveLength(1);
    expect(incidents[0]?.resolvedAt).toBeNull();

    await context.notifications.flush();
    await context.notifications.flush();

    expect(context.senders.captured).toHaveLength(1);
    expect(context.senders.captured[0]?.type).toBe('email');
    expect(context.senders.captured[0]?.alert.kind).toBe('down');
    expect(context.senders.captured[0]?.alert.check.name).toBe('Nightly backup');

    const refreshed = await context.prisma.incident.findFirstOrThrow({
      where: { checkId: check.id },
    });
    expect(refreshed.notificationsSent).toBe(1);
  });

  it('resolves the incident on the next heartbeat and sends a recovery alert', async () => {
    await addEmailChannel();
    const check = await createCheck({ graceSeconds: 0 });

    await expireDeadline(check.id, 10);
    await context.detection.tick();
    await context.notifications.flush();
    expect(context.senders.captured).toHaveLength(1);

    // The heartbeat only writes state=UP; reconciliation happens in the loop.
    await context.app.inject({ method: 'GET', url: `/p/${check.pingKey}` });
    await context.detection.tick();
    await context.notifications.flush();

    const incident = await context.prisma.incident.findFirstOrThrow({
      where: { checkId: check.id },
    });
    expect(incident.resolvedAt).not.toBeNull();

    const recovery = context.senders.captured[1];
    expect(recovery?.alert.kind).toBe('up');
    expect(recovery?.alert.incident.resolvedAt).not.toBeNull();
  });

  it('never announces a recovery for an outage it never announced', async () => {
    // No channel at the time of the outage: nobody was told it went down.
    const check = await createCheck({ graceSeconds: 0 });
    await expireDeadline(check.id, 10);
    await context.detection.tick();

    await addEmailChannel();
    await context.app.inject({ method: 'GET', url: `/p/${check.pingKey}` });
    await context.detection.tick();
    await context.notifications.flush();

    expect(context.senders.captured).toHaveLength(0);
  });

  it('retries a failed delivery with backoff and eventually gives up', async () => {
    await addEmailChannel();
    const check = await createCheck({ graceSeconds: 0 });
    await expireDeadline(check.id, 10);

    // Armed before the tick: the tick delivers opportunistically, so the very
    // first attempt has to be the one that fails.
    context.senders.failNext = 1;
    await context.detection.tick();
    await context.notifications.flush();

    const pending = await context.prisma.notificationDelivery.findFirstOrThrow({});
    expect(pending.status).toBe('pending');
    expect(pending.attempts).toBe(1);
    expect(pending.lastError).toContain('simulated channel failure');
    // Backoff pushes the next attempt into the future.
    expect(pending.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());

    // Once the backoff has elapsed, the alert goes out.
    await context.prisma.notificationDelivery.update({
      where: { id: pending.id },
      data: { nextAttemptAt: new Date(Date.now() - 1_000) },
    });
    await context.notifications.flush();

    const sent = await context.prisma.notificationDelivery.findFirstOrThrow({});
    expect(sent.status).toBe('sent');
    expect(context.senders.captured).toHaveLength(1);
  });

  it('ignores heartbeats for a paused check and resumes cleanly', async () => {
    const check = await createCheck();
    await context.app.inject({ method: 'GET', url: `/p/${check.pingKey}` });

    await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/checks/${check.id}`,
      headers: auth(token),
      payload: { paused: true },
    });

    const paused = await context.app.inject({ method: 'GET', url: `/p/${check.pingKey}` });
    expect(paused.statusCode).toBe(200);
    expect(paused.body).toBe('PAUSED');
    expect((await getCheck(check.id)).state).toBe('PAUSED');

    // A paused check is never late, so the loop must leave it alone.
    await expireDeadline(check.id, 10_000);
    await context.detection.tick();
    expect((await getCheck(check.id)).state).toBe('PAUSED');

    const resumed = await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/checks/${check.id}`,
      headers: auth(token),
      payload: { paused: false },
    });
    expect(resumed.json<CheckDto>().state).toBe('NEW');
    expect(new Date(resumed.json<CheckDto>().nextDueAt as string).getTime()).toBeGreaterThan(
      Date.now(),
    );
  });

  it('resolves an open incident when a check is paused', async () => {
    await addEmailChannel();
    const check = await createCheck({ graceSeconds: 0 });
    await expireDeadline(check.id, 10);
    await context.detection.tick();
    await context.notifications.flush();

    await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/checks/${check.id}`,
      headers: auth(token),
      payload: { paused: true },
    });
    await context.detection.tick();

    const incident = await context.prisma.incident.findFirstOrThrow({ where: { checkId: check.id } });
    expect(incident.resolvedAt).not.toBeNull();
  });

  it('recomputes the deadline when the schedule changes', async () => {
    const check = await createCheck({ periodSeconds: 3_600 });
    const before = new Date(check.nextDueAt as string).getTime();

    const updated = await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/checks/${check.id}`,
      headers: auth(token),
      payload: { scheduleType: 'cron', cronExpression: '0 2 * * *', timezone: 'Europe/Paris' },
    });

    const after = updated.json<CheckDto>();
    expect(after.scheduleType).toBe('cron');
    expect(after.periodSeconds).toBeNull();
    expect(new Date(after.nextDueAt as string).getTime()).not.toBe(before);
  });

  it('rejects incoherent or unusable schedules', async () => {
    const both = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/checks`,
      headers: auth(token),
      payload: {
        name: 'Broken',
        scheduleType: 'cron',
        cronExpression: '0 2 * * *',
        periodSeconds: 60,
        graceSeconds: 0,
      },
    });
    expect(both.statusCode).toBe(400);

    const badCron = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/checks`,
      headers: auth(token),
      payload: {
        name: 'Broken',
        scheduleType: 'cron',
        cronExpression: '99 99 * * *',
        graceSeconds: 0,
      },
    });
    expect(badCron.statusCode).toBe(400);

    const tooFrequent = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/checks`,
      headers: auth(token),
      payload: { name: 'Broken', scheduleType: 'interval', periodSeconds: 5, graceSeconds: 0 },
    });
    expect(tooFrequent.statusCode).toBe(400);
  });

  it('reports a cron check as due at its next occurrence, not one period later', async () => {
    const check = await createCheck({
      scheduleType: 'cron',
      cronExpression: '0 2 * * *',
      timezone: 'Europe/Paris',
      periodSeconds: undefined,
    });

    await context.app.inject({ method: 'GET', url: `/p/${check.pingKey}` });
    const pinged = await getCheck(check.id);
    const dueAt = new Date(pinged.nextDueAt as string);

    // 02:00 Europe/Paris, whatever the server's own zone is.
    const parisHour = Number(
      new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/Paris',
        hour: '2-digit',
        hour12: false,
      }).format(dueAt),
    );
    expect(parisHour).toBe(2);
  });

  it('drains a backlog larger than one batch', async () => {
    const checks = await Promise.all(
      Array.from({ length: 12 }, (_unused, index) =>
        createCheck({ name: `Job ${index}`, graceSeconds: 0 }),
      ),
    );
    await context.prisma.$executeRawUnsafe(
      `UPDATE "check" SET next_due_at = now() - interval '1 hour' WHERE project_id = $1::uuid`,
      projectId,
    );

    // The test app runs with DETECTION_BATCH_SIZE=5: this backlog spans three
    // batches, which is the case that starves if the loop stops too early.
    expect(context.config.DETECTION_BATCH_SIZE).toBeLessThan(checks.length);
    await context.detection.tick();

    const states = await context.prisma.check.findMany({
      where: { id: { in: checks.map((check) => check.id) } },
      select: { state: true },
    });
    expect(states.every((check) => check.state === 'DOWN')).toBe(true);
  });
});
