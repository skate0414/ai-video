import { describe, it, expect } from 'vitest';
import { makeTraceEvent, createRootContext, createChildContext } from '../traceContext.js';
import type { TraceReplayBundle, FailureDescriptor } from '../traceEvents.js';
import {
  buildTimeline,
  findFailureSpan,
  buildProviderDecisionPath,
  buildStageDiff,
  buildAiCallDiff,
  buildSpanTree,
} from '../analyzer.js';

/* ---- Helpers to build test bundles ---- */

const traceId = 'a'.repeat(32);
const projectId = 'test-project';

function failure(overrides?: Partial<FailureDescriptor>): FailureDescriptor {
  return {
    category: 'transient',
    code: 'NETWORK_TIMEOUT',
    message: 'Connection timed out',
    errorType: 'NetworkError',
    retryable: true,
    ...overrides,
  };
}

function makeSuccessBundle(): TraceReplayBundle {
  const ctx = createRootContext(traceId);
  const child1 = createChildContext(ctx);
  const child2 = createChildContext(ctx);

  const baseMs = Date.now();
  const events = [
    { ...makeTraceEvent('pipeline.start', ctx, projectId, { topic: 'cats', qualityTier: 'free' as const, totalStages: 2 }), tsMs: baseMs },
    { ...makeTraceEvent('stage.start', child1, projectId, { stage: 'SCRIPT_GENERATION' as any }), tsMs: baseMs + 100 },
    { ...makeTraceEvent('ai_call.start', createChildContext(child1), projectId, { stage: 'SCRIPT_GENERATION' as any, method: 'generateScript', provider: 'openai', model: 'gpt-4o' }), tsMs: baseMs + 150 },
    { ...makeTraceEvent('ai_call.complete', createChildContext(child1), projectId, { stage: 'SCRIPT_GENERATION' as any, method: 'generateScript', provider: 'openai', model: 'gpt-4o', durationMs: 2000 }), tsMs: baseMs + 2150 },
    { ...makeTraceEvent('cost.recorded', createChildContext(child1), projectId, { stage: 'SCRIPT_GENERATION', method: 'generateScript', provider: 'openai', adapter: 'chat' as const, estimatedCostUsd: 0.01, durationMs: 2000 }), tsMs: baseMs + 2151 },
    { ...makeTraceEvent('stage.complete', child1, projectId, { stage: 'SCRIPT_GENERATION' as any, durationMs: 2200 }), tsMs: baseMs + 2300 },
    { ...makeTraceEvent('stage.start', child2, projectId, { stage: 'STORYBOARD' as any }), tsMs: baseMs + 2400 },
    { ...makeTraceEvent('stage.complete', child2, projectId, { stage: 'STORYBOARD' as any, durationMs: 1500 }), tsMs: baseMs + 3900 },
    { ...makeTraceEvent('pipeline.complete', ctx, projectId, { durationMs: 4000, stagesCompleted: 2 }), tsMs: baseMs + 4100 },
  ];

  return {
    v: 1,
    traceId,
    projectId,
    topic: 'cats',
    qualityTier: 'free',
    startedAt: new Date(baseMs).toISOString(),
    endedAt: new Date(baseMs + 4100).toISOString(),
    durationMs: 4000,
    outcome: 'success',
    events: events as any,
    stageSummary: {
      SCRIPT_GENERATION: { status: 'completed', durationMs: 2200, retries: 0 },
      STORYBOARD: { status: 'completed', durationMs: 1500, retries: 0 },
    },
    totals: { stagesCompleted: 2, stagesFailed: 0, llmCalls: 1, costUsd: 0.01, retries: 0 },
  };
}

