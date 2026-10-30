import { Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { SetupLinkService } from '../src/auth/signup/setup-link.service';
import { BootstrapService } from '../src/auth/signup/bootstrap.service';
import {
  adminSetupCookie,
  createTestApp,
  registerAdmin,
  TEST_ADMIN_EMAIL,
  TEST_BASE_URL,
  type TestApp,
} from './utils/test-app';

const PASSWORD = 'a-sufficiently-long-password';

/** Who may create an account: the public while sign-up is open, and the administrator with its link. */
async function register(
  context: TestApp,
  email: string,
  headers: Record<string, string> = {},
  remoteAddress?: string,
): Promise<number> {
  const response = await context.app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: { origin: TEST_BASE_URL, ...headers },
    ...(remoteAddress === undefined ? {} : { remoteAddress }),
    payload: { email, password: PASSWORD, name: '' },
  });
  return response.statusCode;
}

describe('sign-up when it is open', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  it('creates the account with a first project it owns', async () => {
    expect(await register(context, 'new@example.test')).toBe(200);

    const user = await context.prisma.user.findUniqueOrThrow({
      where: { email: 'new@example.test' },
      include: { memberships: { include: { project: true } } },
    });
    expect(user.memberships).toHaveLength(1);
    expect(user.memberships[0]?.role).toBe('owner');
    expect(user.memberships[0]?.project.name).toBe('My project');
    // Self-hosted: no plan, which is no limit. No address kept either.
    expect(user.plan).toBeNull();
    expect(user.signupNetwork).toBeNull();
    // Nothing proves the address, so nothing claims it is proven.
    expect(user.emailVerified).toBe(false);
  });

  it('records the registration, with the address it came from', async () => {
    await register(context, 'audited@example.test', {}, '203.0.113.9');
    await new Promise((resolve) => setTimeout(resolve, 150));

    const event = await context.prisma.auditEvent.findFirstOrThrow({
      where: { action: 'account.registered' },
    });
    expect(event.actorEmail).toBe('audited@example.test');
    expect(event.ip).toBe('203.0.113.9');
  });

  it('refuses the same address twice, without creating a second account', async () => {
    expect(await register(context, 'twice@example.test')).toBe(200);
    expect(await register(context, 'twice@example.test')).toBeGreaterThanOrEqual(400);
    expect(await context.prisma.user.count({ where: { email: 'twice@example.test' } })).toBe(1);
  });

  it('treats the address as one whatever its case', async () => {
    expect(await register(context, 'Mixed@Example.test')).toBe(200);
    expect(await context.prisma.user.count({ where: { email: 'mixed@example.test' } })).toBe(1);
    expect(await register(context, 'mixed@example.test')).toBeGreaterThanOrEqual(400);
  });
});

describe('sign-up when it is closed', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({ SIGNUP_ENABLED: 'false' });
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  it('lets no one in, the administrator included, without the link', async () => {
    expect(await register(context, 'someone@example.test')).toBe(403);
    expect(await register(context, TEST_ADMIN_EMAIL)).toBe(403);
    expect(await context.prisma.user.count()).toBe(0);

    // Each refusal is counted for the administrator, with its reason and nothing more.
    await new Promise((resolve) => setTimeout(resolve, 150));
    const refusals = await context.prisma.auditEvent.findMany({
      where: { action: 'signup.refused' },
      orderBy: { id: 'asc' },
    });
    expect(refusals.map((event) => event.detail)).toEqual([
      { reason: 'signup_closed' },
      { reason: 'admin_without_link' },
    ]);
    expect(refusals.every((event) => event.actorEmail === null && event.ip === null)).toBe(true);
  });

  it('lets the administrator in with the link, once, and no one else with it', async () => {
    const cookie = await adminSetupCookie(context);

    // The link opens nothing for another address…
    expect(await register(context, 'someone@example.test', { cookie })).toBe(403);
    expect(await register(context, TEST_ADMIN_EMAIL, { cookie })).toBe(200);
    expect(await context.prisma.user.count()).toBe(1);

    // …and, spent, nothing more for this one.
    expect(await register(context, TEST_ADMIN_EMAIL, { cookie })).toBeGreaterThanOrEqual(400);
    expect(await context.prisma.user.count()).toBe(1);
  });

  it('stays closed to everyone else once the administrator is in', async () => {
    await registerAdmin(context);
    expect(await register(context, 'second@example.test')).toBe(403);
    expect(await context.prisma.user.count()).toBe(1);
  });

  it('refuses a link that has run out, and one that was never made', async () => {
    const cookie = await adminSetupCookie(context);
    await context.prisma.verification.updateMany({
      where: { identifier: { startsWith: 'setup:' } },
      data: { expiresAt: new Date(Date.now() - 1_000) },
    });
    expect(await register(context, TEST_ADMIN_EMAIL, { cookie })).toBe(403);
    expect(await register(context, TEST_ADMIN_EMAIL, { cookie: 'sw_setup=made-up' })).toBe(403);
  });

  it('opens nothing with a link made for another address, as older versions could', async () => {
    const token = 'a-link-from-before-for-someone-else-0123456789';
    await context.prisma.verification.create({
      data: {
        identifier: `setup:${createHash('sha256').update(token).digest('hex')}`,
        value: 'invited@example.test',
        expiresAt: new Date(Date.now() + 600_000),
      },
    });
    expect(await register(context, 'invited@example.test', { cookie: `sw_setup=${token}` })).toBe(403);
  });

  it('stores only a hash of the link', async () => {
    const { url } = await context.app.get(SetupLinkService).issue();
    const token = url.split('#')[1] as string;

    const rows = await context.prisma.verification.findMany();
    expect(JSON.stringify(rows)).not.toContain(token);
    // The token rides in the fragment, which a browser never sends to a server.
    expect(url.split('#')[0]).not.toContain(token);
  });
});

