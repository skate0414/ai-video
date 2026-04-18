import { describe, expect, it, vi, afterEach } from 'vitest';
import { computeBackoffDelay, CircuitBreaker, getRetryBudget } from './retryResilience.js';

describe('computeBackoffDelay', () => {
  it('returns base delay for attempt 0', () => {
    // With jitter=0, should be exactly base
    const delay = computeBackoffDelay(0, { baseDelayMs: 1000, jitterFactor: 0 });
    expect(delay).toBe(1000);
  });

  it('doubles delay for each attempt', () => {
    const d0 = computeBackoffDelay(0, { baseDelayMs: 1000, jitterFactor: 0 });
    const d1 = computeBackoffDelay(1, { baseDelayMs: 1000, jitterFactor: 0 });
    const d2 = computeBackoffDelay(2, { baseDelayMs: 1000, jitterFactor: 0 });
    expect(d0).toBe(1000);
    expect(d1).toBe(2000);
    expect(d2).toBe(4000);
  });

  it('caps at maxDelay', () => {
    const delay = computeBackoffDelay(20, { baseDelayMs: 1000, maxDelayMs: 5000, jitterFactor: 0 });
    expect(delay).toBe(5000);
  });

  it('applies jitter within range', () => {
    const delays = new Set<number>();
    for (let i = 0; i < 50; i++) {
      delays.add(computeBackoffDelay(0, { baseDelayMs: 1000, jitterFactor: 0.5 }));
    }
    // With jitter=0.5, delays should be between 500 and 1500
    for (const d of delays) {
      expect(d).toBeGreaterThanOrEqual(500);
      expect(d).toBeLessThanOrEqual(1500);
    }
    // Should have some variation
    expect(delays.size).toBeGreaterThan(1);
  });

  it('uses default options when none provided', () => {
    const delay = computeBackoffDelay(0);
    // Default base is 2000, jitter 0.3, so range is [1400, 2600]
    expect(delay).toBeGreaterThanOrEqual(1400);
    expect(delay).toBeLessThanOrEqual(2600);
  });

  it('never returns negative', () => {
    for (let i = 0; i < 100; i++) {
      expect(computeBackoffDelay(0, { baseDelayMs: 100, jitterFactor: 1 })).toBeGreaterThanOrEqual(0);
    }
  });
});

describe('CircuitBreaker', () => {
  it('starts in closed state', () => {
    const cb = new CircuitBreaker('test');
    expect(cb.getState()).toBe('closed');
    expect(cb.canExecute()).toBe(true);
  });

  it('opens after failure threshold', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 3 });
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    expect(cb.canExecute()).toBe(false);
  });

  it('resets to closed on success', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 2 });
    cb.recordFailure();
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
    expect(cb.getStats().failureCount).toBe(0);
  });

  it('transitions to half-open after timeout', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1, resetTimeoutMs: 100 });
    cb.recordFailure();
    expect(cb.getState()).toBe('open');

    // Simulate time passing
    vi.useFakeTimers();
    vi.advanceTimersByTime(150);
    expect(cb.getState()).toBe('half-open');
    expect(cb.canExecute()).toBe(true);
    vi.useRealTimers();
  });

  it('closes from half-open on success', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1, resetTimeoutMs: 0 });
    cb.recordFailure();
    // resetTimeout=0 means immediately half-open
    expect(cb.canExecute()).toBe(true); // half-open allows trial
    cb.recordSuccess();
    expect(cb.getState()).toBe('closed');
  });

  it('tracks success count', () => {
    const cb = new CircuitBreaker('test');
    cb.recordSuccess();
    cb.recordSuccess();
    expect(cb.getStats().successCount).toBe(2);
  });

  it('reset clears all state', () => {
    const cb = new CircuitBreaker('test', { failureThreshold: 1 });
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
    cb.reset();
    expect(cb.getState()).toBe('closed');
    expect(cb.getStats().failureCount).toBe(0);
    expect(cb.getStats().successCount).toBe(0);
  });

  it('uses default options', () => {
    const cb = new CircuitBreaker('default-test');
    // Default threshold is 3
    cb.recordFailure();
    cb.recordFailure();
    expect(cb.getState()).toBe('closed');
    cb.recordFailure();
    expect(cb.getState()).toBe('open');
  });
});

describe('getRetryBudget', () => {
  const originalEnv = process.env.SCENE_MAX_RETRIES;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.SCENE_MAX_RETRIES;
    } else {
      process.env.SCENE_MAX_RETRIES = originalEnv;
    }
  });

  it('returns 2 when no env var set', () => {
    delete process.env.SCENE_MAX_RETRIES;
    expect(getRetryBudget()).toBe(2);
  });

  it('returns env value when valid', () => {
    process.env.SCENE_MAX_RETRIES = '5';
    expect(getRetryBudget()).toBe(5);
  });

  it('returns 2 for invalid env value', () => {
    process.env.SCENE_MAX_RETRIES = 'abc';
    expect(getRetryBudget()).toBe(2);
  });

  it('returns 2 for out-of-range value', () => {
    process.env.SCENE_MAX_RETRIES = '20';
    expect(getRetryBudget()).toBe(2);
  });

  it('allows 0 retries', () => {
    process.env.SCENE_MAX_RETRIES = '0';
    expect(getRetryBudget()).toBe(0);
  });
});
