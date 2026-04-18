import { describe, it, expect } from 'vitest';
import {
  formatSummary,
  formatTimeline,
  formatFailureSpan,
  formatProviderPath,
  formatStageDiff,
} from '../formatter.js';
import type { TraceReplayBundle } from '../traceEvents.js';
import type {
  TimelineEntry,
  FailureSpan,
  ProviderDecision,
  StageDiff,
} from '../analyzer.js';

/* ---- Test fixtures ---- */

function makeBundle(overrides: Partial<TraceReplayBundle> = {}): TraceReplayBundle {
  return {
    v: 1 as const,
    traceId: 'trace_abc123',
    projectId: 'proj_42',
    topic: 'Test Topic',
    qualityTier: 'standard',
    startedAt: '2026-01-01T00:00:00.000Z',
    endedAt: '2026-01-01T00:01:00.000Z',
    durationMs: 60000,
    outcome: 'success',
    events: [],
    stageSummary: {},
    totals: {
      stagesCompleted: 10,
      stagesFailed: 1,
      retries: 2,
      llmCalls: 15,
      costUsd: 0.0042,
    },
    ...overrides,
  } as TraceReplayBundle;
}

describe('formatSummary', () => {
  it('includes trace metadata fields', () => {
    const output = formatSummary(makeBundle());
    expect(output).toContain('trace_abc123');
    expect(output).toContain('proj_42');
    expect(output).toContain('Test Topic');
    expect(output).toContain('standard');
    expect(output).toContain('SUCCESS');
    expect(output).toContain('60.0s');
    expect(output).toContain('10 completed, 1 failed, 2 retries');
    expect(output).toContain('15');
    expect(output).toContain('$0.0042');
  });

  it('renders error outcome in different color', () => {
    const output = formatSummary(makeBundle({ outcome: 'error' }));
    expect(output).toContain('ERROR');
  });

  it('renders aborted outcome', () => {
    const output = formatSummary(makeBundle({ outcome: 'aborted' }));
    expect(output).toContain('ABORTED');
  });

  it('handles missing endedAt', () => {
    const output = formatSummary(makeBundle({ endedAt: undefined }));
    expect(output).toContain('-');
  });
});

describe('formatTimeline', () => {
  it('renders timeline entries as a table', () => {
    const entries: TimelineEntry[] = [
      { offsetMs: 0, ts: '2024-01-01T00:00:00Z', kind: 'stage_start', stage: 'SCRIPT_GENERATION', status: 'ok' },
      { offsetMs: 1500, ts: '2024-01-01T00:00:01.500Z', kind: 'ai_call', stage: 'SCRIPT_GENERATION', provider: 'gemini', durationMs: 1200, status: 'ok' },
      { offsetMs: 3000, ts: '2024-01-01T00:00:03Z', kind: 'stage_end', stage: 'SCRIPT_GENERATION', durationMs: 3000, status: 'ok' },
    ];
    const output = formatTimeline(entries);
    expect(output).toContain('Timeline');
    expect(output).toContain('SCRIPT_GENERATION');
    expect(output).toContain('gemini');
    expect(output).toContain('1.2s');
  });

  it('renders empty timeline gracefully', () => {
    const output = formatTimeline([]);
    expect(output).toContain('Timeline');
  });

  it('formats sub-second values as ms', () => {
    const entries: TimelineEntry[] = [
      { offsetMs: 50, ts: '2024-01-01T00:00:00.050Z', kind: 'stage_start', stage: 'QA_REVIEW', status: 'ok', durationMs: 800 },
    ];
    const output = formatTimeline(entries);
    expect(output).toContain('800ms');
  });
});

