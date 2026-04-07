/* ------------------------------------------------------------------ */
/*  Pipeline types – migrated from ai-suite with adaptations          */
/* ------------------------------------------------------------------ */

/* ---- Re-export shared types (single source of truth) ---- */

export type {
  PipelineStage,
  ProcessStatus,
  QualityTier,
  ModelOverride,
  ModelOverrides,
  LogEntry,
  PipelineScene,
  PipelineEvent,
} from '../../shared/types.js';

/* Re-export shared PipelineProject as the base, but backend uses FullPipelineProject below */
export type { PipelineProject as PipelineProjectView } from '../../shared/types.js';

import type { PipelineStage, ProcessStatus, QualityTier, ModelOverrides, LogEntry } from '../../shared/types.js';

/* ---- AI Adapter interface (backend-only) ---- */

/* ---- AI Adapter interface (matches ai-suite contract) ---- */

export interface AIRequestOptions {
  temperature?: number;
  topK?: number;
  responseMimeType?: string;
  responseSchema?: any;
  tools?: any[];
  thinkingConfig?: { thinkingBudget?: number; maxTokens?: number };
  systemInstruction?: string;
  overrides?: Record<string, any>;
}

export interface GenerationResult {
  text?: string;
  data?: any;
  imageUrl?: string;
  videoUrl?: string;
  keyframeUrl?: string;
  audioUrl?: string;
  base64?: string;
  groundingMetadata?: any;
  durationMs?: number;
  model?: string;
  operationId?: string;
}

export interface AIAdapter {
  provider: string;
  generateText(model: string, prompt: string | any[], options?: AIRequestOptions): Promise<GenerationResult>;
  generateImage(model: string, prompt: string, aspectRatio?: string, negativePrompt?: string, options?: AIRequestOptions): Promise<GenerationResult>;
  generateVideo(model: string, prompt: string, options?: { aspectRatio?: string; image?: string; duration?: number; fps?: number } & AIRequestOptions): Promise<GenerationResult>;
  uploadFile?(file: { name: string; path: string; mimeType: string }): Promise<{ uri: string; mimeType: string }>;
  generateSpeech?(text: string, voice?: string, options?: AIRequestOptions): Promise<GenerationResult>;
}

/* ---- Production / Scene ---- */

export interface ProductionSpecs {
  camera?: string;
  lighting?: string;
  sound?: string;
  notes?: string;
}

export interface Scene {
  id: string;
  number: number;
  narrative: string;
  visualPrompt: string;
  productionSpecs: ProductionSpecs;
  estimatedDuration: number;
  assetUrl?: string;
  assetType: 'image' | 'video' | 'placeholder';
  keyframeUrl?: string;
  referenceImageUrl?: string;
  audioUrl?: string;
  voiceId?: string;
  audioDuration?: number;
  status: 'pending' | 'generating' | 'done' | 'error' | 'pending_review';
  reviewStatus?: 'pending' | 'pending_review' | 'approved' | 'rejected';
  progressMessage?: string;
  logs: string[];
}

/* ---- Style / Analysis ---- */

export interface KeyMoment {
  label: string;
  startSec: number;
  endSec: number;
  excerpt: string;
  confidence: number;
}

export interface AudioStyle {
  genre?: string;
  mood?: string;
  tempo?: 'slow' | 'medium' | 'fast' | string;
  intensity?: number;
  instrumentation?: string[];
}

export interface StyleProfile {
  visualStyle: string;
  pacing: string;
  tone: string;
  colorPalette: string[];
  targetAudience?: string;
  keyElements?: string[];
  pedagogicalApproach?: string;
  narrativeStructure: string[];
  scriptStyle?: string;
  fullTranscript?: string;
  wordCount?: number;
  wordsPerMinute?: number;
  recommendedWordsPerMinute?: number;
  sourceDuration?: number;
  targetAspectRatio?: '16:9' | '9:16' | string;
  sourceFactCount?: number;
  hookType?: string;
  callToActionType?: string;
  vocabularyLevel?: string;
  sentenceStructure?: string;
  narrativeArchetype?: string;
  emotionalIntensity?: number;
  audioStyle?: AudioStyle;
  keyMoments?: KeyMoment[];
  nodeConfidence?: Record<string, 'confident' | 'inferred' | 'guess'>;
  styleFingerprint?: string;
  profileVersion?: string;
  meta?: {
    video_language: string;
    video_duration_sec: number;
    video_type: string;
  };
  track_a_script?: {
    hook_strategy?: string;
    hook_example?: string;
    narrative_arc?: string[];
    emotional_tone_arc?: string;
    rhetorical_core?: string;
    sentence_length_avg?: number;
    sentence_length_max?: number;
    sentence_length_unit?: string;
    interaction_cues_count?: number;
    cta_pattern?: string;
    metaphor_count?: number;
    jargon_treatment?: string;
  };
  track_b_visual?: {
    base_medium?: string;
    lighting_style?: string;
    camera_motion?: string;
    color_temperature?: string;
    scene_avg_duration_sec?: number;
    transition_style?: string;
    visual_metaphor_mapping?: Record<string, string>;
    b_roll_ratio?: number;
    composition_style?: string;
  };
  track_c_audio?: {
    bgm_genre?: string;
    bgm_mood?: string;
    bgm_tempo?: string;
    bgm_relative_volume?: number;
    voice_style?: string;
    audio_visual_sync_points?: string[];
  };
  /** Suspicious numeric claims flagged for research verification */
  suspiciousNumericClaims?: Array<{
    claim: string;
    value: string;
    context: string;
    severity: 'low' | 'medium' | 'high';
  }>;
}

