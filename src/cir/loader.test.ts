/* ------------------------------------------------------------------ */
/*  Tests for CIR Loader Gateway                                      */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import { loadStyleCIR, loadScriptCIR, loadStoryboardCIR, loadFormatSignature, type CIRLoadContext } from './loader.js';
import { CIRValidationError } from './errors.js';
import { parseStyleAnalysisCIR, parseScriptCIR, parseStoryboardCIR } from './parsers.js';
import type { StyleProfile, ScriptOutput, Scene } from '../pipeline/types.js';
import { ARTIFACT } from '../constants.js';

/* ---- Test helpers ---- */

function fullStyleProfile(): StyleProfile {
  return {
    visualStyle: 'cinematic', pacing: 'fast', tone: 'excited',
    colorPalette: ['#FF0000'], narrativeStructure: ['Hook', 'Body', 'Conclusion'],
    fullTranscript: '测试转录文本。', wordCount: 200, wordsPerMinute: 250,
    meta: { video_duration_sec: 120, video_language: 'Chinese', video_type: 'explainer' },
    track_a_script: { sentence_length_max: 25, hook_strategy: 'Question', sentence_length_avg: 15, sentence_length_unit: 'characters', emotional_tone_arc: 'neutral → engaged', rhetorical_core: 'analogy', metaphor_count: 3, interaction_cues_count: 2, cta_pattern: 'subscribe', jargon_treatment: 'simplified' },
    track_b_visual: { base_medium: '3D animation', scene_avg_duration_sec: 4, lighting_style: 'warm', camera_motion: 'pan', color_temperature: 'warm', transition_style: 'dissolve', b_roll_ratio: 0.2, composition_style: 'rule-of-thirds' },
    track_c_audio: { bgm_genre: 'ambient', bgm_mood: 'uplifting', bgm_tempo: 'medium', bgm_relative_volume: 0.3, voice_style: 'energetic' },
    nodeConfidence: { visualStyle: 'confident', pacing: 'confident' },
  };
}

function fullScriptOutput(): ScriptOutput {
  return {
    scriptText: '量子纠缠是物理学中的基本现象。它连接了两个粒子的状态。',
    usedFactIDs: ['f1'], factUsage: [{ factId: 'f1', usageType: 'paraphrase' }],
    totalWordCount: 24, totalEstimatedDuration: 10,
    safetyMetadata: { isHighRisk: false },
    styleConsistency: { score: 0.85, isDeviation: false, feedback: 'Good', status: 'pass' },
  };
}

function fullScenes(): Scene[] {
  return [
    { id: 's1', number: 1, narrative: 'Opening hook', visualPrompt: 'A vast cosmos with swirling galaxies and nebulae stretching into infinity', productionSpecs: { camera: 'wide', lighting: 'dark', sound: 'ambient', notes: '' }, estimatedDuration: 5, assetType: 'video', status: 'done', logs: [] },
    { id: 's2', number: 2, narrative: 'Explanation', visualPrompt: 'Subatomic particles interacting in a colorful quantum field visualization', productionSpecs: { camera: 'close', lighting: 'warm', sound: 'music', notes: '' }, estimatedDuration: 4, assetType: 'image', status: 'done', logs: [] },
  ];
}

/** Create a mock CIRLoadContext that returns the given artifact map. */
function mockCtx(artifacts: Record<string, unknown>): CIRLoadContext {
  return {
    loadArtifact: <T>(filename: string) => artifacts[filename] as T | undefined,
  };
}

/* ================================================================== */
/*  loadStyleCIR                                                      */
/* ================================================================== */

