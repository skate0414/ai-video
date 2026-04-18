/* ------------------------------------------------------------------ */
/*  Trace Analyzer – pure functions for trace bundle analysis         */
/*  No I/O, no side effects. Takes TraceReplayBundle → structured    */
/*  analysis objects. Used by both CLI and UI.                        */
/* ------------------------------------------------------------------ */

import type {
  TraceReplayBundle,
  AnyTraceEvent,
  FailureDescriptor,
} from './traceEvents.js';

/* ---- AI Log entry (from loggingAdapter JSON files) ---- */

export interface AiLogEntry {
  seq: string | number;
  timestamp: string;
  stage: string;
  taskType: string;
  method: string;
  provider: string;
  durationMs: number;
  input: {
    model: string;
    prompt: string | unknown[];
    options?: Record<string, unknown>;
  };
  output?: Record<string, unknown> | null;
  error?: string | null;
}

export interface AiCallDiff {
  seq: string;
  timestamp: string;
  stage: string;
  taskType: string;
  method: string;
  provider: string;
  model?: string;
  durationMs: number;
  status: 'ok' | 'error';
  inputText: string;
  outputText: string;
  errorText?: string;
  diffSummary: {
    prefixMatchChars: number;
    changedBeforeChars: number;
    changedAfterChars: number;
    changeRatio: number;
  };
  preview: {
    before: string;
    after: string;
  };
}

/* ---- Span tree node for parent-child graph ---- */

export interface SpanNode {
  spanId: string;
  parentSpanId?: string;
  kind: string;
  stage?: string;
  provider?: string;
  model?: string;
  method?: string;
  ts: string;
  tsMs: number;
  durationMs?: number;
  status: 'ok' | 'error' | 'info';
  children: SpanNode[];
}

/* ---- Output types ---- */

export interface TimelineEntry {
  /** Offset from pipeline start in ms. */
  offsetMs: number;
  /** ISO-8601 timestamp. */
  ts: string;
  /** Event kind (e.g. 'stage.start'). */
  kind: string;
  /** Pipeline stage (if applicable). */
  stage?: string;
  /** Provider name (for ai_call events). */
  provider?: string;
  /** Model name (for ai_call events). */
  model?: string;
  /** Duration in ms (for complete/error events). */
  durationMs?: number;
  /** Estimated cost in USD (for cost events). */
  costUsd?: number;
  /** Failure info if this is an error event. */
  failure?: FailureDescriptor;
  /** Status icon for display. */
  status: 'ok' | 'error' | 'retry' | 'skip' | 'info';
}

export interface RetryAttempt {
  attempt: number;
  backoffMs: number;
  failure: FailureDescriptor;
}

export interface FailureSpan {
  /** The stage that ultimately failed. */
  stage: string;
  /** Terminal failure descriptor. */
  failure: FailureDescriptor;
  /** How many retries were attempted before failure. */
  retries: RetryAttempt[];
  /** AI calls that led to the failure. */
  aiCalls: Array<{
    provider: string;
    model?: string;
    method: string;
    durationMs: number;
    failure?: FailureDescriptor;
  }>;
  /** Total time spent in the failing stage (including retries). */
  totalDurationMs: number;
}

export interface ProviderDecision {
  /** Pipeline stage. */
  stage: string;
  /** Provider used. */
  provider: string;
  /** Adapter type (chat/api). */
  adapter?: string;
  /** Model used. */
  model?: string;
  /** Method called. */
  method: string;
  /** Duration of the call. */
  durationMs?: number;
  /** Cost in USD. */
  costUsd?: number;
  /** Whether this was a fallback call. */
  isFallback: boolean;
  /** Whether the call failed. */
  failed: boolean;
}

export interface StageDiff {
  /** Stage name. */
  stage: string;
  /** Stage status. */
  status: 'completed' | 'error' | 'skipped' | 'not_started';
  /** When stage started (ISO-8601). */
  startedAt?: string;
  /** When stage ended (ISO-8601). */
  endedAt?: string;
  /** Duration in ms. */
  durationMs?: number;
  /** Number of retry attempts. */
  retries: number;
  /** Failure info if errored. */
  failure?: FailureDescriptor;
  /** Number of AI calls within this stage. */
  aiCalls: number;
  /** Cost accumulated in this stage. */
  costUsd: number;
}

