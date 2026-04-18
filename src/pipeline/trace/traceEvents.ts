/* ------------------------------------------------------------------ */
/*  Trace Event Schema v1 – industrial-grade pipeline telemetry       */
/*  W3C Trace Context compatible: traceId=32hex, spanId=16hex.       */
/*  Discriminated union on `kind` for type-safe event handling.      */
/* ------------------------------------------------------------------ */

import type { PipelineStage } from '../types.js';

/* ---- Schema version ---- */

export const TRACE_SCHEMA_VERSION = 1;

/* ---- Trace context (W3C Trace Context compatible) ---- */

export interface TraceContext {
  /** 128-bit trace identifier as 32 lowercase hex chars. */
  traceId: string;
  /** 64-bit span identifier as 16 lowercase hex chars. */
  spanId: string;
  /** Parent span's spanId (absent for root spans). */
  parentSpanId?: string;
}

/* ---- Failure classification ---- */

export type FailureCategory =
  | 'transient'
  | 'quota'
  | 'safety'
  | 'timeout'
  | 'abort'
  | 'contract'
  | 'parse'
  | 'infrastructure'
  | 'upstream'
  | 'unknown';

export type FailureCode =
  /* transient */
  | 'BROWSER_TARGET_CLOSED'
  | 'BROWSER_CONTEXT_DESTROYED'
  | 'BROWSER_CLOSED'
  | 'PAGE_CLOSED'
  | 'PROTOCOL_ERROR'
  | 'NETWORK_RESET'
  | 'NETWORK_REFUSED'
  | 'NETWORK_TIMEOUT'
  /* quota */
  | 'PROVIDER_RATE_LIMITED'
  | 'PROVIDER_QUOTA_EXHAUSTED'
  | 'BUDGET_EXCEEDED'
  /* safety */
  | 'SAFETY_BLOCK'
  /* timeout */
  | 'AI_REQUEST_TIMEOUT'
  /* abort */
  | 'USER_ABORT'
  /* contract */
  | 'INPUT_CONTRACT_VIOLATION'
  | 'OUTPUT_CONTRACT_VIOLATION'
  | 'CIR_VALIDATION_FAILED'
  /* parse */
  | 'AI_RESPONSE_PARSE_FAILED'
  /* infrastructure */
  | 'PAGE_CRASHED'
  | 'SEND_PROMPT_PAGE_CRASHED'
  | 'DISK_IO_ERROR'
  /* upstream */
  | 'API_SERVER_ERROR'
  | 'UPSTREAM_UNAVAILABLE'
  /* unknown */
  | 'UNCLASSIFIED';

export interface FailureDescriptor {
  category: FailureCategory;
  code: FailureCode;
  message: string;
  errorType: string;
  retryable: boolean;
  stack?: string;
}

/* ---- Event kinds ---- */

export type TraceEventKind =
  | 'pipeline.start'
  | 'pipeline.complete'
  | 'pipeline.error'
  | 'stage.start'
  | 'stage.complete'
  | 'stage.error'
  | 'stage.retry'
  | 'stage.skip'
  | 'ai_call.start'
  | 'ai_call.complete'
  | 'ai_call.error'
  | 'cost.recorded'
  | 'scene.review'
  | 'assembly.progress'
  | 'checkpoint.pause'
  | 'checkpoint.resume';

/* ---- Base event envelope ---- */

export interface TraceEvent<K extends TraceEventKind, D> {
  /** Schema version (always 1). */
  v: typeof TRACE_SCHEMA_VERSION;
  /** Discriminant for type-safe pattern matching. */
  kind: K;
  /** Trace context linking this event to a trace/span hierarchy. */
  trace: TraceContext;
  /** Project this event belongs to. */
  projectId: string;
  /** ISO-8601 timestamp. */
  ts: string;
  /** Epoch milliseconds (for sorting/duration calculations). */
  tsMs: number;
  /** Event payload — varies by kind. */
  data: D;
  /** Optional freeform attributes for ad-hoc context. */
  attrs?: Record<string, string | number | boolean>;
}

/* ---- Event data payloads ---- */

export interface PipelineStartData {
  topic: string;
  qualityTier: string;
  totalStages: number;
}

export interface PipelineCompleteData {
  durationMs: number;
  stagesCompleted: number;
}

export interface PipelineErrorData {
  failure: FailureDescriptor;
  durationMs: number;
  lastStage?: PipelineStage;
}

export interface StageStartData {
  stage: PipelineStage;
}

export interface StageCompleteData {
  stage: PipelineStage;
  durationMs: number;
}

export interface StageErrorData {
  stage: PipelineStage;
  failure: FailureDescriptor;
  attempt: number;
}

