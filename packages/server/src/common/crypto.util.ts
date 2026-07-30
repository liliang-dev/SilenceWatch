import { hash as argon2Hash, verify as argon2Verify, Algorithm } from '@node-rs/argon2';
import { createHmac, hkdfSync, randomBytes, timingSafeEqual } from 'node:crypto';
import { createHash } from 'node:crypto';

/**
 * Argon2id parameters follow the OWASP Password Storage Cheat Sheet
 * (m=19456 KiB, t=2, p=1). Raising them later is safe: stored hashes carry
 * their own parameters, and `needsRehash` reports outdated ones.
 */
const ARGON2_OPTIONS = {
  algorithm: Algorithm.Argon2id,
  memoryCost: 19_456,
  timeCost: 2,
  parallelism: 1,
} as const;

export async function hashPassword(password: string): Promise<string> {
  return argon2Hash(password, ARGON2_OPTIONS);
}

/** Constant-time password check. Never throws — a corrupt hash is a failed login. */
export async function verifyPassword(storedHash: string, password: string): Promise<boolean> {
  try {
    return await argon2Verify(storedHash, password);
  } catch {
    return false;
  }
}

/** True when a stored hash was produced with weaker parameters than current policy. */
export function needsRehash(storedHash: string): boolean {
  const match = /^\$argon2id\$v=19\$m=(\d+),t=(\d+),p=(\d+)/.exec(storedHash);
  if (!match) return true;
  const [, memory, time, parallelism] = match;
  return (
    Number(memory) < ARGON2_OPTIONS.memoryCost ||
    Number(time) < ARGON2_OPTIONS.timeCost ||
    Number(parallelism) !== ARGON2_OPTIONS.parallelism
  );
}

/**
 * Derives a purpose-bound key from the root secret. Distinct purposes cannot be
 * substituted for one another, so a signing key can never verify a webhook HMAC.
 */
export function deriveKey(secret: string, purpose: string, length = 32): Buffer {
  return Buffer.from(hkdfSync('sha256', secret, 'silencewatch', purpose, length));
}

/** URL-safe random token. 32 bytes = 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacSha256Hex(key: Buffer | string, payload: string): string {
  return createHmac('sha256', key).update(payload).digest('hex');
}

const HEX_ONLY = /^[0-9a-f]+$/;

/**
 * Constant-time comparison of two hex digests.
 *
 * The shape check matters: `Buffer.from('zz', 'hex')` silently yields an empty
 * buffer, which would make two invalid digests compare equal.
 */
export function timingSafeEqualHex(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) return false;
  if (!HEX_ONLY.test(a) || !HEX_ONLY.test(b)) return false;
  try {
    return timingSafeEqual(Buffer.from(a, 'hex'), Buffer.from(b, 'hex'));
  } catch {
    return false;
  }
}

/* ------------------------------------------------------------- api keys --- */

const API_KEY_PATTERN = /^sw_([0-9a-f]{16})_([A-Za-z0-9_-]{43})$/;

export interface GeneratedApiKey {
  /** Full secret shown to the user exactly once. */
  token: string;
  /** Public half, indexed, used to locate the row before verifying the secret. */
  lookupId: string;
  /** SHA-256 of the secret half — the secret has 256 bits of entropy, so a
   *  slow KDF would add cost without adding security. */
  secretHash: string;
  /** Safe-to-display prefix. */
  prefix: string;
}

export function generateApiKey(): GeneratedApiKey {
  const lookupId = randomBytes(8).toString('hex');
  const secret = randomBytes(32).toString('base64url');
  return {
    token: `sw_${lookupId}_${secret}`,
    lookupId,
    secretHash: sha256Hex(secret),
    prefix: `sw_${lookupId}`,
  };
}

export interface ParsedApiKey {
  lookupId: string;
  secretHash: string;
}

/** Parses a presented API key without leaking whether the secret half is valid. */
export function parseApiKey(token: string): ParsedApiKey | null {
  const match = API_KEY_PATTERN.exec(token);
  if (!match) return null;
  const [, lookupId, secret] = match;
  return { lookupId: lookupId as string, secretHash: sha256Hex(secret as string) };
}