describe("the administrator's address", () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp();
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  it('is never registered without its link, even while sign-up is open to everyone else', async () => {
    expect(await register(context, TEST_ADMIN_EMAIL)).toBe(403);
    expect(await register(context, TEST_ADMIN_EMAIL.toUpperCase())).toBe(403);
    expect(await register(context, 'someone@example.test')).toBe(200);

    const describe = await context.app.inject({ method: 'GET', url: '/api/auth/config' });
    expect(describe.json<{ signup: boolean }>().signup).toBe(true);
  });

  it('is registered with its link', async () => {
    expect(await register(context, TEST_ADMIN_EMAIL, { cookie: await adminSetupCookie(context) })).toBe(200);
  });

  it('gets its link printed at start while it has no account, whoever else has one', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      await register(context, 'someone@example.test');
      await context.app.get(BootstrapService).onApplicationBootstrap();
      const printed = warn.mock.calls.map(([message]) => String(message)).join('\n');
      expect(printed).toContain(TEST_ADMIN_EMAIL);
      expect(printed).toMatch(/\/setup\?email=admin%40example\.test#[\w-]{40,}/);

      warn.mockClear();
      await registerAdmin(context);
      await context.app.get(BootstrapService).onApplicationBootstrap();
      expect(warn).not.toHaveBeenCalled();
    } finally {
      warn.mockRestore();
    }
  });
});

describe('sign-up volume rules', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({
      SIGNUP_MAX_PER_NETWORK_PER_HOUR: '3',
      SIGNUP_BLOCK_DISPOSABLE_EMAIL: 'true',
      SIGNUP_BLOCKED_EMAIL_DOMAINS: 'blocked.test',
    });
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
    await register(context, 'first@example.test', {}, '198.51.100.70');
  });

  const attempt = (email: string) => register(context, email, {}, '198.51.100.70');

  it('stops accepting past the per-network ceiling', async () => {
    // The ceiling is 3, and beforeEach already spent one of them.
    expect(await attempt('a@example.test')).toBe(200);
    expect(await attempt('b@example.test')).toBe(200);
    expect(await attempt('c@example.test')).toBe(429);
    expect(await context.prisma.user.count({ where: { email: 'c@example.test' } })).toBe(0);
  });

  it('rejects disposable mailboxes, including on a subdomain', async () => {
    expect(await attempt('throwaway@mailinator.com')).toBe(400);
    expect(await attempt('throwaway@team.mailinator.com')).toBe(400);
    expect(await attempt('someone@blocked.test')).toBe(400);
  });

  it('does not let rejected attempts consume the budget', async () => {
    // Otherwise anybody could lock out a shared corporate NAT by failing on
    // purpose, which turns an anti-abuse rule into the abuse.
    expect(await attempt('throwaway@mailinator.com')).toBe(400);
    expect(await attempt('throwaway2@mailinator.com')).toBe(400);
    expect(await attempt('real@example.test')).toBe(200);
  });

  it("skips these rules for the administrator's account, which comes with its link", async () => {
    expect(await attempt('a@example.test')).toBe(200);
    expect(await attempt('b@example.test')).toBe(200);
    const cookie = await adminSetupCookie(context);
    expect(await register(context, TEST_ADMIN_EMAIL, { cookie }, '198.51.100.70')).toBe(200);
  });
});