describe('loadStyleCIR', () => {
  const validCIR = parseStyleAnalysisCIR(fullStyleProfile(), 85);

  it('returns valid StyleAnalysisCIR', () => {
    const ctx = mockCtx({ [ARTIFACT.STYLE_ANALYSIS_CIR]: validCIR });
    const result = loadStyleCIR(ctx, 'VIDEO_GEN');
    expect(result._cir).toBe('StyleAnalysis');
    expect(result.visualStyle).toBe('cinematic');
  });

  it('throws CIRValidationError when file is missing', () => {
    const ctx = mockCtx({});
    expect(() => loadStyleCIR(ctx, 'TTS')).toThrow(CIRValidationError);
    try { loadStyleCIR(ctx, 'TTS'); } catch (e: any) {
      expect(e.stage).toBe('TTS');
      expect(e.cirType).toBe('StyleAnalysis');
    }
  });

  it('throws CIRValidationError when _cir tag is wrong', () => {
    const ctx = mockCtx({ [ARTIFACT.STYLE_ANALYSIS_CIR]: { _cir: 'Script', version: 1 } });
    expect(() => loadStyleCIR(ctx, 'ASSEMBLY')).toThrow(CIRValidationError);
    try { loadStyleCIR(ctx, 'ASSEMBLY'); } catch (e: any) {
      expect(e.stage).toBe('ASSEMBLY');
      expect(e.violations[0]).toContain('missing or not a valid');
    }
  });

  it('loads CIR without field-level validation (thin loader)', () => {
    // After simplification, loader only checks _cir tag — not field contents
    const thinCIR = { _cir: 'StyleAnalysis', version: 1, visualStyle: '' };
    const ctx = mockCtx({ [ARTIFACT.STYLE_ANALYSIS_CIR]: thinCIR });
    const result = loadStyleCIR(ctx, 'STORYBOARD');
    expect(result._cir).toBe('StyleAnalysis');
  });

  it('throws CIRValidationError when artifact is null', () => {
    const ctx = mockCtx({ [ARTIFACT.STYLE_ANALYSIS_CIR]: null });
    expect(() => loadStyleCIR(ctx, 'VIDEO_GEN')).toThrow(CIRValidationError);
  });

  it('propagates the stage name in the error', () => {
    const ctx = mockCtx({});
    try { loadStyleCIR(ctx, 'SCRIPT_GENERATION'); } catch (e: any) {
      expect(e.stage).toBe('SCRIPT_GENERATION');
    }
  });
});

/* ================================================================== */
/*  loadScriptCIR                                                     */
/* ================================================================== */

describe('loadScriptCIR', () => {
  const validCIR = parseScriptCIR(fullScriptOutput(), undefined, 'Chinese');

  it('returns valid ScriptCIR', () => {
    const ctx = mockCtx({ [ARTIFACT.SCRIPT_CIR]: validCIR });
    const result = loadScriptCIR(ctx, 'ASSEMBLY');
    expect(result._cir).toBe('Script');
    expect(result.fullText).toContain('量子纠缠');
  });

  it('throws CIRValidationError when file is missing', () => {
    const ctx = mockCtx({});
    expect(() => loadScriptCIR(ctx, 'ASSEMBLY')).toThrow(CIRValidationError);
  });

  it('throws CIRValidationError when _cir tag is wrong', () => {
    const ctx = mockCtx({ [ARTIFACT.SCRIPT_CIR]: { _cir: 'StyleAnalysis', version: 1 } });
    expect(() => loadScriptCIR(ctx, 'STORYBOARD')).toThrow(CIRValidationError);
  });

  it('loads CIR without field-level validation (thin loader)', () => {
    const thinCIR = { _cir: 'Script', version: 1, fullText: '', sentences: [], totalWordCount: 0 };
    const ctx = mockCtx({ [ARTIFACT.SCRIPT_CIR]: thinCIR });
    const result = loadScriptCIR(ctx, 'ASSEMBLY');
    expect(result._cir).toBe('Script');
  });
});

/* ================================================================== */
/*  loadStoryboardCIR                                                 */
/* ================================================================== */

