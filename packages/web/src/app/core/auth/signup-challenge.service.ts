import { HttpClient } from '@angular/common/http';
import { Injectable, inject } from '@angular/core';
import {
  countLeadingZeroBits,
  encodePowSolution,
  powInput,
  sha256String,
  POW_MAX_ITERATIONS,
  type SignupChallengeDto,
} from '@silencewatch/shared';
import { firstValueFrom } from 'rxjs';

/**
 * Solves the sign-up challenge, when the instance asks for one.
 *
 * The search runs in a worker. On a desktop the work is a few hundred
 * milliseconds and could pass unnoticed on the main thread, but the same
 * difficulty on a four-year-old phone is several seconds — long enough to
 * freeze the form, drop the user's taps and look exactly like a crash. The
 * worker is same-origin, which is what keeps it inside `default-src 'self'`.
 *
 * A self-hosted instance answers `difficulty: 0` and none of this runs.
 */
@Injectable({ providedIn: 'root' })
export class SignupChallengeService {
  private readonly http = inject(HttpClient);

  /**
   * Fetches a challenge and returns the solution to submit, or `undefined` when
   * this instance does not ask for one.
   *
   * Failures are swallowed: if the challenge endpoint is unreachable, letting
   * the registration proceed without a solution puts the decision back on the
   * server, which is the only place that knows whether one was required.
   */
  async solve(onProgress?: (fraction: number) => void): Promise<string | undefined> {
    const challenge = await firstValueFrom(
      this.http.get<SignupChallengeDto>('/api/auth/signup-challenge'),
    ).catch(() => null);

    if (challenge === null || challenge.difficulty === 0 || challenge.challenge === '') {
      return undefined;
    }

    const nonce = await this.search(challenge, onProgress);
    return nonce === null ? undefined : encodePowSolution(challenge.challenge, nonce);
  }

  private search(
    challenge: SignupChallengeDto,
    onProgress?: (fraction: number) => void,
  ): Promise<number | null> {
    if (typeof Worker === 'undefined') return solveInline(challenge);

    return new Promise<number | null>((resolve) => {
      const worker = new Worker(new URL('./pow.worker', import.meta.url), { type: 'module' });
      const settle = (nonce: number | null): void => {
        worker.terminate();
        resolve(nonce);
      };

      worker.onmessage = ({ data }: MessageEvent<PowWorkerMessage>) => {
        if (data.type === 'progress') onProgress?.(data.fraction);
        else settle(data.nonce);
      };
      // A worker that fails to start must not strand the form: fall back to the
      // main thread rather than leaving the promise pending forever.
      worker.onerror = () => {
        worker.terminate();
        void solveInline(challenge).then(resolve);
      };

      worker.postMessage({
        challenge: challenge.challenge,
        difficulty: challenge.difficulty,
      } satisfies PowWorkerRequest);
    });
  }
}

export interface PowWorkerRequest {
  challenge: string;
  difficulty: number;
}

export type PowWorkerMessage =
  | { type: 'progress'; fraction: number }
  | { type: 'done'; nonce: number | null };

/**
 * Main-thread fallback, for the rare environment with no worker. Same helpers as
 * the worker, so the two cannot disagree about what a valid solution is — and
 * still synchronous, because this path is the one that would visibly freeze.
 */
export function solveInline(challenge: {
  challenge: string;
  difficulty: number;
}): Promise<number | null> {
  for (let nonce = 0; nonce < POW_MAX_ITERATIONS; nonce += 1) {
    if (countLeadingZeroBits(sha256String(powInput(challenge.challenge, nonce))) >= challenge.difficulty) {
      return Promise.resolve(nonce);
    }
  }
  return Promise.resolve(null);
}
