import type { CVQualityMetrics } from './stages/cvMetrics.js';

export interface SceneQualityScore {
  visualConsistency: number;
  audioCompleteness: number;
  assetIntegrity: number;
  cv?: CVQualityMetrics;
  overall: number;
}

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
  rejectionReason?: string;
  progressMessage?: string;
  logs: string[];
  quality?: SceneQualityScore;
}

export type StoryboardReplicationStrength = 'low' | 'medium' | 'high';

export interface StoryboardReferenceScene {
  number: number;
  narrative: string;
  visualPrompt?: string;
  camera?: string;
  lighting?: string;
  estimatedDuration?: number;
}

export interface StoryboardReplicationSettings {
  enabled: boolean;
  strength: StoryboardReplicationStrength;
  sourceProjectId?: string;
  notes?: string;
  referenceScenes?: StoryboardReferenceScene[];
}

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
  nodeConfidence?: Record<string, 'confident' | 'inferred' | 'guess' | 'computed'>;
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
    visual_metaphor_mapping?:
      | Record<string, string>
      | {
          rule?: string;
          examples?: Array<{ concept: string; metaphor_visual: string }>;
        };
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
  track_d_packaging?: {
    subtitle_position?: string;
    subtitle_has_shadow?: boolean;
    subtitle_has_backdrop?: boolean;
    subtitle_font_size?: string | number;
    subtitle_primary_color?: string;
    subtitle_outline_color?: string;
    subtitle_font_category?: string;
    transition_dominant_style?: string;
    transition_estimated_duration_sec?: number;
  };
  suspiciousNumericClaims?: Array<{
    claim: string;
    value: string;
    context: string;
    severity: 'low' | 'medium' | 'high';
  }>;
}

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

export interface SkeletonSentence {
  index: number;
  stage: string;
  targetLength: number;
  purposeTag: string;
  hasFact: boolean;
  hasMetaphor: boolean;
}

export interface ScriptSkeleton {
  sentences: SkeletonSentence[];
  totalTargetWords: number;
  hookIndices: number[];
  ctaIndices: number[];
  stageBreakdown: Record<string, number[]>;
}

export interface ScriptSceneHint {
  number?: number;
  narrative?: string;
  visualPrompt?: string;
  estimatedDuration?: number;
  productionSpecs?: ProductionSpecs;
  [extra: string]: unknown;
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
  scenes?: ScriptSceneHint[];
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

export interface GenerationPlan {
  factsCount: number;
  sequenceCount: number;
  estimatedSceneCount: number;
  targetSceneDuration: number;
  targetWPM: number;
  audienceFactor: number;
  reasoning: string[];
}

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