describe('loadStoryboardCIR', () => {
  const validCIR = parseStoryboardCIR(fullScenes());

  it('returns valid StoryboardCIR', () => {
    const ctx = mockCtx({ [ARTIFACT.STORYBOARD_CIR]: validCIR });
    const result = loadStoryboardCIR(ctx, 'VIDEO_GEN');
    expect(result._cir).toBe('Storyboard');
    expect(result.totalScenes).toBe(2);
  });

  it('throws CIRValidationError when file is missing', () => {
    const ctx = mockCtx({});
    expect(() => loadStoryboardCIR(ctx, 'VIDEO_GEN')).toThrow(CIRValidationError);
  });

  it('throws CIRValidationError when _cir tag is wrong', () => {
    const ctx = mockCtx({ [ARTIFACT.STORYBOARD_CIR]: { _cir: 'Script', version: 1 } });
    expect(() => loadStoryboardCIR(ctx, 'VIDEO_GEN')).toThrow(CIRValidationError);
  });

  it('loads CIR without field-level validation (thin loader)', () => {
    const thinCIR = { _cir: 'Storyboard', version: 1, scenes: [] };
    const ctx = mockCtx({ [ARTIFACT.STORYBOARD_CIR]: thinCIR });
    const result = loadStoryboardCIR(ctx, 'VIDEO_GEN');
    expect(result._cir).toBe('Storyboard');
  });
});

/* ================================================================== */
/*  loadFormatSignature                                               */
/* ================================================================== */

describe('loadFormatSignature', () => {
  const validFS = {
    _type: 'FormatSignature',
    version: 1,
    hookTemplate: 'Direct emotional address',
    closingTemplate: 'CTA: emotional reflection',
    sentenceLengthSequence: [34, 35, 30],
    transitionPositions: [3],
    transitionPatterns: ['但这还不是'],
    arcSentenceAllocation: [3, 3],
    arcStageLabels: ['Hook', 'Reflect'],
    signaturePhrases: ['生死时速'],
    emotionalArcShape: [0.8, 0.5],
    seriesVisualMotifs: {
      hookMotif: 'glowing particles',
      mechanismMotif: 'cellular macro',
      climaxMotif: 'cosmic reveal',
      reflectionMotif: 'warm embrace',
    },
  };

  it('returns valid FormatSignature when artifact is present', () => {
    const ctx = mockCtx({ [ARTIFACT.FORMAT_SIGNATURE]: validFS });
    const result = loadFormatSignature(ctx, 'SCRIPT_GENERATION');
    expect(result).toBeDefined();
    expect(result!._type).toBe('FormatSignature');
    expect(result!.hookTemplate).toBe('Direct emotional address');
  });

  it('returns undefined when artifact is absent', () => {
    const ctx = mockCtx({});
    const result = loadFormatSignature(ctx, 'SCRIPT_GENERATION');
    expect(result).toBeUndefined();
  });

  it('returns undefined when artifact has _error (extraction failure)', () => {
    const failedFS = { _type: 'FormatSignature', _error: 'AI parse failure' };
    const ctx = mockCtx({ [ARTIFACT.FORMAT_SIGNATURE]: failedFS });
    const result = loadFormatSignature(ctx, 'SCRIPT_GENERATION');
    expect(result).toBeUndefined();
  });

  it('returns undefined when _type tag is wrong', () => {
    const wrong = { ...validFS, _type: 'SomethingElse' };
    const ctx = mockCtx({ [ARTIFACT.FORMAT_SIGNATURE]: wrong });
    const result = loadFormatSignature(ctx, 'STORYBOARD');
    expect(result).toBeUndefined();
  });

  it('returns FormatSignature when _type matches (thin loader, no field validation)', () => {
    const partial = { _type: 'FormatSignature', version: 1, hookTemplate: 'ok' };
    const ctx = mockCtx({ [ARTIFACT.FORMAT_SIGNATURE]: partial });
    const result = loadFormatSignature(ctx, 'STORYBOARD');
    expect(result).toBeDefined();
    expect(result!._type).toBe('FormatSignature');
  });
});