function makeErrorBundle(): TraceReplayBundle {
  const ctx = createRootContext(traceId);
  const child1 = createChildContext(ctx);
  const termFailure = failure({ category: 'timeout', code: 'AI_REQUEST_TIMEOUT', message: 'Request timed out after 120s', retryable: true });

  const baseMs = Date.now();
  const events = [
    { ...makeTraceEvent('pipeline.start', ctx, projectId, { topic: 'dogs', qualityTier: 'balanced' as const, totalStages: 2 }), tsMs: baseMs },
    { ...makeTraceEvent('stage.start', child1, projectId, { stage: 'SCRIPT_GENERATION' as any }), tsMs: baseMs + 100 },
    { ...makeTraceEvent('ai_call.start', createChildContext(child1), projectId, { stage: 'SCRIPT_GENERATION' as any, method: 'generateScript', provider: 'openai', model: 'gpt-4o' }), tsMs: baseMs + 150 },
    { ...makeTraceEvent('ai_call.error', createChildContext(child1), projectId, { stage: 'SCRIPT_GENERATION' as any, method: 'generateScript', provider: 'openai', model: 'gpt-4o', durationMs: 120000, failure: termFailure }), tsMs: baseMs + 120150 },
    { ...makeTraceEvent('stage.retry', createChildContext(child1), projectId, { stage: 'SCRIPT_GENERATION' as any, attempt: 1, maxRetries: 3, backoffMs: 5000, failure: termFailure }), tsMs: baseMs + 120200 },
    { ...makeTraceEvent('ai_call.start', createChildContext(child1), projectId, { stage: 'SCRIPT_GENERATION' as any, method: 'generateScript', provider: 'openai', model: 'gpt-4o' }), tsMs: baseMs + 125200 },
    { ...makeTraceEvent('ai_call.error', createChildContext(child1), projectId, { stage: 'SCRIPT_GENERATION' as any, method: 'generateScript', provider: 'openai', model: 'gpt-4o', durationMs: 120000, failure: termFailure }), tsMs: baseMs + 245200 },
    { ...makeTraceEvent('stage.error', child1, projectId, { stage: 'SCRIPT_GENERATION' as any, failure: termFailure, attempt: 2 }), tsMs: baseMs + 245300 },
    { ...makeTraceEvent('pipeline.error', ctx, projectId, { failure: termFailure, durationMs: 245400, lastStage: 'SCRIPT_GENERATION' as any }), tsMs: baseMs + 245400 },
  ];

  return {
    v: 1,
    traceId,
    projectId,
    topic: 'dogs',
    qualityTier: 'balanced',
    startedAt: new Date(baseMs).toISOString(),
    endedAt: new Date(baseMs + 245400).toISOString(),
    durationMs: 245400,
    outcome: 'error',
    terminalFailure: termFailure,
    events: events as any,
    stageSummary: {
      SCRIPT_GENERATION: { status: 'error', retries: 1, failure: termFailure },
    },
    totals: { stagesCompleted: 0, stagesFailed: 1, llmCalls: 2, costUsd: 0, retries: 1 },
  };
}

/* ---- Tests ---- */

describe('buildTimeline', () => {
  it('produces entries for every event', () => {
    const bundle = makeSuccessBundle();
    const timeline = buildTimeline(bundle);
    expect(timeline).toHaveLength(bundle.events.length);
  });

  it('computes offsets relative to first event', () => {
    const bundle = makeSuccessBundle();
    const timeline = buildTimeline(bundle);
    expect(timeline[0].offsetMs).toBe(0);
    expect(timeline[1].offsetMs).toBeGreaterThan(0);
  });

  it('extracts stage and provider from ai_call events', () => {
    const bundle = makeSuccessBundle();
    const timeline = buildTimeline(bundle);
    const aiStart = timeline.find(e => e.kind === 'ai_call.start');
    expect(aiStart?.stage).toBe('SCRIPT_GENERATION');
    expect(aiStart?.provider).toBe('openai');
    expect(aiStart?.model).toBe('gpt-4o');
  });

  it('marks error events with error status', () => {
    const bundle = makeErrorBundle();
    const timeline = buildTimeline(bundle);
    const errors = timeline.filter(e => e.status === 'error');
    expect(errors.length).toBeGreaterThan(0);
  });

  it('marks retry events with retry status', () => {
    const bundle = makeErrorBundle();
    const timeline = buildTimeline(bundle);
    const retries = timeline.filter(e => e.status === 'retry');
    expect(retries).toHaveLength(1);
  });
});

