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
  | 'TEMPORAL_PLANNING'
  | 'STORYBOARD'
  | 'VIDEO_IR_COMPILE'
  | 'REFERENCE_IMAGE'
  | 'KEYFRAME_GEN'
  | 'VIDEO_GEN'
  | 'TTS'
  | 'ASSEMBLY'
  | 'REFINEMENT';

export type ProcessStatus = 'pending' | 'processing' | 'completed' | 'error';

/* ---- Model override (per-task-type manual selection) ---- */

export interface ModelOverride {
  adapter: 'chat' | 'api';
  model?: string;
  provider?: string;
}

export type ModelOverrides = Partial<Record<string, ModelOverride>>;

/* ---- Stage-level provider override (per-stage AI resource selection) ---- */

/**
 * Per-stage provider configuration — allows the user to pick a specific
 * provider (web or API) and optionally restrict to specific resource IDs
 * for any AI-requiring pipeline stage.
 */
export interface StageProviderConfig {
  /** Which adapter type to use: browser chat or REST API. */
  adapter: 'chat' | 'api';
  /** Preferred provider key (e.g. 'gemini', 'chatgpt', 'aivideomaker'). */
  provider?: string;
  /** Specific model to use (e.g. 'Gemini 3.1 Pro', 'gpt-4o'). */
  model?: string;
  /** Restrict to specific resource IDs for account-level rotation. */
  resourceIds?: string[];
}

/**
 * Stage-level overrides keyed by PipelineStage.
 * Takes priority over per-task-type ModelOverrides.
 */
export type StageProviderOverrides = Partial<Record<PipelineStage, StageProviderConfig>>;

/**
 * A single provider option returned by the stage-providers endpoint.
 * Describes one possible AI provider for a given stage.
 */
export interface StageProviderOption {
  /** Provider key (e.g. 'gemini', 'chatgpt', 'aivideomaker'). */
  provider: string;
  /** Display label (e.g. 'Gemini 网页端'). */
  label: string;
  /** Adapter type. */
  adapter: 'chat' | 'api';
  /** Number of available accounts/resources for this provider. */
  resourceCount: number;
  /** How many of those resources have quota remaining. */
  availableCount: number;
  /** Whether any resources are currently quota-exhausted. */
  hasQuotaIssues: boolean;
  /** Available models for this provider. */
  models?: string[];
  /** Provider capabilities relevant to this stage. */
  capabilities: {
    text?: boolean;
    image?: boolean;
    video?: boolean;
    webSearch?: boolean;
  };
  /** Whether this is the recommended/default provider for this stage. */
  recommended?: boolean;
}

/**
 * Per-stage provider availability map returned by GET /api/pipeline/stage-providers.
 */
export interface StageProviderMap {
  [stage: string]: {
    /** Task type for this stage. */
    taskType: string;
    /** The current/default provider selection. */
    current: StageProviderOption;
    /** All available providers for this stage, sorted by recommendation. */
    available: StageProviderOption[];
  };
}

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
    scores?: {
      accuracy: number;
      styleConsistency: number;
      productionReadiness: number;
      engagement: number;
      overall: number;
    };
    issues?: string[];
    suspiciousNumericClaims?: Array<{ claim: string; reason: string }>;
    styleDeviations?: string[];
    unfilmableSentences?: Array<{ index: number; text: string; reason: string }>;
    contentContamination?: {
      score: number;
      copiedPhrases: string[];
      reusedFacts: string[];
      reusedMetaphors: string[];
    };
    seriesConsistency?: {
      score: number;
      hookStructureMatch: boolean;
      closingStructureMatch: boolean;
      rhythmSimilarity: 'high' | 'medium' | 'low';
      arcAllocationMatch: boolean;
      deviations: string[];
    };
  };
  /** Reference style-anchor images */
  referenceImages?: string[];
  /** Extracted style profile (after STYLE_EXTRACTION completes) */
  styleProfile?: Record<string, unknown>;
  logs: LogEntry[];
  error?: string;
  finalVideoPath?: string;
  modelOverrides?: ModelOverrides;
  /** Per-stage provider overrides — takes priority over modelOverrides. */
  stageProviderOverrides?: StageProviderOverrides;
  /** Per-prompt text overrides — key is prompt constant name */
  promptOverrides?: Record<string, string>;
  /** Transient directive for a retry */
  retryDirective?: { stage: PipelineStage; directive: string; timestamp: string };
}

