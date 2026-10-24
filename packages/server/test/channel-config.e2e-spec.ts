import { ChannelConfigResealer } from '../src/notifications/channel-config.resealer';
import { ChannelConfigVault } from '../src/notifications/channel-config.vault';
import { auth, createTestApp, registerUser, type TestApp } from './utils/test-app';

const URL_WITH_SECRET = 'https://hooks.example.test/services/T000/B000/XXXXXXXXXXXXXXXX';

/**
 * A webhook URL is a credential, and so is a signing secret: they must not be readable
 * in the database, and everything that uses them must keep working.
 */
describe('sealed channel configuration', () => {
  let context: TestApp;
  let vault: ChannelConfigVault;

  beforeAll(async () => {
    context = await createTestApp({ TEST_ALERT_COOLDOWN_SECONDS: '0' });
    vault = new ChannelConfigVault(context.config.SECRET_KEY);
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  const create = async (
    user: { token: string; projectId: string },
    config: Record<string, string> = { url: URL_WITH_SECRET, secret: 'sixteen-chars-ok!' },
  ) =>
    (
      await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/channels`,
        headers: auth(user.token),
        payload: { type: 'webhook', name: 'Hook', config },
      })
    ).json<{ id: string; target: string }>();

  const stored = async (id: string): Promise<string> =>
    JSON.stringify((await context.prisma.notificationChannel.findUniqueOrThrow({ where: { id } })).config);

  const test = (user: { token: string; projectId: string }, id: string) =>
    context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/channels/${id}/test`,
      headers: auth(user.token),
    });

  it('is not readable in the database, and still works', async () => {
    const user = await registerUser(context);
    const channel = await create(user);

    const raw = await stored(channel.id);
    expect(raw).toContain('"sealed"');
    expect(raw).not.toContain('hooks.example.test');
    expect(raw).not.toContain('XXXXXXXX');
    expect(raw).not.toContain('sixteen-chars-ok');

    // The API still shows only the masked hint, and the sender gets the real thing.
    expect(channel.target).toBe('hooks.example.test/services/…');
    expect((await test(user, channel.id)).statusCode).toBe(204);
    expect(context.senders.captured.at(-1)?.config).toMatchObject({
      url: URL_WITH_SECRET,
      secret: 'sixteen-chars-ok!',
    });
  });

  it('keeps a channel that an older version stored in plaintext working, until it is sealed', async () => {
    const user = await registerUser(context);
    const channel = await create(user);
    await context.prisma.notificationChannel.update({
      where: { id: channel.id },
      data: { config: { url: URL_WITH_SECRET } },
    });

    expect((await test(user, channel.id)).statusCode).toBe(204);
    expect(context.senders.captured.at(-1)?.config).toEqual({ url: URL_WITH_SECRET });

    const counts = await new ChannelConfigResealer(context.prisma, vault).run();

    expect(counts).toMatchObject({ sealed: 1, failed: 0 });
    expect(await stored(channel.id)).not.toContain('hooks.example.test');
    expect((await test(user, channel.id)).statusCode).toBe(204);
  });

  it('does nothing the second time', async () => {
    const user = await registerUser(context);
    await create(user);

    expect(await new ChannelConfigResealer(context.prisma, vault).run()).toEqual({
      sealed: 0,
      resealed: 0,
      unchanged: 1,
      failed: 0,
    });
  });

  it('survives a changed SECRET_KEY: the list still loads, and reseal brings the channel back', async () => {
    const user = await registerUser(context);
    const channel = await create(user);
    const oldSecret = 'the-previous-secret-key-of-this-instance-00';
    const old = new ChannelConfigVault(oldSecret);
    await context.prisma.notificationChannel.update({
      where: { id: channel.id },
      data: { config: old.seal(channel.id, { url: URL_WITH_SECRET }) },
    });

    // Opened with the wrong key: the page lists it with no target, rather than failing.
    const listed = await context.app.inject({
      method: 'GET',
      url: `/api/v1/projects/${user.projectId}/channels`,
      headers: auth(user.token),
    });
    expect(listed.statusCode).toBe(200);
    expect(listed.json<Array<{ target: string }>>()[0]?.target).toBe('—');

    const withoutOld = await new ChannelConfigResealer(context.prisma, vault).run();
    expect(withoutOld).toMatchObject({ failed: 1, resealed: 0 });

    const withOld = await new ChannelConfigResealer(context.prisma, vault, old).run();
    expect(withOld).toMatchObject({ resealed: 1, failed: 0 });
    expect((await test(user, channel.id)).statusCode).toBe(204);
    expect(context.senders.captured.at(-1)?.config).toEqual({ url: URL_WITH_SECRET });
  });

  it('does not open on another channel: a copied configuration is refused', async () => {
    const user = await registerUser(context);
    const first = await create(user);
    const second = await create(user, { url: 'https://other.example.test/hook' });
    const firstRow = await context.prisma.notificationChannel.findUniqueOrThrow({ where: { id: first.id } });
    await context.prisma.notificationChannel.update({
      where: { id: second.id },
      data: { config: firstRow.config as never },
    });

    const listed = await context.app.inject({
      method: 'GET',
      url: `/api/v1/projects/${user.projectId}/channels`,
      headers: auth(user.token),
    });
    const targets = listed.json<Array<{ id: string; target: string }>>();
    expect(targets.find((c) => c.id === second.id)?.target).toBe('—');
  });
});