describe('findFailureSpan', () => {
  it('returns null for success bundles', () => {
    const bundle = makeSuccessBundle();
    expect(findFailureSpan(bundle)).toBeNull();
  });

  it('identifies the correct failed stage', () => {
    const bundle = makeErrorBundle();
    const span = findFailureSpan(bundle);
    expect(span).not.toBeNull();
    expect(span!.stage).toBe('SCRIPT_GENERATION');
  });

  it('captures the terminal failure descriptor', () => {
    const bundle = makeErrorBundle();
    const span = findFailureSpan(bundle)!;
    expect(span.failure.code).toBe('AI_REQUEST_TIMEOUT');
    expect(span.failure.category).toBe('timeout');
  });

  it('collects retry attempts', () => {
    const bundle = makeErrorBundle();
    const span = findFailureSpan(bundle)!;
    expect(span.retries).toHaveLength(1);
    expect(span.retries[0].attempt).toBe(1);
    expect(span.retries[0].backoffMs).toBe(5000);
  });

  it('collects AI calls from the failing stage', () => {
    const bundle = makeErrorBundle();
    const span = findFailureSpan(bundle)!;
    expect(span.aiCalls.length).toBeGreaterThanOrEqual(1);
    expect(span.aiCalls.some(c => c.failure !== undefined)).toBe(true);
  });

  it('computes total duration in failing stage', () => {
    const bundle = makeErrorBundle();
    const span = findFailureSpan(bundle)!;
    expect(span.totalDurationMs).toBeGreaterThan(0);
  });
});

describe('buildProviderDecisionPath', () => {
  it('extracts provider decisions from ai_call events', () => {
    const bundle = makeSuccessBundle();
    const decisions = buildProviderDecisionPath(bundle);
    expect(decisions.length).toBeGreaterThanOrEqual(1);
    expect(decisions[0].provider).toBe('openai');
    expect(decisions[0].model).toBe('gpt-4o');
    expect(decisions[0].method).toBe('generateScript');
  });

  it('marks failed calls appropriately', () => {
    const bundle = makeErrorBundle();
    const decisions = buildProviderDecisionPath(bundle);
    const failedDecisions = decisions.filter(d => d.failed);
    expect(failedDecisions.length).toBeGreaterThan(0);
  });

  it('detects cost from cost.recorded events', () => {
    const bundle = makeSuccessBundle();
    const decisions = buildProviderDecisionPath(bundle);
    const withCost = decisions.filter(d => d.costUsd !== undefined && d.costUsd > 0);
    expect(withCost.length).toBeGreaterThanOrEqual(1);
  });

  it('detects adapter type from cost.recorded events', () => {
    const bundle = makeSuccessBundle();
    const decisions = buildProviderDecisionPath(bundle);
    const withAdapter = decisions.filter(d => d.adapter !== undefined);
    expect(withAdapter.length).toBeGreaterThanOrEqual(1);
    expect(withAdapter[0].adapter).toBe('chat');
  });
});

describe('buildStageDiff', () => {
  it('produces entries for all stages', () => {
    const bundle = makeSuccessBundle();
    const diffs = buildStageDiff(bundle);
    expect(diffs).toHaveLength(2);
  });

  it('preserves stage order from events', () => {
    const bundle = makeSuccessBundle();
    const diffs = buildStageDiff(bundle);
    expect(diffs[0].stage).toBe('SCRIPT_GENERATION');
    expect(diffs[1].stage).toBe('STORYBOARD');
  });

  it('includes status from stageSummary', () => {
    const bundle = makeSuccessBundle();
    const diffs = buildStageDiff(bundle);
    expect(diffs[0].status).toBe('completed');
    expect(diffs[1].status).toBe('completed');
  });

  it('counts AI calls per stage', () => {
    const bundle = makeSuccessBundle();
    const diffs = buildStageDiff(bundle);
    expect(diffs[0].aiCalls).toBe(1);
    expect(diffs[1].aiCalls).toBe(0);
  });

  it('accumulates cost per stage', () => {
    const bundle = makeSuccessBundle();
    const diffs = buildStageDiff(bundle);
    expect(diffs[0].costUsd).toBeCloseTo(0.01);
    expect(diffs[1].costUsd).toBe(0);
  });

  it('contains failure info for errored stages', () => {
    const bundle = makeErrorBundle();
    const diffs = buildStageDiff(bundle);
    const errored = diffs.find(d => d.status === 'error');
    expect(errored).toBeDefined();
    expect(errored!.failure).toBeDefined();
    expect(errored!.failure!.code).toBe('AI_REQUEST_TIMEOUT');
  });

  it('includes retry count', () => {
    const bundle = makeErrorBundle();
    const diffs = buildStageDiff(bundle);
    const errored = diffs.find(d => d.status === 'error')!;
    expect(errored.retries).toBe(1);
  });
});