/* ---- Pipeline events (SSE) ---- */

/** Centralised SSE event type constants — use these instead of inline strings. */
export const SSE_EVENT = {
  CREATED: 'pipeline_created',
  STAGE: 'pipeline_stage',
  ARTIFACT: 'pipeline_artifact',
  LOG: 'pipeline_log',
  ERROR: 'pipeline_error',
  COMPLETE: 'pipeline_complete',
  PAUSED: 'pipeline_paused',
  RESUMED: 'pipeline_resumed',
  SCENE_REVIEW: 'pipeline_scene_review',
  ASSEMBLY_PROGRESS: 'pipeline_assembly_progress',
  WARNING: 'pipeline_warning',
} as const;

export type PipelineEvent =
  | { type: typeof SSE_EVENT.CREATED; payload: { projectId: string } }
  | { type: typeof SSE_EVENT.STAGE; payload: { projectId: string; stage: PipelineStage; status: ProcessStatus; progress?: number } }
  | { type: typeof SSE_EVENT.ARTIFACT; payload: { projectId: string; stage: PipelineStage; artifactType: string; summary?: string } }
  | { type: typeof SSE_EVENT.LOG; payload: { projectId: string; entry: LogEntry } }
  | { type: typeof SSE_EVENT.ERROR; payload: { projectId: string; stage: PipelineStage; error: string } }
  | { type: typeof SSE_EVENT.COMPLETE; payload: { projectId: string } }
  | { type: typeof SSE_EVENT.PAUSED; payload: { projectId: string; stage: PipelineStage } }
  | { type: typeof SSE_EVENT.RESUMED; payload: { projectId: string; stage: PipelineStage } }
  | { type: typeof SSE_EVENT.SCENE_REVIEW; payload: { projectId: string; sceneId: string; status: string; reason?: string } }
  | { type: typeof SSE_EVENT.ASSEMBLY_PROGRESS; payload: { projectId: string; percent: number; message: string } }
  | { type: typeof SSE_EVENT.WARNING; payload: { projectId: string; stage: PipelineStage; message: string } };

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
 * A regex-based ETA extraction rule used by video queue detection.
 *
 * `regex` should contain capture groups for minutes/seconds as configured
 * by `minutesGroup` and/or `secondsGroup`.
 */
export interface QueueEtaPattern {
  /** Regex source string (without surrounding slashes). */
  regex: string;
  /** 1-based capture group index containing minutes. */
  minutesGroup?: number;
  /** 1-based capture group index containing seconds. */
  secondsGroup?: number;
}

/**
 * Provider-specific queue detection rules for long-running video generation.
 */
export interface QueueDetectionConfig {
  /** Keywords indicating the job is queued/in-progress. */
  queueKeywords?: string[];
  /** Regex patterns used to extract ETA from page text. */
  etaPatterns?: QueueEtaPattern[];
}

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
  /** Optional queue/ETA rules for long-running async generation sites. */
  queueDetection?: QueueDetectionConfig;
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

/* ---- Unified AI Resource ---- */

/** What kind of AI site this resource represents. */
export type AiResourceType = 'chat' | 'video' | 'image' | 'multi' | 'api';

/**
 * Unified AI resource — represents any free-tier AI site the user has
 * added (chat, video generation, image generation, or multi-purpose).
 *
 * Replaces the old split between Account (chat) and VideoProviderConfig (video).
 */
