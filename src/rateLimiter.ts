/* ------------------------------------------------------------------ */
/*  RateLimiter – sliding-window per-IP rate limiter (zero-dep)       */
/* ------------------------------------------------------------------ */

export interface RateLimitConfig {
  /** Maximum number of requests allowed within the window. */
  max: number;
  /** Window size in milliseconds. */
  windowMs: number;
}

interface BucketEntry {
  timestamps: number[];
}

/**
 * In-memory sliding-window rate limiter.
 *
 * - Each key (e.g. IP address) has its own bucket.
 * - Old entries are pruned on every check.
 * - A background sweep removes stale buckets every 60 s to prevent memory leaks.
 */
export class RateLimiter {
  private readonly buckets = new Map<string, BucketEntry>();
  private readonly sweepInterval: ReturnType<typeof setInterval>;

  constructor(private readonly config: RateLimitConfig) {
    // Periodic cleanup of expired buckets
    this.sweepInterval = setInterval(() => this.sweep(), 60_000);
    this.sweepInterval.unref(); // don't prevent process exit
  }

  /**
   * Check whether the key is allowed, and consume one token if so.
   * Returns { allowed, remaining, retryAfterMs }.
   */
  consume(key: string): { allowed: boolean; remaining: number; retryAfterMs: number } {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;

    let bucket = this.buckets.get(key);
    if (!bucket) {
      bucket = { timestamps: [] };
      this.buckets.set(key, bucket);
    }

    // Prune timestamps outside the window
    bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);

    if (bucket.timestamps.length >= this.config.max) {
      // Oldest timestamp still in window → retry after it expires
      const oldest = bucket.timestamps[0]!;
      const retryAfterMs = oldest + this.config.windowMs - now;
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(retryAfterMs, 1),
      };
    }

    bucket.timestamps.push(now);
    return {
      allowed: true,
      remaining: this.config.max - bucket.timestamps.length,
      retryAfterMs: 0,
    };
  }

  /** Remove buckets with no recent activity. */
  private sweep(): void {
    const now = Date.now();
    const windowStart = now - this.config.windowMs;
    for (const [key, bucket] of this.buckets) {
      bucket.timestamps = bucket.timestamps.filter((t) => t > windowStart);
      if (bucket.timestamps.length === 0) {
        this.buckets.delete(key);
      }
    }
  }

  /** Cleanup (for tests). */
  destroy(): void {
    clearInterval(this.sweepInterval);
    this.buckets.clear();
  }
}
