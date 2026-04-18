/* ------------------------------------------------------------------ */
/*  Tests for trace/analyzer – pure analysis functions                 */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import {
  buildTimeline,
  findFailureSpan,
  buildProviderDecisionPath,
  buildStageDiff,
  buildAiCallDiff,
  buildSpanTree,
} from './analyzer.js';
import type { TraceReplayBundle, AnyTraceEvent, FailureDescriptor } from './traceEvents.js';

/* ---- Helper factories ---- */

const FAILURE: FailureDescriptor = {
  category: 'transient',
  code: 'NETWORK_TIMEOUT',
  message: 'timed out',
  errorType: 'Error',
  retryable: true,
};

let spanCounter = 0;
function mkTrace(parent?: string) {
  const spanId = String(++spanCounter).padStart(16, '0');
  return { traceId: '00000000000000000000000000000001', spanId, parentSpanId: parent };
}

function mkEvent<K extends AnyTraceEvent['kind']>(
  kind: K,
  data: any,
  tsMs: number,
  trace?: ReturnType<typeof mkTrace>,
): AnyTraceEvent {
  return {
    v: 1,
    kind,
    trace: trace ?? mkTrace(),
    projectId: 'p1',
    ts: new Date(tsMs).toISOString(),
    tsMs,
    data,
  } as AnyTraceEvent;
}

function emptyBundle(overrides: Partial<TraceReplayBundle> = {}): TraceReplayBundle {
  return {
    v: 1,
    traceId: '00000000000000000000000000000001',
    projectId: 'p1',
    topic: 'test',
    qualityTier: 'standard',
    startedAt: '2024-01-01T00:00:00Z',
    outcome: 'success',
    events: [],
    stageSummary: {},
    totals: { stagesCompleted: 0, stagesFailed: 0, llmCalls: 0, costUsd: 0, retries: 0 },
    ...overrides,
  };
}

/* ================================================================== */
/*  buildTimeline                                                     */
/* ================================================================== */

