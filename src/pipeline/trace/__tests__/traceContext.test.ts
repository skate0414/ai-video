import { describe, it, expect } from 'vitest';
import {
  generateTraceId,
  generateSpanId,
  createRootContext,
  createChildContext,
  classifyError,
  makeTraceEvent,
} from '../traceContext.js';
import { TRACE_SCHEMA_VERSION } from '../traceEvents.js';

describe('generateTraceId', () => {
  it('returns 32 lowercase hex chars', () => {
    const id = generateTraceId();
    expect(id).toMatch(/^[0-9a-f]{32}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateTraceId()));
    expect(ids.size).toBe(100);
  });
});

describe('generateSpanId', () => {
  it('returns 16 lowercase hex chars', () => {
    const id = generateSpanId();
    expect(id).toMatch(/^[0-9a-f]{16}$/);
  });

  it('generates unique IDs', () => {
    const ids = new Set(Array.from({ length: 100 }, () => generateSpanId()));
    expect(ids.size).toBe(100);
  });
});

describe('createRootContext', () => {
  it('creates context with traceId and spanId, no parentSpanId', () => {
    const ctx = createRootContext();
    expect(ctx.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(ctx.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(ctx.parentSpanId).toBeUndefined();
  });

  it('accepts custom traceId', () => {
    const customId = 'a'.repeat(32);
    const ctx = createRootContext(customId);
    expect(ctx.traceId).toBe(customId);
  });
});

describe('createChildContext', () => {
  it('inherits traceId and sets parentSpanId', () => {
    const root = createRootContext();
    const child = createChildContext(root);
    expect(child.traceId).toBe(root.traceId);
    expect(child.spanId).not.toBe(root.spanId);
    expect(child.parentSpanId).toBe(root.spanId);
  });
});

describe('classifyError', () => {
  it('classifies SafetyBlockError', () => {
    const err = new Error('Safety block: topic unsafe');
    err.name = 'SafetyBlockError';
    const desc = classifyError(err);
    expect(desc.category).toBe('safety');
    expect(desc.code).toBe('SAFETY_BLOCK');
    expect(desc.retryable).toBe(false);
  });

  it('classifies AIRequestTimeoutError', () => {
    const err = new Error('timed out after 120000ms');
    err.name = 'AIRequestTimeoutError';
    const desc = classifyError(err);
    expect(desc.category).toBe('timeout');
    expect(desc.code).toBe('AI_REQUEST_TIMEOUT');
    expect(desc.retryable).toBe(true);
  });

  it('classifies AIRequestAbortedError', () => {
    const err = new Error('aborted');
    err.name = 'AIRequestAbortedError';
    const desc = classifyError(err);
    expect(desc.category).toBe('abort');
    expect(desc.code).toBe('USER_ABORT');
    expect(desc.retryable).toBe(false);
  });

  it('classifies CIRValidationError', () => {
    const err = new Error('CIR validation failed at SCRIPT_GENERATION');
    err.name = 'CIRValidationError';
    const desc = classifyError(err);
    expect(desc.category).toBe('contract');
    expect(desc.code).toBe('CIR_VALIDATION_FAILED');
    expect(desc.retryable).toBe(false);
  });

  it('classifies StageContractViolationError (input)', () => {
    const err = new Error('Contract violation at SCRIPT_GENERATION (input): missing field');
    err.name = 'StageContractViolationError';
    const desc = classifyError(err);
    expect(desc.category).toBe('contract');
    expect(desc.code).toBe('INPUT_CONTRACT_VIOLATION');
    expect(desc.retryable).toBe(false);
  });

  it('classifies StageContractViolationError (output)', () => {
    const err = new Error('Contract violation at SCRIPT_GENERATION (output): missing scenes');
    err.name = 'StageContractViolationError';
    const desc = classifyError(err);
    expect(desc.category).toBe('contract');
    expect(desc.code).toBe('OUTPUT_CONTRACT_VIOLATION');
    expect(desc.retryable).toBe(false);
  });

  it('classifies AIParseError', () => {
    const err = new Error('AI parse error at SCRIPT_GENERATION: invalid JSON');
    err.name = 'AIParseError';
    const desc = classifyError(err);
    expect(desc.category).toBe('parse');
    expect(desc.code).toBe('AI_RESPONSE_PARSE_FAILED');
    expect(desc.retryable).toBe(true);
  });

  it('classifies Target closed as transient', () => {
    const desc = classifyError(new Error('Target closed'));
    expect(desc.category).toBe('transient');
    expect(desc.code).toBe('BROWSER_TARGET_CLOSED');
    expect(desc.retryable).toBe(true);
  });

  it('classifies 429 rate limit', () => {
    const desc = classifyError(new Error('HTTP 429 Too Many Requests'));
    expect(desc.category).toBe('quota');
    expect(desc.code).toBe('PROVIDER_RATE_LIMITED');
    expect(desc.retryable).toBe(true);
  });

  it('classifies page_crashed as infrastructure', () => {
    const desc = classifyError(new Error('page_crashed'));
    expect(desc.category).toBe('infrastructure');
    expect(desc.code).toBe('PAGE_CRASHED');
    expect(desc.retryable).toBe(true);
  });

  it('classifies ECONNRESET as transient', () => {
    const desc = classifyError(new Error('ECONNRESET'));
    expect(desc.category).toBe('transient');
    expect(desc.code).toBe('NETWORK_RESET');
    expect(desc.retryable).toBe(true);
  });

  it('classifies BudgetExceededError', () => {
    const err = new Error('Budget exceeded for project xyz');
    err.name = 'BudgetExceededError';
    const desc = classifyError(err);
    expect(desc.category).toBe('quota');
    expect(desc.code).toBe('BUDGET_EXCEEDED');
    expect(desc.retryable).toBe(false);
  });

  it('falls back to unknown/UNCLASSIFIED for generic errors', () => {
    const desc = classifyError(new Error('Something unexpected'));
    expect(desc.category).toBe('unknown');
    expect(desc.code).toBe('UNCLASSIFIED');
    expect(desc.retryable).toBe(false);
  });

  it('handles non-Error values', () => {
    const desc = classifyError('string error');
    expect(desc.category).toBe('unknown');
    expect(desc.code).toBe('UNCLASSIFIED');
    expect(desc.message).toBe('string error');
  });
});

describe('makeTraceEvent', () => {
  it('creates event with correct envelope fields', () => {
    const ctx = createRootContext();
    const event = makeTraceEvent('pipeline.start', ctx, 'proj-1', {
      topic: 'test',
      qualityTier: 'free' as const,
      totalStages: 14,
    });

    expect(event.v).toBe(TRACE_SCHEMA_VERSION);
    expect(event.kind).toBe('pipeline.start');
    expect(event.trace).toBe(ctx);
    expect(event.projectId).toBe('proj-1');
    expect(event.ts).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(event.tsMs).toBeTypeOf('number');
    expect(event.data.topic).toBe('test');
    expect(event.data.totalStages).toBe(14);
  });

  it('includes attrs when provided', () => {
    const ctx = createRootContext();
    const event = makeTraceEvent('stage.start', ctx, 'proj-1',
      { stage: 'SCRIPT_GENERATION' as any },
      { custom: 'value' },
    );
    expect(event.attrs).toEqual({ custom: 'value' });
  });

  it('omits attrs when not provided', () => {
    const ctx = createRootContext();
    const event = makeTraceEvent('stage.start', ctx, 'proj-1',
      { stage: 'SCRIPT_GENERATION' as any },
    );
    expect(event.attrs).toBeUndefined();
  });
});
