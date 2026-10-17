import type { BetterAuthOptions } from 'better-auth';
import { SetupLinkService } from '../src/auth/signup/setup-link.service';
import { Browser } from './utils/browser';
import { createTestApp, type TestApp } from './utils/test-app';
import { VirtualAuthenticator } from './utils/virtual-authenticator';

const BASE_URL = 'http://localhost:8080';

const ENV = {
  AUTH_MODE: 'full',
  BASE_URL,
  GOOGLE_CLIENT_ID: 'google-client',
  GOOGLE_CLIENT_SECRET: 'google-secret',
  MICROSOFT_CLIENT_ID: 'microsoft-client',
  MICROSOFT_CLIENT_SECRET: 'microsoft-secret',
};

/**
 * Providers' servers cannot be reached from a test, so each is answered by a stand-in
 * that reads its "ID token" as JSON. Everything after that point is the real code:
 * the hooks, the account-linking rules, the sign-up policy and the session.
 */
const standIn = (options: BetterAuthOptions): BetterAuthOptions => {
  const providers = options.socialProviders as Record<string, Record<string, unknown>>;
  const fake = (provider: Record<string, unknown>, verified: (claims: { email_verified?: boolean }) => boolean) => ({
    ...provider,
    disableIdTokenSignIn: false,
    verifyIdToken: async () => true,
    getUserInfo: async (token: { idToken?: string }) => {
      const claims = JSON.parse(token.idToken ?? '{}') as { sub: string; email: string; name: string; email_verified?: boolean };
      return {
        user: { id: claims.sub, email: claims.email, name: claims.name, emailVerified: verified(claims) },
        // Google names an account by `sub`, Microsoft by `oid`.
        data: { ...claims, oid: claims.sub },
      };
    },
  });
  return {
    ...options,
    socialProviders: {
      // Google says whether it verified the address; Microsoft, as in life, does not.
      google: fake(providers.google as Record<string, unknown>, (claims) => claims.email_verified === true),
      microsoft: fake(providers.microsoft as Record<string, unknown>, () => false),
    } as never,
  };
};

interface RegistrationOptions {
  challenge: string;
  rp: { id: string };
}

