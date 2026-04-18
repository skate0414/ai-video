/* ------------------------------------------------------------------ */
/*  CIR Parsers – compiler frontend: raw AI output → validated IR    */
/*  These transforms take untrusted backend responses and produce    */
/*  validated CIR objects for downstream compilation passes.          */
/* ------------------------------------------------------------------ */

import type { StyleProfile, ResearchData, ScriptOutput, Scene, CalibrationData } from '../pipeline/types.js';
import type {
  StyleAnalysisCIR, ResearchCIR, ScriptCIR,
  StoryboardCIR, StoryboardSceneCIR,
  TemporalPlanCIR, VideoIR, VideoIRScene,
  Emphasis, ShotCIR,
} from './types.js';
import {
  validateStyleAnalysisCIR,
  validateScriptCIR,
  validateStoryboardCIR,
} from './contracts.js';
import { CIRValidationError, AIParseError } from './errors.js';
import type { PipelineStage } from '../../shared/types.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('CIRParser');

/** Convert snake_case confidence keys from raw profile to camelCase CIR field names. */
function normalizeConfidenceKeys(
  raw: Record<string, string>,
): Record<string, 'confident' | 'inferred' | 'guess' | 'computed'> {
  const keyMap: Record<string, string> = {
    sentence_length_max: 'sentenceLengthMax',
    sentence_length_avg: 'sentenceLengthAvg',
    sentence_length_unit: 'sentenceLengthUnit',
    metaphor_count: 'metaphorCount',
    interaction_cues_count: 'interactionCuesCount',
    hook_strategy: 'hookStrategy',
    narrative_arc: 'narrativeArc',
    emotional_tone_arc: 'emotionalToneArc',
    rhetorical_core: 'rhetoricalCore',
    cta_pattern: 'ctaPattern',
    jargon_treatment: 'jargonTreatment',
    scene_avg_duration_sec: 'sceneAvgDurationSec',
    base_medium: 'baseMedium',
    video_duration_sec: 'videoDurationSec',
    video_language: 'videoLanguage',
  };
  const result: Record<string, 'confident' | 'inferred' | 'guess' | 'computed'> = {};
  for (const [key, value] of Object.entries(raw)) {
    const normalizedKey = keyMap[key] ?? key;
    const v = value as string;
    if (v === 'confident' || v === 'inferred' || v === 'guess' || v === 'computed') {
      result[normalizedKey] = v;
    }
  }
  return result;
}

/* ================================================================== */
/*  StyleProfile → StyleAnalysisCIR                                   */
/* ================================================================== */

