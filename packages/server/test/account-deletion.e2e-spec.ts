import { auth, createTestApp, registerUser, type TestApp } from './utils/test-app';

/**
 * Deleting an account: the password is asked again, everything only that
 * account held goes at once, and what other people share survives.
 *
 * The confirmation the interface asks for (typing a word) is a courtesy against
 * a stray click. What the server enforces is the password and the one rule that
 * keeps a shared project from being left without an owner, so that is what is
 * tested, from the outside.
 */
describe('account deletion', () => {
  let context: TestApp;

  const PASSWORD = 'a-sufficiently-long-password';

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  const deleteAccount = (token: string, payload: unknown) =>
    context.app.inject({
      method: 'POST',
      url: '/api/auth/delete-account',
      headers: auth(token),
      payload: payload as Record<string, unknown>,
    });

  it('refuses a wrong password and leaves everything as it was', async () => {
    const user = await registerUser(context);

    // 403 and not 401: a 401 tells the browser its session has expired, and it would
    // refresh and send the same wrong password again before signing the user out.
    const response = await deleteAccount(user.token, { password: 'not-the-password-at-all' });
    expect(response.statusCode).toBe(403);

    const me = await context.app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(user.token) });
    expect(me.statusCode).toBe(200);
    expect(await context.prisma.project.count({ where: { id: user.projectId } })).toBe(1);
  });

  it('counts wrong passwords towards the lockout, like a login does', async () => {
    const user = await registerUser(context);

    for (let attempt = 0; attempt < 10; attempt += 1) {
      await deleteAccount(user.token, { password: 'not-the-password-at-all' });
    }

    // Locked now: even the right password is refused, and nothing is deleted.
    const response = await deleteAccount(user.token, { password: PASSWORD });
    expect(response.statusCode).toBe(403);
    expect(await context.prisma.user.count({ where: { id: user.userId } })).toBe(1);
  });

  it('refuses a request without a password', async () => {
    const user = await registerUser(context);

    const response = await deleteAccount(user.token, {});
    expect(response.statusCode).toBe(400);
    expect(await context.prisma.user.count({ where: { id: user.userId } })).toBe(1);
  });

  it('is not available to an API key', async () => {
    const user = await registerUser(context);
    const created = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/api-keys`,
      headers: auth(user.token),
      payload: { name: 'ci' },
    });
    const key = created.json<{ token: string }>().token;

    const response = await deleteAccount(key, { password: PASSWORD });
    expect(response.statusCode).toBe(401);
    expect(await context.prisma.user.count({ where: { id: user.userId } })).toBe(1);
  });

  it('deletes the account, its projects and their checks, at once', async () => {
    const user = await registerUser(context);
    const check = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/checks`,
      headers: auth(user.token),
      payload: { name: 'Nightly backup', scheduleType: 'interval', periodSeconds: 3_600, graceSeconds: 300 },
    });
    expect(check.statusCode).toBe(201);
    const checkId = check.json<{ id: string }>().id;

    const response = await deleteAccount(user.token, { password: PASSWORD });
    expect(response.statusCode).toBe(204);

    expect(await context.prisma.user.count({ where: { id: user.userId } })).toBe(0);
    expect(await context.prisma.project.count({ where: { id: user.projectId } })).toBe(0);
    expect(await context.prisma.check.count({ where: { id: checkId } })).toBe(0);
    expect(await context.prisma.session.count({ where: { userId: user.userId } })).toBe(0);

    // The access token that was just used is dead, and so is the account.
    const me = await context.app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(user.token) });
    expect(me.statusCode).toBe(401);
    const login = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: user.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(401);

    // The address can be registered again: nothing of the old account lingers.
    await registerUser(context, user.email);
  });

  it('keeps a record that it happened, with the address of whoever did it', async () => {
    const user = await registerUser(context);
    await deleteAccount(user.token, { password: PASSWORD });

    // The trail is written without blocking the request, so give it a moment.
    let event: { actorEmail: string | null; actorUserId: string | null } | null = null;
    for (let attempt = 0; attempt < 20 && event === null; attempt += 1) {
      event = await context.prisma.auditEvent.findFirst({
        where: { action: 'account.deleted', actorUserId: user.userId },
      });
      if (event === null) await new Promise((resolve) => setTimeout(resolve, 50));
    }

    expect(event?.actorEmail).toBe(user.email);
  });

  it('only removes the member from a project other owners share', async () => {
    const leaving = await registerUser(context);
    const staying = await registerUser(context);

    // Two owners on the leaving user's own project: no invitation endpoint yet,
    // so the membership is written directly.
    await context.prisma.projectMember.create({
      data: { projectId: leaving.projectId, userId: staying.userId, role: 'owner' },
    });

    const response = await deleteAccount(leaving.token, { password: PASSWORD });
    expect(response.statusCode).toBe(204);

    expect(await context.prisma.user.count({ where: { id: leaving.userId } })).toBe(0);
    // The project survives, and now belongs to the one who stayed.
    expect(await context.prisma.project.count({ where: { id: leaving.projectId } })).toBe(1);
    const members = await context.prisma.projectMember.findMany({ where: { projectId: leaving.projectId } });
    expect(members.map((member) => member.userId)).toEqual([staying.userId]);
  });

  it('refuses to leave a shared project without an owner', async () => {
    const owner = await registerUser(context);
    const member = await registerUser(context);
    await context.prisma.projectMember.create({
      data: { projectId: owner.projectId, userId: member.userId, role: 'member' },
    });

    const response = await deleteAccount(owner.token, { password: PASSWORD });
    expect(response.statusCode).toBe(409);
    expect(response.json<{ message: string }>().message).toMatch(/without one/i);

    // Refused whole: nothing was half-deleted.
    expect(await context.prisma.user.count({ where: { id: owner.userId } })).toBe(1);
    expect(await context.prisma.project.count({ where: { id: owner.projectId } })).toBe(1);
  });
});