export interface StageRetryData {
  stage: PipelineStage;
  attempt: number;
  maxRetries: number;
  backoffMs: number;
  failure: FailureDescriptor;
}

export interface StageSkipData {
  stage: PipelineStage;
  reason: string;
}

export interface AiCallStartData {
  stage: PipelineStage;
  method: string;
  provider: string;
  model?: string;
}

export interface AiCallCompleteData {
  stage: PipelineStage;
  method: string;
  provider: string;
  model?: string;
  durationMs: number;
  estimatedTokens?: number;
}

export interface AiCallErrorData {
  stage: PipelineStage;
  method: string;
  provider: string;
  model?: string;
  durationMs: number;
  failure: FailureDescriptor;
}

export interface CostRecordedData {
  stage: string;
  method: string;
  provider: string;
  adapter: 'chat' | 'api';
  estimatedCostUsd: number;
  durationMs: number;
}

export interface SceneReviewData {
  sceneId: string;
  status: string;
}

export interface AssemblyProgressData {
  percent: number;
  message: string;
}

export interface CheckpointPauseData {
  stage: PipelineStage;
}

export interface CheckpointResumeData {
  stage: PipelineStage;
}

/* ---- Concrete event types ---- */

export type PipelineStartEvent       = TraceEvent<'pipeline.start', PipelineStartData>;
export type PipelineCompleteEvent    = TraceEvent<'pipeline.complete', PipelineCompleteData>;
export type PipelineErrorEvent       = TraceEvent<'pipeline.error', PipelineErrorData>;
export type StageStartEvent          = TraceEvent<'stage.start', StageStartData>;
export type StageCompleteEvent       = TraceEvent<'stage.complete', StageCompleteData>;
export type StageErrorEvent          = TraceEvent<'stage.error', StageErrorData>;
export type StageRetryEvent          = TraceEvent<'stage.retry', StageRetryData>;
export type StageSkipEvent           = TraceEvent<'stage.skip', StageSkipData>;
export type AiCallStartEvent         = TraceEvent<'ai_call.start', AiCallStartData>;
export type AiCallCompleteEvent      = TraceEvent<'ai_call.complete', AiCallCompleteData>;
export type AiCallErrorEvent         = TraceEvent<'ai_call.error', AiCallErrorData>;
export type CostRecordedEvent        = TraceEvent<'cost.recorded', CostRecordedData>;
export type SceneReviewEvent         = TraceEvent<'scene.review', SceneReviewData>;
export type AssemblyProgressEvent    = TraceEvent<'assembly.progress', AssemblyProgressData>;
export type CheckpointPauseEvent     = TraceEvent<'checkpoint.pause', CheckpointPauseData>;
export type CheckpointResumeEvent    = TraceEvent<'checkpoint.resume', CheckpointResumeData>;

/* ---- Discriminated union of all trace events ---- */

export type AnyTraceEvent =
  | PipelineStartEvent
  | PipelineCompleteEvent
  | PipelineErrorEvent
  | StageStartEvent
  | StageCompleteEvent
  | StageErrorEvent
  | StageRetryEvent
  | StageSkipEvent
  | AiCallStartEvent
  | AiCallCompleteEvent
  | AiCallErrorEvent
  | CostRecordedEvent
  | SceneReviewEvent
  | AssemblyProgressEvent
  | CheckpointPauseEvent
  | CheckpointResumeEvent;

/* ---- Replay bundle ---- */

export interface StageSummary {
  status: 'completed' | 'error' | 'skipped' | 'not_started';
  durationMs?: number;
  retries: number;
  failure?: FailureDescriptor;
}

export interface ReplayTotals {
  stagesCompleted: number;
  stagesFailed: number;
  llmCalls: number;
  costUsd: number;
  retries: number;
}

export interface TraceReplayBundle {
  /** Schema version. */
  v: typeof TRACE_SCHEMA_VERSION;
  /** Root trace ID for this pipeline run. */
  traceId: string;
  /** Project identifier. */
  projectId: string;
  /** Video topic. */
  topic: string;
  /** Quality tier used. */
  qualityTier: string;
  /** Pipeline start time (ISO-8601). */
  startedAt: string;
  /** Pipeline end time (ISO-8601). */
  endedAt?: string;
  /** Total pipeline duration in ms. */
  durationMs?: number;
  /** Final outcome. */
  outcome: 'success' | 'error' | 'aborted' | 'in_progress';
  /** Terminal failure descriptor (for error/aborted outcomes). */
  terminalFailure?: FailureDescriptor;
  /** Ordered list of all trace events. */
  events: AnyTraceEvent[];
  /** Per-stage summary for quick reference. */
  stageSummary: Record<string, StageSummary>;
  /** Aggregated totals. */
  totals: ReplayTotals;
}