export function parseStyleAnalysisCIR(
  profile: StyleProfile,
  contractScore: number,
  stage: PipelineStage = 'STYLE_EXTRACTION',
): StyleAnalysisCIR {
  const meta = profile.meta ?? { video_language: 'Chinese', video_duration_sec: 60, video_type: 'explainer' };
  const trackA = profile.track_a_script ?? {};
  const trackB = profile.track_b_visual ?? {};
  const trackC = profile.track_c_audio ?? {};
  const trackD = (profile as any).track_d_packaging ?? {};

  // Normalise visual_metaphor_mapping to unified format
  const vmm = trackB.visual_metaphor_mapping;
  let vmmNormalised: { rule: string; examples: Array<{ concept: string; visual: string }> } = {
    rule: 'Map abstract concepts to visually concrete scenes',
    examples: [],
  };
  if (vmm && typeof vmm === 'object') {
    if ('rule' in vmm) {
      vmmNormalised.rule = (vmm as any).rule ?? vmmNormalised.rule;
      const examples = (vmm as any).examples;
      if (Array.isArray(examples)) {
        vmmNormalised.examples = examples.map((e: any) => ({
          concept: e.concept ?? '',
          visual: e.metaphor_visual ?? e.visual ?? '',
        }));
      }
    } else {
      // Legacy format: { "concept": "visual" }
      vmmNormalised.examples = Object.entries(vmm).map(([k, v]) => ({
        concept: k,
        visual: String(v),
      }));
    }
  }

  const cir: StyleAnalysisCIR = {
    _cir: 'StyleAnalysis',
    version: 1,

    visualStyle: profile.visualStyle || 'cinematic',
    pacing: normalisePacing(profile.pacing),
    tone: profile.tone || 'informative',
    colorPalette: profile.colorPalette?.length ? profile.colorPalette : ['#000000', '#FFFFFF'],

    meta: {
      videoDurationSec: meta.video_duration_sec ?? 60,
      videoLanguage: meta.video_language ?? 'Chinese',
      videoType: meta.video_type ?? 'explainer',
    },

    scriptTrack: {
      hookStrategy: trackA.hook_strategy ?? profile.hookType ?? 'Question',
      sentenceLengthMax: trackA.sentence_length_max ?? 30,
      sentenceLengthAvg: trackA.sentence_length_avg ?? 15,
      sentenceLengthUnit: trackA.sentence_length_unit ?? 'characters',
      narrativeArc: profile.narrativeStructure?.length ? profile.narrativeStructure : ['Hook', 'Body', 'Conclusion'],
      emotionalToneArc: trackA.emotional_tone_arc ?? 'neutral → engaged → climax → resolution',
      rhetoricalCore: trackA.rhetorical_core ?? 'analogy, contrast',
      metaphorCount: trackA.metaphor_count ?? 3,
      interactionCuesCount: trackA.interaction_cues_count ?? 2,
      ctaPattern: trackA.cta_pattern ?? profile.callToActionType ?? 'Subscribe / LearnMore',
      jargonTreatment: trackA.jargon_treatment ?? 'simplified',
    },

    visualTrack: {
      baseMedium: trackB.base_medium ?? profile.visualStyle ?? '3D animation',
      lightingStyle: trackB.lighting_style ?? 'neutral',
      cameraMotion: trackB.camera_motion ?? 'static',
      colorTemperature: trackB.color_temperature ?? 'neutral',
      sceneAvgDurationSec: trackB.scene_avg_duration_sec ?? 5,
      transitionStyle: trackB.transition_style ?? 'cut',
      visualMetaphorMapping: vmmNormalised,
      bRollRatio: trackB.b_roll_ratio ?? 0,
      compositionStyle: trackB.composition_style ?? 'standard',
    },

    audioTrack: {
      bgmGenre: trackC.bgm_genre ?? 'ambient',
      bgmMood: trackC.bgm_mood ?? 'neutral',
      bgmTempo: trackC.bgm_tempo ?? 'medium',
      bgmRelativeVolume: trackC.bgm_relative_volume ?? 0.3,
      voiceStyle: trackC.voice_style ?? 'neutral',
    },

    packagingTrack: {
      subtitlePosition: normaliseSubtitlePosition(trackD.subtitle_position),
      subtitleHasShadow: Boolean(trackD.subtitle_has_shadow ?? true),
      subtitleHasBackdrop: Boolean(trackD.subtitle_has_backdrop ?? false),
      subtitleFontSize: normaliseSubtitleFontSize(trackD.subtitle_font_size),
      subtitlePrimaryColor: normaliseHex(trackD.subtitle_primary_color, '#FFFFFF'),
      subtitleOutlineColor: normaliseHex(trackD.subtitle_outline_color, '#000000'),
      subtitleFontCategory: normaliseFontCategory(trackD.subtitle_font_category),
      transitionDominantStyle: normaliseTransitionStyle(trackD.transition_dominant_style),
      transitionEstimatedDurationSec: clampNumber(trackD.transition_estimated_duration_sec, 0, 5, 0.5),
      hasIntroCard: Boolean(trackD.has_intro_card ?? false),
      introCardDurationSec: clampNumber(trackD.intro_card_duration_sec, 0, 10, 0),
      hasFadeIn: Boolean(trackD.has_fade_in ?? false),
      fadeInDurationSec: clampNumber(trackD.fade_in_duration_sec, 0, 5, 0),
      hasOutroCard: Boolean(trackD.has_outro_card ?? false),
      outroCardDurationSec: clampNumber(trackD.outro_card_duration_sec, 0, 10, 0),
      hasFadeOut: Boolean(trackD.has_fade_out ?? false),
      fadeOutDurationSec: clampNumber(trackD.fade_out_duration_sec, 0, 5, 0),
    },

    computed: {
      wordCount: profile.wordCount ?? 0,
      wordsPerMinute: profile.wordsPerMinute ?? 0,
      fullTranscript: profile.fullTranscript ?? '',
    },

    confidence: normalizeConfidenceKeys(profile.nodeConfidence ?? {}),
    contractScore,
  };

  // Validate the CIR
  const violations = validateStyleAnalysisCIR(cir);
  if (violations.length > 0) {
    log.warn('style_cir_validation_failed', { violations });
    throw new CIRValidationError(stage, 'StyleAnalysis', violations);
  }

  log.info('style_cir_parsed', { contractScore, visual: cir.visualStyle });
  return cir;
}

