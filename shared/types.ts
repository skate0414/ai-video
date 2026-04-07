/* ------------------------------------------------------------------ */
/*  Shared types — used by both backend (src/) and frontend (ui/) */
/* ------------------------------------------------------------------ */

/* ---- Pipeline enums ---- */

export type PipelineStage =
  | 'CAPABILITY_ASSESSMENT'
  | 'STYLE_EXTRACTION'
  | 'RESEARCH'
  | 'NARRATIVE_MAP'
  | 'SCRIPT_GENERATION'
  | 'QA_REVIEW'
  | 'STORYBOARD'
  | 'REFERENCE_IMAGE'
  | 'KEYFRAME_GEN'
  | 'VIDEO_GEN'
  | 'TTS'
  | 'ASSEMBLY'
  | 'REFINEMENT';

export type ProcessStatus = 'pending' | 'processing' | 'completed' | 'error';

export type QualityTier = 'free' | 'balanced' | 'premium';

/* ---- Model override (per-task-type manual selection) ---- */

export interface ModelOverride {
  adapter: 'chat' | 'api';
  model?: string;
  provider?: string;
}

export type ModelOverrides = Partial<Record<string, ModelOverride>>;

/* ---- Log entry ---- */

export interface LogEntry {
  id: string;
  timestamp: string;
  message: string;
  type: 'info' | 'success' | 'error' | 'warning';
  stage?: PipelineStage;
}

/* ---- Scene (UI-safe subset) ---- */

export interface PipelineScene {
  id: string;
  number: number;
  narrative: string;
  visualPrompt: string;
  estimatedDuration: number;
  assetUrl?: string;
  assetType: 'image' | 'video' | 'placeholder';
  audioUrl?: string;
  referenceImageUrl?: string;
  status: 'pending' | 'generating' | 'done' | 'error' | 'pending_review';
  reviewStatus?: 'pending' | 'pending_review' | 'approved' | 'rejected';
  progressMessage?: string;
}

/* ---- Pipeline project (UI-safe view) ---- */

export interface PipelineProject {
  id: string;
  title: string;
  topic: string;
  qualityTier: QualityTier;
  createdAt: string;
  updatedAt: string;
  currentStage?: PipelineStage;
  stageStatus: Record<PipelineStage, ProcessStatus>;
  pauseAfterStages?: PipelineStage[];
  isPaused?: boolean;
  pausedAtStage?: PipelineStage;
  scenes?: PipelineScene[];
  scriptOutput?: { scriptText: string; [key: string]: any };
  /** QA review result (human or AI) */
  qaReviewResult?: {
    approved: boolean;
    feedback?: string;
    scores?: { accuracy: number; styleConsistency: number; engagement: number; overall: number };
    issues?: string[];
  };
  /** Reference style-anchor images */
  referenceImages?: string[];
  logs: LogEntry[];
  error?: string;
  finalVideoPath?: string;
  modelOverrides?: ModelOverrides;
}

/* ---- Pipeline events (SSE) ---- */

export type PipelineEvent =
  | { type: 'pipeline_created'; payload: { projectId: string } }
  | { type: 'pipeline_stage'; payload: { projectId: string; stage: PipelineStage; status: ProcessStatus; progress?: number } }
  | { type: 'pipeline_artifact'; payload: { projectId: string; stage: PipelineStage; artifactType: string; summary?: string } }
  | { type: 'pipeline_log'; payload: { projectId: string; entry: LogEntry } }
  | { type: 'pipeline_error'; payload: { projectId: string; stage: PipelineStage; error: string } }
  | { type: 'pipeline_complete'; payload: { projectId: string } }
  | { type: 'pipeline_paused'; payload: { projectId: string; stage: PipelineStage } }
  | { type: 'pipeline_resumed'; payload: { projectId: string; stage: PipelineStage } }
  | { type: 'pipeline_scene_review'; payload: { projectId: string; sceneId: string; status: string } }
  | { type: 'pipeline_assembly_progress'; payload: { projectId: string; percent: number; message: string } };

/* ---- Selector chain (resilient multi-strategy selectors) ---- */

/**
 * A single selector strategy — one attempt at finding a DOM element.
 * Multiple strategies form a SelectorChain for resilient element discovery.
 */
export interface SelectorStrategy {
  /** The selector string (CSS, text pattern, role, etc.) */
  selector: string;
  /** How to interpret the selector */
  method: 'css' | 'text' | 'role' | 'testid' | 'xpath';
  /** Higher priority = tried first (descending). Default 1. */
  priority: number;
  /** ISO timestamp of last successful match. */
  lastWorked?: string;
  /** Consecutive failure count. */
  failCount?: number;
}

