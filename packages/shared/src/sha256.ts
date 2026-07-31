/**
 * A synchronous SHA-256 over short ASCII strings.
 *
 * This exists for one reason, and it is a measured one rather than a
 * preference: `crypto.subtle.digest` is asynchronous, and awaiting a promise
 * per hash costs far more than the hash. Measured in Chromium over the inputs
 * this is used for, WebCrypto manages ~64 000 hashes per second while this
 * routine manages roughly twenty times that — the difference between a sign-up
 * challenge that costs a user a quarter of a second and one that freezes their
 * phone for four.
 *
 * Nothing secret is hashed here. The proof-of-work input is a public challenge
 * and a counter, so the usual objection to hand-written crypto in the browser —
 * side channels, key handling — does not apply. The server verifies with
 * `node:crypto`; `sha256.spec.ts` pins this implementation against it, and
 * against the NIST vectors, so the two cannot drift.
 */

const K = new Uint32Array([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
]);

/** Scratch space, reused across calls: allocation is most of the cost at this size. */
const W = new Uint32Array(64);
const H = new Uint32Array(8);

/**
 * Digest of a byte array. The buffer must already hold the message; length is
 * given separately so callers can reuse one oversized buffer.
 */
export function sha256Bytes(message: Uint8Array, length = message.length): Uint8Array {
  H[0] = 0x6a09e667;
  H[1] = 0xbb67ae85;
  H[2] = 0x3c6ef372;
  H[3] = 0xa54ff53a;
  H[4] = 0x510e527f;
  H[5] = 0x9b05688c;
  H[6] = 0x1f83d9ab;
  H[7] = 0x5be0cd19;

  // One 0x80 byte, then zeroes, then the bit length in the last eight bytes.
  const blocks = Math.ceil((length + 9) / 64);
  const padded = new Uint8Array(blocks * 64);
  padded.set(message.subarray(0, length));
  padded[length] = 0x80;

  const bits = length * 8;
  const view = new DataView(padded.buffer);
  // Messages here are far shorter than 2^32 bits, so the high word is zero.
  view.setUint32(padded.length - 4, bits >>> 0, false);
  view.setUint32(padded.length - 8, Math.floor(bits / 0x100000000), false);

  for (let block = 0; block < blocks; block += 1) {
    const offset = block * 64;

    for (let i = 0; i < 16; i += 1) {
      W[i] = view.getUint32(offset + i * 4, false);
    }
    for (let i = 16; i < 64; i += 1) {
      const a = W[i - 15] as number;
      const b = W[i - 2] as number;
      const s0 = ((a >>> 7) | (a << 25)) ^ ((a >>> 18) | (a << 14)) ^ (a >>> 3);
      const s1 = ((b >>> 17) | (b << 15)) ^ ((b >>> 19) | (b << 13)) ^ (b >>> 10);
      W[i] = ((W[i - 16] as number) + s0 + (W[i - 7] as number) + s1) >>> 0;
    }

    let a = H[0] as number;
    let b = H[1] as number;
    let c = H[2] as number;
    let d = H[3] as number;
    let e = H[4] as number;
    let f = H[5] as number;
    let g = H[6] as number;
    let h = H[7] as number;

    for (let i = 0; i < 64; i += 1) {
      const S1 = ((e >>> 6) | (e << 26)) ^ ((e >>> 11) | (e << 21)) ^ ((e >>> 25) | (e << 7));
      const ch = (e & f) ^ (~e & g);
      const temp1 = (h + S1 + ch + (K[i] as number) + (W[i] as number)) >>> 0;
      const S0 = ((a >>> 2) | (a << 30)) ^ ((a >>> 13) | (a << 19)) ^ ((a >>> 22) | (a << 10));
      const maj = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (S0 + maj) >>> 0;

      h = g;
      g = f;
      f = e;
      e = (d + temp1) >>> 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) >>> 0;
    }

    H[0] = (H[0] + a) >>> 0;
    H[1] = (H[1] + b) >>> 0;
    H[2] = (H[2] + c) >>> 0;
    H[3] = (H[3] + d) >>> 0;
    H[4] = (H[4] + e) >>> 0;
    H[5] = (H[5] + f) >>> 0;
    H[6] = (H[6] + g) >>> 0;
    H[7] = (H[7] + h) >>> 0;
  }

  const digest = new Uint8Array(32);
  const out = new DataView(digest.buffer);
  for (let i = 0; i < 8; i += 1) out.setUint32(i * 4, H[i] as number, false);
  return digest;
}

/**
 * Digest of a string.
 *
 * ASCII fast path, because the proof-of-work input is a base64url challenge and
 * a decimal counter; anything else falls back to a proper UTF-8 encode.
 */
export function sha256String(value: string): Uint8Array {
  const bytes = new Uint8Array(value.length);
  for (let i = 0; i < value.length; i += 1) {
    const code = value.charCodeAt(i);
    if (code > 0x7f) return sha256Bytes(new TextEncoder().encode(value));
    bytes[i] = code;
  }
  return sha256Bytes(bytes);
}

/** Lowercase hex, for tests and for anything that needs to print a digest. */
export function toHex(digest: Uint8Array): string {
  let hex = '';
  for (const byte of digest) hex += byte.toString(16).padStart(2, '0');
  return hex;
}