function normalisePacing(pacing?: string): 'slow' | 'medium' | 'fast' {
  const p = (pacing ?? 'medium').toLowerCase();
  if (p === 'slow' || p === 'fast') return p;
  return 'medium';
}

function normaliseSubtitlePosition(v?: string): 'bottom' | 'top' | 'center' {
  const p = (v ?? 'bottom').toLowerCase();
  if (p === 'top' || p === 'center') return p;
  return 'bottom';
}

function normaliseSubtitleFontSize(v?: string): 'small' | 'medium' | 'large' {
  const p = (v ?? 'medium').toLowerCase();
  if (p === 'small' || p === 'large') return p;
  return 'medium';
}

function normaliseFontCategory(v?: string): 'sans-serif' | 'serif' | 'handwritten' | 'monospace' {
  const p = (v ?? 'sans-serif').toLowerCase();
  if (p === 'serif' || p === 'handwritten' || p === 'monospace') return p;
  return 'sans-serif';
}

function normaliseTransitionStyle(v?: string): 'cut' | 'dissolve' | 'fade' | 'zoom' | 'morph' | 'wipe' {
  const p = (v ?? 'cut').toLowerCase();
  if (p === 'dissolve' || p === 'fade' || p === 'zoom' || p === 'morph' || p === 'wipe') return p;
  return 'cut';
}

function normaliseHex(v: unknown, fallback: string): string {
  if (typeof v !== 'string') return fallback;
  const hex = v.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(hex)) return hex;
  if (/^[0-9a-fA-F]{6}$/.test(hex)) return `#${hex}`;
  return fallback;
}

function clampNumber(v: unknown, min: number, max: number, fallback: number): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

/* ================================================================== */
/*  ResearchData → ResearchCIR                                        */
/* ================================================================== */

export function parseResearchCIR(
  data: ResearchData,
  _stage: PipelineStage = 'RESEARCH',
): ResearchCIR {
  const cir: ResearchCIR = {
    _cir: 'Research',
    version: 1,
    facts: data.facts.map(f => ({
      id: f.id,
      content: f.content,
      sources: f.sources.map(s => ({ url: s.url, title: s.title, reliability: s.reliability })),
      confidence: f.aggConfidence,
      verificationStatus: f.type ?? 'unverified',
    })),
    myths: data.myths ?? [],
    glossary: data.glossary ?? [],
    claimVerifications: (data.claimVerifications ?? []).map(cv => ({
      claim: cv.claim,
      verdict: cv.verdict,
      correction: cv.correction,
      confidence: cv.confidence,
    })),
  };

  log.info('research_cir_parsed', { factCount: cir.facts.length });
  return cir;
}

/* ================================================================== */
/*  ScriptOutput → ScriptCIR                                          */
/* ================================================================== */

