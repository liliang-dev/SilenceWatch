/**
 * Sign-up proof of work — the parts the browser and the server must agree on.
 *
 * The rule is deliberately tiny: find a nonce such that
 * `SHA-256("<challenge>.<nonce>")` starts with `difficulty` zero bits. Both
 * sides live here so a solver and a verifier cannot quietly drift apart, and so
 * neither needs a dependency to do it — the browser has WebCrypto, Node has
 * `node:crypto`, and the only shared code is the arithmetic between them.
 *
 * What this buys, and what it does not, is written up in
 * `docs/abuse-prevention.md`. In short: it prices an account in CPU seconds,
 * which ruins mass registration and barely registers for one honest signup.
 */

/** Upper bound accepted by the verifier — beyond this, honest phones suffer. */
export const POW_MAX_DIFFICULTY = 26;

/** Ceiling on the nonce search, so a hopeless client stops instead of hanging. */
export const POW_MAX_ITERATIONS = 40_000_000;

/** The exact bytes that get hashed. The only definition of it there is. */
export function powInput(challenge: string, nonce: number): string {
  return `${challenge}.${nonce}`;
}

/** `"<challenge>.<nonce>"`, the wire form of a solution. */
export function encodePowSolution(challenge: string, nonce: number): string {
  return `${challenge}.${nonce}`;
}

/**
 * Splits a submitted solution back into its parts.
 *
 * The challenge itself contains dots, so the split is on the *last* one — the
 * nonce is the only field that cannot contain a separator.
 */
export function decodePowSolution(
  solution: string,
): { challenge: string; nonce: number } | null {
  const cut = solution.lastIndexOf('.');
  if (cut <= 0 || cut === solution.length - 1) return null;

  const nonceText = solution.slice(cut + 1);
  if (!/^\d{1,12}$/.test(nonceText)) return null;

  return { challenge: solution.slice(0, cut), nonce: Number(nonceText) };
}

/**
 * Number of leading zero bits in a digest.
 *
 * Bits rather than hex characters: difficulty then moves in factors of two
 * instead of sixteen, which is the difference between "tune this" and "pick one
 * of three".
 */
export function countLeadingZeroBits(digest: Uint8Array): number {
  let bits = 0;
  for (const byte of digest) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    // Math.clz32 counts over 32 bits; the byte occupies the low 8 of them.
    return bits + (Math.clz32(byte) - 24);
  }
  return bits;
}

/** Whether a digest satisfies the difficulty. */
export function digestMeetsDifficulty(digest: Uint8Array, difficulty: number): boolean {
  return countLeadingZeroBits(digest) >= difficulty;
}

/**
 * Expected number of hashes for a given difficulty — used by the UI to decide
 * whether to say anything to the user at all, and by the docs to keep the
 * difficulty recommendations honest rather than vibes.
 */
export function expectedPowAttempts(difficulty: number): number {
  return 2 ** difficulty;
}
