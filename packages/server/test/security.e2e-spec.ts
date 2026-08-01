import type { CheckDto, CreatedApiKeyDto, NotificationChannelDto } from '@silencewatch/shared';
import { randomUUID } from 'node:crypto';
import { auth, createTestApp, registerUser, type TestApp } from './utils/test-app';

/**
 * Authentication and tenant isolation. These are the tests that must never go
 * red: everything else is a feature, this is the product being safe to host.
 */
describe('access control', () => {
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

  async function createCheck(token: string, projectId: string): Promise<CheckDto> {
    const response = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${projectId}/checks`,
      headers: auth(token),
      payload: { name: 'Job', scheduleType: 'interval', periodSeconds: 3_600, graceSeconds: 60 },
    });
    return response.json<CheckDto>();
  }

  describe('closed by default', () => {
    it.each([
      ['GET', '/api/v1/projects'],
      ['GET', '/api/v1/checks'],
      ['GET', '/api/v1/status'],
      ['POST', '/api/v1/checks/sync'],
      ['GET', '/api/auth/me'],
    ])('requires a token for %s %s', async (method, url) => {
      const response = await context.app.inject({ method: method as 'GET', url });
      expect(response.statusCode).toBe(401);
    });

    it('leaves /health public so a watchdog can use it', async () => {
      expect((await context.app.inject({ method: 'GET', url: '/health' })).statusCode).toBe(200);
    });

    it('rejects malformed, forged and expired-looking tokens', async () => {
      for (const header of [
        'Bearer',
        'Bearer ',
        'Basic dXNlcjpwYXNz',
        'Bearer not.a.jwt',
        // A JWT signed with the wrong key: correct shape, invalid signature.
        'Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ1c2VyIn0.aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
        'Bearer sw_0123456789abcdef_' + 'a'.repeat(43),
      ]) {
        const response = await context.app.inject({
          method: 'GET',
          url: '/api/v1/projects',
          headers: { authorization: header },
        });
        expect(response.statusCode).toBe(401);
      }
    });
  });

  describe('tenant isolation', () => {
    it('hides another user\'s project behind a 404, not a 403', async () => {
      const alice = await registerUser(context);
      const bob = await registerUser(context);

      const response = await context.app.inject({
        method: 'GET',
        url: `/api/v1/projects/${alice.projectId}`,
        headers: auth(bob.token),
      });
      // 403 would confirm the project exists. It must not.
      expect(response.statusCode).toBe(404);
    });

    it('refuses to read, modify or delete another user\'s check', async () => {
      const alice = await registerUser(context);
      const bob = await registerUser(context);
      const check = await createCheck(alice.token, alice.projectId);

      for (const [method, url] of [
        ['GET', `/api/v1/checks/${check.id}`],
        ['PATCH', `/api/v1/checks/${check.id}`],
        ['DELETE', `/api/v1/checks/${check.id}`],
        ['GET', `/api/v1/checks/${check.id}/pings`],
        ['GET', `/api/v1/checks/${check.id}/incidents`],
      ] as const) {
        const response = await context.app.inject({
          method,
          url,
          headers: auth(bob.token),
          payload: method === 'PATCH' ? { name: 'stolen' } : undefined,
        });
        expect(response.statusCode).toBe(404);
      }
    });

    it('never lists another project\'s checks', async () => {
      const alice = await registerUser(context);
      const bob = await registerUser(context);
      await createCheck(alice.token, alice.projectId);

      const response = await context.app.inject({
        method: 'GET',
        url: '/api/v1/checks',
        headers: auth(bob.token),
      });
      expect(response.json<{ items: unknown[] }>().items).toHaveLength(0);
    });
  });

  describe('API keys', () => {
    async function createKey(token: string, projectId: string): Promise<CreatedApiKeyDto> {
      const response = await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${projectId}/api-keys`,
        headers: auth(token),
        payload: { name: 'CI' },
      });
      expect(response.statusCode).toBe(201);
      return response.json<CreatedApiKeyDto>();
    }

    it('returns the secret once and stores only its hash', async () => {
      const user = await registerUser(context);
      const created = await createKey(user.token, user.projectId);

      expect(created.token).toMatch(/^sw_[0-9a-f]{16}_[\w-]{43}$/);

      // The secret half is base64url, and that alphabet includes `_`, so
      // splitting the token on underscores cuts the secret short whenever it
      // happens to contain one — leaving a fragment short enough to occur in
      // any hex digest by chance, which failed this test about 2% of the time.
      // Everything past the prefix is the secret, however many `_` it holds.
      const secret = created.token.slice(`${created.prefix}_`.length);

      const stored = await context.prisma.apiKey.findUniqueOrThrow({ where: { id: created.id } });
      expect(stored.secretHash).not.toContain(secret);
      expect(JSON.stringify(stored)).not.toContain(created.token);

      // Listing keys never exposes the secret again.
      const listed = await context.app.inject({
        method: 'GET',
        url: `/api/v1/projects/${user.projectId}/api-keys`,
        headers: auth(user.token),
      });
      expect(listed.body).not.toContain(created.token);
      expect(listed.body).toContain(created.prefix);
    });

    it('is scoped to its own project', async () => {
      const alice = await registerUser(context);
      const bob = await registerUser(context);
      const key = await createKey(alice.token, alice.projectId);

      const ownProject = await context.app.inject({
        method: 'GET',
        url: `/api/v1/projects/${alice.projectId}/checks`,
        headers: auth(key.token),
      });
      expect(ownProject.statusCode).toBe(200);

      const otherProject = await context.app.inject({
        method: 'GET',
        url: `/api/v1/projects/${bob.projectId}/checks`,
        headers: auth(key.token),
      });
      expect(otherProject.statusCode).toBe(404);
    });

    it('cannot mint or list API keys', async () => {
      const user = await registerUser(context);
      const key = await createKey(user.token, user.projectId);

      // A leaked CI key must not be able to grant itself more credentials.
      for (const method of ['GET', 'POST'] as const) {
        const response = await context.app.inject({
          method,
          url: `/api/v1/projects/${user.projectId}/api-keys`,
          headers: auth(key.token),
          payload: method === 'POST' ? { name: 'escalation' } : undefined,
        });
        expect(response.statusCode).toBe(401);
      }
    });

    it('stops working the moment it is revoked', async () => {
      const user = await registerUser(context);
      const key = await createKey(user.token, user.projectId);

      await context.app.inject({
        method: 'DELETE',
        url: `/api/v1/projects/${user.projectId}/api-keys/${key.id}`,
        headers: auth(user.token),
      });

      const response = await context.app.inject({
        method: 'GET',
        url: '/api/v1/projects',
        headers: auth(key.token),
      });
      expect(response.statusCode).toBe(401);
    });

    it('rejects an expired key', async () => {
      const user = await registerUser(context);
      const key = await createKey(user.token, user.projectId);
      await context.prisma.apiKey.update({
        where: { id: key.id },
        data: { expiresAt: new Date(Date.now() - 1_000) },
      });

      expect(
        (
          await context.app.inject({
            method: 'GET',
            url: '/api/v1/projects',
            headers: auth(key.token),
          })
        ).statusCode,
      ).toBe(401);
    });
  });

  describe('sessions', () => {
    it('rotates refresh tokens and refuses to reuse one', async () => {
      const login = await context.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'rotate@example.test', password: 'a-sufficiently-long-password' },
      });
      const first = login.json<{ refreshToken: string }>().refreshToken;

      const refreshed = await context.app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refreshToken: first },
      });
      expect(refreshed.statusCode).toBe(200);
      const second = refreshed.json<{ refreshToken: string }>().refreshToken;
      expect(second).not.toBe(first);

      // Replaying the old token is treated as theft: every session dies.
      const replay = await context.app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refreshToken: first },
      });
      expect(replay.statusCode).toBe(401);

      const afterReplay = await context.app.inject({
        method: 'POST',
        url: '/api/auth/refresh',
        payload: { refreshToken: second },
      });
      expect(afterReplay.statusCode).toBe(401);
    });

    it('invalidates access tokens on logout', async () => {
      const registered = await context.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'logout@example.test', password: 'a-sufficiently-long-password' },
      });
      const session = registered.json<{ accessToken: string; refreshToken: string }>();

      expect(
        (await context.app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(session.accessToken) }))
          .statusCode,
      ).toBe(200);

      await context.app.inject({
        method: 'POST',
        url: '/api/auth/logout',
        payload: { refreshToken: session.refreshToken },
      });

      // The JWT is still cryptographically valid; the session behind it is not.
      expect(
        (await context.app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(session.accessToken) }))
          .statusCode,
      ).toBe(401);
    });

    it('ends every session when the password changes', async () => {
      const registered = await context.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'rekey@example.test', password: 'a-sufficiently-long-password' },
      });
      const session = registered.json<{ accessToken: string }>();

      const changed = await context.app.inject({
        method: 'POST',
        url: '/api/auth/password',
        headers: auth(session.accessToken),
        payload: {
          currentPassword: 'a-sufficiently-long-password',
          newPassword: 'an-even-longer-new-password',
        },
      });
      expect(changed.statusCode).toBe(204);

      expect(
        (await context.app.inject({ method: 'GET', url: '/api/auth/me', headers: auth(session.accessToken) }))
          .statusCode,
      ).toBe(401);
    });

    it('answers identically whether or not the email exists', async () => {
      await registerUser(context, 'known@example.test');

      const unknown = await context.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'unknown@example.test', password: 'wrong-password-here' },
      });
      const wrongPassword = await context.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: 'known@example.test', password: 'wrong-password-here' },
      });

      expect(unknown.statusCode).toBe(401);
      expect(wrongPassword.statusCode).toBe(401);
      expect(unknown.json<{ message: string }>().message).toBe(
        wrongPassword.json<{ message: string }>().message,
      );
    });

    it('locks an account after repeated failures', async () => {
      const user = await registerUser(context, 'lockme@example.test');

      for (let attempt = 0; attempt < 10; attempt += 1) {
        await context.app.inject({
          method: 'POST',
          url: '/api/auth/login',
          payload: { email: user.email, password: `wrong-password-${attempt}` },
        });
      }

      const correct = await context.app.inject({
        method: 'POST',
        url: '/api/auth/login',
        payload: { email: user.email, password: 'a-sufficiently-long-password' },
      });
      expect(correct.statusCode).toBe(401);
      expect(correct.json<{ message: string }>().message).toContain('Too many failed attempts');
    });

    it('enforces a minimum password length', async () => {
      const response = await context.app.inject({
        method: 'POST',
        url: '/api/auth/register',
        payload: { email: 'weak@example.test', password: 'short' },
      });
      expect(response.statusCode).toBe(400);
    });
  });

  describe('secret handling', () => {
    it('never returns channel configuration, only a masked target', async () => {
      const user = await registerUser(context);
      const webhookUrl = 'https://hooks.example.com/services/T000/B000/XXXXsecretXXXX';

      const created = await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/channels`,
        headers: auth(user.token),
        payload: {
          type: 'slack',
          name: 'Ops',
          config: { url: webhookUrl },
        },
      });
      expect(created.statusCode).toBe(201);

      const channel = created.json<NotificationChannelDto>();
      expect(created.body).not.toContain('XXXXsecretXXXX');
      expect(channel.target).toBe('hooks.example.com/services/…');
      expect((channel as unknown as { config?: unknown }).config).toBeUndefined();

      const listed = await context.app.inject({
        method: 'GET',
        url: `/api/v1/projects/${user.projectId}/channels`,
        headers: auth(user.token),
      });
      expect(listed.body).not.toContain('XXXXsecretXXXX');
    });

    it('refuses a webhook target on a private address', async () => {
      const user = await registerUser(context);
      const response = await context.app.inject({
        method: 'POST',
        url: `/api/v1/projects/${user.projectId}/channels`,
        headers: auth(user.token),
        payload: { type: 'webhook', name: 'Internal', config: { url: 'http://127.0.0.1:9000/hook' } },
      });

      expect(response.statusCode).toBe(400);
      expect(response.json<{ message: string }>().message).toMatch(/private or reserved/);
    });

    it('does not leak internals in error responses', async () => {
      const user = await registerUser(context);
      const response = await context.app.inject({
        method: 'GET',
        url: '/api/v1/checks/not-a-uuid',
        headers: auth(user.token),
      });

      expect(response.statusCode).toBe(400);
      expect(response.body).not.toContain('prisma');
      expect(response.body).not.toContain('SELECT');
      expect(response.body).not.toMatch(/at [A-Za-z]+\./);
    });
  });

  describe('input validation', () => {
    it('rejects unknown enum values and out-of-range numbers', async () => {
      const user = await registerUser(context);

      for (const payload of [
        { name: 'x', scheduleType: 'weekly', periodSeconds: 60, graceSeconds: 0 },
        { name: 'x', scheduleType: 'interval', periodSeconds: 60, graceSeconds: -1 },
        { name: 'x', scheduleType: 'interval', periodSeconds: 99_999_999_999, graceSeconds: 0 },
        { name: '', scheduleType: 'interval', periodSeconds: 60, graceSeconds: 0 },
        { name: 'x'.repeat(500), scheduleType: 'interval', periodSeconds: 60, graceSeconds: 0 },
      ]) {
        const response = await context.app.inject({
          method: 'POST',
          url: `/api/v1/projects/${user.projectId}/checks`,
          headers: auth(user.token),
          payload,
        });
        expect(response.statusCode).toBe(400);
      }
    });

    it('treats SQL metacharacters in filters as plain text', async () => {
      const user = await registerUser(context);
      await createCheck(user.token, user.projectId);

      const response = await context.app.inject({
        method: 'GET',
        url: `/api/v1/checks?search=${encodeURIComponent("'; DROP TABLE \"check\"; --")}`,
        headers: auth(user.token),
      });

      expect(response.statusCode).toBe(200);
      expect(response.json<{ items: unknown[] }>().items).toHaveLength(0);
      // The table is still there.
      expect(await context.prisma.check.count()).toBe(1);
    });
  });

});

/**
 * `/p/*` bypasses the Nest pipeline, so the per-IP API limiter never sees a
 * heartbeat and the per-key limiter is useless against a caller that never
 * repeats a key. Walking the URL space therefore used to buy an unbounded
 * supply of unauthenticated database lookups on the one pool that real
 * heartbeats depend on.
 *
 * Runs with TRUST_PROXY on so the source address can be varied — which is the
 * whole point: throttling a scanner must not throttle anybody else.
 */
describe('heartbeat ingestion under a ping-URL scan', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({ TRUST_PROXY: 'true' });
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  it('stops paying for the scan, without ever calling a real key unknown', async () => {
    const user = await registerUser(context);
    const check = await context.app.inject({
      method: 'POST',
      url: `/api/v1/projects/${user.projectId}/checks`,
      headers: auth(user.token),
      payload: { name: 'Job', scheduleType: 'interval', periodSeconds: 3_600, graceSeconds: 60 },
    });
    const pingKey = check.json<CheckDto>().pingKey;

    const misses = async (): Promise<number> => {
      const status = await context.app.inject({
        method: 'GET',
        url: '/api/v1/status',
        headers: auth(user.token),
      });
      return status.json<{ ingestCache: { misses: number } }>().ingestCache.misses;
    };

    const before = await misses();
    for (let attempt = 0; attempt < 200; attempt += 1) {
      const response = await context.app.inject({
        method: 'GET',
        url: `/p/${randomUUID()}`,
        headers: { 'x-forwarded-for': '203.0.113.9' },
      });
      expect([404, 429]).toContain(response.statusCode);
    }

    // 60 unknown keys per minute is the budget; the rest never reach the pool.
    expect((await misses()) - before).toBeLessThanOrEqual(61);

    // Refused, not disowned. A 404 here would tell a job with a perfectly good
    // URL that it is calling the wrong one, and a heartbeat that stops is
    // exactly what this product raises an alarm about.
    const throttled = await context.app.inject({
      method: 'GET',
      url: `/p/${pingKey}`,
      headers: { 'x-forwarded-for': '203.0.113.9' },
    });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.headers['retry-after']).toBe('60');

    // And the scan costs no one else anything: another source is unaffected.
    const elsewhere = await context.app.inject({
      method: 'GET',
      url: `/p/${pingKey}`,
      headers: { 'x-forwarded-for': '198.51.100.7' },
    });
    expect(elsewhere.statusCode).toBe(200);
    expect(elsewhere.body).toBe('OK');
  });
});
