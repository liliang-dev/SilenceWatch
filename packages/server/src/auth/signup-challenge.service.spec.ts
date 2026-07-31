import {
  countLeadingZeroBits,
  decodePowSolution,
  encodePowSolution,
  powInput,
} from '@silencewatch/shared';
import { createHash } from 'node:crypto';
import { loadConfig, type AppConfig } from '../config/config';
import { SignupChallengeService } from './signup-challenge.service';

const BASE_ENV = {
  DATABASE_URL: 'postgres://localhost/test',
  SECRET_KEY: 'x'.repeat(48),
};

function serviceWith(overrides: Record<string, string> = {}): SignupChallengeService {
  const config: AppConfig = loadConfig({ ...BASE_ENV, ...overrides } as NodeJS.ProcessEnv);
  return new SignupChallengeService(config);
}

/** Brute-forces a valid nonce, exactly as the browser worker does. */
function solve(challenge: string, difficulty: number): number {
  for (let nonce = 0; nonce < 5_000_000; nonce += 1) {
    const digest = createHash('sha256').update(powInput(challenge, nonce)).digest();
    if (countLeadingZeroBits(digest) >= difficulty) return nonce;
  }
  throw new Error('no solution found');
}

describe('SignupChallengeService', () => {
  // Low enough to solve in milliseconds, high enough that a wrong nonce fails.
  const DIFFICULTY = '10';

  it('asks for nothing when the gate is off', () => {
    const service = serviceWith();

    expect(service.enabled).toBe(false);
    expect(service.issue('203.0.113.0/24')).toEqual({
      challenge: '',
      difficulty: 0,
      expiresIn: 0,
    });
    // And accepts a registration that carries no solution at all.
    expect(service.verify(undefined, '203.0.113.0/24')).toEqual({ ok: true });
  });

  it('accepts a correctly solved challenge', () => {
    const service = serviceWith({ SIGNUP_POW_DIFFICULTY: DIFFICULTY });
    const network = '203.0.113.0/24';

    const issued = service.issue(network);
    const nonce = solve(issued.challenge, issued.difficulty);

    expect(service.verify(encodePowSolution(issued.challenge, nonce), network)).toEqual({
      ok: true,
    });
  });

  it('rejects a solution replayed after it was spent', () => {
    const service = serviceWith({ SIGNUP_POW_DIFFICULTY: DIFFICULTY });
    const network = '203.0.113.0/24';
    const issued = service.issue(network);
    const solution = encodePowSolution(issued.challenge, solve(issued.challenge, issued.difficulty));

    expect(service.verify(solution, network).ok).toBe(true);
    expect(service.verify(solution, network)).toEqual({ ok: false, reason: 'reused' });
  });

  it('rejects a challenge solved for a different network', () => {
    // The point of binding the network into the signature: solving once on a
    // cheap host and spending the answer across a proxy pool must not work.
    const service = serviceWith({ SIGNUP_POW_DIFFICULTY: DIFFICULTY });
    const issued = service.issue('203.0.113.0/24');
    const solution = encodePowSolution(issued.challenge, solve(issued.challenge, issued.difficulty));

    expect(service.verify(solution, '198.51.100.0/24')).toEqual({ ok: false, reason: 'invalid' });
  });

  it('rejects a nonce that does not meet the difficulty', () => {
    const service = serviceWith({ SIGNUP_POW_DIFFICULTY: DIFFICULTY });
    const network = '203.0.113.0/24';
    const issued = service.issue(network);
    const valid = solve(issued.challenge, issued.difficulty);

    expect(service.verify(encodePowSolution(issued.challenge, valid + 1), network)).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects a forged challenge as invalid rather than expired', () => {
    // An expired verdict earns a fresh challenge; a forgery must not be able to
    // ask for one by claiming to be old.
    const service = serviceWith({ SIGNUP_POW_DIFFICULTY: DIFFICULTY });
    const past = Math.floor(Date.now() / 1000) - 10;

    expect(service.verify(`${past}.salt.${'0'.repeat(64)}.7`, '203.0.113.0/24')).toEqual({
      ok: false,
      reason: 'invalid',
    });
  });

  it('rejects an expired challenge', () => {
    const service = serviceWith({
      SIGNUP_POW_DIFFICULTY: DIFFICULTY,
      SIGNUP_POW_TTL_SECONDS: '60',
    });
    const network = '203.0.113.0/24';
    const issued = service.issue(network);
    const solution = encodePowSolution(issued.challenge, solve(issued.challenge, issued.difficulty));

    expect(service.verify(solution, network, Date.now() + 61_000)).toEqual({
      ok: false,
      reason: 'expired',
    });
  });

  it('reports a missing solution separately from a malformed one', () => {
    const service = serviceWith({ SIGNUP_POW_DIFFICULTY: DIFFICULTY });

    expect(service.verify(undefined, 'n')).toEqual({ ok: false, reason: 'missing' });
    expect(service.verify('', 'n')).toEqual({ ok: false, reason: 'missing' });
    expect(service.verify('nonsense', 'n')).toEqual({ ok: false, reason: 'invalid' });
    expect(service.verify('a.b.c.notanumber', 'n')).toEqual({ ok: false, reason: 'invalid' });
  });

  describe('networkOf', () => {
    it('collapses IPv4 to a /24', () => {
      expect(SignupChallengeService.networkOf('203.0.113.42')).toBe('203.0.113.0/24');
      expect(SignupChallengeService.networkOf('203.0.113.7')).toBe('203.0.113.0/24');
    });

    it('collapses IPv6 to a /48, so one host cannot spend its whole /64', () => {
      expect(SignupChallengeService.networkOf('2001:db8:abcd:1234::1')).toBe('2001:db8:abcd::/48');
      expect(SignupChallengeService.networkOf('2001:db8:abcd:9999::ff')).toBe('2001:db8:abcd::/48');
    });

    it('unwraps IPv4-mapped IPv6', () => {
      expect(SignupChallengeService.networkOf('::ffff:203.0.113.42')).toBe('203.0.113.0/24');
    });

    it('expands compressed IPv6', () => {
      expect(SignupChallengeService.networkOf('2001:db8::1')).toBe('2001:db8:0::/48');
      expect(SignupChallengeService.networkOf('::1')).toBe('0:0:0::/48');
    });

    it('answers "unknown" rather than guessing', () => {
      expect(SignupChallengeService.networkOf(null)).toBe('unknown');
      expect(SignupChallengeService.networkOf('')).toBe('unknown');
      expect(SignupChallengeService.networkOf('not-an-address')).toBe('unknown');
    });

    it('refuses out-of-range octets instead of minting a bucket for them', () => {
      // With TRUST_PROXY on this value comes from a header. Every distinct
      // string it accepts is a fresh quota bucket, so garbage must collapse to
      // one rather than become an unlimited supply of them.
      expect(SignupChallengeService.networkOf('999.1.1.1')).toBe('unknown');
      expect(SignupChallengeService.networkOf('203.0.113.256')).toBe('unknown');
      expect(SignupChallengeService.networkOf('203.0.113')).toBe('unknown');
    });
  });

  describe('solution encoding', () => {
    it('round-trips a challenge that contains dots', () => {
      const challenge = '1234567890.abc.def';
      expect(decodePowSolution(encodePowSolution(challenge, 42))).toEqual({ challenge, nonce: 42 });
    });

    it('refuses a nonce that is not a plain number', () => {
      expect(decodePowSolution('a.b.-1')).toBeNull();
      expect(decodePowSolution('a.b.1e9')).toBeNull();
      expect(decodePowSolution('a.b.')).toBeNull();
      expect(decodePowSolution('nodots')).toBeNull();
    });
  });
});