interface AiDiffWindow {
  startedAt: string;
  endedAt?: string;
}

/* ---- Analysis functions ---- */

/**
 * Build a sorted timeline of all events with computed offsets.
 */
export function buildTimeline(bundle: TraceReplayBundle): TimelineEntry[] {
  const startMs = bundle.events.length > 0 ? bundle.events[0].tsMs : 0;

  return bundle.events.map((evt): TimelineEntry => {
    const base: TimelineEntry = {
      offsetMs: evt.tsMs - startMs,
      ts: evt.ts,
      kind: evt.kind,
      status: 'info',
    };

    switch (evt.kind) {
      case 'pipeline.start':
        return { ...base, status: 'ok' };

      case 'pipeline.complete':
        return { ...base, status: 'ok', durationMs: evt.data.durationMs };

      case 'pipeline.error':
        return {
          ...base, status: 'error',
          failure: evt.data.failure,
          durationMs: evt.data.durationMs,
        };

      case 'stage.start':
        return { ...base, stage: evt.data.stage, status: 'ok' };

      case 'stage.complete':
        return {
          ...base, stage: evt.data.stage, status: 'ok',
          durationMs: evt.data.durationMs,
        };

      case 'stage.error':
        return {
          ...base, stage: evt.data.stage, status: 'error',
          failure: evt.data.failure,
        };

      case 'stage.retry':
        return { ...base, stage: evt.data.stage, status: 'retry' };

      case 'stage.skip':
        return { ...base, stage: evt.data.stage, status: 'skip' };

      case 'ai_call.start':
        return {
          ...base, stage: evt.data.stage, status: 'info',
          provider: evt.data.provider,
          model: evt.data.model,
        };

      case 'ai_call.complete':
        return {
          ...base, stage: evt.data.stage, status: 'ok',
          provider: evt.data.provider,
          model: evt.data.model,
          durationMs: evt.data.durationMs,
        };

      case 'ai_call.error':
        return {
          ...base, stage: evt.data.stage, status: 'error',
          provider: evt.data.provider,
          model: evt.data.model,
          durationMs: evt.data.durationMs,
          failure: evt.data.failure,
        };

      case 'cost.recorded':
        return {
          ...base, stage: evt.data.stage, status: 'info',
          provider: evt.data.provider,
          costUsd: evt.data.estimatedCostUsd,
        };

      default:
        return base;
    }
  });
}

/**
 * Find the failure span — the stage that caused the pipeline to fail,
 * including retry history and related AI calls.
 * Returns null if the pipeline succeeded.
 */
export function findFailureSpan(bundle: TraceReplayBundle): FailureSpan | null {
  if (bundle.outcome === 'success' || bundle.outcome === 'in_progress') {
    return null;
  }

  if (!bundle.terminalFailure) {
    return null;
  }

  // Find the failed stage from stageSummary
  let failedStage: string | undefined;
  for (const [stage, summary] of Object.entries(bundle.stageSummary)) {
    if (summary.status === 'error') {
      failedStage = stage;
      break;
    }
  }

  // Fallback: get lastStage from pipeline.error event
  if (!failedStage) {
    const pipelineError = bundle.events.find(
      (e): e is Extract<AnyTraceEvent, { kind: 'pipeline.error' }> =>
        e.kind === 'pipeline.error',
    );
    failedStage = pipelineError?.data.lastStage ?? 'UNKNOWN';
  }

  // Collect retries for the failed stage
  const retries: RetryAttempt[] = [];
  for (const evt of bundle.events) {
    if (evt.kind === 'stage.retry' && evt.data.stage === failedStage) {
      retries.push({
        attempt: evt.data.attempt,
        backoffMs: evt.data.backoffMs,
        failure: evt.data.failure,
      });
    }
  }

  // Collect ai_calls for the failed stage
  const aiCalls: FailureSpan['aiCalls'] = [];
  for (const evt of bundle.events) {
    if (evt.kind === 'ai_call.complete' && evt.data.stage === failedStage) {
      aiCalls.push({
        provider: evt.data.provider,
        model: evt.data.model,
        method: evt.data.method,
        durationMs: evt.data.durationMs,
      });
    }
    if (evt.kind === 'ai_call.error' && evt.data.stage === failedStage) {
      aiCalls.push({
        provider: evt.data.provider,
        model: evt.data.model,
        method: evt.data.method,
        durationMs: evt.data.durationMs,
        failure: evt.data.failure,
      });
    }
  }

  // Compute total time in failed stage
  let totalDurationMs = 0;
  let stageStartMs: number | undefined;
  for (const evt of bundle.events) {
    if (evt.kind === 'stage.start' && evt.data.stage === failedStage) {
      stageStartMs = evt.tsMs;
    }
    if (
      (evt.kind === 'stage.error' || evt.kind === 'stage.complete') &&
      evt.data.stage === failedStage
    ) {
      if (stageStartMs !== undefined) {
        totalDurationMs += evt.tsMs - stageStartMs;
        stageStartMs = undefined;
      }
    }
  }

  return {
    stage: failedStage,
    failure: bundle.terminalFailure,
    retries,
    aiCalls,
    totalDurationMs,
  };
}

