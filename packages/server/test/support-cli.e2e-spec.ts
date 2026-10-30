import { SupportCommands, SupportError } from '../src/auth/cli/support-commands';
import { auth, createTestApp, registerAdmin, registerUser, TEST_BASE_URL, type TestApp } from './utils/test-app';

/**
 * The command line of whoever runs the server, against a real database: what it
 * changes, what it refuses, and that every change leaves a line in the audit trail.
 */
describe('support commands', () => {
  let context: TestApp;
  let commands: SupportCommands;

  beforeAll(async () => {
    context = await createTestApp({
      PLAN_LIMITS: JSON.stringify({ free: { checks: 3 }, pro: { checks: 10 } }),
    });
    commands = new SupportCommands(context.config, context.prisma);
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  const trail = async (email: string): Promise<Array<{ command: string; detail: unknown }>> => {
    const rows = await context.prisma.auditEvent.findMany({
      where: { action: 'operator.change', targetLabel: email },
      orderBy: { id: 'asc' },
    });
    return rows.map((row) => ({ command: (row.detail as { command: string }).command, detail: row.detail }));
  };

  describe('create-admin', () => {
    it("prints a link for the administrator's account, and only while it does not exist", async () => {
      const text = await commands.createAdmin();
      expect(text).toContain(context.config.ADMIN_EMAIL);
      expect(text).toMatch(/\/setup\?email=admin%40example\.test#[\w-]{40,}/);

      await registerAdmin(context);
      await expect(commands.createAdmin()).rejects.toThrow(/already exists/);
    });
  });

  it('refuses an address that has no account, and changes nothing', async () => {
    await expect(commands.show('nobody@example.test')).rejects.toThrow(SupportError);
    await expect(commands.unlock('nobody@example.test')).rejects.toThrow('No account for');
    expect(await context.prisma.auditEvent.count({ where: { action: 'operator.change' } })).toBe(0);
  });

  describe('show', () => {
    it('describes the account, and prints no secret', async () => {
      const user = await registerUser(context);
      await context.prisma.user.update({ where: { id: user.userId }, data: { plan: 'free' } });

      const text = await commands.show(user.email);

      expect(text).toContain(user.email);
      expect(text).toMatch(/Email verified\s+no/);
      expect(text).toMatch(/Plan\s+free/);
      expect(text).toMatch(/Sign-in methods\s+password/);
      expect(text).toMatch(/Live sessions\s+1/);
      const hash = (await context.prisma.account.findFirstOrThrow({ where: { userId: user.userId } })).password;
      expect(text).not.toContain(hash as string);
      // Reading is not changing: nothing is written to the trail.
      expect(await trail(user.email)).toEqual([]);
    });
  });

  describe('verify-email', () => {
    it('marks the address as verified once, and says so when it already was', async () => {
      const user = await registerUser(context);

      expect(await commands.verifyEmail(user.email)).toContain('now marked as verified');
      expect((await context.prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).emailVerified).toBe(true);
      expect(await commands.verifyEmail(user.email)).toContain('already verified');

      expect((await trail(user.email)).map((entry) => entry.command)).toEqual(['verify-email']);
    });
  });

  describe('set-plan', () => {
    it('moves the account to a plan that PLAN_LIMITS defines, and back to none', async () => {
      const user = await registerUser(context);

      expect(await commands.setPlan(user.email, 'pro')).toContain('none → pro');
      expect((await context.prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).plan).toBe('pro');

      expect(await commands.setPlan(user.email, 'none')).toContain('pro → none');
      expect((await context.prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).plan).toBeNull();

      const entries = await trail(user.email);
      expect(entries.map((entry) => entry.command)).toEqual(['set-plan', 'set-plan']);
      expect(entries[0]?.detail).toMatchObject({ from: null, to: 'pro' });
    });

    it('refuses a plan nobody defined, naming the ones that exist', async () => {
      const user = await registerUser(context);

      await expect(commands.setPlan(user.email, 'entreprise')).rejects.toThrow(/PLAN_LIMITS defines: free, pro/);
      expect((await context.prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).plan).toBeNull();
      expect(await trail(user.email)).toEqual([]);
    });

    it('warns that a subscription will set the plan again', async () => {
      const user = await registerUser(context);
      await context.prisma.subscription.create({
        data: { userId: user.userId, stripeCustomerId: 'cus_test', plan: 'pro', status: 'active' },
      });

      expect(await commands.setPlan(user.email, 'free')).toContain('Stripe subscription');
    });
  });

  describe('unlock', () => {
    it('ends a lockout', async () => {
      const user = await registerUser(context);
      await context.prisma.user.update({
        where: { id: user.userId },
        data: { failedLoginCount: 9, lockedUntil: new Date(Date.now() + 3_600_000) },
      });
      expect(await commands.show(user.email)).toMatch(/Lockout\s+locked until/);

      await commands.unlock(user.email);

      const after = await context.prisma.user.findUniqueOrThrow({ where: { id: user.userId } });
      expect(after.lockedUntil).toBeNull();
      expect(after.failedLoginCount).toBe(0);
      expect((await trail(user.email)).map((entry) => entry.command)).toEqual(['unlock']);
    });
  });

  describe('end-sessions', () => {
    it('signs the account out everywhere', async () => {
      const user = await registerUser(context);
      const before = await context.app.inject({ method: 'GET', url: '/api/v1/projects', headers: auth(user.token) });
      expect(before.statusCode).toBe(200);

      expect(await commands.endSessions(user.email)).toContain('Ended 1 session');

      const after = await context.app.inject({ method: 'GET', url: '/api/v1/projects', headers: auth(user.token) });
      expect(after.statusCode).toBe(401);
      expect((await trail(user.email)).map((entry) => entry.command)).toEqual(['end-sessions']);
    });
  });

  describe('disable and enable', () => {
    const signIn = (email: string, password = 'a-sufficiently-long-password') =>
      context.app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { origin: TEST_BASE_URL },
        payload: { email, password },
      });
    const apiKeyOf = async (user: { token: string; projectId: string }): Promise<string> => {
      const created = await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/api-keys`,
        headers: auth(user.token),
        payload: { name: 'ci' },
      });
      return created.json<{ token: string }>().token;
    };
    const listWith = (token: string) =>
      context.app.inject({ method: 'GET', url: '/api/v1/checks', headers: { authorization: `Bearer ${token}` } });

    it('shuts the account out of every way in, and enable lets it back', async () => {
      const user = await registerUser(context);
      const key = await apiKeyOf(user);
      expect((await listWith(key)).statusCode).toBe(200);

      expect(await commands.disable(user.email)).toContain('1 session(s) ended');

      // The session it had, the password that was right, and the key of its own project.
      expect((await context.app.inject({ method: 'GET', url: '/api/v1/projects', headers: auth(user.token) })).statusCode).toBe(401);
      const refused = await signIn(user.email);
      expect(refused.statusCode).toBe(403);
      expect(refused.json<{ code: string }>().code).toBe('ACCOUNT_DISABLED');
      expect((await listWith(key)).statusCode).toBe(401);
      expect(await commands.show(user.email)).toMatch(/Status\s+DISABLED since/);

      expect(await commands.enable(user.email)).toContain('can sign in again');

      expect((await signIn(user.email)).statusCode).toBe(200);
      expect((await listWith(key)).statusCode).toBe(200);
      expect(await commands.show(user.email)).toMatch(/Status\s+active/);
      expect((await trail(user.email)).map((entry) => entry.command)).toEqual(['disable', 'enable']);
    });

    it('says so, and writes nothing, when there is nothing to do', async () => {
      const user = await registerUser(context);

      expect(await commands.enable(user.email)).toContain('was not disabled');
      await commands.disable(user.email);
      expect(await commands.disable(user.email)).toContain('was already disabled');

      expect((await trail(user.email)).map((entry) => entry.command)).toEqual(['disable']);
    });

    it('leaves a project that has another owner working', async () => {
      const owner = await registerUser(context);
      const other = await registerUser(context);
      await context.prisma.projectMember.create({
        data: { projectId: owner.projectId, userId: other.userId, role: 'owner' },
      });
      const key = await apiKeyOf(owner);

      await commands.disable(owner.email);

      expect((await listWith(key)).statusCode).toBe(200);
    });
  });

  describe('reset-password', () => {
    it('sets a password that works, ends the sessions, and records it', async () => {
      const user = await registerUser(context);

      const text = await commands.resetPassword(user.email);
      const password = text.trim().split('\n').pop()?.trim() as string;

      const old = await context.app.inject({ method: 'GET', url: '/api/v1/projects', headers: auth(user.token) });
      expect(old.statusCode).toBe(401);
      const signIn = await context.app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: { origin: TEST_BASE_URL },
        payload: { email: user.email, password },
      });
      expect(signIn.statusCode).toBe(200);
      expect((await trail(user.email)).map((entry) => entry.command)).toEqual(['reset-password']);
      // The password itself is for the terminal only.
      const rows = await context.prisma.auditEvent.findMany({ where: { action: 'operator.change' } });
      expect(JSON.stringify(rows, (_k, v: unknown) => (typeof v === 'bigint' ? v.toString() : v))).not.toContain(password);
    });
  });
});
