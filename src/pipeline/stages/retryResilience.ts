/* ------------------------------------------------------------------ */
/*  Retry Resilience – exponential backoff, jitter, circuit breaker  */
/*  Shared retry primitives for scene generation stages.             */
/* ------------------------------------------------------------------ */

import { createLogger } from '../../lib/logger.js';

const log = createLogger('RetryResilience');

/* ---- Exponential backoff with jitter ---- */

export interface BackoffOptions {
  /** Base delay in ms (default 2000). */
  baseDelayMs?: number;
  /** Maximum delay cap in ms (default 60_000). */
  maxDelayMs?: number;
  /** Jitter factor 0-1. 0.5 means ±50% random adjustment (default 0.3). */
  jitterFactor?: number;
}

/**
 * Compute the delay for a given retry attempt using exponential backoff + jitter.
 *
 * Formula: min(base * 2^attempt, maxDelay) ± jitter
 */
export function computeBackoffDelay(attempt: number, options?: BackoffOptions): number {
  const base = options?.baseDelayMs ?? 2000;
  const max = options?.maxDelayMs ?? 60_000;
  const jitter = options?.jitterFactor ?? 0.3;

  const exponential = Math.min(base * Math.pow(2, attempt), max);
  const jitterRange = exponential * jitter;
  const randomJitter = (Math.random() * 2 - 1) * jitterRange; // [-jitterRange, +jitterRange]

  return Math.max(0, Math.round(exponential + randomJitter));
}

/**
 * Sleep for a computed backoff duration. Returns the actual delay used.
 */
export async function sleepWithBackoff(attempt: number, options?: BackoffOptions): Promise<number> {
  const delay = computeBackoffDelay(attempt, options);
  log.info('backoff_sleep', { attempt, delayMs: delay });
  await new Promise(r => setTimeout(r, delay));
  return delay;
}

/* ---- Circuit Breaker ---- */

export type CircuitState = 'closed' | 'open' | 'half-open';

export interface CircuitBreakerOptions {
  /** Number of consecutive failures before opening circuit (default 3). */
  failureThreshold?: number;
  /** Time in ms before circuit transitions from open → half-open (default 30_000). */
  resetTimeoutMs?: number;
}

/**
 * Lightweight circuit breaker for external service calls.
 * Prevents cascading failures when a provider is consistently down.
 */
export class CircuitBreaker {
  private state: CircuitState = 'closed';
  private failureCount = 0;
  private lastFailureTime = 0;
  private successCount = 0;
  private readonly failureThreshold: number;
  private readonly resetTimeoutMs: number;
  readonly name: string;

  constructor(name: string, options?: CircuitBreakerOptions) {
    this.name = name;
    this.failureThreshold = options?.failureThreshold ?? 3;
    this.resetTimeoutMs = options?.resetTimeoutMs ?? 30_000;
  }

  /**
   * Check if the circuit allows a request.
   * Returns true if the circuit is closed or half-open (allowing a trial).
   */
  canExecute(): boolean {
    if (this.state === 'closed') return true;
    if (this.state === 'open') {
      // Check if reset timeout has elapsed → transition to half-open
      if (Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
        this.state = 'half-open';
        log.info('circuit_half_open', { name: this.name, failureCount: this.failureCount });
        return true;
      }
      return false;
    }
    // half-open: allow one trial request
    return true;
  }

  /** Record a successful operation. Resets the circuit to closed. */
  recordSuccess(): void {
    if (this.state === 'half-open') {
      log.info('circuit_closed', { name: this.name, priorFailures: this.failureCount });
    }
    this.failureCount = 0;
    this.successCount++;
    this.state = 'closed';
  }

  /** Record a failed operation. Opens circuit if threshold reached. */
  recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.failureThreshold) {
      this.state = 'open';
      log.warn('circuit_opened', { name: this.name, failureCount: this.failureCount, threshold: this.failureThreshold });
    }
  }

  /** Get current circuit state. */
  getState(): CircuitState {
    // Re-evaluate open → half-open based on time
    if (this.state === 'open' && Date.now() - this.lastFailureTime >= this.resetTimeoutMs) {
      this.state = 'half-open';
    }
    return this.state;
  }

  /** Get circuit stats for observability. */
  getStats(): { state: CircuitState; failureCount: number; successCount: number } {
    return {
      state: this.getState(),
      failureCount: this.failureCount,
      successCount: this.successCount,
    };
  }

  /** Reset the circuit to closed state (for testing or manual recovery). */
  reset(): void {
    this.failureCount = 0;
    this.successCount = 0;
    this.state = 'closed';
    this.lastFailureTime = 0;
  }
}

/* ---- Configurable retry budget ---- */

/**
 * Get the maximum retry count from environment or use default.
 * Reads SCENE_MAX_RETRIES env var (default: 2).
 */
export function getRetryBudget(): number {
  const env = process.env.SCENE_MAX_RETRIES;
  if (env) {
    const n = parseInt(env, 10);
    if (!isNaN(n) && n >= 0 && n <= 10) return n;
  }
  return 2;
}