/**
 * Build the provider decision path — which provider/model was used for each AI call.
 */
export function buildProviderDecisionPath(bundle: TraceReplayBundle): ProviderDecision[] {
  const decisions: ProviderDecision[] = [];

  // Track completed/errored calls by stage+method+provider in occurrence order.
  // We intentionally do not require spanId equality because some call sites
  // may emit distinct span ids for start/end while preserving call order.
  const completedCalls = new Map<string, AnyTraceEvent[]>();
  for (const evt of bundle.events) {
    if (evt.kind === 'ai_call.complete' || evt.kind === 'ai_call.error') {
      const key = `${evt.data.stage}:${evt.data.method}:${evt.data.provider}`;
      const queue = completedCalls.get(key) ?? [];
      queue.push(evt);
      completedCalls.set(key, queue);
    }
  }

  // Track cost per stage+method+provider
  const costMap = new Map<string, number>();
  for (const evt of bundle.events) {
    if (evt.kind === 'cost.recorded') {
      const key = `${evt.data.stage}:${evt.data.method}:${evt.data.provider}`;
      costMap.set(key, (costMap.get(key) ?? 0) + evt.data.estimatedCostUsd);
    }
  }

  // Track which stages had retries (fallback indicator)
  const retriedStages = new Set<string>();
  for (const evt of bundle.events) {
    if (evt.kind === 'stage.retry') {
      retriedStages.add(evt.data.stage);
    }
  }

  // Build decisions from ai_call.start events
  for (const evt of bundle.events) {
    if (evt.kind !== 'ai_call.start') continue;

    const endKey = `${evt.data.stage}:${evt.data.method}:${evt.data.provider}`;
    const queue = completedCalls.get(endKey) ?? [];
    const matchedEnd = queue.length > 0 ? queue.shift() : undefined;
    if (queue.length > 0 || completedCalls.has(endKey)) {
      completedCalls.set(endKey, queue);
    }
    const costKey = `${evt.data.stage}:${evt.data.method}:${evt.data.provider}`;

    const decision: ProviderDecision = {
      stage: evt.data.stage,
      provider: evt.data.provider,
      model: evt.data.model,
      method: evt.data.method,
      isFallback: retriedStages.has(evt.data.stage),
      failed: matchedEnd?.kind === 'ai_call.error',
    };

    if (matchedEnd?.kind === 'ai_call.complete') {
      decision.durationMs = matchedEnd.data.durationMs;
    } else if (matchedEnd?.kind === 'ai_call.error') {
      decision.durationMs = matchedEnd.data.durationMs;
    }

    const cost = costMap.get(costKey);
    if (cost !== undefined) {
      decision.costUsd = cost;
    }

    // Detect adapter from cost.recorded event
    const costEvt = bundle.events.find(
      e => e.kind === 'cost.recorded' &&
        e.data.stage === evt.data.stage &&
        e.data.method === evt.data.method &&
        e.data.provider === evt.data.provider,
    );
    if (costEvt?.kind === 'cost.recorded') {
      decision.adapter = costEvt.data.adapter;
    }

    decisions.push(decision);
  }

  return decisions;
}

/**
 * Build per-stage diffs showing status, duration, retries, and costs.
 */