describe('buildTimeline', () => {
  it('returns empty array for empty events', () => {
    const tl = buildTimeline(emptyBundle());
    expect(tl).toEqual([]);
  });

  it('maps pipeline.start to ok status', () => {
    const bundle = emptyBundle({
      events: [mkEvent('pipeline.start', { topic: 'test', qualityTier: 'standard', totalStages: 3 }, 1000)],
    });
    const tl = buildTimeline(bundle);
    expect(tl).toHaveLength(1);
    expect(tl[0].status).toBe('ok');
    expect(tl[0].offsetMs).toBe(0);
  });

  it('computes offsetMs relative to first event', () => {
    const bundle = emptyBundle({
      events: [
        mkEvent('pipeline.start', { topic: 'test', qualityTier: 'standard', totalStages: 3 }, 1000),
        mkEvent('stage.start', { stage: 'STYLE_EXTRACTION' }, 1500),
      ],
    });
    const tl = buildTimeline(bundle);
    expect(tl[1].offsetMs).toBe(500);
    expect(tl[1].stage).toBe('STYLE_EXTRACTION');
  });

  it('maps pipeline.complete with durationMs', () => {
    const bundle = emptyBundle({
      events: [mkEvent('pipeline.complete', { durationMs: 5000, stagesCompleted: 3 }, 6000)],
    });
    const tl = buildTimeline(bundle);
    expect(tl[0].durationMs).toBe(5000);
    expect(tl[0].status).toBe('ok');
  });

  it('maps pipeline.error with failure', () => {
    const bundle = emptyBundle({
      events: [mkEvent('pipeline.error', { failure: FAILURE, durationMs: 3000 }, 4000)],
    });
    const tl = buildTimeline(bundle);
    expect(tl[0].status).toBe('error');
    expect(tl[0].failure).toBe(FAILURE);
    expect(tl[0].durationMs).toBe(3000);
  });

  it('maps stage events correctly', () => {
    const bundle = emptyBundle({
      events: [
        mkEvent('stage.start', { stage: 'RESEARCH' }, 1000),
        mkEvent('stage.complete', { stage: 'RESEARCH', durationMs: 2000 }, 3000),
        mkEvent('stage.error', { stage: 'SCRIPT_GENERATION', failure: FAILURE, attempt: 1 }, 3500),
        mkEvent('stage.retry', { stage: 'SCRIPT_GENERATION', attempt: 1, maxRetries: 3, backoffMs: 1000, failure: FAILURE }, 3600),
        mkEvent('stage.skip', { stage: 'QA_REVIEW', reason: 'not needed' }, 3700),
      ],
    });
    const tl = buildTimeline(bundle);
    expect(tl[0].status).toBe('ok');
    expect(tl[0].stage).toBe('RESEARCH');
    expect(tl[1].durationMs).toBe(2000);
    expect(tl[2].status).toBe('error');
    expect(tl[3].status).toBe('retry');
    expect(tl[4].status).toBe('skip');
  });

  it('maps ai_call events with provider/model', () => {
    const bundle = emptyBundle({
      events: [
        mkEvent('ai_call.start', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini', model: 'gemini-2.0' }, 1000),
        mkEvent('ai_call.complete', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini', model: 'gemini-2.0', durationMs: 500 }, 1500),
        mkEvent('ai_call.error', { stage: 'SCRIPT_GENERATION', method: 'generateText', provider: 'openai', model: 'gpt-4', durationMs: 300, failure: FAILURE }, 2000),
      ],
    });
    const tl = buildTimeline(bundle);
    expect(tl[0].provider).toBe('gemini');
    expect(tl[0].model).toBe('gemini-2.0');
    expect(tl[0].status).toBe('info');
    expect(tl[1].status).toBe('ok');
    expect(tl[1].durationMs).toBe(500);
    expect(tl[2].status).toBe('error');
    expect(tl[2].failure).toBe(FAILURE);
  });

  it('maps cost.recorded events', () => {
    const bundle = emptyBundle({
      events: [
        mkEvent('cost.recorded', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini', adapter: 'chat', estimatedCostUsd: 0.05, durationMs: 100 }, 1000),
      ],
    });
    const tl = buildTimeline(bundle);
    expect(tl[0].costUsd).toBe(0.05);
    expect(tl[0].provider).toBe('gemini');
  });

  it('handles unknown event kinds gracefully', () => {
    const bundle = emptyBundle({
      events: [mkEvent('scene.review' as any, { sceneId: 's1', status: 'ok' }, 1000)],
    });
    const tl = buildTimeline(bundle);
    expect(tl[0].status).toBe('info');
  });
});

/* ================================================================== */
/*  findFailureSpan                                                   */
/* ================================================================== */

describe('findFailureSpan', () => {
  it('returns null for successful pipeline', () => {
    expect(findFailureSpan(emptyBundle({ outcome: 'success' }))).toBeNull();
  });

  it('returns null for in_progress pipeline', () => {
    expect(findFailureSpan(emptyBundle({ outcome: 'in_progress' }))).toBeNull();
  });

  it('returns null when no terminalFailure', () => {
    expect(findFailureSpan(emptyBundle({ outcome: 'error' }))).toBeNull();
  });

  it('identifies failed stage from stageSummary', () => {
    const bundle = emptyBundle({
      outcome: 'error',
      terminalFailure: FAILURE,
      stageSummary: {
        STYLE_EXTRACTION: { status: 'completed', retries: 0, durationMs: 1000 },
        RESEARCH: { status: 'error', retries: 2, failure: FAILURE },
      },
      events: [],
    });
    const span = findFailureSpan(bundle);
    expect(span).not.toBeNull();
    expect(span!.stage).toBe('RESEARCH');
    expect(span!.failure).toBe(FAILURE);
  });

  it('falls back to pipeline.error lastStage', () => {
    const bundle = emptyBundle({
      outcome: 'error',
      terminalFailure: FAILURE,
      stageSummary: {},
      events: [
        mkEvent('pipeline.error', { failure: FAILURE, durationMs: 5000, lastStage: 'SCRIPT_GENERATION' }, 5000),
      ],
    });
    const span = findFailureSpan(bundle);
    expect(span!.stage).toBe('SCRIPT_GENERATION');
  });

  it('collects retries for the failed stage', () => {
    const bundle = emptyBundle({
      outcome: 'error',
      terminalFailure: FAILURE,
      stageSummary: { RESEARCH: { status: 'error', retries: 2, failure: FAILURE } },
      events: [
        mkEvent('stage.retry', { stage: 'RESEARCH', attempt: 1, maxRetries: 3, backoffMs: 1000, failure: FAILURE }, 1000),
        mkEvent('stage.retry', { stage: 'RESEARCH', attempt: 2, maxRetries: 3, backoffMs: 2000, failure: FAILURE }, 3000),
      ],
    });
    const span = findFailureSpan(bundle);
    expect(span!.retries).toHaveLength(2);
    expect(span!.retries[0].attempt).toBe(1);
    expect(span!.retries[1].backoffMs).toBe(2000);
  });

  it('collects AI calls for the failed stage', () => {
    const bundle = emptyBundle({
      outcome: 'error',
      terminalFailure: FAILURE,
      stageSummary: { RESEARCH: { status: 'error', retries: 0, failure: FAILURE } },
      events: [
        mkEvent('ai_call.complete', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini', model: 'gemini-2.0', durationMs: 500 }, 1000),
        mkEvent('ai_call.error', { stage: 'RESEARCH', method: 'generateText', provider: 'openai', model: 'gpt-4', durationMs: 300, failure: FAILURE }, 1500),
      ],
    });
    const span = findFailureSpan(bundle);
    expect(span!.aiCalls).toHaveLength(2);
    expect(span!.aiCalls[0].provider).toBe('gemini');
    expect(span!.aiCalls[1].failure).toBe(FAILURE);
  });

  it('computes totalDurationMs from stage start/error events', () => {
    const bundle = emptyBundle({
      outcome: 'error',
      terminalFailure: FAILURE,
      stageSummary: { RESEARCH: { status: 'error', retries: 0, failure: FAILURE } },
      events: [
        mkEvent('stage.start', { stage: 'RESEARCH' }, 1000),
        mkEvent('stage.error', { stage: 'RESEARCH', failure: FAILURE, attempt: 1 }, 4000),
      ],
    });
    const span = findFailureSpan(bundle);
    expect(span!.totalDurationMs).toBe(3000);
  });
});

/* ================================================================== */
/*  buildProviderDecisionPath                                         */
/* ================================================================== */

describe('buildProviderDecisionPath', () => {
  it('returns empty for no AI calls', () => {
    expect(buildProviderDecisionPath(emptyBundle())).toEqual([]);
  });

  it('builds decisions from ai_call start/complete pairs', () => {
    const bundle = emptyBundle({
      events: [
        mkEvent('ai_call.start', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini', model: 'gemini-2.0' }, 1000),
        mkEvent('ai_call.complete', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini', model: 'gemini-2.0', durationMs: 500 }, 1500),
      ],
    });
    const decisions = buildProviderDecisionPath(bundle);
    expect(decisions).toHaveLength(1);
    expect(decisions[0].provider).toBe('gemini');
    expect(decisions[0].durationMs).toBe(500);
    expect(decisions[0].failed).toBe(false);
    expect(decisions[0].isFallback).toBe(false);
  });

  it('marks failed decisions', () => {
    const bundle = emptyBundle({
      events: [
        mkEvent('ai_call.start', { stage: 'RESEARCH', method: 'generateText', provider: 'openai', model: 'gpt-4' }, 1000),
        mkEvent('ai_call.error', { stage: 'RESEARCH', method: 'generateText', provider: 'openai', model: 'gpt-4', durationMs: 300, failure: FAILURE }, 1300),
      ],
    });
    const decisions = buildProviderDecisionPath(bundle);
    expect(decisions[0].failed).toBe(true);
  });

  it('marks fallback when stage has retries', () => {
    const bundle = emptyBundle({
      events: [
        mkEvent('stage.retry', { stage: 'RESEARCH', attempt: 1, maxRetries: 3, backoffMs: 1000, failure: FAILURE }, 500),
        mkEvent('ai_call.start', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini' }, 1000),
        mkEvent('ai_call.complete', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini', durationMs: 500 }, 1500),
      ],
    });
    const decisions = buildProviderDecisionPath(bundle);
    expect(decisions[0].isFallback).toBe(true);
  });

  it('attaches cost from cost.recorded events', () => {
    const bundle = emptyBundle({
      events: [
        mkEvent('ai_call.start', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini' }, 1000),
        mkEvent('ai_call.complete', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini', durationMs: 500 }, 1500),
        mkEvent('cost.recorded', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini', adapter: 'chat', estimatedCostUsd: 0.05, durationMs: 500 }, 1500),
      ],
    });
    const decisions = buildProviderDecisionPath(bundle);
    expect(decisions[0].costUsd).toBe(0.05);
    expect(decisions[0].adapter).toBe('chat');
  });
});

/* ================================================================== */
/*  buildStageDiff                                                    */
/* ================================================================== */

describe('buildStageDiff', () => {
  it('returns empty for empty bundle', () => {
    expect(buildStageDiff(emptyBundle())).toEqual([]);
  });

  it('builds diffs from stage events', () => {
    const bundle = emptyBundle({
      stageSummary: {
        STYLE_EXTRACTION: { status: 'completed', durationMs: 1000, retries: 0 },
        RESEARCH: { status: 'completed', durationMs: 2000, retries: 1 },
      },
      events: [
        mkEvent('stage.start', { stage: 'STYLE_EXTRACTION' }, 1000),
        mkEvent('stage.complete', { stage: 'STYLE_EXTRACTION', durationMs: 1000 }, 2000),
        mkEvent('stage.start', { stage: 'RESEARCH' }, 2000),
        mkEvent('stage.complete', { stage: 'RESEARCH', durationMs: 2000 }, 4000),
      ],
    });
    const diffs = buildStageDiff(bundle);
    expect(diffs).toHaveLength(2);
    expect(diffs[0].stage).toBe('STYLE_EXTRACTION');
    expect(diffs[0].status).toBe('completed');
    expect(diffs[0].durationMs).toBe(1000);
    expect(diffs[1].retries).toBe(1);
  });

  it('includes skipped stages', () => {
    const bundle = emptyBundle({
      stageSummary: { QA_REVIEW: { status: 'skipped', retries: 0 } },
      events: [mkEvent('stage.skip', { stage: 'QA_REVIEW', reason: 'not needed' }, 1000)],
    });
    const diffs = buildStageDiff(bundle);
    expect(diffs[0].status).toBe('skipped');
  });

  it('counts AI calls and cost per stage', () => {
    const bundle = emptyBundle({
      stageSummary: { RESEARCH: { status: 'completed', retries: 0 } },
      events: [
        mkEvent('stage.start', { stage: 'RESEARCH' }, 1000),
        mkEvent('ai_call.start', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini' }, 1100),
        mkEvent('ai_call.start', { stage: 'RESEARCH', method: 'generateText', provider: 'openai' }, 1200),
        mkEvent('cost.recorded', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini', adapter: 'chat', estimatedCostUsd: 0.03, durationMs: 100 }, 1300),
        mkEvent('cost.recorded', { stage: 'RESEARCH', method: 'generateText', provider: 'openai', adapter: 'chat', estimatedCostUsd: 0.07, durationMs: 200 }, 1400),
        mkEvent('stage.complete', { stage: 'RESEARCH', durationMs: 1000 }, 2000),
      ],
    });
    const diffs = buildStageDiff(bundle);
    expect(diffs[0].aiCalls).toBe(2);
    expect(diffs[0].costUsd).toBeCloseTo(0.10);
  });

  it('includes stages from stageSummary not in events', () => {
    const bundle = emptyBundle({
      stageSummary: {
        ASSEMBLY: { status: 'not_started', retries: 0 },
      },
      events: [],
    });
    const diffs = buildStageDiff(bundle);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].stage).toBe('ASSEMBLY');
    expect(diffs[0].status).toBe('not_started');
  });
});

/* ================================================================== */
/*  buildAiCallDiff                                                   */
/* ================================================================== */

describe('buildAiCallDiff', () => {
  it('returns empty for no logs', () => {
    expect(buildAiCallDiff([])).toEqual([]);
  });

  it('builds diffs from AI log entries', () => {
    const logs = [
      {
        seq: 1,
        timestamp: '2024-01-01T00:00:01Z',
        stage: 'RESEARCH',
        taskType: 'research',
        method: 'generateText',
        provider: 'gemini',
        durationMs: 500,
        input: { model: 'gemini-2.0', prompt: 'What is water?' },
        output: { text: 'Water is H2O.' },
      },
    ];
    const diffs = buildAiCallDiff(logs);
    expect(diffs).toHaveLength(1);
    expect(diffs[0].seq).toBe('1');
    expect(diffs[0].status).toBe('ok');
    expect(diffs[0].inputText).toBe('What is water?');
    expect(diffs[0].outputText).toBe('Water is H2O.');
    expect(diffs[0].model).toBe('gemini-2.0');
  });

  it('handles error entries', () => {
    const logs = [
      {
        seq: '2',
        timestamp: '2024-01-01T00:00:02Z',
        stage: 'RESEARCH',
        taskType: 'research',
        method: 'generateText',
        provider: 'openai',
        durationMs: 300,
        input: { model: 'gpt-4', prompt: 'Test' },
        error: 'rate limited',
      },
    ];
    const diffs = buildAiCallDiff(logs);
    expect(diffs[0].status).toBe('error');
    expect(diffs[0].errorText).toBe('rate limited');
    expect(diffs[0].outputText).toBe('');
  });

  it('filters by time window', () => {
    const logs = [
      { seq: 1, timestamp: '2024-01-01T00:00:01Z', stage: 'A', taskType: 't', method: 'm', provider: 'p', durationMs: 100, input: { model: 'm', prompt: 'early' } },
      { seq: 2, timestamp: '2024-01-01T00:01:00Z', stage: 'B', taskType: 't', method: 'm', provider: 'p', durationMs: 100, input: { model: 'm', prompt: 'in window' } },
      { seq: 3, timestamp: '2024-01-01T00:05:00Z', stage: 'C', taskType: 't', method: 'm', provider: 'p', durationMs: 100, input: { model: 'm', prompt: 'late' } },
    ];
    const diffs = buildAiCallDiff(logs, {
      startedAt: '2024-01-01T00:00:30Z',
      endedAt: '2024-01-01T00:02:00Z',
    });
    expect(diffs).toHaveLength(1);
    expect(diffs[0].stage).toBe('B');
  });

  it('sorts by seq number', () => {
    const logs = [
      { seq: 3, timestamp: '2024-01-01T00:00:03Z', stage: 'C', taskType: 't', method: 'm', provider: 'p', durationMs: 100, input: { model: 'm', prompt: 'third' } },
      { seq: 1, timestamp: '2024-01-01T00:00:01Z', stage: 'A', taskType: 't', method: 'm', provider: 'p', durationMs: 100, input: { model: 'm', prompt: 'first' } },
      { seq: 2, timestamp: '2024-01-01T00:00:02Z', stage: 'B', taskType: 't', method: 'm', provider: 'p', durationMs: 100, input: { model: 'm', prompt: 'second' } },
    ];
    const diffs = buildAiCallDiff(logs);
    expect(diffs.map(d => d.stage)).toEqual(['A', 'B', 'C']);
  });

  it('handles array prompts', () => {
    const logs = [
      {
        seq: 1,
        timestamp: '2024-01-01T00:00:01Z',
        stage: 'A',
        taskType: 't',
        method: 'm',
        provider: 'p',
        durationMs: 100,
        input: { model: 'm', prompt: [{ role: 'user', content: 'hello' }] },
      },
    ];
    const diffs = buildAiCallDiff(logs);
    expect(diffs[0].inputText).toContain('hello');
  });

  it('handles output with url instead of text', () => {
    const logs = [
      {
        seq: 1,
        timestamp: '2024-01-01T00:00:01Z',
        stage: 'A',
        taskType: 't',
        method: 'm',
        provider: 'p',
        durationMs: 100,
        input: { model: 'm', prompt: 'generate image' },
        output: { url: 'https://example.com/image.png' },
      },
    ];
    const diffs = buildAiCallDiff(logs);
    expect(diffs[0].outputText).toBe('https://example.com/image.png');
  });

  it('computes diff summary', () => {
    const logs = [
      {
        seq: 1,
        timestamp: '2024-01-01T00:00:01Z',
        stage: 'A',
        taskType: 't',
        method: 'm',
        provider: 'p',
        durationMs: 100,
        input: { model: 'm', prompt: 'Hello World' },
        output: { text: 'Hello Universe' },
      },
    ];
    const diffs = buildAiCallDiff(logs);
    expect(diffs[0].diffSummary.prefixMatchChars).toBeGreaterThan(0);
    expect(diffs[0].diffSummary.changeRatio).toBeGreaterThan(0);
  });

  it('skips logs with invalid timestamps', () => {
    const logs = [
      { seq: 1, timestamp: 'invalid', stage: 'A', taskType: 't', method: 'm', provider: 'p', durationMs: 100, input: { model: 'm', prompt: 'x' } },
    ];
    const diffs = buildAiCallDiff(logs);
    expect(diffs).toHaveLength(0);
  });
});

/* ================================================================== */
/*  buildSpanTree                                                     */
/* ================================================================== */

describe('buildSpanTree', () => {
  it('returns empty for no events', () => {
    expect(buildSpanTree(emptyBundle())).toEqual([]);
  });

  it('builds root nodes for events without parents', () => {
    const tr = mkTrace();
    const bundle = emptyBundle({
      events: [mkEvent('pipeline.start', { topic: 'test', qualityTier: 'standard', totalStages: 3 }, 1000, tr)],
    });
    const roots = buildSpanTree(bundle);
    expect(roots).toHaveLength(1);
    expect(roots[0].spanId).toBe(tr.spanId);
    expect(roots[0].kind).toBe('pipeline.start');
    expect(roots[0].children).toEqual([]);
  });

  it('links child spans to parents', () => {
    const parentTrace = mkTrace();
    const childTrace = mkTrace(parentTrace.spanId);
    const bundle = emptyBundle({
      events: [
        mkEvent('pipeline.start', { topic: 'test', qualityTier: 'standard', totalStages: 3 }, 1000, parentTrace),
        mkEvent('stage.start', { stage: 'RESEARCH' }, 1100, childTrace),
      ],
    });
    const roots = buildSpanTree(bundle);
    expect(roots).toHaveLength(1);
    expect(roots[0].children).toHaveLength(1);
    expect(roots[0].children[0].stage).toBe('RESEARCH');
  });

  it('enriches nodes with completion status and duration', () => {
    const tr = mkTrace();
    const bundle = emptyBundle({
      events: [
        mkEvent('stage.start', { stage: 'RESEARCH' }, 1000, tr),
        mkEvent('stage.complete', { stage: 'RESEARCH', durationMs: 2000 }, 3000, tr),
      ],
    });
    const roots = buildSpanTree(bundle);
    expect(roots[0].status).toBe('ok');
    expect(roots[0].durationMs).toBe(2000);
  });

  it('enriches nodes with error status', () => {
    const tr = mkTrace();
    const bundle = emptyBundle({
      events: [
        mkEvent('stage.start', { stage: 'RESEARCH' }, 1000, tr),
        mkEvent('stage.error', { stage: 'RESEARCH', failure: FAILURE, attempt: 1 }, 3000, tr),
      ],
    });
    const roots = buildSpanTree(bundle);
    expect(roots[0].status).toBe('error');
  });

  it('sorts children by timestamp', () => {
    const parentTrace = mkTrace();
    const child1 = mkTrace(parentTrace.spanId);
    const child2 = mkTrace(parentTrace.spanId);
    const bundle = emptyBundle({
      events: [
        mkEvent('pipeline.start', { topic: 'x', qualityTier: 's', totalStages: 1 }, 1000, parentTrace),
        mkEvent('stage.start', { stage: 'QA_REVIEW' }, 3000, child2),
        mkEvent('stage.start', { stage: 'RESEARCH' }, 2000, child1),
      ],
    });
    const roots = buildSpanTree(bundle);
    expect(roots[0].children[0].stage).toBe('RESEARCH');
    expect(roots[0].children[1].stage).toBe('QA_REVIEW');
  });

  it('extracts provider/model/method from event data', () => {
    const tr = mkTrace();
    const bundle = emptyBundle({
      events: [
        mkEvent('ai_call.start', { stage: 'RESEARCH', method: 'generateText', provider: 'gemini', model: 'gemini-2.0' }, 1000, tr),
      ],
    });
    const roots = buildSpanTree(bundle);
    expect(roots[0].provider).toBe('gemini');
    expect(roots[0].model).toBe('gemini-2.0');
    expect(roots[0].method).toBe('generateText');
  });
});
