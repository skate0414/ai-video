/* ------------------------------------------------------------------ */
/*  Canonical Intermediate Representations (CIR)                      */
/*  The compiler's core IR system: strictly-typed, provider-          */
/*  independent data models that flow between compilation passes.     */
/*                                                                    */
/*  Architecture: LLMs are the "compiler frontend" (untrusted         */
/*  parsers), CIRs are the IR that passes transform, and FFmpeg      */
/*  is the final linker that emits the output binary (.mp4).         */
/* ------------------------------------------------------------------ */

/* ================================================================== */
/*  1. StyleAnalysisCIR – output of STYLE_EXTRACTION                  */
/* ================================================================== */

export interface StyleAnalysisCIR {
  readonly _cir: 'StyleAnalysis';
  readonly version: 1;

  /** Core visual identity */
  visualStyle: string;
  pacing: 'slow' | 'medium' | 'fast';
  tone: string;
  colorPalette: string[];

  /** Meta info about the reference video */
  meta: {
    videoDurationSec: number;
    videoLanguage: string;
    videoType: string;
  };

  /** Script track — drives SCRIPT_GENERATION + SCRIPT_VALIDATOR */
  scriptTrack: {
    hookStrategy: string;
    sentenceLengthMax: number;
    sentenceLengthAvg: number;
    sentenceLengthUnit: string;
    narrativeArc: string[];
    emotionalToneArc: string;
    rhetoricalCore: string;
    metaphorCount: number;
    interactionCuesCount: number;
    ctaPattern: string;
    jargonTreatment: string;
  };

  /** Visual track — drives STORYBOARD + IMAGE/VIDEO_GEN */
  visualTrack: {
    baseMedium: string;
    lightingStyle: string;
    cameraMotion: string;
    colorTemperature: string;
    sceneAvgDurationSec: number;
    transitionStyle: string;
    visualMetaphorMapping: { rule: string; examples: Array<{ concept: string; visual: string }> };
    bRollRatio: number;
    compositionStyle: string;
  };

  /** Audio track — drives TTS + ASSEMBLY */
  audioTrack: {
    bgmGenre: string;
    bgmMood: string;
    bgmTempo: string;
    bgmRelativeVolume: number;
    voiceStyle: string;
  };

  /** Transcript-derived computed fields (not AI guesses) */
  computed: {
    wordCount: number;
    wordsPerMinute: number;
    fullTranscript: string;
  };

  /** Packaging track — drives ASSEMBLY refine defaults */
  packagingTrack: {
    /** Subtitle style observed in reference video */
    subtitlePosition: 'bottom' | 'top' | 'center';
    subtitleHasShadow: boolean;
    subtitleHasBackdrop: boolean;
    subtitleFontSize: 'small' | 'medium' | 'large';
    subtitlePrimaryColor: string;
    subtitleOutlineColor: string;
    subtitleFontCategory: 'sans-serif' | 'serif' | 'handwritten' | 'monospace';

    /** Transition style observed in reference video */
    transitionDominantStyle: 'cut' | 'dissolve' | 'fade' | 'zoom' | 'morph' | 'wipe';
    transitionEstimatedDurationSec: number;

    /** Intro/outro detected in reference video */
    hasIntroCard: boolean;
    introCardDurationSec: number;
    hasFadeIn: boolean;
    fadeInDurationSec: number;
    hasOutroCard: boolean;
    outroCardDurationSec: number;
    hasFadeOut: boolean;
    fadeOutDurationSec: number;
  };

  /** Confidence metadata — which fields to trust less */
  confidence: Record<string, 'confident' | 'inferred' | 'guess' | 'computed'>;

  /** Contract validation score (0-100) */
  contractScore: number;
}

/* ================================================================== */
/*  2. ResearchCIR – output of RESEARCH                               */
/* ================================================================== */

export interface ResearchFactCIR {
  id: string;
  content: string;
  sources: Array<{ url: string; title?: string; reliability?: number }>;
  confidence: number;
  verificationStatus: 'verified' | 'disputed' | 'unverified';
}