describe('buildAiCallDiff', () => {
  it('builds structured diffs from ai logs', () => {
    const logs = [
      {
        seq: 1,
        timestamp: '2026-01-01T00:00:05.000Z',
        stage: 'SCRIPT_GENERATION',
        taskType: 'script',
        method: 'generateText',
        provider: 'openai',
        durationMs: 1200,
        input: { model: 'gpt-4o', prompt: 'write a short script about cats' },
        output: { text: 'A short script about cats...' },
      },
    ];

    const diffs = buildAiCallDiff(logs as any, {
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:01:00.000Z',
    });

    expect(diffs).toHaveLength(1);
    expect(diffs[0].seq).toBe('1');
    expect(diffs[0].status).toBe('ok');
    expect(diffs[0].inputText).toContain('cats');
    expect(diffs[0].outputText).toContain('cats');
    expect(diffs[0].diffSummary.changeRatio).toBeGreaterThanOrEqual(0);
  });

  it('marks error logs as error diffs', () => {
    const logs = [
      {
        seq: '2',
        timestamp: '2026-01-01T00:00:10.000Z',
        stage: 'SCRIPT_GENERATION',
        taskType: 'script',
        method: 'generateText',
        provider: 'openai',
        durationMs: 1000,
        input: { prompt: 'hello world' },
        error: 'timeout',
      },
    ];

    const diffs = buildAiCallDiff(logs as any, {
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:01:00.000Z',
    });

    expect(diffs).toHaveLength(1);
    expect(diffs[0].status).toBe('error');
    expect(diffs[0].errorText).toContain('timeout');
  });

  it('filters logs by trace time window', () => {
    const logs = [
      {
        seq: 1,
        timestamp: '2026-01-01T00:00:05.000Z',
        stage: 'SCRIPT_GENERATION',
        taskType: 'script',
        method: 'generateText',
        provider: 'openai',
        durationMs: 1200,
        input: { prompt: 'inside window' },
        output: { text: 'inside window out' },
      },
      {
        seq: 2,
        timestamp: '2026-01-01T00:10:05.000Z',
        stage: 'SCRIPT_GENERATION',
        taskType: 'script',
        method: 'generateText',
        provider: 'openai',
        durationMs: 1100,
        input: { prompt: 'outside window' },
        output: { text: 'outside window out' },
      },
    ];

    const diffs = buildAiCallDiff(logs as any, {
      startedAt: '2026-01-01T00:00:00.000Z',
      endedAt: '2026-01-01T00:01:00.000Z',
    });

    expect(diffs).toHaveLength(1);
    expect(diffs[0].inputText).toContain('inside window');
  });
});

describe('buildSpanTree', () => {
  it('builds parent-child span hierarchy', () => {
    const bundle = makeSuccessBundle();
    const tree = buildSpanTree(bundle);

    expect(tree.length).toBeGreaterThan(0);
    const root = tree[0];
    expect(root.spanId).toBeTruthy();
    // Root should have children from stage/ai spans
    expect(root.children.length).toBeGreaterThan(0);
  });

  it('marks error spans as error status', () => {
    const bundle = makeErrorBundle();
    const tree = buildSpanTree(bundle);

    const flatten = (nodes: any[]): any[] => nodes.flatMap(n => [n, ...flatten(n.children)]);
    const all = flatten(tree);
    expect(all.some(n => n.status === 'error')).toBe(true);
  });
});
