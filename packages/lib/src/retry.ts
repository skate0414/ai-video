/* ------------------------------------------------------------------ */
/*  retry – unified withRetry + isQuotaError for API adapters          */
/*                                                                     */
/*  Extracted from geminiAdapter.ts / aivideomakerAdapter.ts which     */
/*  used to carry near-identical retry loops. Using this helper keeps  */
/*  429 / 5xx back-off behaviour consistent across every adapter and   */
/*  makes quota-error tagging a single source of truth.                */
/* ------------------------------------------------------------------ */

import { throwIfAborted, waitWithAbort } from './abortable.js';
import type { RetryRequestOptions } from './retry.types.js';
import { createLogger, type Logger } from './logger.js';

/**
 * Max retry attempts for API calls (Gemini, etc).  Mirrors the
 * `API_MAX_RETRIES` constant at `src/constants.ts` but is read here
 * directly so `@ai-video/lib` has zero dependency on the host
 * application's `constants.ts` after the C-2 split.
 */
const API_MAX_RETRIES = Number(process.env.API_MAX_RETRIES ?? 3);

const defaultLog = createLogger('retry');

/* ------------------------------------------------------------------ */
/*  Retry observers                                                    */
/*                                                                     */
/*  Long-lived listeners (e.g. Prometheus counters) subscribe via      */
/*  registerRetryObserver instead of having to thread an `onRetry`     */
/*  callback through every call site.  Keeps @ai-video/lib free of    */
/*  pipeline / observability imports while still letting the host     */
/*  observe back-off events for its own counters.                      */
/* ------------------------------------------------------------------ */

export interface RetryObservation {
  label: string;
  attempt: number;
  maxRetries: number;
  delayMs: number;
  reason: string | undefined;
  err: unknown;
}

export type RetryObserver = (obs: RetryObservation) => void;

const retryObservers = new Set<RetryObserver>();

/** Subscribe to every retry attempt. Returns an unsubscribe function. */
export function registerRetryObserver(observer: RetryObserver): () => void {
  retryObservers.add(observer);
  return () => {
    retryObservers.delete(observer);
  };
}

/** Test helper. */
export function clearRetryObservers(): void {
  retryObservers.clear();
}

function notifyRetryObservers(obs: RetryObservation): void {
  for (const observer of retryObservers) {
    try {
      observer(obs);
    } catch {
      // Observers must never break the retry loop.
    }
  }
}

/* ------------------------------------------------------------------ */
/*  Quota / transient error detection                                  */
/* ------------------------------------------------------------------ */

const QUOTA_MESSAGE_RE = /quota|rate limit|resource_exhausted|usage cap|free plan limit|too many requests|you've reached|请求过于频繁|已达到.*使用上限/i;

/**
 * True when the error looks like a provider quota / rate-limit error.
 * Recognises HTTP 429, common message phrases in English and Chinese,
 * and explicit `isQuotaError` tags set upstream.
 */
export function isQuotaError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { isQuotaError?: unknown; status?: unknown; message?: unknown };
  if (e.isQuotaError) return true;
  if (e.status === 429) return true;
  const msg = typeof e.message === 'string' ? e.message : '';
  return QUOTA_MESSAGE_RE.test(msg);
}

/** Mutates `err` to set `isQuotaError = true` when it looks like a quota error. */
export function tagIfQuota(err: unknown): void {
  if (err && typeof err === 'object' && isQuotaError(err)) {
    (err as { isQuotaError?: boolean }).isQuotaError = true;
  }
}

/** HTTP status ∈ {429, 500, 502, 503, 504} or network errors are retriable by default. */
export function isTransient(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: unknown; message?: unknown; code?: unknown };
  if (e.status === 429 || e.status === 500 || e.status === 502 || e.status === 503 || e.status === 504) {
    return true;
  }
  const msg = typeof e.message === 'string' ? e.message : '';
  if (/\b(429|500|502|503|504)\b|rate limit|ETIMEDOUT|ECONNRESET|ECONNREFUSED|ENOTFOUND/.test(msg)) {
    return true;
  }
  const code = e.code;
  if (typeof code === 'string' && ['ETIMEDOUT', 'ECONNRESET', 'ECONNREFUSED', 'EAI_AGAIN', 'ENOTFOUND'].includes(code)) {
    return true;
  }
  return false;
}