export interface AiResource {
  id: string;
  /** What kind of site this is. */
  type: AiResourceType;
  /** Provider key derived from URL domain (e.g. 'chatgpt', 'gemini'). */
  provider: ProviderId;
  /** Display name. */
  label: string;
  /** The main URL this resource points to. */
  siteUrl: string;
  /** Browser user-data directory (persistent cookies / session). */
  profileDir: string;
  /** Whether the resource is currently known to have exhausted its quota. */
  quotaExhausted: boolean;
  /** ISO timestamp of when quota was marked exhausted. Used for auto-reset. */
  quotaExhaustedAt?: string;
  /** ISO timestamp of last known quota reset, if any. */
  quotaResetAt?: string;
  /** Site capabilities. */
  capabilities: {
    text?: boolean;
    image?: boolean;
    video?: boolean;
    fileUpload?: boolean;
    webSearch?: boolean;
  };
  /** CSS selectors for browser automation. */
  selectors?: {
    /* Common */
    promptInput?: string;
    generateButton?: string;
    /* Chat-specific */
    sendButton?: string;
    responseBlock?: string;
    readyIndicator?: string;
    /* Video/Image result */
    resultElement?: string;
    progressIndicator?: string;
    downloadButton?: string;
    imageUploadTrigger?: string;
  };
  /** Timing configuration for automation. */
  timing?: {
    maxWaitMs?: number;
    pollIntervalMs?: number;
    hydrationDelayMs?: number;
  };
  /** Optional queue/ETA rules for long-running video generation UIs. */
  queueDetection?: QueueDetectionConfig;
  /** Optional free-tier daily limits. */
  dailyLimits?: {
    text?: number;
    images?: number;
    videos?: number;
  };
  /** For type='api': masked API key for display (e.g. 'ak_e150b53...'). */
  apiKeyMasked?: string;
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
  /** Task-scoped chat mode captured at enqueue time. */
  chatMode?: ChatMode;
  /** Logical chat session identifier for safe context reuse. */
  sessionId?: string;
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
  /** @deprecated Use `resources` instead. Kept for backward compat. */
  accounts: Account[];
  /** Unified AI resources (chat, video, image). */
  resources: AiResource[];
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

/* ---- Workbench SSE events ---- */

/** Centralised workbench event type constants — use these instead of inline strings. */
export const WB_EVENT = {
  STATE: 'state',
  TASK_STARTED: 'task_started',
  TASK_DONE: 'task_done',
  TASK_FAILED: 'task_failed',
  QUOTA_EXHAUSTED: 'quota_exhausted',
  ACCOUNT_SWITCHED: 'account_switched',
  LOGIN_BROWSER_OPENED: 'login_browser_opened',
  LOGIN_BROWSER_CLOSED: 'login_browser_closed',
  MODELS_DETECTED: 'models_detected',
  STOPPED: 'stopped',
  ACTIVE_PAGE_CRASHED: 'active_page_crashed',
  SELECTOR_HEALTH_WARNING: 'selector_health_warning',
  SELECTORS_UPDATED: 'selectors_updated',
  BGM_DOWNLOAD_READY: 'bgm_download_ready',
} as const;

/** Events pushed from the backend to UI via SSE. */
export type WorkbenchEvent =
  | { type: typeof WB_EVENT.STATE; payload: WorkbenchState }
  | { type: typeof WB_EVENT.TASK_STARTED; payload: { taskId: string; accountId: string } }
  | { type: typeof WB_EVENT.TASK_DONE; payload: { taskId: string; answer: string } }
  | { type: typeof WB_EVENT.TASK_FAILED; payload: { taskId: string; error: string } }
  | { type: typeof WB_EVENT.QUOTA_EXHAUSTED; payload: { accountId: string } }
  | { type: typeof WB_EVENT.ACCOUNT_SWITCHED; payload: { fromAccountId: string; toAccountId: string } }
  | { type: typeof WB_EVENT.LOGIN_BROWSER_OPENED; payload: { accountId: string } }
  | { type: typeof WB_EVENT.LOGIN_BROWSER_CLOSED; payload: { accountId: string } }
  | { type: typeof WB_EVENT.MODELS_DETECTED; payload: { provider: ProviderId; models: ModelOption[] } }
  | { type: typeof WB_EVENT.STOPPED; payload: Record<string, never> }
  // Browser lifecycle events
  | { type: typeof WB_EVENT.ACTIVE_PAGE_CRASHED; payload: { accountId: string; reason: string } }
  // Selector health events
  | { type: typeof WB_EVENT.SELECTOR_HEALTH_WARNING; payload: { provider: string; healthScore: number; brokenSelectors: string[] } }
  | { type: typeof WB_EVENT.SELECTORS_UPDATED; payload: { provider: string; source: 'auto_detect' | 'health_redetect'; fields: string[] } }
  // BGM download events
  | { type: typeof WB_EVENT.BGM_DOWNLOAD_READY; payload: { filename: string; originalName: string; mood: string; title: string; size: number } }
  // Pipeline events
  | PipelineEvent;

/* ------------------------------------------------------------------ */
/*  Video Refinement Options                                          */
/* ------------------------------------------------------------------ */

/** Subtitle style preset names. */
export type SubtitlePreset = 'classic_white' | 'backdrop_black' | 'cinematic' | 'top_hint' | 'custom';

/** Subtitle style configuration for the assembler. */
export interface SubtitleStyle {
  /** Font name (e.g. 'Arial', 'PingFang SC'). */
  fontName: string;
  /** Font size in pixels. */
  fontSize: number;
  /** Primary text color as hex (e.g. '#FFFFFF'). */
  primaryColor: string;
  /** Outline/stroke color as hex. */
  outlineColor: string;
  /** Outline width in pixels (0-4). */
  outlineWidth: number;
  /** Whether shadow is enabled. */
  shadowEnabled: boolean;
  /** Vertical margin from bottom in pixels. */
  marginV: number;
  /** Whether backdrop/background is enabled. */
  backdropEnabled: boolean;
  /** Backdrop opacity (0-1), only used if backdropEnabled. */
  backdropOpacity: number;
}

/** Title card configuration. */
export interface TitleCardStyle {
  /** Title text (project title by default). */
  text?: string;
  /** Font size in pixels. */
  fontSize: number;
  /** Font color as hex. */
  fontColor: string;
  /** Total display duration in seconds (includes fade in/out). */
  duration: number;
}

/** Encoding quality preset. */
export type QualityPreset = 'high' | 'medium' | 'low';

/** Export speed preset (affects encoding preset). */
export type SpeedPreset = 'fast' | 'balanced' | 'quality';

/** Complete refinement options passed to re-assembly. */
export interface RefineOptions {
  /* ---- BGM ---- */
  /** Path to BGM file (relative to project uploads or absolute). */
  bgmPath?: string;
  /** BGM volume (0-1). */
  bgmVolume: number;
  /** BGM-specific fade-in duration in seconds (applied to BGM stream only). */
  bgmFadeIn: number;
  /** BGM-specific fade-out duration in seconds (applied to BGM stream only). */
  bgmFadeOut: number;