export function parseScriptCIR(
  output: ScriptOutput,
  calibrationData: CalibrationData | undefined,
  language: string,
  stage: PipelineStage = 'SCRIPT_GENERATION',
): ScriptCIR {
  if (!output.scriptText?.trim()) {
    throw new AIParseError(stage, '', 'scriptText is empty');
  }

  // Safety net: unwrap scriptText if it looks like a JSON envelope
  // (happens when extractAndValidateJSON fails and raw LLM JSON is stored)
  let cleanText = output.scriptText.trim();
  if (cleanText.startsWith('{')) {
    try {
      const parsed = JSON.parse(cleanText);
      if (typeof parsed.script === 'string' && parsed.script.trim()) {
        log.warn('json_unwrap', { msg: 'scriptText was a JSON envelope — extracted .script field' });
        cleanText = parsed.script.trim();
      } else if (typeof parsed.scriptText === 'string' && parsed.scriptText.trim()) {
        log.warn('json_unwrap', { msg: 'scriptText was a JSON envelope — extracted .scriptText field' });
        cleanText = parsed.scriptText.trim();
      }
    } catch {
      // Not valid JSON — use as-is
    }
  }

  // Split script into sentences for structured representation.
  // Do NOT split on ASCII period between digits (e.g. "0.01%").
  const rawSentences = cleanText
    .split(/(?<=[。！？!?\n])|(?<=\.)(?!\d)(?<!\d\.)/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const sentences = rawSentences.map((text, index) => ({
    index,
    text,
    beatIndex: 0, // Would need narrative map to determine beat assignment
    factReferences: [] as string[],
    estimatedDurationSec: 0,
  }));

  // Assign fact references from sentence_list if available
  if (output.factUsage) {
    for (const fu of output.factUsage) {
      // Distribute to first relevant sentence (approximation)
      const match = sentences.find(s =>
        s.text.toLowerCase().includes(fu.factId.toLowerCase()),
      );
      if (match) match.factReferences.push(fu.factId);
    }
  }

  const calibration = calibrationData?.calibration ?? output.calibration;

  const cir: ScriptCIR = {
    _cir: 'Script',
    version: 1,
    fullText: output.scriptText,
    sentences,
    totalWordCount: output.totalWordCount ?? countWords(output.scriptText, language),
    totalDurationSec: output.totalEstimatedDuration ?? 60,
    usedFactIDs: output.usedFactIDs ?? [],
    safety: {
      isHighRisk: output.safetyMetadata?.isHighRisk ?? false,
      categories: output.safetyMetadata?.riskCategories ?? [],
      needsManualReview: output.safetyMetadata?.needsManualReview ?? false,
    },
    styleConsistencyScore: output.styleConsistency?.score ?? 0,
    calibration: {
      targetWordCount: calibration?.target_word_count ?? 300,
      targetWordCountMin: Number(calibration?.target_word_count_min ?? 270),
      targetWordCountMax: Number(calibration?.target_word_count_max ?? 330),
      targetDurationSec: calibration?.new_video_target_duration_sec ?? 60,
      speechRate: calibration?.actual_speech_rate ?? '250 characters per minute',
    },
  };

  // Validate
  const violations = validateScriptCIR(cir);
  if (violations.length > 0) {
    log.warn('script_cir_validation_failed', { violations });
    throw new CIRValidationError(stage, 'Script', violations);
  }

  log.info('script_cir_parsed', { wordCount: cir.totalWordCount, sentences: cir.sentences.length });
  return cir;
}

function countWords(text: string, language: string): number {
  if (!text) return 0;
  const isChinese = language.toLowerCase().includes('chinese') || language.toLowerCase().includes('中文');
  if (isChinese) {
    const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0;
    const ascii = text.match(/[a-zA-Z]+/g)?.length ?? 0;
    return cjk + ascii;
  }
  return text.split(/\s+/).filter(Boolean).length;
}

/* ================================================================== */
/*  Scene[] → StoryboardCIR                                           */
/* ================================================================== */

export function parseStoryboardCIR(
  scenes: Scene[],
  stage: PipelineStage = 'STORYBOARD',
): StoryboardCIR {
  if (!scenes || scenes.length === 0) {
    throw new AIParseError(stage, '', 'no scenes produced');
  }

  const cirScenes: StoryboardSceneCIR[] = scenes.map((s, i) => ({
    id: s.id,
    index: i,
    narrative: s.narrative,
    visualPrompt: s.visualPrompt,
    production: {
      camera: s.productionSpecs?.camera ?? '',
      lighting: s.productionSpecs?.lighting ?? '',
      sound: s.productionSpecs?.sound ?? '',
      notes: s.productionSpecs?.notes ?? '',
    },
    targetDurationSec: s.estimatedDuration ?? 5,
    assetType: s.assetType === 'video' ? 'video' : 'image',
  }));

  const videoCount = cirScenes.filter(s => s.assetType === 'video').length;

  // A3: Visual prompt quality checks
  const vpWarnings: string[] = [];
  for (const sc of cirScenes) {
    const vpLen = (sc.visualPrompt ?? '').length;
    if (vpLen < 20) {
      vpWarnings.push(`scenes[${sc.index}].visualPrompt too short (${vpLen} chars < 20): insufficient detail for visual generation`);
    } else if (vpLen < 50) {
      log.warn('visual_prompt_short', { sceneId: sc.id, length: vpLen });
    }
    if (vpLen > 500) {
      log.warn('visual_prompt_long', { sceneId: sc.id, length: vpLen });
    }
  }
  if (vpWarnings.length > 0) {
    throw new CIRValidationError(stage, 'Storyboard', vpWarnings);
  }

  const cir: StoryboardCIR = {
    _cir: 'Storyboard',
    version: 1,
    scenes: cirScenes,
    totalScenes: cirScenes.length,
    videoSceneCount: videoCount,
    imageSceneCount: cirScenes.length - videoCount,
    totalDurationSec: cirScenes.reduce((sum, s) => sum + s.targetDurationSec, 0),
  };

  // Validate
  const violations = validateStoryboardCIR(cir);
  if (violations.length > 0) {
    log.warn('storyboard_cir_validation_failed', { violations });
    throw new CIRValidationError(stage, 'Storyboard', violations);
  }

  log.info('storyboard_cir_parsed', {
    totalScenes: cir.totalScenes,
    videoScenes: cir.videoSceneCount,
    imageScenes: cir.imageSceneCount,
  });
  return cir;
}

/* ================================================================== */
/*  buildVideoIR – compiler MIR builder (NOT a parser)                */
/*  Pure merge of HIR artifacts into a fully-resolved VideoIR.        */
/*  No untrusted input — all inputs are validated CIRs.               */
/* ================================================================== */

export interface BuildVideoIROptions {
  scriptCIR: ScriptCIR;
  storyboardCIR: StoryboardCIR;
  temporalPlanCIR: TemporalPlanCIR;
  styleCIR: StyleAnalysisCIR;
  /** Pre-resolved TTS voice per scene (from resolveVoiceFromStyle) */
  ttsVoice: string;
  /** Pre-resolved TTS rate per scene (from resolveRateFromPacing) */
  ttsRate: string | undefined;
  /** Video scenes that should be promoted (post MIN_VIDEO_SCENES logic) */
  promotedVideoIndices?: Set<number>;
  /** C4: Output resolution override (default: { w: 1280, h: 720 }) */
  resolution?: { w: number; h: number };
  /** C4: Output FPS override (default: 30) */
  fps?: number;
  /** ShotCIR for per-scene transition mapping (optional). */
  shotCIR?: ShotCIR;
}

/** Emphasis → rate override. Applied at compile time so TTS reads a single field. */
const EMPHASIS_OVERRIDES: Record<Emphasis, string | undefined> = {
  slow: '-8%',
  normal: undefined,
  fast: '+8%',
};

type TransitionType = 'cut' | 'dissolve' | 'fade' | 'wipe' | 'zoom' | 'none';
const VALID_TRANSITIONS = new Set<TransitionType>(['cut', 'dissolve', 'fade', 'wipe', 'zoom', 'none']);
const TRANSITION_ALIASES: Record<string, TransitionType> = { morph: 'dissolve', crossfade: 'dissolve' };

/** Map a free-text transitionStyle from StyleAnalysisCIR to a valid VideoIR transition. */
export function normalizeTransitionStyle(raw: string): TransitionType | undefined {
  const key = raw.toLowerCase().trim();
  if (VALID_TRANSITIONS.has(key as TransitionType)) return key as TransitionType;
  return TRANSITION_ALIASES[key];
}

export function buildVideoIR(options: BuildVideoIROptions): VideoIR {
  const { scriptCIR, storyboardCIR, temporalPlanCIR, styleCIR, ttsVoice, ttsRate, promotedVideoIndices, shotCIR } = options;

  // Build transition map from ShotCIR (if available)
  const shotTransitions = shotCIR?.shots ?? [];

  const scenes: VideoIRScene[] = storyboardCIR.scenes.map((sb, i) => {
    const tp = temporalPlanCIR.scenes[i];

    // Determine final asset type: storyboard suggestion + promotion
    let assetType: 'image' | 'video' = sb.assetType;
    if (promotedVideoIndices?.has(i)) {
      assetType = 'video';
    }

    // Map transition from ShotCIR — interpolate if scene count differs from shot count.
    // Fallback chain: ShotCIR → StyleAnalysisCIR.visualTrack.transitionStyle
    //   → packagingTrack.transitionDominantStyle → 'cut'.
    let transitionToNext: 'cut' | 'dissolve' | 'fade' | 'wipe' | 'zoom' | 'none' = 'cut';
    if (shotTransitions.length > 0) {
      const shotIdx = Math.min(
        Math.floor((i / storyboardCIR.scenes.length) * shotTransitions.length),
        shotTransitions.length - 1,
      );
      transitionToNext = shotTransitions[shotIdx].transitionToNext;
    } else if (styleCIR.visualTrack.transitionStyle) {
      const styleTransition = normalizeTransitionStyle(styleCIR.visualTrack.transitionStyle);
      if (styleTransition) transitionToNext = styleTransition;
    } else if (styleCIR.packagingTrack?.transitionDominantStyle) {
      const pkgTransition = normalizeTransitionStyle(styleCIR.packagingTrack.transitionDominantStyle);
      if (pkgTransition) transitionToNext = pkgTransition;
    }
    // Last scene always has 'none' — no transition after it
    if (i === storyboardCIR.scenes.length - 1) {
      transitionToNext = 'none';
    }

    return {
      index: i,
      sentenceIndices: [tp.sentenceIndex],
      narrative: sb.narrative,
      visualPrompt: sb.visualPrompt,
      colorPalette: [...styleCIR.colorPalette],
      lightingStyle: styleCIR.visualTrack.lightingStyle,
      visualStyle: styleCIR.visualStyle,
      assetType,
      production: { ...sb.production },
      rawDurationSec: tp.rawDurationSec,
      apiDurationSec: tp.apiDurationSec,
      ttsBudgetSec: tp.ttsBudgetSec,
      ttsVoice,
      ttsRate: EMPHASIS_OVERRIDES[tp.emphasis] ?? ttsRate,
      emphasis: tp.emphasis,
      narrativePhase: tp.narrativePhase,
      emotionIntensity: tp.emotionIntensity,
      transitionToNext,
      transitionDuration: 0.5,
    };
  });

  return {
    _cir: 'VideoIR',
    version: 1,
    scenes,
    targetDurationSec: temporalPlanCIR.totalDurationSec,
    resolution: options.resolution ?? { w: 1280, h: 720 },
    fps: options.fps ?? 30,
    language: styleCIR.meta.videoLanguage || 'Chinese',
    avSyncPolicy: 'audio-primary',
    bgmRelativeVolume: styleCIR.audioTrack.bgmRelativeVolume,
  };
}
