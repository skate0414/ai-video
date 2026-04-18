/* ------------------------------------------------------------------ */
/*  Tests for RateLimiter                                             */
/* ------------------------------------------------------------------ */
import { describe, it, expect, afterEach, vi } from 'vitest';
import { RateLimiter } from './rateLimiter.js';

describe('RateLimiter', () => {
  const instances: RateLimiter[] = [];
  function create(max: number, windowMs: number) {
    const rl = new RateLimiter({ max, windowMs });
    instances.push(rl);
    return rl;
  }
  afterEach(() => {
    instances.forEach((rl) => rl.destroy());
    instances.length = 0;
  });

  it('allows requests up to the limit', () => {
    const rl = create(3, 60_000);
    expect(rl.consume('a').allowed).toBe(true);
    expect(rl.consume('a').allowed).toBe(true);
    expect(rl.consume('a').allowed).toBe(true);
    expect(rl.consume('a').allowed).toBe(false);
  });

  it('returns correct remaining count', () => {
    const rl = create(5, 60_000);
    expect(rl.consume('a').remaining).toBe(4);
    expect(rl.consume('a').remaining).toBe(3);
    expect(rl.consume('a').remaining).toBe(2);
    expect(rl.consume('a').remaining).toBe(1);
    expect(rl.consume('a').remaining).toBe(0);
    // Next call is blocked
    const blocked = rl.consume('a');
    expect(blocked.allowed).toBe(false);
    expect(blocked.remaining).toBe(0);
    expect(blocked.retryAfterMs).toBeGreaterThan(0);
  });

  it('isolates keys from each other', () => {
    const rl = create(2, 60_000);
    rl.consume('alice');
    rl.consume('alice');
    expect(rl.consume('alice').allowed).toBe(false);
    // Bob should still have quota
    expect(rl.consume('bob').allowed).toBe(true);
  });

  it('provides retryAfterMs when blocked', () => {
    const rl = create(1, 10_000);
    rl.consume('a');
    const result = rl.consume('a');
    expect(result.allowed).toBe(false);
    expect(result.retryAfterMs).toBeGreaterThan(0);
    expect(result.retryAfterMs).toBeLessThanOrEqual(10_000);
  });

  it('recovers after window expires', async () => {
    // Use a tiny window
    const rl = create(1, 50); // 50ms window
    rl.consume('a');
    expect(rl.consume('a').allowed).toBe(false);
    // Wait for window to pass
    await new Promise((r) => setTimeout(r, 60));
    expect(rl.consume('a').allowed).toBe(true);
  });

  it('destroy clears all state', () => {
    const rl = create(5, 60_000);
    rl.consume('a');
    rl.destroy();
    // After destroy, buckets are cleared; new consume should work
    // (we use a fresh consume since destroy cleared state)
    // Note: destroy only clears — the instance is still usable
    expect(rl.consume('a').remaining).toBe(4);
  });

  it('sweep removes stale buckets after interval', () => {
    vi.useFakeTimers();
    try {
      const rl = create(2, 1_000); // 1s window
      rl.consume('stale-client');
      rl.consume('stale-client');

      // Advance time beyond the window
      vi.advanceTimersByTime(2_000);
      // Trigger the sweep interval (60s default)
      vi.advanceTimersByTime(60_000);

      // After sweep, the stale bucket should be cleaned; consuming is allowed again
      expect(rl.consume('stale-client').allowed).toBe(true);
    } finally {
      vi.useRealTimers();
    }
  });
});
