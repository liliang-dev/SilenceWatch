import { SetupLinkService } from '../src/auth/signup/setup-link.service';
import { RecoveryCodesService } from '../src/auth/recovery/recovery-codes.service';
import { Browser } from './utils/browser';
import { createTestApp, type TestApp } from './utils/test-app';
import { VirtualAuthenticator } from './utils/virtual-authenticator';

/** localhost is the one http origin a browser accepts passkeys on. */
const BASE_URL = 'http://localhost:8080';

interface RegistrationOptions {
  challenge: string;
  rp: { id: string; name: string };
  user: { id: string; name: string };
  authenticatorSelection: { residentKey: string; userVerification: string };
}

/** Passkeys alone (AUTH_MODE=passkey, the default): sign-up by passkey, sign-in, recovery codes. */
describe('passkey sign-in', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({ AUTH_MODE: 'passkey', BASE_URL });
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  const newBrowser = (): Browser => new Browser(context.app, BASE_URL);

  /** Creates an account the way the web UI does: the address, then the passkey. */
  async function signUp(
    browser: Browser,
    email: string,
    device = new VirtualAuthenticator(),
    headers: Record<string, string> = {},
  ): Promise<{ device: VirtualAuthenticator; status: number }> {
    const options = await browser.send(
      'GET',
      `/api/auth/passkey/generate-register-options?context=${encodeURIComponent(email)}`,
      { headers },
    );
    if (options.statusCode !== 200) return { device, status: options.statusCode };

    const verified = await browser.send('POST', '/api/auth/passkey/verify-registration', {
      headers,
      payload: { response: device.register(options.json<RegistrationOptions>(), BASE_URL), createSession: true },
    });
    return { device, status: verified.statusCode };
  }

  async function signInWith(browser: Browser, device: VirtualAuthenticator, tamper = false) {
    const options = await browser.send('GET', '/api/auth/passkey/generate-authenticate-options');
    const challenge = options.json<{ challenge: string; rpId: string }>();
    return browser.send('POST', '/api/auth/passkey/verify-authentication', {
      payload: { response: device.assert(challenge, BASE_URL, tamper) },
    });
  }

  describe('what this mode offers', () => {
    it('describes itself to the sign-in page', async () => {
      const response = await context.app.inject({ method: 'GET', url: '/api/auth/config' });
      expect(response.json()).toEqual({
        mode: 'passkey',
        passkey: true,
        password: false,
        providers: [],
        recoveryCodes: true,
        signup: true,
      });
    });

    it.each([
      ['POST', '/api/auth/sign-up/email'],
      ['POST', '/api/auth/sign-in/email'],
      ['POST', '/api/auth/change-password'],
      ['POST', '/api/auth/sign-in/social'],
      ['GET', '/api/auth/callback/google'],
      ['POST', '/api/auth/request-password-reset'],
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

  describe('creating an account', () => {
    it('is done by registering the first passkey, and signs the new account in', async () => {
      const browser = newBrowser();
      const { status } = await signUp(browser, 'new@example.test');

      expect(status).toBe(200);
      expect(browser.signedIn).toBe(true);

      const user = await context.prisma.user.findUniqueOrThrow({
        where: { email: 'new@example.test' },
        include: { passkeys: true, memberships: true, accounts: true },
      });
      expect(user.passkeys).toHaveLength(1);
      expect(user.passkeys[0]?.credentialID).toBeDefined();
      // A first project it owns, and no password anywhere.
      expect(user.memberships.map((member) => member.role)).toEqual(['owner']);
      expect(user.accounts).toHaveLength(0);

      const me = await browser.send('GET', '/api/auth/me');
      expect(me.statusCode).toBe(200);
      expect(me.json<{ email: string }>().email).toBe('new@example.test');
    });

    it('asks the authenticator for a resident, user-verified credential', async () => {
      const options = await newBrowser().send(
        'GET',
        '/api/auth/passkey/generate-register-options?context=a%40example.test',
      );
      const body = options.json<RegistrationOptions>();
      expect(body.rp.id).toBe('localhost');
      expect(body.authenticatorSelection.residentKey).toBe('required');
      expect(body.authenticatorSelection.userVerification).toBe('required');
    });

    it('creates nothing until the passkey has been verified', async () => {
      const browser = newBrowser();
      await browser.send('GET', '/api/auth/passkey/generate-register-options?context=pending%40example.test');
      expect(await context.prisma.user.count()).toBe(0);
    });

    it('refuses an address that is not one, and one that already has a way in', async () => {
      const bad = await newBrowser().send(
        'GET',
        '/api/auth/passkey/generate-register-options?context=not-an-address',
      );
      expect(bad.statusCode).toBe(400);

      await signUp(newBrowser(), 'taken@example.test');
      const taken = await newBrowser().send(
        'GET',
        '/api/auth/passkey/generate-register-options?context=taken%40example.test',
      );
      expect(taken.statusCode).toBe(400);
      expect(await context.prisma.user.count()).toBe(1);
    });

    it('does not accept a passkey that was made for another challenge', async () => {
      const browser = newBrowser();
      const options = await browser.send(
        'GET',
        '/api/auth/passkey/generate-register-options?context=forged%40example.test',
      );
      const forged = new VirtualAuthenticator().register(
        { ...options.json<RegistrationOptions>(), challenge: Buffer.from('another challenge').toString('base64url') },
        BASE_URL,
      );
      const verified = await browser.send('POST', '/api/auth/passkey/verify-registration', {
        payload: { response: forged, createSession: true },
      });

      expect(verified.statusCode).toBeGreaterThanOrEqual(400);
      expect(await context.prisma.user.count()).toBe(0);
    });

    it('does not accept a passkey made on another site', async () => {
      const browser = newBrowser();
      const options = await browser.send(
        'GET',
        '/api/auth/passkey/generate-register-options?context=phish%40example.test',
      );
      const verified = await browser.send('POST', '/api/auth/passkey/verify-registration', {
        payload: {
          response: new VirtualAuthenticator().register(options.json<RegistrationOptions>(), 'https://evil.example'),
          createSession: true,
        },
      });

      expect(verified.statusCode).toBeGreaterThanOrEqual(400);
      expect(await context.prisma.user.count()).toBe(0);
    });

    it('finishes the registration of an address that was left with no way in', async () => {
      // What a registration that stopped between its two writes leaves behind.
      await context.prisma.user.create({ data: { email: 'half@example.test', name: '' } });

      const { status } = await signUp(newBrowser(), 'half@example.test');
      expect(status).toBe(200);
      expect(await context.prisma.user.count()).toBe(1);
      expect(await context.prisma.passkey.count()).toBe(1);
    });

    it('never hands an account that has been used to whoever registers its address', async () => {
      await signUp(newBrowser(), 'victim@example.test');
      // Its passkeys gone by whatever route: two tabs removing one each, a direct
      // call, an operator. The account, its projects and its history are still there.
      await context.prisma.passkey.deleteMany();

      const attacker = newBrowser();
      const options = await attacker.send(
        'GET',
        '/api/auth/passkey/generate-register-options?context=victim%40example.test',
      );
      expect(options.statusCode).toBe(400);
      expect(attacker.signedIn).toBe(false);
      expect(await context.prisma.passkey.count()).toBe(0);
    });

    it('applies the same rules as any other way of signing up', async () => {
      const closed = await createTestApp({ AUTH_MODE: 'passkey', BASE_URL, SIGNUP_ENABLED: 'false' });
      try {
        const browser = new Browser(closed.app, BASE_URL);
        const refused = await browser.send(
          'GET',
          '/api/auth/passkey/generate-register-options?context=nope%40example.test',
        );
        expect(refused.statusCode).toBe(403);

        // Only the administrator's account, and only with its link.
        const { url } = await closed.app.get(SetupLinkService).issue();
        const cookie = `sw_setup=${url.split('#')[1]}`;
        const stranger = await browser.send(
          'GET',
          '/api/auth/passkey/generate-register-options?context=nope%40example.test',
          { headers: { cookie } },
        );
        expect(stranger.statusCode).toBe(403);
        const invited = await browser.send(
          'GET',
          `/api/auth/passkey/generate-register-options?context=${encodeURIComponent(closed.config.ADMIN_EMAIL)}`,
          { headers: { cookie } },
        );
        expect(invited.statusCode).toBe(200);
      } finally {
        await closed.close();
        // The pool of the app under test is gone with it; the other app reopens its own.
      }
    });
  });

  describe('signing in', () => {
    it('works with the passkey, and moves the signature counter on', async () => {
      const first = newBrowser();
      const { device } = await signUp(first, 'again@example.test');

      const browser = newBrowser();
      const response = await signInWith(browser, device);
      expect(response.statusCode).toBe(200);
      expect(browser.signedIn).toBe(true);
      expect((await browser.send('GET', '/api/auth/me')).statusCode).toBe(200);

      const stored = await context.prisma.passkey.findFirstOrThrow();
      expect(stored.counter).toBeGreaterThan(0);
    });

    it('refuses a signature that does not verify, and a passkey nobody registered', async () => {
      const { device } = await signUp(newBrowser(), 'sig@example.test');

      const forged = newBrowser();
      expect((await signInWith(forged, device, true)).statusCode).toBeGreaterThanOrEqual(400);
      expect(forged.signedIn).toBe(false);

      const stranger = newBrowser();
      expect((await signInWith(stranger, new VirtualAuthenticator())).statusCode).toBeGreaterThanOrEqual(400);
      expect(stranger.signedIn).toBe(false);
    });

    it('lets a second passkey be added by someone who just signed in, and either one sign in', async () => {
      const browser = newBrowser();
      const { device: first } = await signUp(browser, 'two@example.test');

      const second = new VirtualAuthenticator();
      const options = await browser.send('GET', '/api/auth/passkey/generate-register-options');
      expect(options.statusCode).toBe(200);
      const added = await browser.send('POST', '/api/auth/passkey/verify-registration', {
        payload: { response: second.register(options.json<RegistrationOptions>(), BASE_URL), name: 'Phone' },
      });
      expect(added.statusCode).toBe(200);

      const listed = await browser.send('GET', '/api/auth/passkey/list-user-passkeys');
      expect(listed.json<unknown[]>()).toHaveLength(2);

      expect((await signInWith(newBrowser(), first)).statusCode).toBe(200);
      expect((await signInWith(newBrowser(), second)).statusCode).toBe(200);

      const removed = await browser.send('POST', '/api/auth/passkey/delete-passkey', {
        payload: { id: listed.json<Array<{ id: string }>>()[0]?.id },
      });
      expect(removed.statusCode).toBe(200);
      expect(await context.prisma.passkey.count()).toBe(1);
    });

    it('refuses to remove the last passkey, which is the only way in', async () => {
      const browser = newBrowser();
      await signUp(browser, 'last@example.test');
      const listed = await browser.send('GET', '/api/auth/passkey/list-user-passkeys');

      const removed = await browser.send('POST', '/api/auth/passkey/delete-passkey', {
        payload: { id: listed.json<Array<{ id: string }>>()[0]?.id },
      });
      expect(removed.statusCode).toBe(400);
      expect(await context.prisma.passkey.count()).toBe(1);
    });

    it('asks a session that is not recent to sign in again before adding a passkey', async () => {
      const browser = newBrowser();
      await signUp(browser, 'stale@example.test');
      await context.prisma.session.updateMany({ data: { createdAt: new Date(Date.now() - 11 * 60_000) } });

      const options = await browser.send('GET', '/api/auth/passkey/generate-register-options');
      expect(options.statusCode).toBe(403);
    });

    it('records the sign-in and the passkey in the audit trail', async () => {
      const { device } = await signUp(newBrowser(), 'trail@example.test');
      await signInWith(newBrowser(), device);
      await new Promise((resolve) => setTimeout(resolve, 150));

      const actions = (await context.prisma.auditEvent.findMany()).map((event) => event.action);
      expect(actions).toEqual(expect.arrayContaining(['account.registered', 'passkey.added', 'auth.login']));
    });
  });

  describe('recovery codes', () => {
    async function withCodes(): Promise<{ browser: Browser; email: string; codes: string[]; userId: string }> {
      const browser = newBrowser();
      await signUp(browser, 'lost@example.test');
      const generated = await browser.send('POST', '/api/auth/recovery-codes/generate', { payload: {} });
      expect(generated.statusCode).toBe(200);
      const user = await context.prisma.user.findUniqueOrThrow({ where: { email: 'lost@example.test' } });
      return { browser, email: 'lost@example.test', codes: generated.json<{ codes: string[] }>().codes, userId: user.id };
    }

    const recover = (email: string, code: string) =>
      newBrowser().send('POST', '/api/auth/recovery-codes/sign-in', { payload: { email, code } });

    it('are eight, shown once, and kept only as a keyed hash', async () => {
      const { codes, userId } = await withCodes();

      expect(codes).toHaveLength(8);
      expect(new Set(codes).size).toBe(8);
      for (const code of codes) expect(code).toMatch(/^[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}-[0-9A-HJKMNP-TV-Z]{4}$/);

      const stored = await context.prisma.recoveryCode.findMany({ where: { userId } });
      expect(stored).toHaveLength(8);
      const dump = JSON.stringify(stored);
      for (const code of codes) expect(dump).not.toContain(code.replace(/-/g, ''));
      for (const row of stored) expect(row.codeHash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('sign the account in once, and never again', async () => {
      const { email, codes } = await withCodes();

      const first = await recover(email, codes[0] as string);
      expect(first.statusCode).toBe(200);
      expect(first.headers['set-cookie']).toBeDefined();

      const again = await recover(email, codes[0] as string);
      expect(again.statusCode).toBe(401);

      // The others are untouched.
      expect((await recover(email, codes[1] as string)).statusCode).toBe(200);
    });

    it('are read forgivingly, as a person copies them', async () => {
      const { email, codes } = await withCodes();
      const sloppy = ` ${(codes[0] as string).toLowerCase().replace(/-/g, ' ')} `;
      expect((await recover(email, sloppy)).statusCode).toBe(200);
    });

    it('cannot be spent at two requests at once', async () => {
      const { email, codes } = await withCodes();
      const results = await Promise.all(Array.from({ length: 5 }, () => recover(email, codes[2] as string)));
      expect(results.filter((response) => response.statusCode === 200)).toHaveLength(1);
    });

    it('answer alike for a wrong code, a spent one and an address with no account', async () => {
      const { email, codes } = await withCodes();
      await recover(email, codes[0] as string);

      const answers = await Promise.all([
        recover(email, 'AAAA-AAAA-AAAA'),
        recover(email, codes[0] as string),
        recover('nobody@example.test', codes[1] as string),
      ]);
      expect(answers.map((answer) => answer.statusCode)).toEqual([401, 401, 401]);
      expect(new Set(answers.map((answer) => answer.json<{ message: string }>().message)).size).toBe(1);
    });

    it('lock the account after repeated failures, and say nothing different', async () => {
      const { email, codes } = await withCodes();
      for (let attempt = 0; attempt < 10; attempt += 1) await recover(email, 'AAAA-AAAA-AAAA');

      const response = await recover(email, codes[3] as string);
      expect(response.statusCode).toBe(401);
    });

    it('are replaced, not added to, when new ones are made', async () => {
      const { browser, email, codes } = await withCodes();
      const fresh = await browser.send('POST', '/api/auth/recovery-codes/generate', { payload: {} });
      expect(fresh.statusCode).toBe(200);

      expect((await recover(email, codes[0] as string)).statusCode).toBe(401);
      const newCode = fresh.json<{ codes: string[] }>().codes[0] as string;
      expect((await recover(email, newCode)).statusCode).toBe(200);

      const remaining = await browser.send('GET', '/api/auth/recovery-codes/remaining');
      expect(remaining.json<{ remaining: number }>().remaining).toBe(7);
    });

    it('are only made for someone who signed in a moment ago', async () => {
      const { browser } = await withCodes();
      await context.prisma.session.updateMany({ data: { createdAt: new Date(Date.now() - 11 * 60_000) } });

      expect((await browser.send('POST', '/api/auth/recovery-codes/generate', { payload: {} })).statusCode).toBe(403);
      expect((await newBrowser().send('POST', '/api/auth/recovery-codes/generate', { payload: {} })).statusCode).toBe(401);
    });

    it('get an account back in without its passkey, and let it register a new one', async () => {
      const { email, codes } = await withCodes();
      const browser = newBrowser();
      const response = await browser.send('POST', '/api/auth/recovery-codes/sign-in', {
        payload: { email, code: codes[0] },
      });
      expect(response.statusCode).toBe(200);

      // Signed in just now, so adding a passkey is allowed.
      const options = await browser.send('GET', '/api/auth/passkey/generate-register-options');
      expect(options.statusCode).toBe(200);
    });

    it('can be issued from the command line for an account that has none left', async () => {
      const { userId } = await withCodes();
      const codes = await context.app.get(RecoveryCodesService).replaceAll(userId);
      expect(codes).toHaveLength(8);
      expect(await context.prisma.recoveryCode.count({ where: { userId } })).toBe(8);
    });
  });
});
