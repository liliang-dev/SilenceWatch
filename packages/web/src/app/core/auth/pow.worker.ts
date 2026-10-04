/// <reference lib="webworker" />

import { countLeadingZeroBits, powInput, sha256String, POW_MAX_ITERATIONS } from '@silencewatch/shared';
import type { PowWorkerMessage, PowWorkerRequest } from './signup-challenge.service';

/**
 * Searches for a nonce satisfying the sign-up challenge.
 *
 * Off the main thread on purpose: a difficulty that costs a laptop a fraction of
 * a second costs an old phone several, and a frozen sign-up form is
 * indistinguishable from a broken one.
 *
 * The hash is the synchronous implementation from the shared package rather than
 * `crypto.subtle`. That is a measured choice: awaiting a promise per attempt
 * caps Chromium at roughly 64 000 hashes per second, which would put an honest
 * user at four seconds for a difficulty an attacker clears in milliseconds. See
 * `sha256.ts`.
 */

/** Hashes between progress messages. Small enough to stay responsive. */
const PROGRESS_EVERY = 20_000;

addEventListener('message', ({ data }: MessageEvent<PowWorkerRequest>) => {
  solve(data);
});

function solve({ challenge, difficulty }: PowWorkerRequest): void {
  // Expected attempts is 2^difficulty; the search is memoryless, so this is a
  // rough position rather than a promise, and the UI treats it as one.
  const expected = 2 ** difficulty;

  for (let nonce = 0; nonce < POW_MAX_ITERATIONS; nonce += 1) {
    if (countLeadingZeroBits(sha256String(powInput(challenge, nonce))) >= difficulty) {
      post({ type: 'done', nonce });
      return;
    }

    if (nonce % PROGRESS_EVERY === 0 && nonce > 0) {
      post({ type: 'progress', fraction: Math.min(0.99, nonce / expected) });
    }
  }

  post({ type: 'done', nonce: null });
}

function post(message: PowWorkerMessage): void {
  postMessage(message);
}
