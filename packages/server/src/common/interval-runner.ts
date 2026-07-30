import { Logger } from '@nestjs/common';
import type { SchedulerRegistry } from '@nestjs/schedule';

/**
 * A repeating background task with the three properties every loop in this
 * server needs:
 *
 *  - **no overlap**: a slow tick is skipped rather than queued, so a database
 *    hiccup cannot pile up concurrent scans;
 *  - **no crash**: a failing tick is logged and the loop survives, because a
 *    dead detection loop is the one failure this product cannot have;
 *  - **observable**: tick counters and the last error feed /health.
 *
 * Intervals are registered with Nest's SchedulerRegistry so shutdown disposes
 * of them with everything else.
 */
export class IntervalRunner {
  private readonly logger: Logger;
  private timer: NodeJS.Timeout | null = null;
  /** The tick currently in flight, if any. */
  private current: Promise<void> | null = null;

  private ticks = 0;
  private failures = 0;
  private skipped = 0;
  private lastError: string | null = null;
  private lastSuccessAt: Date | null = null;

  constructor(
    private readonly name: string,
    private readonly intervalMs: number,
    private readonly task: () => Promise<void>,
    private readonly registry?: SchedulerRegistry,
  ) {
    this.logger = new Logger(name);
  }

  start(): void {
    if (this.timer !== null) return;
    this.timer = setInterval(() => void this.run(), this.intervalMs);
    // Never hold the event loop open on its own account.
    this.timer.unref();
    this.registry?.addInterval(this.name, this.timer);
    this.logger.log(`Started (every ${this.intervalMs}ms)`);
  }

  stop(): void {
    if (this.timer === null) return;
    clearInterval(this.timer);
    if (this.registry?.doesExist('interval', this.name)) this.registry.deleteInterval(this.name);
    this.timer = null;
  }

  /**
   * Runs one tick. Concurrent callers join the tick already in flight instead of
   * starting a second one, so awaiting the result always means "a tick finished".
   */
  run(): Promise<void> {
    const inFlight = this.current;
    if (inFlight !== null) {
      this.skipped += 1;
      this.logger.debug(`Tick already running, joining it (${this.skipped} joined so far)`);
      return inFlight;
    }

    const tick = this.execute().finally(() => {
      this.current = null;
    });
    this.current = tick;
    return tick;
  }

  /** Resolves once no tick is in flight. */
  async settle(): Promise<void> {
    while (this.current !== null) await this.current;
  }

  private async execute(): Promise<void> {
    const startedAt = Date.now();
    try {
      await this.task();
      this.ticks += 1;
      this.lastSuccessAt = new Date();
      this.lastError = null;
    } catch (error) {
      this.failures += 1;
      this.lastError = (error as Error).message;
      this.logger.error(`Tick failed: ${this.lastError}`, (error as Error).stack);
    } finally {
      const elapsed = Date.now() - startedAt;
      if (elapsed > this.intervalMs) {
        this.logger.warn(`Tick took ${elapsed}ms, longer than its ${this.intervalMs}ms interval`);
      }
    }
  }

  health(): {
    name: string;
    intervalMs: number;
    ticks: number;
    failures: number;
    skipped: number;
    lastError: string | null;
    lastSuccessAt: string | null;
  } {
    return {
      name: this.name,
      intervalMs: this.intervalMs,
      ticks: this.ticks,
      failures: this.failures,
      skipped: this.skipped,
      lastError: this.lastError,
      lastSuccessAt: this.lastSuccessAt?.toISOString() ?? null,
    };
  }
}