export function buildStageDiff(bundle: TraceReplayBundle): StageDiff[] {
  const stages: StageDiff[] = [];

  // Collect all unique stages from events (in order of appearance)
  const stageOrder: string[] = [];
  const stageSet = new Set<string>();
  for (const evt of bundle.events) {
    if (evt.kind === 'stage.start' && !stageSet.has(evt.data.stage)) {
      stageOrder.push(evt.data.stage);
      stageSet.add(evt.data.stage);
    }
    if (evt.kind === 'stage.skip' && !stageSet.has(evt.data.stage)) {
      stageOrder.push(evt.data.stage);
      stageSet.add(evt.data.stage);
    }
  }

  // Also include stages from stageSummary not seen in events
  for (const stage of Object.keys(bundle.stageSummary)) {
    if (!stageSet.has(stage)) {
      stageOrder.push(stage);
      stageSet.add(stage);
    }
  }

  for (const stage of stageOrder) {
    const summary = bundle.stageSummary[stage];
    const diff: StageDiff = {
      stage,
      status: summary?.status ?? 'not_started',
      retries: summary?.retries ?? 0,
      failure: summary?.failure,
      durationMs: summary?.durationMs,
      aiCalls: 0,
      costUsd: 0,
    };

    // Find timestamps
    for (const evt of bundle.events) {
      if (evt.kind === 'stage.start' && evt.data.stage === stage && !diff.startedAt) {
        diff.startedAt = evt.ts;
      }
      if (
        (evt.kind === 'stage.complete' || evt.kind === 'stage.error') &&
        evt.data.stage === stage
      ) {
        diff.endedAt = evt.ts;
      }
      if (evt.kind === 'ai_call.start' && evt.data.stage === stage) {
        diff.aiCalls++;
      }
      if (evt.kind === 'cost.recorded' && evt.data.stage === stage) {
        diff.costUsd += evt.data.estimatedCostUsd;
      }
    }

    stages.push(diff);
  }

  return stages;
}

/**
 * Build structured input/output diffs from AI logs.
 * Optional window limits logs to the pipeline run time range.
 */
export function buildAiCallDiff(logs: AiLogEntry[], window?: AiDiffWindow): AiCallDiff[] {
  const startMs = window ? Date.parse(window.startedAt) : Number.NEGATIVE_INFINITY;
  const endMs = window?.endedAt ? Date.parse(window.endedAt) : Number.POSITIVE_INFINITY;

  const inWindow = logs.filter(log => {
    const ts = Date.parse(log.timestamp);
    if (Number.isNaN(ts)) return false;
    return ts >= startMs && ts <= endMs;
  });

  const sorted = inWindow.sort((a, b) => {
    const aSeq = Number(a.seq);
    const bSeq = Number(b.seq);
    if (!Number.isNaN(aSeq) && !Number.isNaN(bSeq) && aSeq !== bSeq) return aSeq - bSeq;
    return Date.parse(a.timestamp) - Date.parse(b.timestamp);
  });

  return sorted.map(log => {
    const inputText = stringifyPrompt(log.input?.prompt);
    const outputText = log.error
      ? ''
      : stringifyOutput(log.output);
    const errorText = log.error ? String(log.error) : undefined;
    const target = errorText ?? outputText;
    const summary = summarizeDiff(inputText, target);

    return {
      seq: String(log.seq),
      timestamp: log.timestamp,
      stage: log.stage,
      taskType: log.taskType,
      method: log.method,
      provider: log.provider,
      model: typeof log.input?.model === 'string' ? log.input.model : undefined,
      durationMs: Number(log.durationMs) || 0,
      status: log.error ? 'error' : 'ok',
      inputText,
      outputText,
      errorText,
      diffSummary: {
        prefixMatchChars: summary.prefix,
        changedBeforeChars: summary.changedBefore,
        changedAfterChars: summary.changedAfter,
        changeRatio: summary.ratio,
      },
      preview: {
        before: summary.beforePreview,
        after: summary.afterPreview,
      },
    };
  });
}

/**
 * Build a span tree from flat trace events.
 * Groups events by spanId and links via parentSpanId.
 */
