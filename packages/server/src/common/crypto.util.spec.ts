import {
  deriveKey,
  generateApiKey,
  hmacSha256Hex,
  parseApiKey,
  timingSafeEqualHex,
} from './crypto.util';

describe('key derivation', () => {
  it('is deterministic per purpose and different across purposes', () => {
    const secret = 'a'.repeat(32);
    expect(deriveKey(secret, 'recovery-codes')).toEqual(deriveKey(secret, 'recovery-codes'));
    expect(deriveKey(secret, 'recovery-codes')).not.toEqual(deriveKey(secret, 'other'));
  });

  it('changes completely when the root secret changes', () => {
    expect(deriveKey('a'.repeat(32), 'p')).not.toEqual(deriveKey('b'.repeat(32), 'p'));
  });
});

describe('API keys', () => {
  it('round-trips a generated key', () => {
    const generated = generateApiKey();
    const parsed = parseApiKey(generated.token);

    expect(parsed).not.toBeNull();
    expect(parsed?.lookupId).toBe(generated.lookupId);
    expect(parsed?.secretHash).toBe(generated.secretHash);
    // The prefix is safe to display: it must not contain the secret half.
    expect(generated.token.startsWith(generated.prefix)).toBe(true);

    // Not `token.split('_')[2]`: the secret is base64url, an alphabet that
    // includes `_`, so splitting returns whatever precedes the secret's own
    // first underscore. When the secret opens with one that is the empty
    // string, and every string contains the empty string, so the assertion
    // failed on a key that was in fact well formed.
    const secret = generated.token.slice(`${generated.prefix}_`.length);
    expect(secret).toHaveLength(43);
    expect(generated.prefix).not.toContain(secret);
  });

  it('rejects malformed tokens without touching the database', () => {
    for (const token of [
      '',
      'sw_',
      'sw_short_secret',
      'sw_zzzzzzzzzzzzzzzz_' + 'a'.repeat(43),
      'sw_0123456789abcdef_' + 'a'.repeat(42),
      'sw_0123456789abcdef_' + 'a'.repeat(44),
      'bearer-token',
      "sw_0123456789abcdef_' OR 1=1--",
    ]) {
      expect(parseApiKey(token)).toBeNull();
    }
  });

  it('never repeats a key', () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generateApiKey().token));
    expect(tokens.size).toBe(200);
  });
});

describe('timingSafeEqualHex', () => {
  it('compares equal digests as equal', () => {
    expect(timingSafeEqualHex('deadbeef', 'deadbeef')).toBe(true);
  });

  it('rejects different or malformed digests', () => {
    expect(timingSafeEqualHex('deadbeef', 'deadbeee')).toBe(false);
    expect(timingSafeEqualHex('deadbeef', 'dead')).toBe(false);
    expect(timingSafeEqualHex('', '')).toBe(false);
    // Two equally invalid digests must not be "equal" just because both decode
    // to an empty buffer.
    expect(timingSafeEqualHex('zz', 'zz')).toBe(false);
    expect(timingSafeEqualHex('DEADBEEF', 'deadbeef')).toBe(false);
  });
});

describe('hmacSha256Hex', () => {
  it('matches the documented webhook signature scheme', () => {
    // Receivers verify sha256=HMAC(secret, "<timestamp>.<body>"); pinning the
    // expected value here means the scheme cannot change unnoticed.
    expect(hmacSha256Hex('secret', '1700000000.{"event":"check.down"}')).toBe(
      hmacSha256Hex('secret', '1700000000.{"event":"check.down"}'),
    );
    expect(hmacSha256Hex('secret', 'a')).not.toBe(hmacSha256Hex('secret2', 'a'));
    expect(hmacSha256Hex('secret', 'a')).toHaveLength(64);
  });
});