/**
 * An ordered list of selector strategies to try.
 * The system tries each in priority order (desc) and uses the first match.
 */
export type SelectorChain = SelectorStrategy[];

/**
 * Unified site automation config — describes how to automate any
 * free-tier AI site (chat, image generation, or video generation).
 */
export interface SiteAutomationConfig {
  /** Unique identifier (e.g. 'jimeng-video', 'chatgpt'). */
  id: string;
  /** Display label (e.g. '即梦（视频生成）'). */
  label: string;
  /** What kind of site this is. */
  type: 'chat' | 'image' | 'video' | 'multi';
  /** URL to navigate to. */
  siteUrl: string;
  /** What this site can do. */
  capabilities: {
    text?: boolean;
    image?: boolean;
    video?: boolean;
    fileUpload?: boolean;
    webSearch?: boolean;
  };
  /** Selectors for automation — each is a chain of fallback strategies. */
  selectors: {
    /* Common */
    promptInput: SelectorChain;
    generateButton?: SelectorChain;
    /* Chat-specific */
    responseBlock?: SelectorChain;
    readyIndicator?: SelectorChain;
    quotaExhaustedIndicator?: SelectorChain;
    modelPickerTrigger?: SelectorChain;
    modelOptionSelector?: SelectorChain;
    sendButton?: SelectorChain;
    /* Image/Video result */
    resultElement?: SelectorChain;
    progressIndicator?: SelectorChain;
    downloadButton?: SelectorChain;
    imageUploadTrigger?: SelectorChain;
    fileUploadTrigger?: SelectorChain;
  };
  /** Timing configuration. */
  timing: {
    maxWaitMs: number;
    pollIntervalMs: number;
    hydrationDelayMs: number;
  };
  /** Persistent browser profile directory. */
  profileDir: string;
  /** Optional free-tier daily limits. */
  dailyLimits?: {
    text?: number;
    images?: number;
    videos?: number;
  };
}

/**
 * Selector health summary for a site — result of a selector probe.
 */
export interface SelectorHealth {
  /** ISO timestamp of last probe. */
  lastProbed?: string;
  /** Selector names where all strategies failed. */
  brokenSelectors: string[];
  /** 0–100 health score. */
  healthScore: number;
}

/* ---- Workbench types (shared between backend and frontend) ---- */

/** Provider identifier — built-in providers plus any user-added custom providers. */
export type ProviderId = string;

/** Chat mode – new chat per question or continue in same chat. */
export type ChatMode = 'new' | 'continue';

/** Summary info for a provider, exposed to the UI. */
export interface ProviderInfo {
  id: ProviderId;
  label: string;
  builtin: boolean;
}

/** One login credential for a chat provider. */
export interface Account {
  id: string;
  provider: ProviderId;
  label: string;
  /** Browser user-data directory (persistent cookies / session). */
  profileDir: string;
  /** Whether the account is currently known to have exhausted its quota. */
  quotaExhausted: boolean;
  /** ISO timestamp of last known quota reset, if any. */
  quotaResetAt?: string;
}

/** A model/mode option available for a provider. */
export interface ModelOption {
  id: string;
  label: string;
  /** Sequence of selectors to click to activate this model. Empty/omitted = default (no action needed). */
  selectSteps?: string[];
}

/** A single question to be sent to the AI chat. */
export interface TaskItem {
  id: string;
  question: string;
  /** Which provider to prefer (optional – falls back to any available). */
  preferredProvider?: ProviderId;
  /** Which model/mode to use (optional – falls back to provider default). */
  preferredModel?: string;
  /** Absolute file paths on the server to upload with the question. */
  attachments?: string[];
  status: 'pending' | 'running' | 'done' | 'failed';
  answer?: string;
  error?: string;
  /** ISO timestamp when processing started. */
  startedAt?: string;
  /** ISO timestamp when processing completed. */
  completedAt?: string;
  /** Which account was used. */
  accountId?: string;
}

/** Overall workbench state exposed to the UI. */
export interface WorkbenchState {
  accounts: Account[];
  tasks: TaskItem[];
  isRunning: boolean;
  chatMode: ChatMode;
  /** All available providers (built-in + custom). */
  providers: ProviderInfo[];
  /** Dynamically detected models per provider. */
  detectedModels: Partial<Record<ProviderId, ModelOption[]>>;
  currentTaskId?: string;
  activeAccountId?: string;
  /** Account IDs that currently have a login browser open. */
  loginOpenAccountIds: string[];
}
