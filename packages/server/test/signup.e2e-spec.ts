import {
  countLeadingZeroBits,
  encodePowSolution,
  powInput,
  type SignupChallengeDto,
} from '@silencewatch/shared';
import { createHash } from 'node:crypto';
import { createTestApp, type TestApp } from './utils/test-app';

/**
 * Registration under the rules a hosted deployment turns on: a proven address,
 * a solved challenge, and no way to learn from the API whether an address is
 * already taken.
 *
 * All of it is off by default, so the self-hosted path is what the other suites
 * already exercise; here it is switched on explicitly.
 */

const PASSWORD = 'a-sufficiently-long-password';

/** Brute-forces a nonce, exactly as the browser worker does. */
function solve(challenge: string, difficulty: number): number {
  for (let nonce = 0; nonce < 5_000_000; nonce += 1) {
    if (countLeadingZeroBits(createHash('sha256').update(powInput(challenge, nonce)).digest()) >= difficulty) {
      return nonce;
    }
  }
  throw new Error('no solution found');
}

function linkFrom(text: string): string {
  const match = /https?:\/\/\S+\/verify-email\?token=(\S+)/.exec(text);
  if (match === null) throw new Error(`no verification link in:\n${text}`);
  return decodeURIComponent(match[1] as string);
}

describe('sign-up with email verification', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({
      EMAIL_VERIFICATION_REQUIRED: 'true',
      // `console` is refused alongside verification, and the transport is
      // replaced by a recorder anyway.
      EMAIL_PROVIDER: 'smtp',
      SMTP_URL: 'smtp://user:pass@smtp.example.test:587',
    });
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
  });

  /**
   * The bootstrap account is exempt: on an empty instance nobody could have
   * read their inbox to unlock the instance that would have sent the mail.
   */
  async function seedBootstrapAccount(): Promise<void> {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'first@example.test', password: PASSWORD },
    });
    expect(response.statusCode).toBe(201);
    expect(response.json<{ status: string }>().status).toBe('active');
  }

  async function register(email: string): Promise<{ statusCode: number; body: unknown }> {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: PASSWORD, name: 'Test' },
    });
    return { statusCode: response.statusCode, body: response.json() };
  }

  it('creates the first account without verification, and gates every one after it', async () => {
    await seedBootstrapAccount();

    const result = await register('second@example.test');
    expect(result.statusCode).toBe(201);
    expect(result.body).toEqual({ status: 'verification_sent', email: 'second@example.test' });

    // No session, and the account cannot be used yet.
    const login = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'second@example.test', password: PASSWORD },
    });
    expect(login.statusCode).toBe(403);
    expect(login.json<{ details: { emailVerificationPending: boolean } }>().details)
      .toEqual({ emailVerificationPending: true });
  });

  it('lets the account in once the emailed link is confirmed', async () => {
    await seedBootstrapAccount();
    await register('user@example.test');

    const mail = context.emails.lastTo('user@example.test');
    expect(mail?.subject).toBe('Confirm your email address');

    const verify = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: linkFrom(mail?.text as string) },
    });
    expect(verify.statusCode).toBe(204);

    const login = await context.app.inject({
      method: 'POST',
      url: '/api/auth/login',
      payload: { email: 'user@example.test', password: PASSWORD },
    });
    expect(login.statusCode).toBe(200);
    expect(login.json<{ accessToken: string }>().accessToken).toEqual(expect.any(String));
  });

  it('burns the token: a link cannot be used twice', async () => {
    await seedBootstrapAccount();
    await register('once@example.test');
    const token = linkFrom(context.emails.lastTo('once@example.test')?.text as string);

    const first = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token },
    });
    expect(first.statusCode).toBe(204);

    const second = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token },
    });
    expect(second.statusCode).toBe(400);
  });

  it('invalidates the previous link when a new one is requested', async () => {
    await seedBootstrapAccount();
    await register('resend@example.test');
    const firstToken = linkFrom(context.emails.lastTo('resend@example.test')?.text as string);

    const resend = await context.app.inject({
      method: 'POST',
      url: '/api/auth/resend-verification',
      payload: { email: 'resend@example.test' },
    });
    expect(resend.statusCode).toBe(204);

    const secondToken = linkFrom(context.emails.lastTo('resend@example.test')?.text as string);
    expect(secondToken).not.toBe(firstToken);

    // A widening set of live links in a widening set of inboxes is not a
    // feature; only the newest one works.
    const stale = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: firstToken },
    });
    expect(stale.statusCode).toBe(400);

    const fresh = await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token: secondToken },
    });
    expect(fresh.statusCode).toBe(204);
  });

  it('answers identically whether or not the address is already registered', async () => {
    await seedBootstrapAccount();

    const fresh = await register('taken@example.test');
    const duplicate = await register('taken@example.test');

    // Byte for byte the same: the response cannot be a membership oracle.
    expect(duplicate.statusCode).toBe(fresh.statusCode);
    expect(duplicate.body).toEqual(fresh.body);

    // Exactly one account exists, whatever the second answer implied.
    const users = await context.prisma.user.count({ where: { email: 'taken@example.test' } });
    expect(users).toBe(1);
  });

  it('warns the owner when someone tries to register their verified address', async () => {
    await seedBootstrapAccount();
    await register('owner@example.test');
    const token = linkFrom(context.emails.lastTo('owner@example.test')?.text as string);
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/verify-email',
      payload: { token },
    });
    context.emails.clear();

    await register('owner@example.test');

    // The truth goes to the inbox, which is the only party entitled to it.
    expect(context.emails.lastTo('owner@example.test')?.subject).toBe(
      'Someone tried to sign up with your email address',
    );
  });

  it('says nothing when asked to resend for an address that does not exist', async () => {
    await seedBootstrapAccount();

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/resend-verification',
      payload: { email: 'nobody@example.test' },
    });

    expect(response.statusCode).toBe(204);
    expect(context.emails.lastTo('nobody@example.test')).toBeUndefined();
  });

  it('reports a mail outage instead of promising an inbox that gets nothing', async () => {
    await seedBootstrapAccount();
    const failing = jest
      .spyOn(context.emails, 'send')
      .mockRejectedValue(new Error('connect ECONNREFUSED'));

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'unlucky@example.test', password: PASSWORD },
    });

    // 503 and a sentence the visitor can act on, not a 500 and a correlation id.
    expect(response.statusCode).toBe(503);
    expect(response.json<{ message: string }>().message).toContain('try again');

    // Retrying once mail is back works, because the address is now a known
    // unverified one and that branch re-sends.
    failing.mockRestore();
    const retry = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'unlucky@example.test', password: PASSWORD },
    });
    expect(retry.statusCode).toBe(201);
    expect(context.emails.lastTo('unlucky@example.test')?.subject).toBe(
      'Confirm your email address',
    );
  });

  it('fails identically for a new and an existing address during a mail outage', async () => {
    await seedBootstrapAccount();
    await register('known@example.test');
    const token = linkFrom(context.emails.lastTo('known@example.test')?.text as string);
    await context.app.inject({ method: 'POST', url: '/api/auth/verify-email', payload: { token } });

    jest.spyOn(context.emails, 'send').mockRejectedValue(new Error('connect ECONNREFUSED'));

    // If one branch answered 201 while the other reported an outage, the
    // difference would be exactly the membership oracle this design closes.
    const fresh = await register('brand-new@example.test');
    const existing = await register('known@example.test');

    expect(fresh.statusCode).toBe(503);
    expect(existing.statusCode).toBe(503);
    expect(existing.body).toEqual(fresh.body);

    jest.restoreAllMocks();
  });

  it('deletes accounts that never confirmed, freeing the address again', async () => {
    await seedBootstrapAccount();
    await register('ghost@example.test');

    await context.prisma.user.updateMany({
      where: { email: 'ghost@example.test' },
      data: { createdAt: new Date(Date.now() - 30 * 86_400_000) },
    });

    const { EmailVerificationService } = await import('../src/auth/email-verification.service');
    const purged = await context.app.get(EmailVerificationService).purge();

    expect(purged.accounts).toBe(1);
    expect(await context.prisma.user.count({ where: { email: 'ghost@example.test' } })).toBe(0);
  });
});

