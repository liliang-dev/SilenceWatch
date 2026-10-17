import type { CreatedApiKeyDto } from '@silencewatch/shared';
import { MAX_LIVE_SESSIONS_PER_USER } from '../src/auth/better-auth/auth-policy';
import {
  auth,
  createTestApp,
  registerUser,
  sessionCookieOf,
  signIn,
  TEST_BASE_URL,
  type TestApp,
} from './utils/test-app';

const PASSWORD = 'a-sufficiently-long-password';
const browser = { origin: TEST_BASE_URL };

/** Sign-in with a password (AUTH_MODE=password): what a session is, and how it ends. */
describe('password sign-in', () => {
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

  const post = (url: string, payload: unknown, headers: Record<string, string> = browser) =>
    context.app.inject({ method: 'POST', url, headers, payload: payload as never });

  const me = (token: string) =>
    context.app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(token) });

  describe('the session', () => {
    it('is a cookie the page cannot read, and cannot be sent from another site', async () => {
      const response = await post('/api/auth/sign-up/email', {
        email: 'cookie@example.test',
        password: PASSWORD,
        name: '',
      });

      const cookie = [response.headers['set-cookie']].flat().find((line) => line?.startsWith('sw.session_token='));
      expect(cookie).toBeDefined();
      expect(cookie).toMatch(/HttpOnly/i);
      expect(cookie).toMatch(/SameSite=Lax/i);
      expect(cookie).toMatch(/Path=\//);
      // 30 days, in seconds.
      expect(cookie).toMatch(/Max-Age=2592000/i);
    });

    it('works until it is signed out, and not after', async () => {
      const user = await registerUser(context);
      expect((await me(user.token)).statusCode).toBe(200);

      const out = await post('/api/auth/sign-out', {}, auth(user.token));
      expect(out.statusCode).toBe(200);

      expect((await me(user.token)).statusCode).toBe(401);
    });

    it('is refused for a write that does not say it came from our page', async () => {
      const user = await registerUser(context);
      const write = (headers: Record<string, string>) =>
        context.app.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: { cookie: user.token, ...headers },
          payload: { name: 'Another' },
        });

      expect((await write({})).statusCode).toBe(403);
      expect((await write({ origin: 'https://evil.example' })).statusCode).toBe(403);
      expect((await write({ origin: TEST_BASE_URL })).statusCode).toBe(201);

      // Reading is not what the check protects.
      const read = await context.app.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: { cookie: user.token },
      });
      expect(read.statusCode).toBe(200);
    });

    it('slides: using it after a day moves its end, and the browser is told', async () => {
      const user = await registerUser(context);
      const session = await context.prisma.session.findFirstOrThrow({ where: { userId: user.userId } });
      const stale = new Date(Date.now() - 2 * 86_400_000);
      await context.prisma.session.update({
        where: { id: session.id },
        data: { updatedAt: stale, expiresAt: new Date(Date.now() + 5 * 86_400_000) },
      });

      const response = await context.app.inject({
        method: 'GET',
        url: '/api/auth/me',
        headers: auth(user.token),
      });
      expect(response.statusCode).toBe(200);

      const after = await context.prisma.session.findUniqueOrThrow({ where: { id: session.id } });
      expect(after.expiresAt.getTime()).toBeGreaterThan(Date.now() + 29 * 86_400_000);
      // Without a new Set-Cookie the browser would drop the cookie on the old date.
      expect(sessionCookieOf(response.headers['set-cookie'])).toBe(user.token);
    });

    it('is refused once it has run out', async () => {
      const user = await registerUser(context);
      await context.prisma.session.updateMany({
        where: { userId: user.userId },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });
      expect((await me(user.token)).statusCode).toBe(401);
    });

    it(`keeps the ${MAX_LIVE_SESSIONS_PER_USER} newest sessions of an account`, async () => {
      const user = await registerUser(context);
      for (let index = 0; index < MAX_LIVE_SESSIONS_PER_USER + 3; index += 1) {
        await signIn(context, user.email);
      }
      expect(await context.prisma.session.count({ where: { userId: user.userId } })).toBe(
        MAX_LIVE_SESSIONS_PER_USER,
      );
    });
  });

  describe('credentials', () => {
    it('answers identically whether or not the address has an account', async () => {
      await registerUser(context, 'known@example.test');

      const unknown = await post('/api/auth/sign-in/email', {
        email: 'unknown@example.test',
        password: 'wrong-password-here',
      });
      const wrong = await post('/api/auth/sign-in/email', {
        email: 'known@example.test',
        password: 'wrong-password-here',
      });

      expect(unknown.statusCode).toBe(401);
      expect(wrong.statusCode).toBe(401);
      expect(unknown.json<{ message: string }>().message).toBe(wrong.json<{ message: string }>().message);
    });

    it('locks an account after repeated failures, and says nothing different about it', async () => {
      const user = await registerUser(context, 'lockme@example.test');
      let last: { message: string } | null = null;

      for (let attempt = 0; attempt < 10; attempt += 1) {
        const response = await post('/api/auth/sign-in/email', {
          email: user.email,
          password: `wrong-password-${attempt}`,
        });
        last = response.json<{ message: string }>();
      }

      const correct = await post('/api/auth/sign-in/email', { email: user.email, password: PASSWORD });
      expect(correct.statusCode).toBe(401);
      expect(correct.json<{ message: string }>().message).toBe(last?.message);
    });

    it('lets the owner back in once the lockout is over', async () => {
      const user = await registerUser(context, 'unlock@example.test');
      for (let attempt = 0; attempt < 10; attempt += 1) {
        await post('/api/auth/sign-in/email', { email: user.email, password: `wrong-password-${attempt}` });
      }
      await context.prisma.user.update({
        where: { id: user.userId },
        data: { lockedUntil: new Date(Date.now() - 1_000) },
      });

      const response = await post('/api/auth/sign-in/email', { email: user.email, password: PASSWORD });
      expect(response.statusCode).toBe(200);
      expect((await context.prisma.user.findUniqueOrThrow({ where: { id: user.userId } })).failedLoginCount).toBe(0);
    });

    it('refuses a password shorter than twelve characters', async () => {
      const response = await post('/api/auth/sign-up/email', {
        email: 'weak@example.test',
        password: 'short',
        name: '',
      });
      expect(response.statusCode).toBe(400);
      expect(await context.prisma.user.count()).toBe(0);
    });

    it('keeps the password only as a hash, in the account', async () => {
      const user = await registerUser(context);
      const account = await context.prisma.account.findFirstOrThrow({ where: { userId: user.userId } });
      expect(account.providerId).toBe('credential');
      expect(account.password).not.toContain(PASSWORD);
      expect(account.password).toMatch(/^[0-9a-f]+:[0-9a-f]+$/); // scrypt: salt:key
    });

    it('changes the password, and ends the other sessions when asked to', async () => {
      const user = await registerUser(context);
      const other = await signIn(context, user.email);

      const changed = await post(
        '/api/auth/change-password',
        {
          currentPassword: PASSWORD,
          newPassword: 'an-even-longer-new-password',
          revokeOtherSessions: true,
        },
        auth(user.token),
      );
      expect(changed.statusCode).toBe(200);

      expect((await me(other)).statusCode).toBe(401);
      expect(
        (await post('/api/auth/sign-in/email', { email: user.email, password: PASSWORD })).statusCode,
      ).toBe(401);
      expect(
        (await post('/api/auth/sign-in/email', { email: user.email, password: 'an-even-longer-new-password' }))
          .statusCode,
      ).toBe(200);
    });

    it('refuses a wrong current password and leaves the session alone', async () => {
      const user = await registerUser(context);
      const changed = await post(
        '/api/auth/change-password',
        { currentPassword: 'not-the-password-at-all', newPassword: 'an-even-longer-new-password' },
        auth(user.token),
      );
      expect(changed.statusCode).toBeGreaterThanOrEqual(400);
      expect((await me(user.token)).statusCode).toBe(200);
    });
  });

  describe('what an instance in this mode does not have', () => {
    it.each([
      ['GET', '/api/auth/passkey/list-user-passkeys'],
      ['GET', '/api/auth/passkey/generate-authenticate-options'],
      ['POST', '/api/auth/recovery-codes/sign-in'],
      ['POST', '/api/auth/sign-in/social'],
      ['GET', '/api/auth/callback/google'],
      ['POST', '/api/auth/request-password-reset'],
      ['POST', '/api/auth/reset-password'],
      ['POST', '/api/auth/send-verification-email'],
      ['POST', '/api/auth/change-email'],
      ['POST', '/api/auth/link-social'],
      ['GET', '/api/auth/list-sessions'],
      ['GET', '/api/auth/ok'],
    ])('answers 404 to %s %s', async (method, url) => {
      const user = await registerUser(context);
      const response = await context.app.inject({
        method: method as 'GET',
        url,
        headers: auth(user.token),
        payload: method === 'POST' ? {} : undefined,
      });
      expect(response.statusCode).toBe(404);
    });

    it('describes itself to the sign-in page, and tells it nothing secret', async () => {
      const response = await context.app.inject({ method: 'GET', url: '/api/auth/config' });
      expect(response.statusCode).toBe(200);
      expect(response.json()).toEqual({
        mode: 'password',
        passkey: false,
        password: true,
        providers: [],
        recoveryCodes: false,
        signup: true,
      });
    });
  });

  describe('what asks for a recent sign-in', () => {
    const age = (userId: string, minutes: number) =>
      context.prisma.session.updateMany({
        where: { userId },
        data: { createdAt: new Date(Date.now() - minutes * 60_000) },
      });

    it('lets a session that just signed in delete the account, and not one from yesterday', async () => {
      const user = await registerUser(context);
      await age(user.userId, 11);

      const stale = await context.app.inject({
        method: 'POST',
        url: '/api/auth/delete-account',
        headers: auth(user.token),
      });
      expect(stale.statusCode).toBe(403);
      expect(stale.json<{ details: { reauthRequired: boolean } }>().details.reauthRequired).toBe(true);
      expect(await context.prisma.user.count()).toBe(1);

      // Signing in again is what makes it recent.
      const fresh = await signIn(context, user.email);
      const deleted = await context.app.inject({
        method: 'POST',
        url: '/api/auth/delete-account',
        headers: auth(fresh),
      });
      expect(deleted.statusCode).toBe(204);
      expect(await context.prisma.user.count()).toBe(0);
    });

    it('asks the same before minting or revoking an API key, but not before listing them', async () => {
      const user = await registerUser(context);
      const created = await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/api-keys`,
        headers: auth(user.token),
        payload: { name: 'CI' },
      });
      expect(created.statusCode).toBe(201);
      const key = created.json<CreatedApiKeyDto>();

      await age(user.userId, 11);

      const mint = await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/api-keys`,
        headers: auth(user.token),
        payload: { name: 'another' },
      });
      const revoke = await context.app.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${user.projectId}/api-keys/${key.id}`,
        headers: auth(user.token),
      });
      const list = await context.app.inject({
        method: 'GET',
        url: `/api/v1/projects/${user.projectId}/api-keys`,
        headers: auth(user.token),
      });

      expect(mint.statusCode).toBe(403);
      expect(revoke.statusCode).toBe(403);
      expect(list.statusCode).toBe(200);
    });

    it('does not apply to an API key, which is not a session at all', async () => {
      const user = await registerUser(context);
      const key = (
        await context.app.inject({
          method: 'POST',
          url: `/api/v1/projects/${user.projectId}/api-keys`,
          headers: auth(user.token),
          payload: { name: 'CI' },
        })
      ).json<CreatedApiKeyDto>();

      const response = await context.app.inject({
        method: 'POST',
        url: '/api/auth/delete-account',
        headers: auth(key.token),
      });
      expect(response.statusCode).toBe(401);
    });
  });
});

/** Over HTTPS the cookie is also Secure, and cannot be set from a sibling site. */
describe('the session cookie over https', () => {
  let context: TestApp;
  const HTTPS = 'https://watch.example.com';

  beforeAll(async () => {
    context = await createTestApp({ BASE_URL: HTTPS });
  });

  afterAll(async () => {
    await context.close();
  });

  it('is Secure, HttpOnly, SameSite=Lax and carries the __Secure- prefix', async () => {
    await context.reset();
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/sign-up/email',
      headers: { origin: HTTPS },
      payload: { email: 'tls@example.test', password: PASSWORD, name: '' },
    });
    expect(response.statusCode).toBe(200);

    const cookie = [response.headers['set-cookie']].flat().find((line) => line?.includes('session_token='));
    expect(cookie).toMatch(/^__Secure-sw\.session_token=/);
    expect(cookie).toMatch(/; Secure/i);
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
  });

  it('refuses a write from the plain-http twin of the site', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/sign-in/email',
      headers: { origin: 'http://watch.example.com' },
      payload: { email: 'tls@example.test', password: PASSWORD },
    });
    expect(response.statusCode).toBe(403);
  });
});

/** The limit on trying: Better Auth's own, set from AUTH_RATE_LIMIT_PER_MINUTE. */
describe('rate limiting of sign-in', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({ AUTH_RATE_LIMIT_PER_MINUTE: '5' });
  });

  afterAll(async () => {
    await context.close();
  });

  it('answers 429 once an address has tried too often, whoever it tried to be', async () => {
    // Better Auth keeps its counters in one place for the whole process, so this
    // suite uses an address of its own rather than inherit another suite's count.
    const attempt = (email: string) =>
      context.app.inject({
        method: 'POST',
        url: '/api/auth/sign-in/email',
        headers: browser,
        remoteAddress: '203.0.113.50',
        payload: { email, password: 'whatever-password-here' },
      });

    const statuses: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      statuses.push((await attempt(`nobody-${index}@example.test`)).statusCode);
    }

    expect(statuses.slice(0, 5)).toEqual([401, 401, 401, 401, 401]);
    expect(statuses.slice(5)).toEqual([429, 429, 429]);
  });

  it('is not reset by changing the query string', async () => {
    const statuses: number[] = [];
    for (let index = 0; index < 8; index += 1) {
      const response = await context.app.inject({
        method: 'POST',
        url: `/api/auth/sign-in/email?cache-bust=${index}`,
        headers: browser,
        remoteAddress: '203.0.113.51',
        payload: { email: 'nobody@example.test', password: 'whatever-password-here' },
      });
      statuses.push(response.statusCode);
    }
    expect(statuses).toContain(429);
  });
});