export interface ResearchCIR {
  readonly _cir: 'Research';
  readonly version: 1;

  facts: ResearchFactCIR[];
  myths: string[];
  glossary: Array<{ term: string; definition: string }>;
  claimVerifications: Array<{
    claim: string;
    verdict: 'verified' | 'debunked' | 'unverifiable';
    correction?: string;
    confidence: number;
  }>;
}

/* ================================================================== */
/*  3. ScriptCIR – output of SCRIPT_GENERATION                       */
/* ================================================================== */

export interface ScriptSentenceCIR {
  index: number;
  text: string;
  /** Which narrative beat this belongs to */
  beatIndex: number;
  /** Fact IDs referenced in this sentence */
  factReferences: string[];
  /** Estimated spoken duration in seconds */
  estimatedDurationSec: number;
}

export interface ScriptCIR {
  readonly _cir: 'Script';
  readonly version: 1;

  /** Full script text (joined from sentences) */
  fullText: string;
  /** Structured sentence breakdown */
  sentences: ScriptSentenceCIR[];
  /** Total word/character count */
  totalWordCount: number;
  /** Total estimated duration */
  totalDurationSec: number;
  /** All fact IDs used anywhere in the script */
  usedFactIDs: string[];
  /** Safety assessment */
  safety: {
    isHighRisk: boolean;
    categories: string[];
    needsManualReview: boolean;
  };
  /** Style consistency score (0-100) */
  styleConsistencyScore: number;
  /** Calibration used to generate this script */
  calibration: {
    targetWordCount: number;
    targetWordCountMin: number;
    targetWordCountMax: number;
    targetDurationSec: number;
    speechRate: string;
  };
}

/* ================================================================== */
/*  4. StoryboardCIR – output of STORYBOARD                          */
/* ================================================================== */

export interface StoryboardSceneCIR {
  id: string;
  index: number;
  /** Narrative text for this scene (what is said) */
  narrative: string;
  /** Visual prompt for image/video generation */
  visualPrompt: string;
  /** Production specifications */
  production: {
    camera: string;
    lighting: string;
    sound: string;
    notes: string;
  };
  /** Target duration in seconds */
  targetDurationSec: number;
  /** Whether this scene should be video or static image */
  assetType: 'image' | 'video';
}

export interface StoryboardCIR {
  readonly _cir: 'Storyboard';
  readonly version: 1;

  scenes: StoryboardSceneCIR[];
  /** Total scene count */
  totalScenes: number;
  /** Count of video vs image scenes */
  videoSceneCount: number;
  imageSceneCount: number;
  /** Total estimated duration across all scenes */
  totalDurationSec: number;
}

/* ================================================================== */
/*  5. FormatSignature – series identity structure                    */
/*     Extracted from reference transcript, separates immutable       */
/*     "series format" from variable "topic content". Used to         */
/*     hard-constrain subsequent script generation for series         */
/*     consistency across different topics.                           */
/* ================================================================== */

export interface FormatSignature {
  readonly _type: 'FormatSignature';
  readonly version: 1;

  /** Hook structural template (e.g. "[反直觉数据] + [第二人称挑战] + [悬念前瞻]") */
  hookTemplate: string;
  /** Closing structural template (e.g. "[情感升华] + [行动号召] + [开放性问题]") */
  closingTemplate: string;
  /** Per-sentence character/word count sequence from reference (rhythm fingerprint) */
  sentenceLengthSequence: number[];
  /** Indices (0-based) where major transitions occur in the reference */
  transitionPositions: number[];
  /** Transition pattern phrases used at transition points (e.g. "但这还不是最…", "然而…") */
  transitionPatterns: string[];
  /** Sentence count allocation per narrative arc stage (e.g. [3, 5, 4, 3, 2]) */
  arcSentenceAllocation: number[];
  /** Arc stage labels corresponding to arcSentenceAllocation */
  arcStageLabels: string[];
  /** Recurring signature phrases/sentence structures (anonymized, content-stripped) */
  signaturePhrases: string[];
  /** Emotional arc shape as per-sentence intensity values (0-1 normalized) */
  emotionalArcShape: number[];
  /** Visual motif templates for series consistency in storyboard */
  seriesVisualMotifs: {
    hookMotif: string;
    mechanismMotif: string;
    climaxMotif: string;
    reflectionMotif: string;
  };
}

