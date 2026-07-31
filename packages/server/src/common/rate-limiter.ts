/**
 * Fixed-window in-memory rate limiter.
 *
 * Deliberately not Redis: an extra service to run is an extra service to
 * monitor, which would be ironic for this product. Each instance limits
 * independently, so with N instances the effective ceiling is N × limit — fine
 * for the goal here (stopping a runaway job from hammering the database), and
 * the database keeps its own bounds anyway.
 *
 * Hot path: one Map lookup and no allocation on the common path.
 */
export class RateLimiter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly limit: number,
    private readonly windowMs: number,
    /** Upper bound on tracked keys; oldest entries are dropped past it. */
    private readonly maxKeys = 100_000,
  ) {}

  /** Records a hit. Returns 0 when allowed, or the retry-after delay in seconds. */
  hit(key: string, now = Date.now()): number {
    const window = this.windows.get(key);

    if (window === undefined || window.resetAt <= now) {
      if (this.windows.size >= this.maxKeys) this.evict(now);
      // Re-inserting moves the key to the end of the Map's iteration order,
      // which is what makes `evict` an approximate LRU.
      this.windows.delete(key);
      this.windows.set(key, { count: 1, resetAt: now + this.windowMs });
      return 0;
    }

    if (window.count >= this.limit) {
      return Math.max(1, Math.ceil((window.resetAt - now) / 1000));
    }

    window.count += 1;
    return 0;
  }

  /**
   * Whether a key has already spent its budget, without spending any more of
   * it. For callers that must decide *before* doing the expensive thing, and
   * that only charge the budget once they know the work was wasted.
   */
  exceeded(key: string, now = Date.now()): boolean {
    const window = this.windows.get(key);
    return window !== undefined && window.resetAt > now && window.count >= this.limit;
  }

  /** Number of tracked keys — exposed for diagnostics. */
  get size(): number {
    return this.windows.size;
  }

  reset(key?: string): void {
    if (key === undefined) this.windows.clear();
    else this.windows.delete(key);
  }

  private evict(now: number): void {
    for (const [key, window] of this.windows) {
      if (window.resetAt <= now) this.windows.delete(key);
    }
    // Still full: drop the least recently created windows.
    if (this.windows.size >= this.maxKeys) {
      const excess = this.windows.size - Math.floor(this.maxKeys * 0.9);
      let dropped = 0;
      for (const key of this.windows.keys()) {
        this.windows.delete(key);
        if (++dropped >= excess) break;
      }
    }
  }
}