describe('formatFailureSpan', () => {
  it('renders failure detail block', () => {
    const span: FailureSpan = {
      stage: 'STYLE_EXTRACTION',
      failure: {
        category: 'parse',
        code: 'AI_RESPONSE_PARSE_FAILED',
        message: 'Model returned empty response',
        errorType: 'AdapterError',
        retryable: true,
      },
      totalDurationMs: 5000,
      retries: [],
      aiCalls: [],
    };
    const output = formatFailureSpan(span);
    expect(output).toContain('FAILURE DETAIL');
    expect(output).toContain('STYLE_EXTRACTION');
    expect(output).toContain('AI_RESPONSE_PARSE_FAILED');
    expect(output).toContain('Model returned empty response');
    expect(output).toContain('yes'); // retryable
    expect(output).toContain('5.0s');
  });

  it('renders retry chain', () => {
    const span: FailureSpan = {
      stage: 'VIDEO_GEN',
      failure: {
        category: 'timeout',
        code: 'AI_REQUEST_TIMEOUT',
        message: 'Request timed out',
        errorType: 'TimeoutError',
        retryable: true,
      },
      totalDurationMs: 12000,
      retries: [
        { attempt: 1, failure: { category: 'timeout', code: 'AI_REQUEST_TIMEOUT', message: 'timed out', errorType: 'TimeoutError', retryable: true }, backoffMs: 2000 },
        { attempt: 2, failure: { category: 'timeout', code: 'AI_REQUEST_TIMEOUT', message: 'timed out', errorType: 'TimeoutError', retryable: true }, backoffMs: 4000 },
      ],
      aiCalls: [],
    };
    const output = formatFailureSpan(span);
    expect(output).toContain('Retry Chain (2 attempts)');
    expect(output).toContain('Attempt 1');
    expect(output).toContain('Attempt 2');
  });

  it('renders ai calls in failing stage', () => {
    const span: FailureSpan = {
      stage: 'RESEARCH',
      failure: {
        category: 'parse',
        code: 'AI_RESPONSE_PARSE_FAILED',
        message: 'Invalid JSON',
        errorType: 'ParseError',
        retryable: false,
      },
      totalDurationMs: 3000,
      retries: [],
      aiCalls: [
        { provider: 'gemini', model: 'gemini-2.5-pro', method: 'generateText', durationMs: 2500 },
        { provider: 'chatgpt', method: 'generateText', durationMs: 400, failure: { category: 'quota', code: 'PROVIDER_QUOTA_EXHAUSTED', message: 'limit reached', errorType: 'QuotaError', retryable: false } },
      ],
    };
    const output = formatFailureSpan(span);
    expect(output).toContain('AI Calls in failing stage');
    expect(output).toContain('gemini');
    expect(output).toContain('chatgpt');
    expect(output).toContain('PROVIDER_QUOTA_EXHAUSTED');
  });

  it('renders stack trace', () => {
    const span: FailureSpan = {
      stage: 'STORYBOARD',
      failure: {
        category: 'contract',
        code: 'OUTPUT_CONTRACT_VIOLATION',
        message: 'Unexpected state',
        errorType: 'Error',
        retryable: false,
        stack: 'Error: Unexpected state\n    at foo.ts:10\n    at bar.ts:20\n    at baz.ts:30',
      },
      totalDurationMs: 100,
      retries: [],
      aiCalls: [],
    };
    const output = formatFailureSpan(span);
    expect(output).toContain('Stack trace');
    expect(output).toContain('foo.ts:10');
  });
});

describe('formatProviderPath', () => {
  it('renders table with provider decisions', () => {
    const decisions: ProviderDecision[] = [
      { stage: 'SCRIPT_GENERATION', provider: 'gemini', model: 'gemini-2.5-pro', method: 'generateText', durationMs: 2000, costUsd: 0.001, failed: false, isFallback: false },
      { stage: 'SCRIPT_GENERATION', provider: 'chatgpt', model: 'gpt-4o', method: 'generateText', durationMs: 3000, costUsd: 0.002, failed: true, isFallback: true },
    ];
    const output = formatProviderPath(decisions);
    expect(output).toContain('Provider Decision Path');
    expect(output).toContain('gemini');
    expect(output).toContain('chatgpt');
    expect(output).toContain('[fallback]');
  });

  it('handles empty decisions', () => {
    const output = formatProviderPath([]);
    expect(output).toContain('Provider Decision Path');
  });
});

describe('formatStageDiff', () => {
  it('renders stage summary table', () => {
    const diffs: StageDiff[] = [
      { stage: 'STYLE_EXTRACTION', status: 'completed', durationMs: 5000, retries: 0, aiCalls: 2, costUsd: 0.001 },
      { stage: 'SCRIPT_GENERATION', status: 'error', durationMs: 12000, retries: 3, aiCalls: 5, costUsd: 0.005 },
      { stage: 'STORYBOARD', status: 'skipped', durationMs: 0, retries: 0, aiCalls: 0, costUsd: 0 },
    ];
    const output = formatStageDiff(diffs);
    expect(output).toContain('Stage Summary');
    expect(output).toContain('STYLE_EXTRACTION');
    expect(output).toContain('completed');
    expect(output).toContain('SCRIPT_GENERATION');
    expect(output).toContain('error');
    expect(output).toContain('skipped');
  });
});