describe('sign-up proof of work', () => {
  let context: TestApp;

  beforeAll(async () => {
    context = await createTestApp({ SIGNUP_POW_DIFFICULTY: '10' });
  });

  afterAll(async () => {
    await context.close();
  });

  beforeEach(async () => {
    await context.reset();
    // The very first account bypasses the gate; seed one so the rest is tested.
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'first@example.test', password: PASSWORD },
    });
  });

  it('refuses a registration with no solution', async () => {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'bot@example.test', password: PASSWORD },
    });

    expect(response.statusCode).toBe(400);
    expect(response.json<{ details: { challengeRequired: boolean } }>().details).toEqual({
      challengeRequired: true,
    });
    expect(await context.prisma.user.count({ where: { email: 'bot@example.test' } })).toBe(0);
  });

  it('accepts one that carries a solved challenge', async () => {
    const issued = await context.app.inject({ method: 'GET', url: '/api/auth/signup-challenge' });
    const challenge = issued.json<SignupChallengeDto>();
    expect(challenge.difficulty).toBe(10);

    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: {
        email: 'human@example.test',
        password: PASSWORD,
        powSolution: encodePowSolution(
          challenge.challenge,
          solve(challenge.challenge, challenge.difficulty),
        ),
      },
    });

    expect(response.statusCode).toBe(201);
    expect(response.json<{ status: string }>().status).toBe('active');
  });

  it('refuses the same solution a second time', async () => {
    const challenge = (
      await context.app.inject({ method: 'GET', url: '/api/auth/signup-challenge' })
    ).json<SignupChallengeDto>();
    const powSolution = encodePowSolution(
      challenge.challenge,
      solve(challenge.challenge, challenge.difficulty),
    );

    const first = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'one@example.test', password: PASSWORD, powSolution },
    });
    expect(first.statusCode).toBe(201);

    // Solve once, register a thousand times is exactly the shortcut this closes.
    const replay = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'two@example.test', password: PASSWORD, powSolution },
    });
    expect(replay.statusCode).toBe(400);
    expect(await context.prisma.user.count({ where: { email: 'two@example.test' } })).toBe(0);
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
    await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email: 'first@example.test', password: PASSWORD },
    });
  });

  async function register(email: string): Promise<number> {
    const response = await context.app.inject({
      method: 'POST',
      url: '/api/auth/register',
      payload: { email, password: PASSWORD },
    });
    return response.statusCode;
  }

  it('stops accepting past the per-network ceiling', async () => {
    // The bootstrap account skips the *checks*, but it is still an account and
    // still counts: the ceiling is 3, and beforeEach already spent one of them.
    expect(await register('a@example.test')).toBe(201);
    expect(await register('b@example.test')).toBe(201);
    expect(await register('c@example.test')).toBe(429);

    expect(await context.prisma.user.count({ where: { email: 'c@example.test' } })).toBe(0);
  });

  it('rejects disposable mailboxes, including on a subdomain', async () => {
    expect(await register('throwaway@mailinator.com')).toBe(400);
    expect(await register('throwaway@team.mailinator.com')).toBe(400);
    expect(await register('someone@blocked.test')).toBe(400);
  });

  it('does not let rejected attempts consume the budget', async () => {
    // Otherwise anybody could lock out a shared corporate NAT by failing on
    // purpose, which turns an anti-abuse rule into the abuse.
    expect(await register('throwaway@mailinator.com')).toBe(400);
    expect(await register('throwaway2@mailinator.com')).toBe(400);
    expect(await register('real@example.test')).toBe(201);
  });
});