export function buildSpanTree(bundle: TraceReplayBundle): SpanNode[] {
  // Collect one representative node per spanId (first event seen defines it,
  // later events enrich with duration/status).
  const nodeMap = new Map<string, SpanNode>();

  for (const evt of bundle.events) {
    const { spanId, parentSpanId } = evt.trace;
    const existing = nodeMap.get(spanId);

    if (!existing) {
      const node: SpanNode = {
        spanId,
        parentSpanId,
        kind: evt.kind,
        ts: evt.ts,
        tsMs: evt.tsMs,
        status: 'info',
        children: [],
      };

      // Extract stage/provider/model/method from event data
      const d = evt.data as unknown as Record<string, unknown>;
      if (d.stage) node.stage = d.stage as string;
      if (d.provider) node.provider = d.provider as string;
      if (d.model) node.model = d.model as string;
      if (d.method) node.method = d.method as string;

      nodeMap.set(spanId, node);
    } else {
      // Enrich: if this event is a completion/error, update status + duration
      if (evt.kind.endsWith('.complete')) {
        existing.status = 'ok';
        const d = evt.data as unknown as Record<string, unknown>;
        if (typeof d.durationMs === 'number') existing.durationMs = d.durationMs;
      } else if (evt.kind.endsWith('.error')) {
        existing.status = 'error';
        const d = evt.data as unknown as Record<string, unknown>;
        if (typeof d.durationMs === 'number') existing.durationMs = d.durationMs;
      }
    }
  }

  // Build parent→children links
  const roots: SpanNode[] = [];
  for (const node of nodeMap.values()) {
    if (node.parentSpanId) {
      const parent = nodeMap.get(node.parentSpanId);
      if (parent) {
        parent.children.push(node);
        continue;
      }
    }
    roots.push(node);
  }

  // Sort children by timestamp
  for (const node of nodeMap.values()) {
    node.children.sort((a, b) => a.tsMs - b.tsMs);
  }

  return roots.sort((a, b) => a.tsMs - b.tsMs);
}

function stringifyPrompt(prompt: string | unknown[] | undefined): string {
  if (typeof prompt === 'string') return prompt;
  if (Array.isArray(prompt)) {
    try {
      return JSON.stringify(prompt, null, 2);
    } catch {
      return String(prompt);
    }
  }
  return '';
}

function stringifyOutput(output: Record<string, unknown> | null | undefined): string {
  if (!output) return '';
  const asText = output.text;
  if (typeof asText === 'string') return asText;
  const asUrl = output.url;
  if (typeof asUrl === 'string') return asUrl;
  try {
    return JSON.stringify(output, null, 2);
  } catch {
    return String(output);
  }
}

function summarizeDiff(before: string, after: string): {
  prefix: number;
  changedBefore: number;
  changedAfter: number;
  ratio: number;
  beforePreview: string;
  afterPreview: string;
} {
  const prefix = commonPrefix(before, after);
  const suffix = commonSuffix(before, after, prefix);
  const changedBefore = Math.max(0, before.length - prefix - suffix);
  const changedAfter = Math.max(0, after.length - prefix - suffix);
  const denom = Math.max(before.length, after.length, 1);
  const ratio = Number(((changedBefore + changedAfter) / denom).toFixed(4));

  const beforeSliceStart = Math.max(0, prefix - 120);
  const beforeSliceEnd = Math.min(before.length, prefix + changedBefore + 120);
  const afterSliceStart = Math.max(0, prefix - 120);
  const afterSliceEnd = Math.min(after.length, prefix + changedAfter + 120);

  return {
    prefix,
    changedBefore,
    changedAfter,
    ratio,
    beforePreview: before.slice(beforeSliceStart, beforeSliceEnd),
    afterPreview: after.slice(afterSliceStart, afterSliceEnd),
  };
}

function commonPrefix(a: string, b: string): number {
  const limit = Math.min(a.length, b.length);
  let i = 0;
  while (i < limit && a.charCodeAt(i) === b.charCodeAt(i)) i++;
  return i;
}

function commonSuffix(a: string, b: string, consumedPrefix: number): number {
  const maxSuffix = Math.min(a.length, b.length) - consumedPrefix;
  let i = 0;
  while (
    i < maxSuffix &&
    a.charCodeAt(a.length - 1 - i) === b.charCodeAt(b.length - 1 - i)
  ) {
    i++;
  }
  return i;
}