/** AUTH_MODE=full: passkeys, Google and Microsoft, and what each is allowed to do to an account. */
describe('passkeys, Google and Microsoft', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp(ENV, standIn);
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  const newBrowser = (): Browser => new Browser(context.app, BASE_URL);

  async function signInWithProvider(
    browser: Browser,
    provider: 'google' | 'microsoft',
    claims: { sub: string; email: string; name?: string; email_verified?: boolean },
    headers: Record<string, string> = {},
  ) {
    return browser.send('POST', '/api/auth/sign-in/social', {
      headers,
      payload: { provider, idToken: { token: JSON.stringify({ name: 'Someone', ...claims }) } },
    });
  }

  describe('what this mode offers', () => {
    it('describes itself to the sign-in page', async () => {
      const response = await context.app.inject({ method: 'GET', url: '/api/auth/config' });
      expect(response.json()).toEqual({
        mode: 'full',
        passkey: true,
        password: false,
        providers: ['google', 'microsoft'],
        recoveryCodes: false,
        signup: true,
      });
    });

    it.each([
      ['POST', '/api/auth/sign-up/email'],
      ['POST', '/api/auth/sign-in/email'],
      ['POST', '/api/auth/recovery-codes/sign-in'],
      ['POST', '/api/auth/recovery-codes/generate'],
      ['POST', '/api/auth/link-social'],
      ['GET', '/api/auth/callback/github'],
    ])('has no %s %s', async (method, url) => {
      const response = await context.app.inject({
        method: method as 'GET',
        url,
        headers: { origin: BASE_URL },
        payload: method === 'POST' ? {} : undefined,
      });
      expect(response.statusCode).toBe(404);
    });
  });

  describe('the real providers', () => {
    it('are reached by redirect, with the address they will call back', async () => {
      const real = await createTestApp(ENV);
      try {
        const browser = new Browser(real.app, BASE_URL);
        for (const [provider, host] of [
          ['google', 'accounts.google.com'],
          ['microsoft', 'login.microsoftonline.com'],
        ] as const) {
          const response = await browser.send('POST', '/api/auth/sign-in/social', {
            payload: { provider, callbackURL: '/' },
          });
          expect(response.statusCode).toBe(200);
          const { url } = response.json<{ url: string }>();
          expect(new URL(url).host).toBe(host);
          expect(new URL(url).searchParams.get('redirect_uri')).toBe(`${BASE_URL}/api/auth/callback/${provider}`);
          expect(new URL(url).searchParams.get('prompt')).toBe('select_account');
        }
      } finally {
        await real.close();
      }
    });

    it('cannot be bypassed by handing the API a token of one\'s own', async () => {
      const real = await createTestApp(ENV);
      try {
        const response = await new Browser(real.app, BASE_URL).send('POST', '/api/auth/sign-in/social', {
          payload: { provider: 'google', idToken: { token: 'a.b.c' } },
        });
        expect(response.statusCode).toBeGreaterThanOrEqual(400);
        expect(await real.prisma.user.count()).toBe(0);
      } finally {
        await real.close();
      }
    });
  });

  describe('signing up with Google', () => {
    it('creates the account, vouched for by Google, with a first project and no picture', async () => {
      const browser = newBrowser();
      const response = await signInWithProvider(browser, 'google', {
        sub: 'g-1',
        email: 'Person@Example.test',
        email_verified: true,
      });
      expect(response.statusCode).toBe(200);
      expect(browser.signedIn).toBe(true);

      const user = await context.prisma.user.findUniqueOrThrow({
        where: { email: 'person@example.test' },
        include: { accounts: true, memberships: true },
      });
      expect(user.emailVerified).toBe(true);
      expect(user.image).toBeNull();
      expect(user.accounts.map((account) => account.providerId)).toEqual(['google']);
      expect(user.memberships.map((member) => member.role)).toEqual(['owner']);
      // Tokens the provider handed over are not kept: nothing here calls it again.
      expect(user.accounts[0]?.password).toBeNull();
      expect(user.accounts[0]?.accessToken).toBeNull();
      expect(user.accounts[0]?.refreshToken).toBeNull();
      expect(user.accounts[0]?.idToken).toBeNull();
    });

    it('signs the same person into the same account next time', async () => {
      const claims = { sub: 'g-2', email: 'same@example.test', email_verified: true };
      await signInWithProvider(newBrowser(), 'google', claims);
      const again = await signInWithProvider(newBrowser(), 'google', claims);

      expect(again.statusCode).toBe(200);
      expect(await context.prisma.user.count()).toBe(1);
      expect(await context.prisma.account.count()).toBe(1);
    });

    it('is bound by the same sign-up rules as any other way in', async () => {
      const closed = await createTestApp({ ...ENV, SIGNUP_ENABLED: 'false' }, standIn);
      try {
        const browser = new Browser(closed.app, BASE_URL);
        const claims = { sub: 'g-3', email: 'invited@example.test', email_verified: true };
        const refused = await browser.send('POST', '/api/auth/sign-in/social', {
          payload: { provider: 'google', idToken: { token: JSON.stringify({ name: 'x', ...claims }) } },
        });
        expect(refused.statusCode).toBeGreaterThanOrEqual(400);
        expect(await closed.prisma.user.count()).toBe(0);

        // The link travels in a cookie, which survives the trip to the provider and back.
        const { url } = await closed.app.get(SetupLinkService).issue('invited@example.test');
        const accepted = await browser.send('POST', '/api/auth/sign-in/social', {
          headers: { cookie: `sw_setup=${url.split('#')[1]}` },
          payload: { provider: 'google', idToken: { token: JSON.stringify({ name: 'x', ...claims }) } },
        });
        expect(accepted.statusCode).toBe(200);
        expect(await closed.prisma.user.count()).toBe(1);
      } finally {
        await closed.close();
      }
    });
  });

  describe('signing up with Microsoft', () => {
    it('creates the account, but does not take the address on trust', async () => {
      const browser = newBrowser();
      const response = await signInWithProvider(browser, 'microsoft', { sub: 'm-1', email: 'worker@corp.test' });
      expect(response.statusCode).toBe(200);

      const user = await context.prisma.user.findUniqueOrThrow({ where: { email: 'worker@corp.test' } });
      expect(user.emailVerified).toBe(false);
    });
  });

  describe('two providers, one address', () => {
    it('does not let Microsoft into an account Google made: its address is whatever a tenant says', async () => {
      await signInWithProvider(newBrowser(), 'google', { sub: 'g-4', email: 'victim@example.test', email_verified: true });

      const attacker = newBrowser();
      const response = await signInWithProvider(attacker, 'microsoft', { sub: 'm-evil', email: 'victim@example.test' });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(attacker.signedIn).toBe(false);
      expect(await context.prisma.user.count()).toBe(1);
      expect(await context.prisma.account.count({ where: { providerId: 'microsoft' } })).toBe(0);
    });

    it('does not let Google into an account Microsoft made, whose address nobody proved', async () => {
      await signInWithProvider(newBrowser(), 'microsoft', { sub: 'm-2', email: 'shared@example.test' });

      const other = newBrowser();
      const response = await signInWithProvider(other, 'google', {
        sub: 'g-5',
        email: 'shared@example.test',
        email_verified: true,
      });

      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(other.signedIn).toBe(false);
      expect(await context.prisma.user.count()).toBe(1);
    });

    it('does not trust a Google address that Google itself did not verify', async () => {
      await signInWithProvider(newBrowser(), 'google', { sub: 'g-6', email: 'loose@example.test', email_verified: true });
      const response = await signInWithProvider(newBrowser(), 'google', {
        sub: 'g-6-other',
        email: 'loose@example.test',
        email_verified: false,
      });
      expect(response.statusCode).toBeGreaterThanOrEqual(400);
      expect(await context.prisma.account.count()).toBe(1);
    });
  });

  describe('passkeys, added to an account that exists', () => {
    it('are never a way to create one', async () => {
      const response = await newBrowser().send(
        'GET',
        '/api/auth/passkey/generate-register-options?context=new%40example.test',
      );
      expect(response.statusCode).toBe(401);
      expect(await context.prisma.user.count()).toBe(0);
    });

    it('are added by someone signed in, and then sign in on their own', async () => {
      const browser = newBrowser();
      await signInWithProvider(browser, 'google', { sub: 'g-7', email: 'enroll@example.test', email_verified: true });

      const device = new VirtualAuthenticator();
      const options = await browser.send('GET', '/api/auth/passkey/generate-register-options');
      expect(options.statusCode).toBe(200);
      const added = await browser.send('POST', '/api/auth/passkey/verify-registration', {
        payload: { response: device.register(options.json<RegistrationOptions>(), BASE_URL), name: 'Laptop' },
      });
      expect(added.statusCode).toBe(200);
      expect(await context.prisma.passkey.count()).toBe(1);

      const fresh = newBrowser();
      const challenge = await fresh.send('GET', '/api/auth/passkey/generate-authenticate-options');
      const signedIn = await fresh.send('POST', '/api/auth/passkey/verify-authentication', {
        payload: { response: device.assert(challenge.json<{ challenge: string; rpId: string }>(), BASE_URL) },
      });
      expect(signedIn.statusCode).toBe(200);
      expect((await fresh.send('GET', '/api/auth/me')).json<{ email: string }>().email).toBe('enroll@example.test');
    });

    it('need a recent sign-in to be added', async () => {
      const browser = newBrowser();
      await signInWithProvider(browser, 'google', { sub: 'g-8', email: 'old@example.test', email_verified: true });
      await context.prisma.session.updateMany({ data: { createdAt: new Date(Date.now() - 11 * 60_000) } });

      const options = await browser.send('GET', '/api/auth/passkey/generate-register-options');
      expect(options.statusCode).toBe(403);
    });
  });
});
