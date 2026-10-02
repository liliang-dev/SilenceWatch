import { Logger } from '@nestjs/common';

/**
 * Two questions a "the site froze for a few minutes" report cannot answer
 * after the fact, and both are answered by a log line written while it happens:
 *
 *  - **Was this process stalled?** A Node server that blocked its own event loop
 *    stops answering everything at once and recovers by itself, which looks
 *    exactly like a network fault from outside. A loop that kept turning on
 *    time while users waited points at what is *around* the process instead —
 *    the proxy, the overlay network, the database, the host.
 *  - **Which request was slow?** Named by route pattern, never by URL: heartbeat
 *    URLs are secrets, and this must not put them in a log.
 *
 * Silent when nothing is wrong, so it costs a line per incident and nothing else.
 */

export interface EventLoopMonitorOptions {
  /** How often the loop is sampled. */
  readonly intervalMs: number;
  /** How late a sample has to be before it is worth a warning. */
  readonly warnAfterMs: number;
}

export class EventLoopLagMonitor {
  private readonly logger = new Logger('RuntimeWatch');
  private timer: NodeJS.Timeout | null = null;
  private last: number;

  constructor(
    private readonly options: EventLoopMonitorOptions = { intervalMs: 1_000, warnAfterMs: 500 },
    private readonly now: () => number = Date.now,
  ) {
    this.last = this.now();
  }

  start(): void {
    if (this.timer !== null) return;
    this.last = this.now();
    this.timer = setInterval(() => this.tick(), this.options.intervalMs);
    // Never the reason the process stays alive.
    this.timer.unref();
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * One sample: how much later than scheduled did this run? Returns the lag, so
   * a test can drive it without waiting on a real timer.
   */
  tick(): number {
    const at = this.now();
    const lag = Math.max(0, at - this.last - this.options.intervalMs);
    this.last = at;

    if (lag >= this.options.warnAfterMs) {
      this.logger.warn(
        `Event loop was blocked for ${Math.round(lag)}ms — every request in flight waited for it`,
      );
    }
    return lag;
  }
}

interface RequestLike {
  readonly method: string;
  readonly routeOptions?: { readonly url?: string | undefined };
}

interface ReplyLike {
  readonly statusCode: number;
  readonly elapsedTime: number;
}

interface HookableFastify {
  addHook(
    name: 'onResponse',
    hook: (request: RequestLike, reply: ReplyLike) => Promise<void> | void,
  ): unknown;
}

/** Warns, once per request, about any that took `thresholdMs` or more. */
export function registerSlowRequestLog(
  fastify: HookableFastify,
  thresholdMs = 2_000,
  logger: Pick<Logger, 'warn'> = new Logger('RuntimeWatch'),
): void {
  fastify.addHook('onResponse', (request, reply) => {
    if (reply.elapsedTime < thresholdMs) return;

    // The route as declared (`/p/:token`), not the URL as requested.
    const route = request.routeOptions?.url ?? '(no route)';
    logger.warn(
      `Slow request: ${request.method} ${route} took ${Math.round(reply.elapsedTime)}ms ` +
        `(status ${reply.statusCode})`,
    );
  });
}
