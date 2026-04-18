/* ------------------------------------------------------------------ */
/*  Trace module barrel – re-exports for clean imports                */
/* ------------------------------------------------------------------ */

export {
  TRACE_SCHEMA_VERSION,
  type TraceContext,
  type FailureCategory,
  type FailureCode,
  type FailureDescriptor,
  type TraceEventKind,
  type TraceEvent,
  type AnyTraceEvent,
  type TraceReplayBundle,
  type StageSummary,
  type ReplayTotals,
  // Concrete event types
  type PipelineStartEvent,
  type PipelineCompleteEvent,
  type PipelineErrorEvent,
  type StageStartEvent,
  type StageCompleteEvent,
  type StageErrorEvent,
  type StageRetryEvent,
  type StageSkipEvent,
  type AiCallStartEvent,
  type AiCallCompleteEvent,
  type AiCallErrorEvent,
  type CostRecordedEvent,
  type SceneReviewEvent,
  type AssemblyProgressEvent,
  type CheckpointPauseEvent,
  type CheckpointResumeEvent,
  // Data payloads
  type PipelineStartData,
  type PipelineCompleteData,
  type PipelineErrorData,
  type StageStartData,
  type StageCompleteData,
  type StageErrorData,
  type StageRetryData,
  type StageSkipData,
  type AiCallStartData,
  type AiCallCompleteData,
  type AiCallErrorData,
  type CostRecordedData,
  type SceneReviewData,
  type AssemblyProgressData,
  type CheckpointPauseData,
  type CheckpointResumeData,
} from './traceEvents.js';

export {
  generateTraceId,
  generateSpanId,
  createRootContext,
  createChildContext,
  classifyError,
  makeTraceEvent,
} from './traceContext.js';

export {
  TraceWriter,
  type TraceWriterMeta,
} from './traceWriter.js';

export {
  buildTimeline,
  findFailureSpan,
  buildProviderDecisionPath,
  buildStageDiff,
  buildAiCallDiff,
  buildSpanTree,
  type TimelineEntry,
  type FailureSpan,
  type ProviderDecision,
  type StageDiff,
  type RetryAttempt,
  type AiLogEntry,
  type AiCallDiff,
  type SpanNode,
} from './analyzer.js';
