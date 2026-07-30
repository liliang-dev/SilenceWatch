import { RateLimiter } from './rate-limiter';

describe('RateLimiter', () => {
  it('allows up to the limit inside a window', () => {
    const limiter = new RateLimiter(3, 60_000);
    expect(limiter.hit('a', 1_000)).toBe(0);
    expect(limiter.hit('a', 1_001)).toBe(0);
    expect(limiter.hit('a', 1_002)).toBe(0);
    expect(limiter.hit('a', 1_003)).toBeGreaterThan(0);
  });

  it('reports a retry-after that expires with the window', () => {
    const limiter = new RateLimiter(1, 60_000);
    limiter.hit('a', 0);
    expect(limiter.hit('a', 30_000)).toBe(30);
    expect(limiter.hit('a', 60_000)).toBe(0);
  });

  it('keeps budgets independent per key', () => {
    const limiter = new RateLimiter(1, 60_000);
    expect(limiter.hit('a', 0)).toBe(0);
    expect(limiter.hit('b', 0)).toBe(0);
    expect(limiter.hit('a', 0)).toBeGreaterThan(0);
  });

  it('stays bounded when flooded with distinct keys', () => {
    const limiter = new RateLimiter(10, 60_000, 100);
    for (let index = 0; index < 5_000; index += 1) {
      limiter.hit(`key-${index}`, 1_000);
    }
    // The cap is what keeps a ping-URL scan from turning into unbounded memory.
    expect(limiter.size).toBeLessThanOrEqual(100);
  });

  it('reclaims expired windows before evicting live ones', () => {
    const limiter = new RateLimiter(1, 1_000, 10);
    for (let index = 0; index < 10; index += 1) limiter.hit(`old-${index}`, 0);
    limiter.hit('fresh', 5_000);
    expect(limiter.hit('fresh', 5_001)).toBeGreaterThan(0);
  });
});
