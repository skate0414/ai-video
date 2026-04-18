/* ---- Workbench types (single source of truth: shared/types.ts) ---- */

export type {
  ProviderId,
  ChatMode,
  ProviderInfo,
  Account,
  AiResource,
  AiResourceType,
  ModelOption,
  TaskItem,
  WorkbenchState,
  SelectorStrategy,
  SelectorChain,
  QueueEtaPattern,
  QueueDetectionConfig,
  SiteAutomationConfig,
  SelectorHealth,
  WorkbenchEvent,
} from '../../shared/types';

/* ---- Pipeline types (single source of truth: shared/types.ts) ---- */

export { SSE_EVENT, WB_EVENT, SUBTITLE_PRESETS, DEFAULT_REFINE_OPTIONS } from '../../shared/types';

export type {
  PipelineStage,
  ProcessStatus,
  ModelOverride,
  ModelOverrides,
  StageProviderConfig,
  StageProviderOverrides,
  StageProviderOption,
  StageProviderMap,
  LogEntry as PipelineLogEntry,
  PipelineScene,
  PipelineProject,
  PipelineEvent,
  SubtitlePreset,
  SubtitleStyle,
  TitleCardStyle,
  QualityPreset,
  SpeedPreset,
  RefineOptions,
} from '../../shared/types';

/* ---- Settings types ---- */

export interface EnvironmentStatus {
  ffmpegAvailable: boolean;
  edgeTtsAvailable: boolean;
  playwrightAvailable: boolean;
  chromiumAvailable?: boolean;
  nodeVersion: string;
  platform: string;
  dataDir: string;
}

export interface TTSSettings {
  voice?: string;
  rate?: string;
  pitch?: string;
}

export interface VideoProviderConfig {
  url: string;
  promptInput: string;
  imageUploadTrigger?: string;
  generateButton: string;
  progressIndicator?: string;
  videoResult: string;
  downloadButton?: string;
  maxWaitMs?: number;
  queueDetection?: QueueDetectionConfig;
  profileDir: string;
}

export interface GlobalCostSummary {
  totalCostUsd: number;
  totalCalls: number;
  totalFallbackCalls: number;
  byProject: Record<string, { costUsd: number; calls: number }>;
  dailyTotals: Record<string, { costUsd: number; calls: number }>;
}

export interface RouteTableEntry {
  stage: string;
  taskType: string;
  adapter: string;
  provider?: string;
  model?: string;
  reason: string;
}

/* ---- Trace Replay types ---- */

export interface FailureDescriptor {
  category: string;
  code: string;
  message: string;
  errorType: string;
  retryable: boolean;
  stack?: string;
}

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
  v: number;
  traceId: string;
  projectId: string;
  topic: string;
  qualityTier: string;
  startedAt: string;
  endedAt?: string;
  durationMs?: number;
  outcome: 'success' | 'error' | 'aborted' | 'in_progress';
  terminalFailure?: FailureDescriptor;
  events: Array<{ kind: string; ts: string; tsMs: number; data: Record<string, unknown>; trace: { traceId: string; spanId: string; parentSpanId?: string }; projectId: string }>;
  stageSummary: Record<string, StageSummary>;
  totals: ReplayTotals;
}

export interface TimelineEntry {
  offsetMs: number;
  ts: string;
  kind: string;
  stage?: string;
  provider?: string;
  model?: string;
  durationMs?: number;
  costUsd?: number;
  failure?: FailureDescriptor;
  status: 'ok' | 'error' | 'retry' | 'skip' | 'info';
}

export interface FailureSpan {
  stage: string;
  failure: FailureDescriptor;
  retries: Array<{ attempt: number; backoffMs: number; failure: FailureDescriptor }>;
  aiCalls: Array<{ provider: string; model?: string; method: string; durationMs: number; failure?: FailureDescriptor }>;
  totalDurationMs: number;
}

export interface ProviderDecision {
  stage: string;
  provider: string;
  adapter?: string;
  model?: string;
  method: string;
  durationMs?: number;
  costUsd?: number;
  isFallback: boolean;
  failed: boolean;
}

export interface StageDiff {
  stage: string;
  status: 'completed' | 'error' | 'skipped' | 'not_started';
  startedAt?: string;
  endedAt?: string;
  durationMs?: number;
  retries: number;
  failure?: FailureDescriptor;
  aiCalls: number;
  costUsd: number;
}

/* ---- AI Log entry (input/output diff) ---- */

export interface AiLogEntry {
  seq: string | number;
  timestamp: string;
  stage: string;
  taskType: string;
  method: string;
  provider: string;
  durationMs: number;
  input: {
    model?: string;
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

export interface TraceAnalysis {
  timeline: TimelineEntry[];
  failureSpan: FailureSpan | null;
  providerPath: ProviderDecision[];
  stageDiff: StageDiff[];
  aiDiffs: AiCallDiff[];
  spanTree: SpanNode[];
}
