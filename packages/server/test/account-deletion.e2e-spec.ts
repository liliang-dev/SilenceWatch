import { auth, createTestApp, registerUser, TEST_BASE_URL, type TestApp } from './utils/test-app';

/**
 * Deleting an account: a recent sign-in is required, everything only that
 * account held goes at once, and what other people share survives.
 *
 * The confirmation the interface asks for (typing a word) is a courtesy against
 * a stray click. What the server enforces is the recent sign-in (tested in
 * sign-in.e2e-spec.ts) and the one rule that keeps a shared project from being
 * left without an owner, so that is what is tested here, from the outside.
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

  const deleteAccount = (token: string) =>
    context.app.inject({
      method: 'POST',
      url: '/api/auth/delete-account',
      headers: auth(token),
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

    const response = await deleteAccount(key);
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

    const response = await deleteAccount(user.token);
    expect(response.statusCode).toBe(204);

    expect(await context.prisma.user.count({ where: { id: user.userId } })).toBe(0);
    expect(await context.prisma.project.count({ where: { id: user.projectId } })).toBe(0);
    expect(await context.prisma.check.count({ where: { id: checkId } })).toBe(0);
    expect(await context.prisma.session.count({ where: { userId: user.userId } })).toBe(0);

    // The session that was just used is dead, and so is the account.
    const me = await context.app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(user.token) });
    expect(me.statusCode).toBe(401);
    const login = await context.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: TEST_BASE_URL },
      payload: { email: user.email, password: PASSWORD },
    });
    expect(login.statusCode).toBe(401);

    // The address can be registered again: nothing of the old account lingers.
    await registerUser(context, user.email);
  });

  it('keeps a record that it happened, with the address of whoever did it', async () => {
    const user = await registerUser(context);
    await deleteAccount(user.token);

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

    const response = await deleteAccount(leaving.token);
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

    const response = await deleteAccount(owner.token);
    expect(response.statusCode).toBe(409);
    expect(response.json<{ message: string }>().message).toMatch(/without one/i);

    // Refused whole: nothing was half-deleted.
    expect(await context.prisma.user.count({ where: { id: owner.userId } })).toBe(1);
    expect(await context.prisma.project.count({ where: { id: owner.projectId } })).toBe(1);
  });
});
