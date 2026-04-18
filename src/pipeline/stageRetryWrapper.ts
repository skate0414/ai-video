/* ------------------------------------------------------------------ */
/*  Pass Retry Wrapper — configurable per-pass automatic retry        */
/*  Wraps pass execute() with try/catch + exponential backoff for    */
/*  transient backend failures.                                      */
/* ------------------------------------------------------------------ */

import type { PipelineStage } from './types.js';
import type { StageDefinition, StageRunContext } from './stageRegistry.js';
import { waitWithAbort } from './aiControl.js';
import type { TraceWriter } from './trace/traceWriter.js';
import type { TraceContext } from './trace/traceEvents.js';
import { classifyError, makeTraceEvent, createChildContext } from './trace/traceContext.js';

export interface RetryPolicy {
  maxRetries: number;
  baseDelayMs: number;
}

const DEFAULT_RETRY_POLICIES: Partial<Record<PipelineStage, RetryPolicy>> = {
  CAPABILITY_ASSESSMENT: { maxRetries: 1, baseDelayMs: 1000 },
  STYLE_EXTRACTION: { maxRetries: 1, baseDelayMs: 2000 },
  RESEARCH:         { maxRetries: 1, baseDelayMs: 2000 },
  NARRATIVE_MAP:    { maxRetries: 1, baseDelayMs: 2000 },
  STORYBOARD:       { maxRetries: 1, baseDelayMs: 1000 },
  REFERENCE_IMAGE:  { maxRetries: 1, baseDelayMs: 1000 },
  TTS:              { maxRetries: 1, baseDelayMs: 3000 },
  ASSEMBLY:         { maxRetries: 1, baseDelayMs: 3000 },
};

// All stages get the same simple transient retry — no skip list needed.
// Internal retry loops have been removed from SCRIPT_GENERATION and QA_REVIEW.

/** Patterns that indicate transient browser/connection errors (always retryable). */
const TRANSIENT_ERROR_PATTERNS = [
  'has been closed', 'Target closed', 'Session closed',
  'Protocol error', 'tab has been closed',
  'net::ERR_', 'ECONNRESET', 'ECONNREFUSED', 'ETIMEDOUT',
  // Additional Playwright crash messages
  'Execution context was destroyed',
  'Browser has been closed',
  'Page has been closed',
  'page_crashed',
];

/** Check if an error is a transient browser/connection error that should be retried. */
function isTransientError(err: unknown): boolean {
  if (!(err instanceof Error)) return false;
  const msg = err.message;
  return TRANSIENT_ERROR_PATTERNS.some(p => msg.includes(p));
}

/**
 * Wrap a stage definition with automatic retry logic.
 * Stages listed in SKIP_STAGES are returned unchanged.
 */
export interface RetryTraceContext {
  writer: TraceWriter;
  parentTrace: TraceContext;
}

export function withRetry(
  def: StageDefinition,
  customPolicies?: Partial<Record<PipelineStage, RetryPolicy>>,
  traceCtx?: RetryTraceContext,
): StageDefinition {
  const policies = { ...DEFAULT_RETRY_POLICIES, ...customPolicies };
  const policy = policies[def.stage];
  const maxRetries = policy?.maxRetries ?? 0;
  if (maxRetries <= 0 && !TRANSIENT_ERROR_PATTERNS.length) return def;

  return {
    stage: def.stage,
    async execute(ctx: StageRunContext) {
      // Effective max retries: policy maxRetries OR 1 for transient errors
      const effectiveMaxRetries = Math.max(maxRetries, 1);
      let lastError: unknown;
      for (let attempt = 0; attempt <= effectiveMaxRetries; attempt++) {
        try {
          await def.execute(ctx);
          return; // success
        } catch (err) {
          lastError = err;

          // Never retry safety blocks
          if (err instanceof Error && err.name === 'SafetyBlockError') throw err;

          // Non-retryable errors: only retry transient (browser/network) errors
          // and quota/API errors. Skip deterministic failures.
          if (!isTransientError(err) && !policy) throw err;

          // Check if aborted
          if (ctx.isAborted()) throw err;

          if (attempt < maxRetries) {
            const backoff = policy
              ? policy.baseDelayMs * 2 ** attempt + Math.floor(Math.random() * 1000)
              : 1000 + Math.floor(Math.random() * 500);
            ctx.addLog({
              id: `log_${Date.now()}`,
              timestamp: new Date().toISOString(),
              message: `${def.stage} failed (attempt ${attempt + 1}/${effectiveMaxRetries + 1}): ${err instanceof Error ? err.message : String(err)}. Retrying in ${backoff}ms...`,
              type: 'warning',
              stage: def.stage,
            });
            // Trace: emit stage.retry event
            if (traceCtx) {
              const retrySpan = createChildContext(traceCtx.parentTrace);
              traceCtx.writer.append(makeTraceEvent('stage.retry', retrySpan, ctx.projectId, {
                stage: def.stage,
                attempt: attempt + 1,
                maxRetries: effectiveMaxRetries,
                backoffMs: backoff,
                failure: classifyError(err),
              }));
            }

            // W1: Use abort-aware wait so cancellation interrupts retry backoff
            await waitWithAbort(backoff, ctx.abortSignal, `${def.stage} retry backoff`);
          }
        }
      }
      throw lastError;
    },
  };
}

/**
 * Wrap all stage definitions in an array with retry logic.
 */
export function applyRetryPolicies(
  defs: readonly StageDefinition[],
  customPolicies?: Partial<Record<PipelineStage, RetryPolicy>>,
  traceCtx?: RetryTraceContext,
): StageDefinition[] {
  return defs.map((d) => withRetry(d, customPolicies, traceCtx));
}
