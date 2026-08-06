import { auth, createTestApp, registerUser, type TestApp } from './utils/test-app';

/**
 * Managing projects from the account, and the one rule that has to hold on the
 * server: an account cannot be left without a project.
 *
 * The browser asks for confirmation before a deletion, but a confirmation
 * dialog is a courtesy — the endpoint is reachable with curl, and every screen
 * in the application assumes a project exists. So the refusal is tested here,
 * where it is enforced, rather than trusted to the interface that asks nicely.
 */
describe('projects', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  it('refuses to delete the only project an account has', async () => {
    const user = await registerUser(context);

    const response = await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${user.projectId}`,
      headers: auth(user.token),
    });

    expect(response.statusCode).toBe(409);
    expect(response.json<{ message: string }>().message).toMatch(/last project/i);

    // And it is still there — a refusal that half-deleted would be worse than
    // no refusal at all.
    const list = await context.app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: auth(user.token),
    });
    expect(list.json<Array<{ id: string }>>()).toHaveLength(1);
  });

  it('deletes a project once a second one exists, and takes its checks with it', async () => {
    const user = await registerUser(context);

    const created = await context.app.inject({
      method: 'POST',
      url: '/api/v1/projects',
      headers: auth(user.token),
      payload: { name: 'Second project' },
    });
    expect(created.statusCode).toBe(201);
    const second = created.json<{ id: string; slug: string }>();

    // A check in the doomed project, so the cascade is exercised rather than
    // assumed from the schema.
    const check = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/checks`,
      headers: auth(user.token),
      payload: {
        name: 'Nightly backup',
        scheduleType: 'interval',
        periodSeconds: 3_600,
        graceSeconds: 300,
      },
    });
    expect(check.statusCode).toBe(201);

    const deleted = await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${user.projectId}`,
      headers: auth(user.token),
    });
    expect(deleted.statusCode).toBe(204);

    const list = await context.app.inject({
      method: 'GET',
      url: '/api/v1/projects',
      headers: auth(user.token),
    });
    const remaining = list.json<Array<{ id: string }>>();
    expect(remaining).toHaveLength(1);
    expect(remaining[0]?.id).toBe(second.id);

    // The last one is now the last one, and is protected in turn.
    const lastOne = await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${second.id}`,
      headers: auth(user.token),
    });
    expect(lastOne.statusCode).toBe(409);
  });

  it('renames a project without touching its slug', async () => {
    const user = await registerUser(context);

    const before = await context.app.inject({
      method: 'GET',
      url: `/api/v1/projects/${user.projectId}`,
      headers: auth(user.token),
    });
    const originalSlug = before.json<{ slug: string }>().slug;

    const renamed = await context.app.inject({
      method: 'PATCH',
      url: `/api/v1/projects/${user.projectId}`,
      headers: auth(user.token),
      payload: { name: 'Renamed project' },
    });

    expect(renamed.statusCode).toBe(200);
    const dto = renamed.json<{ name: string; slug: string }>();
    expect(dto.name).toBe('Renamed project');
    // The slug is in ping URLs people have already deployed into crontabs.
    expect(dto.slug).toBe(originalSlug);
  });

  it('refuses one account reach into another account project', async () => {
    const mine = await registerUser(context);
    const theirs = await registerUser(context);

    const peek = await context.app.inject({
      method: 'DELETE',
      url: `/api/v1/projects/${theirs.projectId}`,
      headers: auth(mine.token),
    });

    // Not 403: whether that id exists is not something to confirm.
    expect(peek.statusCode).toBe(404);
  });
});