/* ================================================================== */
/*  7. TemporalPlanCIR – output of TEMPORAL_PLANNING                  */
/*     Pure computation: sentence-level duration allocation using      */
/*     semantic weight, emotion intensity, and pacing constraints.    */
/* ================================================================== */

export type NarrativePhase = 'hook' | 'build' | 'climax' | 'resolution' | 'cta';
export type Emphasis = 'slow' | 'normal' | 'fast';

export interface TemporalSceneCIR {
  sentenceIndex: number;
  text: string;
  charCount: number;
  /** Content importance (0-1). Derived from fact density. */
  semanticWeight: number;
  /** Emotional intensity (0-1). From FormatSignature.emotionalArcShape or neutral fallback. */
  emotionIntensity: number;
  /** Narrative phase classification. */
  narrativePhase: NarrativePhase;
  /** Whether this sentence is at a narrative transition point. */
  isTransition: boolean;
  /** Algorithm-computed raw duration (before API quantization). */
  rawDurationSec: number;
  /** Duration snapped to video API valid values [5, 8, 10, 15, 20]. */
  apiDurationSec: number;
  /** Target speaking duration for TTS pacing. */
  ttsBudgetSec: number;
  /** Pacing emphasis hint for TTS. */
  emphasis: Emphasis;
}

export interface TemporalPlanCIR {
  readonly _cir: 'TemporalPlan';
  readonly version: 1;
  totalDurationSec: number;
  totalSentences: number;
  pacing: 'slow' | 'medium' | 'fast';
  scenes: TemporalSceneCIR[];
  durationBudget: {
    allocated: number;
    target: number;
    /** Fractional deviation: |1 - allocated/target| */
    deviation: number;
  };
}

/* ================================================================== */
/*  8. VideoIR – output of VIDEO_IR_COMPILE                           */
/*     The compiler's MIR (mid-level IR): a fully-resolved,           */
/*     immutable production plan. After VIDEO_IR_COMPILE, this is     */
/*     the ONLY allowed source for timing, structure, voice, and      */
/*     pacing decisions. Downstream codegen stages are pure           */
/*     projections of this IR — no fallback computation allowed.      */
/* ================================================================== */

/** AV sync strategy executed by the linker (FFmpeg). */
export type AVSyncPolicy = 'audio-primary';

export interface VideoIRScene {
  /** Scene index (matches 1:1 with script sentences) */
  readonly index: number;
  /** Script sentence indices that map to this scene */
  readonly sentenceIndices: number[];
  /** Narrative text (what is spoken) */
  readonly narrative: string;
  /** Visual prompt for image/video generation (AI-generated content) */
  readonly visualPrompt: string;
  /** Compiler-projected palette for all downstream generation prompts */
  readonly colorPalette: readonly string[];
  /** Compiler-projected lighting style for all downstream generation prompts */
  readonly lightingStyle: string;
  /** Compiler-projected visual style for all downstream generation prompts */
  readonly visualStyle: string;
  /** Whether this scene is video or static image (final, includes promotion) */
  readonly assetType: 'image' | 'video';
  /** Production specifications */
  readonly production: {
    readonly camera: string;
    readonly lighting: string;
    readonly sound: string;
    readonly notes: string;
  };

  /* ---- Timing (pre-resolved by compiler, not runtime) ---- */

  /** Algorithm-computed raw duration before API quantization */
  readonly rawDurationSec: number;
  /** Duration snapped to video API grid [5, 8, 10, 15, 20] */
  readonly apiDurationSec: number;
  /** Target speaking duration for TTS pacing */
  readonly ttsBudgetSec: number;