/* ---- Research / Fact ---- */

export interface FactSource {
  url: string;
  title?: string;
  snippet?: string;
  reliability?: number;
}

export interface Fact {
  id: string;
  content: string;
  sources: FactSource[];
  aggConfidence: number;
  type?: 'verified' | 'disputed' | 'unverified';
}

export interface ClaimVerification {
  claim: string;
  verdict: 'verified' | 'debunked' | 'unverifiable';
  correction?: string;
  source?: string;
  confidence: number;
}

export interface ResearchData {
  facts: Fact[];
  myths?: string[];
  glossary?: { term: string; definition: string }[];
  claimVerifications?: ClaimVerification[];
}

/* ---- Narrative / Script ---- */

export interface NarrativeBeat {
  sectionTitle: string;
  description: string;
  estimatedDuration: number;
  targetWordCount?: number;
  factReferences?: string[];
}

export type NarrativeMap = NarrativeBeat[];

export interface FactUsage {
  factId: string;
  usageType: 'verbatim' | 'paraphrase' | 'referenced';
  sectionTitle?: string;
}

export interface StyleConsistency {
  score: number;
  isDeviation: boolean;
  feedback: string;
  status?: 'pass' | 'warn' | 'fail';
}

export interface SafetyMetadata {
  isHighRisk?: boolean;
  riskCategories?: string[];
  triggerWarning?: string;
  softenedWordingApplied?: boolean;
  needsManualReview?: boolean;
}

export interface ScriptOutput {
  scriptText: string;
  usedFactIDs: string[];
  factUsage: FactUsage[];
  requiresManualCorrection?: boolean;
  safetyMetadata?: SafetyMetadata;
  styleConsistency?: StyleConsistency;
  totalWordCount?: number;
  totalEstimatedDuration?: number;
  scenes?: any[];
  warnings?: string[];
  calibration?: {
    reference_total_words: number;
    reference_duration_sec: number;
    actual_speech_rate: string;
    new_video_target_duration_sec: number;
    target_word_count: number;
    target_word_count_min: string;
    target_word_count_max: string;
  };
}

/* ---- Generation plan ---- */

export interface GenerationPlan {
  factsCount: number;
  sequenceCount: number;
  estimatedSceneCount: number;
  targetSceneDuration: number;
  targetWPM: number;
  audienceFactor: number;
  reasoning: string[];
}

/** Output of the calibration stage */
export interface CalibrationData {
  calibration: {
    reference_total_words: number;
    reference_duration_sec: number;
    actual_speech_rate: string;
    new_video_target_duration_sec: number;
    target_word_count: number;
    target_word_count_min: string;
    target_word_count_max: string;
  };
  verified_facts: Array<{
    fact_id: number;
    content: string;
    source_marker: string;
    visual_potential: string;
    recommended_stage: string;
  }>;
}

/* ---- Pipeline project (backend — extends shared with backend-only artifacts) ---- */

export interface PipelineProject {
  id: string;
  title: string;
  topic: string;
  referenceVideoPath?: string;
  qualityTier: QualityTier;
  createdAt: string;
  updatedAt: string;

  /** Current stage being processed */
  currentStage?: PipelineStage;
  stageStatus: Record<PipelineStage, ProcessStatus>;

  /** Pause/review control */
  pauseAfterStages?: PipelineStage[];
  isPaused?: boolean;
  pausedAtStage?: PipelineStage;

  /** Per-task-type model overrides (method C) */
  modelOverrides?: ModelOverrides;

  /** Intermediate artifacts (backend-only, not sent to UI as-is) */
  styleProfile?: StyleProfile;
  generationPlan?: GenerationPlan;
  researchData?: ResearchData;
  narrativeMap?: NarrativeMap;
  calibrationData?: CalibrationData;
  scriptOutput?: ScriptOutput;
  scenes?: Scene[];
  safetyCheck?: { safe: boolean; reason?: string };

  /** QA review result */
  qaReviewResult?: { approved: boolean; feedback?: string };
  /** QA report with score and issues */
  qaReport?: { score?: number; issues?: string[] };
  /** Reference style-anchor images */
  referenceImages?: string[];
  /** Refinement history */
  refinementHistory?: any[];

  /** Final output */
  finalVideoPath?: string;

  /** Logs */
  logs: LogEntry[];
  error?: string;
}
