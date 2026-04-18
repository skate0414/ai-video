/* ------------------------------------------------------------------ */
/*  Trace Context – ID generation, failure classification, factory    */
/*  Provides W3C-compatible trace/span IDs and centralised error     */
/*  classification for the trace event system.                       */
/* ------------------------------------------------------------------ */

import { randomBytes } from 'node:crypto';
import type {
  TraceContext,
  FailureDescriptor,
  FailureCategory,
  FailureCode,
  TraceEventKind,
  AnyTraceEvent,
  TRACE_SCHEMA_VERSION,
} from './traceEvents.js';

/* ---- ID generation ---- */

/** Generate a 128-bit trace ID as 32 lowercase hex chars. */
export function generateTraceId(): string {
  return randomBytes(16).toString('hex');
}

/** Generate a 64-bit span ID as 16 lowercase hex chars. */
export function generateSpanId(): string {
  return randomBytes(8).toString('hex');
}

/** Create a root trace context (no parent span). */
export function createRootContext(traceId?: string): TraceContext {
  return {
    traceId: traceId ?? generateTraceId(),
    spanId: generateSpanId(),
  };
}

/** Create a child span context inheriting the parent's traceId. */
export function createChildContext(parent: TraceContext): TraceContext {
  return {
    traceId: parent.traceId,
    spanId: generateSpanId(),
    parentSpanId: parent.spanId,
  };
}

/* ---- Failure classification ---- */

/** Reduce a stack trace to the first N non-node_modules frames. */
function cleanStack(stack: string | undefined, maxFrames = 10): string | undefined {
  if (!stack) return undefined;
  const lines = stack.split('\n');
  const header = lines[0] ?? '';
  const frames = lines
    .slice(1)
    .filter(l => !l.includes('node_modules'))
    .slice(0, maxFrames);
  return [header, ...frames].join('\n');
}

/**
 * Message-based transient/quota/infra pattern matching.
 * Returns [category, code, retryable] or undefined if no match.
 */
function matchMessagePattern(msg: string): [FailureCategory, FailureCode, boolean] | undefined {
  // Transient browser/connection errors
  if (msg.includes('Target closed'))                         return ['transient', 'BROWSER_TARGET_CLOSED', true];
  if (msg.includes('Execution context was destroyed'))       return ['transient', 'BROWSER_CONTEXT_DESTROYED', true];
  if (msg.includes('Browser has been closed'))               return ['transient', 'BROWSER_CLOSED', true];
  if (msg.includes('Page has been closed'))                  return ['transient', 'PAGE_CLOSED', true];
  if (msg.includes('has been closed'))                       return ['transient', 'BROWSER_TARGET_CLOSED', true];
  if (msg.includes('Session closed'))                        return ['transient', 'BROWSER_TARGET_CLOSED', true];
  if (msg.includes('Protocol error'))                        return ['transient', 'PROTOCOL_ERROR', true];
  if (msg.includes('ECONNRESET'))                            return ['transient', 'NETWORK_RESET', true];
  if (msg.includes('ECONNREFUSED'))                          return ['transient', 'NETWORK_REFUSED', true];
  if (msg.includes('ETIMEDOUT'))                             return ['transient', 'NETWORK_TIMEOUT', true];
  if (msg.includes('net::ERR_'))                             return ['transient', 'NETWORK_RESET', true];

  // Quota / rate limit
  if (msg.includes('429') || msg.includes('rate limit'))     return ['quota', 'PROVIDER_RATE_LIMITED', true];
  if (/quota|resource.exhausted/i.test(msg))                 return ['quota', 'PROVIDER_QUOTA_EXHAUSTED', false];
  if (msg.includes('Budget exceeded'))                       return ['quota', 'BUDGET_EXCEEDED', false];

  // Infrastructure
  if (msg.includes('page_crashed'))                          return ['infrastructure', 'PAGE_CRASHED', true];
  if (msg.includes('send_prompt_page_crashed'))              return ['infrastructure', 'SEND_PROMPT_PAGE_CRASHED', true];

  // Upstream
  if (/5\d{2}\b/.test(msg) && /server|internal/i.test(msg)) return ['upstream', 'API_SERVER_ERROR', true];

  return undefined;
}

/**
 * Classify any error into a structured FailureDescriptor.
 *
 * Classification priority:
 * 1. instanceof checks for known error classes
 * 2. Error name matching (for cross-boundary errors)
 * 3. Message pattern matching
 * 4. Fallback to unknown/UNCLASSIFIED
 */
export function classifyError(err: unknown): FailureDescriptor {
  const error = err instanceof Error ? err : new Error(String(err));
  const msg = error.message;
  const name = error.name;
  const stack = cleanStack(error.stack);

  const base = { message: msg, errorType: name, stack };

  // 1. Known error class names (works across module boundaries)
  switch (name) {
    case 'SafetyBlockError':
      return { ...base, category: 'safety', code: 'SAFETY_BLOCK', retryable: false };

    case 'AIRequestTimeoutError':
      return { ...base, category: 'timeout', code: 'AI_REQUEST_TIMEOUT', retryable: true };

    case 'AIRequestAbortedError':
      return { ...base, category: 'abort', code: 'USER_ABORT', retryable: false };

    case 'CIRValidationError':
      return { ...base, category: 'contract', code: 'CIR_VALIDATION_FAILED', retryable: false };

    case 'StageContractViolationError': {
      // Direction is encoded in the message ("input" or "output")
      const isOutput = msg.includes('(output)');
      return {
        ...base,
        category: 'contract',
        code: isOutput ? 'OUTPUT_CONTRACT_VIOLATION' : 'INPUT_CONTRACT_VIOLATION',
        retryable: false,
      };
    }

    case 'AIParseError':
      return { ...base, category: 'parse', code: 'AI_RESPONSE_PARSE_FAILED', retryable: true };

    case 'BudgetExceededError':
      return { ...base, category: 'quota', code: 'BUDGET_EXCEEDED', retryable: false };
  }

  // 2. Message pattern matching
  const pattern = matchMessagePattern(msg);
  if (pattern) {
    return { ...base, category: pattern[0], code: pattern[1], retryable: pattern[2] };
  }

  // 3. Fallback
  return { ...base, category: 'unknown', code: 'UNCLASSIFIED', retryable: false };
}

/* ---- Event factory ---- */

/**
 * Create a trace event with standard envelope fields pre-populated.
 */
export function makeTraceEvent<K extends TraceEventKind>(
  kind: K,
  trace: TraceContext,
  projectId: string,
  data: Extract<AnyTraceEvent, { kind: K }>['data'],
  attrs?: Record<string, string | number | boolean>,
): Extract<AnyTraceEvent, { kind: K }> {
  const now = Date.now();
  return {
    v: 1 as typeof import('./traceEvents.js').TRACE_SCHEMA_VERSION,
    kind,
    trace,
    projectId,
    ts: new Date(now).toISOString(),
    tsMs: now,
    data,
    ...(attrs ? { attrs } : {}),
  } as Extract<AnyTraceEvent, { kind: K }>;
}