  /* ---- Audio (pre-resolved by compiler, not runtime) ---- */

  /** TTS voice name (e.g. 'zh-CN-XiaoxiaoNeural') */
  readonly ttsVoice: string;
  /** TTS rate adjustment (e.g. '+5%', '-8%', or undefined for default) */
  readonly ttsRate: string | undefined;
  /** Pacing emphasis hint */
  readonly emphasis: Emphasis;

  /* ---- Narrative metadata ---- */

  /** Narrative phase classification */
  readonly narrativePhase: NarrativePhase;

  /** Emotional intensity (0-1). Propagated from TemporalSceneCIR for adaptive transition selection. */
  readonly emotionIntensity: number;

  /* ---- Transition (from ShotCIR alignment) ---- */

  /** Transition type to apply AFTER this scene (before the next scene). */
  readonly transitionToNext: 'cut' | 'dissolve' | 'fade' | 'wipe' | 'zoom' | 'none';

  /** Per-scene transition duration in seconds (0.2–1.5). Computed by adaptive transition logic. */
  readonly transitionDuration: number;
}

export interface VideoIR {
  readonly _cir: 'VideoIR';
  readonly version: 1;

  /** All scenes — immutable after compilation */
  readonly scenes: readonly VideoIRScene[];
  /** Target total duration in seconds */
  readonly targetDurationSec: number;
  /** Output resolution */
  readonly resolution: { readonly w: number; readonly h: number };
  /** Output frame rate */
  readonly fps: number;
  /** Primary language */
  readonly language: string;
  /** AV sync strategy for the linker */
  readonly avSyncPolicy: AVSyncPolicy;
  /** BGM relative volume for assembly (0–1 scale) */
  readonly bgmRelativeVolume: number;
}

/* ================================================================== */
/*  9. ShotCIR – output of shot boundary detection in CV_PREPROCESS   */
/*     Represents the temporal structure of the reference video:      */
/*     per-shot keyframes, durations, camera motion, and transition   */
/*     types. Used by STORYBOARD for shot→scene alignment and by     */
/*     ASSEMBLY for real transition execution.                        */
/* ================================================================== */

export interface ShotBoundary {
  /** Shot index (0-based) */
  readonly index: number;
  /** Start time in seconds */
  readonly startSec: number;
  /** End time in seconds */
  readonly endSec: number;
  /** Shot duration in seconds */
  readonly durationSec: number;
  /** Path to extracted keyframe image for this shot */
  readonly keyframePath: string;
  /** Detected camera motion type */
  readonly cameraMotion: string;
  /** Transition type to the NEXT shot (last shot has 'none') */
  readonly transitionToNext: 'cut' | 'dissolve' | 'fade' | 'wipe' | 'zoom' | 'none';
  /** Dominant colors in this shot's keyframe */
  readonly dominantColors: string[];
  /** Brief description of the primary visual subject */
  readonly subjectDescription: string;
}

export interface ShotCIR {
  readonly _cir: 'ShotAnalysis';
  readonly version: 1;

  /** All detected shots in temporal order */
  readonly shots: readonly ShotBoundary[];
  /** Total number of shots detected */
  readonly totalShots: number;
  /** Average shot duration in seconds */
  readonly avgShotDurationSec: number;
  /** Normalised duration ratios (each shot's fraction of total, sums to 1.0) */
  readonly rhythmSignature: readonly number[];
  /** Total reference video duration in seconds */
  readonly videoDurationSec: number;
}

/* ================================================================== */
/*  Union type for all CIRs                                           */
/* ================================================================== */

export type AnyCIR =
  | StyleAnalysisCIR
  | ResearchCIR
  | ScriptCIR
  | StoryboardCIR
  | TemporalPlanCIR
  | VideoIR
  | ShotCIR;

export type CIRType = AnyCIR['_cir'];