/* ------------------------------------------------------------------ */
/*  withRetry                                                          */
/* ------------------------------------------------------------------ */

export interface WithRetryOptions {
  /** Maximum retry attempts after the first call. Defaults to API_MAX_RETRIES. */
  maxRetries?: number;
  /** Label used for log lines and abort messages. */
  label?: string;
  /** AbortSignal propagated to waits. */
  signal?: AbortSignal;
  /**
   * Classify whether an error should be retried. Defaults to `isTransient`.
   * Non-retriable errors are rethrown immediately.
   */
  isRetriable?: (err: unknown) => boolean;
  /**
   * Compute the delay (in ms) before the next attempt.
   * Default: exponential backoff (1s → 2s → 4s → ...) with extra 30s wait
   * for 429/quota errors, plus up to 500ms random jitter.
   */
  delayMs?: (err: unknown, attempt: number) => number;
  /** Logger (defaults to the module logger). */
  logger?: Logger;
}

const DEFAULT_JITTER_MS = 500;

function defaultDelayMs(err: unknown, attempt: number): number {
  const quotaOrRateLimit = isQuotaError(err)
    || (err && typeof err === 'object' && (err as { status?: number }).status === 429);
  const base = quotaOrRateLimit ? 30_000 : 1000 * Math.pow(2, attempt);
  return base + Math.random() * DEFAULT_JITTER_MS;
}

/**
 * Run `fn`, retrying with back-off on transient / rate-limit errors.
 *
 * Mirrors the retry contract previously scattered across adapters:
 *   • abort-aware (throws immediately when `signal.aborted`)
 *   • up to `maxRetries` retries (default: `API_MAX_RETRIES`)
 *   • exponential back-off, 30s for 429
 *   • taggs quota errors so callers can detect them downstream
 *
 * The helper accepts either `AIRequestOptions` (so call sites in the
 * AI adapters read naturally) or a detailed `WithRetryOptions` bag.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  options?: WithRetryOptions | RetryRequestOptions,
): Promise<T> {
  const opts = normaliseOptions(options);
  const log = opts.logger ?? defaultLog;
  const label = opts.label ?? 'withRetry';
  const maxRetries = opts.maxRetries ?? API_MAX_RETRIES;
  const isRetriable = opts.isRetriable ?? isTransient;
  const delayFn = opts.delayMs ?? defaultDelayMs;

  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    throwIfAborted(opts.signal, label);
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      tagIfQuota(err);
      if (attempt === maxRetries || !isRetriable(err)) break;

      const waitMs = Math.max(0, delayFn(err, attempt));
      const reason = err instanceof Error ? err.message.slice(0, 160) : String(err);
      log.info('retry', {
        label,
        attempt: attempt + 1,
        maxRetries,
        delayMs: Math.round(waitMs),
        reason,
      });
      notifyRetryObservers({
        label,
        attempt: attempt + 1,
        maxRetries,
        delayMs: Math.round(waitMs),
        reason,
        err,
      });
      await waitWithAbort(waitMs, opts.signal, `${label} retry wait`);
    }
  }
  throw lastErr;
}

function normaliseOptions(input?: WithRetryOptions | RetryRequestOptions): WithRetryOptions {
  if (!input) return {};
  // RetryRequestOptions only exposes `signal` and `timeoutMs` — the rest are
  // WithRetryOptions-only. An options bag can pass both shapes safely.
  const o = input as WithRetryOptions & RetryRequestOptions;
  return {
    maxRetries: o.maxRetries,
    label: o.label,
    signal: o.signal,
    isRetriable: o.isRetriable,
    delayMs: o.delayMs,
    logger: o.logger,
  };
}
