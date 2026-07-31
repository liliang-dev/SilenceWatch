import { createHash, randomBytes } from 'node:crypto';
import { countLeadingZeroBits, powInput } from './pow';
import { sha256Bytes, sha256String, toHex } from './sha256';

/**
 * This implementation exists so the browser can hash without awaiting a promise
 * per attempt. It is only safe to keep because it is pinned here: against the
 * published vectors, and against `node:crypto` — which is what the server
 * verifies with, and therefore the only opinion that counts.
 */
describe('sha256', () => {
  it('matches the published vectors', () => {
    expect(toHex(sha256String(''))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    );
    expect(toHex(sha256String('abc'))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(toHex(sha256String('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq'))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    );
  });

  it('agrees with node:crypto across every padding boundary', () => {
    // 55/56 and 119/120 are where the length field forces an extra block; an
    // off-by-one in the padding hides until exactly there.
    for (let length = 0; length <= 130; length += 1) {
      const input = 'a'.repeat(length);
      expect(toHex(sha256String(input))).toBe(createHash('sha256').update(input).digest('hex'));
    }
  });

  it('agrees with node:crypto on random binary input', () => {
    for (let trial = 0; trial < 200; trial += 1) {
      const bytes = randomBytes(1 + Math.floor(Math.random() * 200));
      expect(toHex(sha256Bytes(new Uint8Array(bytes)))).toBe(
        createHash('sha256').update(bytes).digest('hex'),
      );
    }
  });

  it('agrees with node:crypto on real proof-of-work input', () => {
    // The exact shape the solver hashes: a base64url challenge and a counter.
    for (let nonce = 0; nonce < 500; nonce += 1) {
      const input = powInput('1785500000.Ab3-_xYz9Q.deadbeef'.repeat(1), nonce);
      expect(toHex(sha256String(input))).toBe(createHash('sha256').update(input).digest('hex'));
    }
  });

  it('handles non-ASCII by falling off the fast path, not by corrupting it', () => {
    for (const input of ['héllo', '日本語', '🔥 emoji', 'mixed ascii and é']) {
      expect(toHex(sha256String(input))).toBe(createHash('sha256').update(input).digest('hex'));
    }
  });

  it('does not leak state between calls', () => {
    // The working buffers are module-level and reused; a missing reset would
    // make the second digest depend on the first.
    const first = toHex(sha256String('abc'));
    sha256String('a much longer message that spans more than a single block '.repeat(4));
    expect(toHex(sha256String('abc'))).toBe(first);
  });
});

describe('countLeadingZeroBits', () => {
  it('counts across byte boundaries', () => {
    expect(countLeadingZeroBits(new Uint8Array([0xff]))).toBe(0);
    expect(countLeadingZeroBits(new Uint8Array([0x7f]))).toBe(1);
    expect(countLeadingZeroBits(new Uint8Array([0x01]))).toBe(7);
    expect(countLeadingZeroBits(new Uint8Array([0x00, 0xff]))).toBe(8);
    expect(countLeadingZeroBits(new Uint8Array([0x00, 0x01]))).toBe(15);
    expect(countLeadingZeroBits(new Uint8Array([0x00, 0x00]))).toBe(16);
  });
});
