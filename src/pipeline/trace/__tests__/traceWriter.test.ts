import { describe, it, expect, beforeEach } from 'vitest';
import { TraceWriter } from '../traceWriter.js';
import { makeTraceEvent, createRootContext, createChildContext } from '../traceContext.js';
import { TRACE_SCHEMA_VERSION } from '../traceEvents.js';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('TraceWriter', () => {
  let projectDir: string;
  const traceId = 'a'.repeat(32);
  const projectId = 'test-project';

  beforeEach(() => {
    projectDir = mkdtempSync(join(tmpdir(), 'trace-writer-test-'));
  });

  it('creates trace directory on construction', () => {
    new TraceWriter(traceId, projectId, projectDir);
    expect(existsSync(join(projectDir, 'trace'))).toBe(true);
  });

  it('appends events to buffer and JSONL file', () => {
    const writer = new TraceWriter(traceId, projectId, projectDir);
    const ctx = createRootContext(traceId);

    const event = makeTraceEvent('pipeline.start', ctx, projectId, {
      topic: 'test',
      qualityTier: 'free' as const,
      totalStages: 14,
    });
    writer.append(event);

    expect(writer.getEvents()).toHaveLength(1);
    expect(writer.getEvents()[0]).toBe(event);

    // JSONL file should exist
    const jsonlPath = join(projectDir, 'trace', `events-${traceId}.jsonl`);
    expect(existsSync(jsonlPath)).toBe(true);
    const lines = readFileSync(jsonlPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).kind).toBe('pipeline.start');
  });

  it('preserves event ordering', () => {
    const writer = new TraceWriter(traceId, projectId, projectDir);
    const ctx = createRootContext(traceId);

    writer.append(makeTraceEvent('pipeline.start', ctx, projectId, {
      topic: 'test', qualityTier: 'free' as const, totalStages: 14,
    }));
    writer.append(makeTraceEvent('stage.start', createChildContext(ctx), projectId, {
      stage: 'SCRIPT_GENERATION' as any,
    }));
    writer.append(makeTraceEvent('stage.complete', createChildContext(ctx), projectId, {
      stage: 'SCRIPT_GENERATION' as any, durationMs: 5000,
    }));

    const events = writer.getEvents();
    expect(events).toHaveLength(3);
    expect(events[0].kind).toBe('pipeline.start');
    expect(events[1].kind).toBe('stage.start');
    expect(events[2].kind).toBe('stage.complete');
  });

  it('builds replay bundle with correct stageSummary', () => {
    const writer = new TraceWriter(traceId, projectId, projectDir);
    const ctx = createRootContext(traceId);

    writer.append(makeTraceEvent('pipeline.start', ctx, projectId, {
      topic: 'test', qualityTier: 'free' as const, totalStages: 2,
    }));
    writer.append(makeTraceEvent('stage.start', createChildContext(ctx), projectId, {
      stage: 'CAPABILITY_ASSESSMENT' as any,
    }));
    writer.append(makeTraceEvent('stage.complete', createChildContext(ctx), projectId, {
      stage: 'CAPABILITY_ASSESSMENT' as any, durationMs: 1000,
    }));
    writer.append(makeTraceEvent('stage.start', createChildContext(ctx), projectId, {
      stage: 'SCRIPT_GENERATION' as any,
    }));
    writer.append(makeTraceEvent('stage.error', createChildContext(ctx), projectId, {
      stage: 'SCRIPT_GENERATION' as any,
      failure: { category: 'parse', code: 'AI_RESPONSE_PARSE_FAILED', message: 'bad json', errorType: 'AIParseError', retryable: true },
      attempt: 1,
    }));
    writer.append(makeTraceEvent('pipeline.error', ctx, projectId, {
      failure: { category: 'parse', code: 'AI_RESPONSE_PARSE_FAILED', message: 'bad json', errorType: 'AIParseError', retryable: true },
      durationMs: 3000,
    }));

    const bundle = writer.buildReplayBundle({
      topic: 'test', qualityTier: 'free', startedAt: '2026-01-01T00:00:00.000Z',
    });

    expect(bundle.v).toBe(TRACE_SCHEMA_VERSION);
    expect(bundle.outcome).toBe('error');
    expect(bundle.totals.stagesCompleted).toBe(1);
    expect(bundle.totals.stagesFailed).toBe(1);
    expect(bundle.stageSummary['CAPABILITY_ASSESSMENT'].status).toBe('completed');
    expect(bundle.stageSummary['CAPABILITY_ASSESSMENT'].durationMs).toBe(1000);
    expect(bundle.stageSummary['SCRIPT_GENERATION'].status).toBe('error');
    expect(bundle.terminalFailure?.code).toBe('AI_RESPONSE_PARSE_FAILED');
  });

  it('sets outcome to success for pipeline.complete', () => {
    const writer = new TraceWriter(traceId, projectId, projectDir);
    const ctx = createRootContext(traceId);

    writer.append(makeTraceEvent('pipeline.start', ctx, projectId, {
      topic: 'test', qualityTier: 'free' as const, totalStages: 1,
    }));
    writer.append(makeTraceEvent('pipeline.complete', ctx, projectId, {
      durationMs: 5000, stagesCompleted: 1,
    }));

    const bundle = writer.buildReplayBundle({
      topic: 'test', qualityTier: 'free', startedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(bundle.outcome).toBe('success');
    expect(bundle.durationMs).toBe(5000);
  });

  it('sets outcome to aborted for abort errors', () => {
    const writer = new TraceWriter(traceId, projectId, projectDir);
    const ctx = createRootContext(traceId);

    writer.append(makeTraceEvent('pipeline.start', ctx, projectId, {
      topic: 'test', qualityTier: 'free' as const, totalStages: 1,
    }));
    writer.append(makeTraceEvent('pipeline.error', ctx, projectId, {
      failure: { category: 'abort', code: 'USER_ABORT', message: 'aborted', errorType: 'AIRequestAbortedError', retryable: false },
      durationMs: 2000,
    }));

    const bundle = writer.buildReplayBundle({
      topic: 'test', qualityTier: 'free', startedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(bundle.outcome).toBe('aborted');
  });

  it('counts retries in totals and stageSummary', () => {
    const writer = new TraceWriter(traceId, projectId, projectDir);
    const ctx = createRootContext(traceId);

    writer.append(makeTraceEvent('stage.start', createChildContext(ctx), projectId, {
      stage: 'TTS' as any,
    }));
    writer.append(makeTraceEvent('stage.retry', createChildContext(ctx), projectId, {
      stage: 'TTS' as any, attempt: 1, maxRetries: 2, backoffMs: 1000,
      failure: { category: 'transient', code: 'BROWSER_TARGET_CLOSED', message: 'closed', errorType: 'Error', retryable: true },
    }));
    writer.append(makeTraceEvent('stage.complete', createChildContext(ctx), projectId, {
      stage: 'TTS' as any, durationMs: 3000,
    }));

    const bundle = writer.buildReplayBundle({
      topic: 'test', qualityTier: 'free', startedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(bundle.totals.retries).toBe(1);
    expect(bundle.stageSummary['TTS'].retries).toBe(1);
    expect(bundle.stageSummary['TTS'].status).toBe('completed');
  });

  it('save and load roundtrip produces equivalent bundle', () => {
    const writer = new TraceWriter(traceId, projectId, projectDir);
    const ctx = createRootContext(traceId);

    writer.append(makeTraceEvent('pipeline.start', ctx, projectId, {
      topic: 'roundtrip test', qualityTier: 'balanced' as const, totalStages: 1,
    }));
    writer.append(makeTraceEvent('pipeline.complete', ctx, projectId, {
      durationMs: 1000, stagesCompleted: 1,
    }));

    const meta = { topic: 'roundtrip test', qualityTier: 'balanced' as const, startedAt: '2026-01-01T00:00:00.000Z' };
    writer.save(meta);

    const bundlePath = join(projectDir, 'trace', `trace-${traceId}.json`);
    expect(existsSync(bundlePath)).toBe(true);

    const loaded = TraceWriter.load(bundlePath);
    expect(loaded.v).toBe(TRACE_SCHEMA_VERSION);
    expect(loaded.traceId).toBe(traceId);
    expect(loaded.projectId).toBe(projectId);
    expect(loaded.topic).toBe('roundtrip test');
    expect(loaded.outcome).toBe('success');
    expect(loaded.events).toHaveLength(2);
  });

  it('counts llmCalls from ai_call.start events', () => {
    const writer = new TraceWriter(traceId, projectId, projectDir);
    const ctx = createRootContext(traceId);

    writer.append(makeTraceEvent('ai_call.start', createChildContext(ctx), projectId, {
      stage: 'SCRIPT_GENERATION' as any, method: 'generateText', provider: 'gemini',
    }));
    writer.append(makeTraceEvent('ai_call.start', createChildContext(ctx), projectId, {
      stage: 'SCRIPT_GENERATION' as any, method: 'generateText', provider: 'gemini',
    }));

    const bundle = writer.buildReplayBundle({
      topic: 'test', qualityTier: 'free', startedAt: '2026-01-01T00:00:00.000Z',
    });
    expect(bundle.totals.llmCalls).toBe(2);
  });
});