  /* ---- Subtitle Style ---- */
  /** Selected preset name. */
  subtitlePreset: SubtitlePreset;
  /** Full subtitle style (populated from preset or custom). */
  subtitleStyle: SubtitleStyle;

  /* ---- Intro/Outro ---- */
  /** Fade-in duration at video start (seconds). */
  fadeInDuration: number;
  /** Fade-out duration at video end (seconds). */
  fadeOutDuration: number;
  /** Title card config (null = disabled). */
  titleCard: TitleCardStyle | null;

  /* ---- Advanced ---- */
  /** Quality preset (affects CRF). */
  qualityPreset: QualityPreset;
  /** Speed preset (affects encoding preset). */
  speedPreset: SpeedPreset;
  /** Default transition duration in seconds. */
  transitionDuration: number;
}

/** Default subtitle style presets. */
export const SUBTITLE_PRESETS: Record<SubtitlePreset, SubtitleStyle> = {
  classic_white: {
    fontName: 'Arial',
    fontSize: 20,
    primaryColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    shadowEnabled: true,
    marginV: 35,
    backdropEnabled: false,
    backdropOpacity: 0,
  },
  backdrop_black: {
    fontName: 'Arial',
    fontSize: 20,
    primaryColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 0,
    shadowEnabled: false,
    marginV: 35,
    backdropEnabled: true,
    backdropOpacity: 0.6,
  },
  cinematic: {
    fontName: 'Georgia',
    fontSize: 22,
    primaryColor: '#FFFDE7',
    outlineColor: '#1A1A1A',
    outlineWidth: 1,
    shadowEnabled: true,
    marginV: 50,
    backdropEnabled: false,
    backdropOpacity: 0,
  },
  top_hint: {
    fontName: 'Arial',
    fontSize: 16,
    primaryColor: '#FFFFFF',
    outlineColor: '#333333',
    outlineWidth: 1,
    shadowEnabled: false,
    marginV: 20,
    backdropEnabled: true,
    backdropOpacity: 0.5,
  },
  custom: {
    fontName: 'Arial',
    fontSize: 20,
    primaryColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    shadowEnabled: true,
    marginV: 35,
    backdropEnabled: false,
    backdropOpacity: 0,
  },
};

/** Default refine options. */
export const DEFAULT_REFINE_OPTIONS: RefineOptions = {
  bgmPath: undefined,
  bgmVolume: 0.15,
  bgmFadeIn: 0,
  bgmFadeOut: 0,
  subtitlePreset: 'classic_white',
  subtitleStyle: SUBTITLE_PRESETS.classic_white,
  fadeInDuration: 0,
  fadeOutDuration: 0,
  titleCard: null,
  qualityPreset: 'medium',
  speedPreset: 'balanced',
  transitionDuration: 0.5,
};

/* ------------------------------------------------------------------ */
/*  PackagingTrack → RefineOptions mapper                             */
/* ------------------------------------------------------------------ */

/** Packaging data extracted from the reference video by STYLE_EXTRACTION. */
export interface PackagingTrack {
  subtitlePosition: 'bottom' | 'top' | 'center';
  subtitleHasShadow: boolean;
  subtitleHasBackdrop: boolean;
  subtitleFontSize: 'small' | 'medium' | 'large';
  subtitlePrimaryColor: string;
  subtitleOutlineColor: string;
  subtitleFontCategory: 'sans-serif' | 'serif' | 'handwritten' | 'monospace';
  transitionDominantStyle: 'cut' | 'dissolve' | 'fade' | 'zoom' | 'morph' | 'wipe';
  transitionEstimatedDurationSec: number;
  hasIntroCard: boolean;
  introCardDurationSec: number;
  hasFadeIn: boolean;
  fadeInDurationSec: number;
  hasOutroCard: boolean;
  outroCardDurationSec: number;
  hasFadeOut: boolean;
  fadeOutDurationSec: number;
}

/** Fields in the returned Partial<RefineOptions> that were inferred from the reference video. */
export type PackagingProvenance = Set<keyof RefineOptions>;

/**
 * Map a PackagingTrack (from StyleAnalysisCIR) to smart RefineOptions defaults.
 * Also returns a provenance set indicating which fields were derived.
 * Only maps fields where the confidence map indicates ≥ 'inferred'.
 */
export function packagingStyleToRefineOptions(
  pkg: PackagingTrack | undefined,
  confidence: Record<string, string> | undefined,
  bgmRelativeVolume?: number,
): { options: Partial<RefineOptions>; provenance: PackagingProvenance } {
  const provenance: PackagingProvenance = new Set();
  if (!pkg) return { options: {}, provenance };

  const ok = (field: string) => {
    const c = confidence?.[field];
    return c === 'confident' || c === 'inferred' || c === 'computed';
  };

  const opts: Partial<RefineOptions> = {};

  // --- Subtitle style ---
  const fontCategoryMap: Record<string, SubtitlePreset> = {
    'sans-serif': 'classic_white',
    'serif': 'cinematic',
    'handwritten': 'cinematic',
    'monospace': 'classic_white',
  };
  const fontNameMap: Record<string, string> = {
    'sans-serif': 'Arial',
    'serif': 'Georgia',
    'handwritten': 'Georgia',
    'monospace': 'Courier New',
  };
  const fontSizeMap: Record<string, number> = { small: 16, medium: 20, large: 24 };
  const marginVMap: Record<string, number> = { bottom: 35, top: 20, center: 50 };

  // Apply subtitle preset based on font category + backdrop
  if (pkg.subtitleHasBackdrop) {
    opts.subtitlePreset = 'backdrop_black';
    opts.subtitleStyle = { ...SUBTITLE_PRESETS.backdrop_black };
    provenance.add('subtitlePreset');
    provenance.add('subtitleStyle');
  } else {
    const preset = fontCategoryMap[pkg.subtitleFontCategory] ?? 'classic_white';
    opts.subtitlePreset = preset;
    opts.subtitleStyle = { ...SUBTITLE_PRESETS[preset] };
    provenance.add('subtitlePreset');
    provenance.add('subtitleStyle');
  }

  // Override specific subtitle fields from packaging analysis
  if (ok('subtitle_primary_color')) {
    opts.subtitleStyle!.primaryColor = pkg.subtitlePrimaryColor;
  }
  if (ok('subtitle_outline_color')) {
    opts.subtitleStyle!.outlineColor = pkg.subtitleOutlineColor;
  }
  if (ok('subtitle_font_size')) {
    opts.subtitleStyle!.fontSize = fontSizeMap[pkg.subtitleFontSize] ?? 20;
  }
  opts.subtitleStyle!.fontName = fontNameMap[pkg.subtitleFontCategory] ?? 'Arial';
  opts.subtitleStyle!.shadowEnabled = pkg.subtitleHasShadow;
  opts.subtitleStyle!.marginV = marginVMap[pkg.subtitlePosition] ?? 35;
  opts.subtitleStyle!.backdropEnabled = pkg.subtitleHasBackdrop;
  opts.subtitleStyle!.backdropOpacity = pkg.subtitleHasBackdrop ? 0.6 : 0;

  // If any custom color/size differs from preset, switch to custom preset
  const presetKey = opts.subtitlePreset!;
  const presetRef = SUBTITLE_PRESETS[presetKey];
  if (
    opts.subtitleStyle!.primaryColor !== presetRef.primaryColor ||
    opts.subtitleStyle!.outlineColor !== presetRef.outlineColor ||
    opts.subtitleStyle!.fontSize !== presetRef.fontSize
  ) {
    opts.subtitlePreset = 'custom';
  }

  // --- Transition ---
  if (ok('transition_estimated_duration_sec') && pkg.transitionEstimatedDurationSec > 0) {
    opts.transitionDuration = pkg.transitionEstimatedDurationSec;
    provenance.add('transitionDuration');
  }

  // --- Fade in/out ---
  if (pkg.hasFadeIn && pkg.fadeInDurationSec > 0) {
    opts.fadeInDuration = pkg.fadeInDurationSec;
    provenance.add('fadeInDuration');
  }
  if (pkg.hasFadeOut && pkg.fadeOutDurationSec > 0) {
    opts.fadeOutDuration = pkg.fadeOutDurationSec;
    provenance.add('fadeOutDuration');
  }

  // --- Title card from intro card ---
  if (pkg.hasIntroCard && pkg.introCardDurationSec > 0) {
    opts.titleCard = {
      fontSize: 64,
      fontColor: pkg.subtitlePrimaryColor || '#ffffff',
      duration: pkg.introCardDurationSec,
    };
    provenance.add('titleCard');
  }

  // --- BGM volume from StyleAnalysisCIR.audioTrack ---
  if (bgmRelativeVolume !== undefined && bgmRelativeVolume > 0) {
    opts.bgmVolume = bgmRelativeVolume;
    provenance.add('bgmVolume');
  }

  return { options: opts, provenance };
}
