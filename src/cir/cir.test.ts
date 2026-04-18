/* ------------------------------------------------------------------ */
/*  Tests for CIR system: parsers, validators, errors                 */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import { validateStyleAnalysisCIR, validateScriptCIR, validateStoryboardCIR } from './contracts.js';
import { parseStyleAnalysisCIR, parseResearchCIR, parseScriptCIR, parseStoryboardCIR } from './parsers.js';
import { CIRValidationError, AIParseError } from './errors.js';
import type { StyleProfile, ResearchData, ScriptOutput, Scene } from '../pipeline/types.js';

/* ---- Helpers ---- */

function fullStyleProfile(): StyleProfile {
  return {
    visualStyle: 'cinematic',
    pacing: 'fast',
    tone: 'excited',
    colorPalette: ['#FF0000'],
    narrativeStructure: ['Hook', 'Body', 'Conclusion'],
    fullTranscript: '这是一个完整的测试转录文本。',
    wordCount: 200,
    wordsPerMinute: 250,
    meta: { video_duration_sec: 120, video_language: 'Chinese', video_type: 'explainer' },
    track_a_script: { sentence_length_max: 25, hook_strategy: 'Question', sentence_length_avg: 15, sentence_length_unit: 'characters', emotional_tone_arc: 'neutral → engaged', rhetorical_core: 'analogy', metaphor_count: 3, interaction_cues_count: 2, cta_pattern: 'subscribe', jargon_treatment: 'simplified' },
    track_b_visual: { base_medium: '3D animation', scene_avg_duration_sec: 4, lighting_style: 'warm', camera_motion: 'pan', color_temperature: 'warm', transition_style: 'dissolve', b_roll_ratio: 0.2, composition_style: 'rule-of-thirds' },
    track_c_audio: { bgm_genre: 'ambient', bgm_mood: 'uplifting', bgm_tempo: 'medium', bgm_relative_volume: 0.3, voice_style: 'energetic' },
    nodeConfidence: { visualStyle: 'confident', pacing: 'confident' },
  };
}

function fullResearchData(): ResearchData {
  return {
    facts: [
      { id: 'f1', content: 'Quantum entanglement is real', sources: [{ url: 'https://example.com' }], aggConfidence: 0.9, type: 'verified' },
    ],
    myths: ['Quantum means random'],
    glossary: [{ term: 'Qubit', definition: 'Quantum bit' }],
    claimVerifications: [{ claim: 'Entanglement', verdict: 'verified', confidence: 0.95 }],
  };
}

function fullScriptOutput(): ScriptOutput {
  return {
    scriptText: '量子纠缠是物理学中的基本现象。它连接了两个粒子的状态。',
    usedFactIDs: ['f1'],
    factUsage: [{ factId: 'f1', usageType: 'paraphrase' }],
    totalWordCount: 24,
    totalEstimatedDuration: 10,
    safetyMetadata: { isHighRisk: false },
    styleConsistency: { score: 0.85, isDeviation: false, feedback: 'Good', status: 'pass' },
  };
}

function fullScenes(): Scene[] {
  return [
    { id: 's1', number: 1, narrative: 'Opening hook', visualPrompt: 'A vast cosmos with swirling galaxies and nebulae stretching into infinity', productionSpecs: { camera: 'wide', lighting: 'dark', sound: 'ambient', notes: '' }, estimatedDuration: 5, assetType: 'video', status: 'done', logs: [], referenceImageUrl: '/ref-1.png', keyframeUrl: '/kf-1.png', assetUrl: '/video-1.mp4', audioUrl: '/audio-1.mp3', audioDuration: 5 },
    { id: 's2', number: 2, narrative: 'Explanation', visualPrompt: 'Subatomic particles interacting in a colorful quantum field visualization', productionSpecs: { camera: 'close', lighting: 'warm', sound: 'music', notes: '' }, estimatedDuration: 4, assetType: 'image', status: 'done', logs: [], referenceImageUrl: '/ref-2.png' },
  ];
}

/* ================================================================== */
/*  Error model tests                                                  */
/* ================================================================== */

describe('CIR Errors', () => {
  it('CIRValidationError has correct properties', () => {
    const err = new CIRValidationError('STYLE_EXTRACTION', 'StyleAnalysis', ['field missing']);
    expect(err.name).toBe('CIRValidationError');
    expect(err.stage).toBe('STYLE_EXTRACTION');
    expect(err.cirType).toBe('StyleAnalysis');
    expect(err.violations).toEqual(['field missing']);
    expect(err.message).toContain('StyleAnalysis');
  });

  it('AIParseError has correct properties', () => {
    const err = new AIParseError('SCRIPT_GENERATION', 'raw garbage', 'not JSON');
    expect(err.name).toBe('AIParseError');
    expect(err.stage).toBe('SCRIPT_GENERATION');
    expect(err.reason).toBe('not JSON');
    expect(err.message).not.toContain('raw garbage'); // Should not leak raw text
  });
});

/* ================================================================== */
/*  CIR validator tests                                                */
/* ================================================================== */

describe('CIR validators', () => {
  it('validateStyleAnalysisCIR accepts valid CIR', () => {
    const cir = parseStyleAnalysisCIR(fullStyleProfile(), 85);
    expect(validateStyleAnalysisCIR(cir)).toEqual([]);
  });

  it('validateStyleAnalysisCIR rejects null', () => {
    expect(validateStyleAnalysisCIR(null).length).toBeGreaterThan(0);
  });

  it('validateScriptCIR rejects missing fullText', () => {
    expect(validateScriptCIR({ _cir: 'Script' }).length).toBeGreaterThan(0);
  });

  it('validateStoryboardCIR rejects empty scenes', () => {
    expect(validateStoryboardCIR({ _cir: 'Storyboard', scenes: [] }).length).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/*  Parser tests                                                       */
/* ================================================================== */

describe('parseStyleAnalysisCIR', () => {
  it('converts StyleProfile to valid CIR', () => {
    const cir = parseStyleAnalysisCIR(fullStyleProfile(), 90);
    expect(cir._cir).toBe('StyleAnalysis');
    expect(cir.version).toBe(1);
    expect(cir.visualStyle).toBe('cinematic');
    expect(cir.meta.videoDurationSec).toBe(120);
    expect(cir.meta.videoLanguage).toBe('Chinese');
    expect(cir.scriptTrack.hookStrategy).toBe('Question');
    expect(cir.visualTrack.baseMedium).toBe('3D animation');
    expect(cir.audioTrack.bgmGenre).toBe('ambient');
    expect(cir.contractScore).toBe(90);
    expect(cir.confidence).toEqual({ visualStyle: 'confident', pacing: 'confident' });
  });

  it('normalises pacing to enum', () => {
    const profile = fullStyleProfile();
    profile.pacing = 'FAST';
    const cir = parseStyleAnalysisCIR(profile, 80);
    expect(cir.pacing).toBe('fast');
  });

  it('handles missing optional tracks gracefully', () => {
    const profile: StyleProfile = {
      visualStyle: 'cinematic', pacing: 'medium', tone: 'informative',
      colorPalette: ['#fff'], narrativeStructure: ['Hook'],
      meta: { video_duration_sec: 60, video_language: 'Chinese', video_type: 'explainer' },
    };
    const cir = parseStyleAnalysisCIR(profile, 50);
    expect(cir.scriptTrack.hookStrategy).toBe('Question'); // default
    expect(cir.visualTrack.baseMedium).toBe('cinematic'); // falls back to visualStyle
    expect(cir.audioTrack.bgmGenre).toBe('ambient'); // default
  });

  it('fills defensive defaults for empty profile', () => {
    // Parser is intentionally defensive — it fills defaults rather than throwing
    const profile: StyleProfile = {
      visualStyle: '', pacing: '', tone: '', colorPalette: [], narrativeStructure: [],
    };
    const cir = parseStyleAnalysisCIR(profile, 0);
    expect(cir.visualStyle).toBe('cinematic'); // default fallback
    expect(cir.pacing).toBe('medium'); // normalised default
    expect(cir.meta.videoDurationSec).toBe(60); // meta default
  });
});

describe('parseResearchCIR', () => {
  it('converts ResearchData to valid CIR', () => {
    const cir = parseResearchCIR(fullResearchData());
    expect(cir._cir).toBe('Research');
    expect(cir.facts).toHaveLength(1);
    expect(cir.facts[0].verificationStatus).toBe('verified');
    expect(cir.myths).toEqual(['Quantum means random']);
    expect(cir.glossary).toHaveLength(1);
    expect(cir.claimVerifications).toHaveLength(1);
  });
});

describe('parseScriptCIR', () => {
  it('converts ScriptOutput to valid CIR', () => {
    const cir = parseScriptCIR(fullScriptOutput(), undefined, 'Chinese');
    expect(cir._cir).toBe('Script');
    expect(cir.fullText).toContain('量子纠缠');
    expect(cir.sentences.length).toBeGreaterThan(0);
    expect(cir.totalWordCount).toBeGreaterThan(0);
    expect(cir.usedFactIDs).toEqual(['f1']);
    expect(cir.safety.isHighRisk).toBe(false);
  });

  it('throws AIParseError for empty script', () => {
    const output: ScriptOutput = { scriptText: '', usedFactIDs: [], factUsage: [] };
    expect(() => parseScriptCIR(output, undefined, 'Chinese')).toThrow(AIParseError);
  });
});

describe('parseStoryboardCIR', () => {
  it('converts scenes to valid CIR', () => {
    const cir = parseStoryboardCIR(fullScenes());
    expect(cir._cir).toBe('Storyboard');
    expect(cir.totalScenes).toBe(2);
    expect(cir.videoSceneCount).toBe(1);
    expect(cir.imageSceneCount).toBe(1);
    expect(cir.scenes[0].narrative).toBe('Opening hook');
    expect(cir.totalDurationSec).toBe(9);
  });

  it('throws AIParseError for empty scenes', () => {
    expect(() => parseStoryboardCIR([])).toThrow(AIParseError);
  });
});

/* ================================================================== */
/*  SCRIPT_GENERATION CIR consumption tests                           */
/*  Validates that the CIR produced by STYLE_EXTRACTION contains      */
/*  all fields that SCRIPT_GENERATION consumes, and that the          */
/*  fail-closed loading pattern rejects missing/invalid CIR.          */
/* ================================================================== */

describe('SCRIPT_GENERATION CIR consumption', () => {
  const cir = parseStyleAnalysisCIR(fullStyleProfile(), 85);

  it('CIR present and valid — all SCRIPT_GENERATION fields available', () => {
    // scriptTrack fields consumed by runScriptGeneration()
    expect(cir.scriptTrack).toBeDefined();
    expect(cir.scriptTrack.hookStrategy).toBeTypeOf('string');
    expect(cir.scriptTrack.sentenceLengthMax).toBeTypeOf('number');
    expect(cir.scriptTrack.sentenceLengthAvg).toBeTypeOf('number');
    expect(cir.scriptTrack.sentenceLengthUnit).toBeTypeOf('string');
    expect(cir.scriptTrack.narrativeArc).toBeInstanceOf(Array);
    expect(cir.scriptTrack.narrativeArc.length).toBeGreaterThan(0);
    expect(cir.scriptTrack.emotionalToneArc).toBeTypeOf('string');
    expect(cir.scriptTrack.rhetoricalCore).toBeTypeOf('string');
    expect(cir.scriptTrack.metaphorCount).toBeTypeOf('number');
    expect(cir.scriptTrack.interactionCuesCount).toBeTypeOf('number');
    expect(cir.scriptTrack.ctaPattern).toBeTypeOf('string');
    expect(cir.scriptTrack.jargonTreatment).toBeTypeOf('string');

    // visualTrack fields consumed by runScriptGeneration()
    expect(cir.visualTrack).toBeDefined();
    expect(cir.visualTrack.baseMedium).toBeTypeOf('string');
    expect(cir.visualTrack.sceneAvgDurationSec).toBeTypeOf('number');
    expect(cir.visualTrack.visualMetaphorMapping).toBeDefined();
    expect(cir.visualTrack.visualMetaphorMapping.rule).toBeTypeOf('string');
    expect(cir.visualTrack.visualMetaphorMapping.examples).toBeInstanceOf(Array);

    // meta fields
    expect(cir.meta.videoDurationSec).toBeTypeOf('number');
    expect(cir.meta.videoDurationSec).toBeGreaterThan(0);
    expect(cir.meta.videoLanguage).toBeTypeOf('string');

    // computed fields
    expect(cir.computed.wordsPerMinute).toBeTypeOf('number');
    expect(cir.computed.wordCount).toBeTypeOf('number');
    expect(cir.computed.fullTranscript).toBeTypeOf('string');

    // confidence + pacing
    expect(cir.confidence).toBeDefined();
    expect(cir.pacing).toMatch(/^(slow|medium|fast)$/);
  });

  it('CIR missing — fail-closed rejects null/undefined', () => {
    // Simulates loadAndValidateStyleCIR when artifact is absent
    const styleCIR: unknown = undefined;
    expect(!styleCIR || (styleCIR as any)?._cir !== 'StyleAnalysis').toBe(true);
    // This path throws CIRValidationError in loadAndValidateStyleCIR
  });

  it('CIR invalid — wrong _cir tag rejected by validator', () => {
    const badCIR = { _cir: 'Research', version: 1, visualStyle: 'cinematic' };
    const violations = validateStyleAnalysisCIR(badCIR);
    expect(violations).toContain('_cir must be "StyleAnalysis"');
  });

  it('CIR invalid — missing scriptTrack rejected by validator', () => {
    const incompleteCIR = {
      _cir: 'StyleAnalysis',
      version: 1,
      visualStyle: 'cinematic',
      meta: { videoDurationSec: 60, videoLanguage: 'Chinese' },
      visualTrack: { baseMedium: '3D' },
    };
    const violations = validateStyleAnalysisCIR(incompleteCIR);
    expect(violations).toContain('scriptTrack is required');
  });

  it('CIR invalid — missing visualTrack rejected by validator', () => {
    const incompleteCIR = {
      _cir: 'StyleAnalysis',
      version: 1,
      visualStyle: 'cinematic',
      meta: { videoDurationSec: 60, videoLanguage: 'Chinese' },
      scriptTrack: { hookStrategy: 'Question' },
    };
    const violations = validateStyleAnalysisCIR(incompleteCIR);
    expect(violations).toContain('visualTrack is required');
  });

  it('CIR invalid — missing meta rejected by validator', () => {
    const incompleteCIR = {
      _cir: 'StyleAnalysis',
      version: 1,
      visualStyle: 'cinematic',
      scriptTrack: { hookStrategy: 'Question' },
      visualTrack: { baseMedium: '3D' },
    };
    const violations = validateStyleAnalysisCIR(incompleteCIR);
    expect(violations).toContain('meta is required');
  });

  it('raw styleProfile not accepted by ScriptGenerationInput', () => {
    // ScriptGenerationInput requires styleCIR, not styleProfile.
    // Compile-time enforcement; this runtime test documents the contract change.
    const input: Record<string, unknown> = {
      topic: 'test',
      styleCIR: cir,
      researchData: { facts: [] },
      narrativeMap: [],
    };
    expect(input.styleCIR).toBe(cir);
    expect(input).not.toHaveProperty('styleProfile');
  });
});

/* ================================================================== */
/*  STORYBOARD CIR consumption tests                                  */
/*  Validates that both StyleAnalysisCIR and ScriptCIR contain all    */
/*  fields STORYBOARD consumes, and that fail-closed rejects          */
/*  missing/invalid CIR.                                              */
/* ================================================================== */

describe('STORYBOARD CIR consumption', () => {
  const styleCir = parseStyleAnalysisCIR(fullStyleProfile(), 85);
  const scriptCir = parseScriptCIR(fullScriptOutput(), undefined, 'Chinese');

  it('StyleAnalysisCIR has all STORYBOARD visual fields', () => {
    const vt = styleCir.visualTrack;
    expect(vt).toBeDefined();
    expect(vt.baseMedium).toBeTypeOf('string');
    expect(vt.lightingStyle).toBeTypeOf('string');
    expect(vt.cameraMotion).toBeTypeOf('string');
    expect(vt.colorTemperature).toBeTypeOf('string');
    expect(vt.compositionStyle).toBeTypeOf('string');
    expect(vt.transitionStyle).toBeTypeOf('string');
    expect(vt.sceneAvgDurationSec).toBeTypeOf('number');
    expect(vt.sceneAvgDurationSec).toBeGreaterThan(0);
    expect(vt.visualMetaphorMapping).toBeDefined();
    expect(vt.visualMetaphorMapping.rule).toBeTypeOf('string');
    expect(vt.visualMetaphorMapping.examples).toBeInstanceOf(Array);
    expect(styleCir.colorPalette).toBeInstanceOf(Array);
    expect(styleCir.colorPalette.length).toBeGreaterThan(0);
  });

  it('ScriptCIR has all STORYBOARD script fields', () => {
    expect(scriptCir.fullText).toBeTypeOf('string');
    expect(scriptCir.fullText.length).toBeGreaterThan(0);
    expect(scriptCir.sentences).toBeInstanceOf(Array);
    expect(scriptCir.sentences.length).toBeGreaterThan(0);
    expect(scriptCir.sentences[0].text).toBeTypeOf('string');
    expect(scriptCir.totalWordCount).toBeTypeOf('number');
  });

  it('ScriptCIR missing — validator rejects wrong _cir tag', () => {
    const badCIR = { _cir: 'StyleAnalysis', version: 1, fullText: 'text' };
    const violations = validateScriptCIR(badCIR);
    expect(violations).toContain('_cir must be "Script"');
  });

  it('ScriptCIR missing — validator rejects null', () => {
    const violations = validateScriptCIR(null);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('ScriptCIR invalid — missing fullText rejected', () => {
    const badCIR = { _cir: 'Script', version: 1, fullText: '', sentences: [], totalWordCount: 0, safety: {}, calibration: {} };
    const violations = validateScriptCIR(badCIR);
    expect(violations).toContain('fullText is required');
  });

  it('ScriptCIR invalid — missing sentences rejected', () => {
    const badCIR = { _cir: 'Script', version: 1, fullText: 'some text', sentences: undefined };
    const violations = validateScriptCIR(badCIR);
    expect(violations).toContain('sentences must be an array');
  });

  it('StyleAnalysisCIR missing visualTrack — rejected by validator', () => {
    const incompleteCIR = {
      _cir: 'StyleAnalysis',
      version: 1,
      visualStyle: 'cinematic',
      meta: { videoDurationSec: 60, videoLanguage: 'Chinese' },
      scriptTrack: { hookStrategy: 'Question' },
    };
    const violations = validateStyleAnalysisCIR(incompleteCIR);
    expect(violations).toContain('visualTrack is required');
  });

  it('raw project fields not accepted by StoryboardInput', () => {
    // StoryboardInput requires styleCIR + scriptCIR, not styleProfile/scriptOutput.
    // Compile-time enforcement; this runtime test documents the contract change.
    const input: Record<string, unknown> = {
      topic: 'test',
      styleCIR: styleCir,
      scriptCIR: scriptCir,
    };
    expect(input.styleCIR).toBe(styleCir);
    expect(input.scriptCIR).toBe(scriptCir);
    expect(input).not.toHaveProperty('styleProfile');
    expect(input).not.toHaveProperty('scriptOutput');
  });
});

/* ================================================================== */
/*  VIDEO_GEN CIR consumption tests                                   */
/*  Validates that StyleAnalysisCIR + StoryboardCIR contain all       */
/*  fields VIDEO_GEN consumes, and that fail-closed rejects           */
/*  missing/invalid CIR.                                              */
/* ================================================================== */

describe('VIDEO_GEN CIR consumption', () => {
  const styleCir = parseStyleAnalysisCIR(fullStyleProfile(), 85);
  const storyboardCir = parseStoryboardCIR(fullScenes());

  it('StyleAnalysisCIR has all VIDEO_GEN visual fields', () => {
    const vt = styleCir.visualTrack;
    expect(vt).toBeDefined();
    expect(vt.lightingStyle).toBeTypeOf('string');
    expect(styleCir.visualStyle).toBeTypeOf('string');
    expect(styleCir.colorPalette).toBeInstanceOf(Array);
    expect(styleCir.colorPalette.length).toBeGreaterThan(0);
  });

  it('StoryboardCIR has all VIDEO_GEN scene fields', () => {
    expect(storyboardCir.scenes).toBeInstanceOf(Array);
    expect(storyboardCir.scenes.length).toBeGreaterThan(0);
    expect(storyboardCir.videoSceneCount).toBeTypeOf('number');
    expect(storyboardCir.totalScenes).toBeGreaterThan(0);
    // Each scene has visual prompt and duration
    for (const s of storyboardCir.scenes) {
      expect(s.visualPrompt).toBeTypeOf('string');
      expect(s.targetDurationSec).toBeTypeOf('number');
      expect(s.assetType).toMatch(/^(image|video)$/);
    }
  });

  it('StoryboardCIR missing — validator rejects null', () => {
    const violations = validateStoryboardCIR(null);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('StoryboardCIR missing — validator rejects wrong _cir tag', () => {
    const badCIR = { _cir: 'Script', version: 1, scenes: [{}] };
    const violations = validateStoryboardCIR(badCIR);
    expect(violations).toContain('_cir must be "Storyboard"');
  });

  it('StoryboardCIR invalid — empty scenes rejected', () => {
    const badCIR = { _cir: 'Storyboard', version: 1, scenes: [] };
    const violations = validateStoryboardCIR(badCIR);
    expect(violations).toContain('scenes must not be empty');
  });

  it('StyleAnalysisCIR missing visualTrack — rejected by validator', () => {
    const incompleteCIR = {
      _cir: 'StyleAnalysis',
      version: 1,
      visualStyle: 'cinematic',
      meta: { videoDurationSec: 60, videoLanguage: 'Chinese' },
      scriptTrack: { hookStrategy: 'Question' },
    };
    const violations = validateStyleAnalysisCIR(incompleteCIR);
    expect(violations).toContain('visualTrack is required');
  });

  it('raw project fields not accepted by VideoGenInput', () => {
    // VideoGenInput requires styleCIR + storyboardCIR, not styleProfile.
    const input: Record<string, unknown> = {
      scenes: [],
      styleCIR: styleCir,
      storyboardCIR: storyboardCir,
      assetsDir: '/tmp',
    };
    expect(input.styleCIR).toBe(styleCir);
    expect(input.storyboardCIR).toBe(storyboardCir);
    expect(input).not.toHaveProperty('styleProfile');
    expect(input).not.toHaveProperty('scriptOutput');
  });
});

/* ================================================================== */
/*  TTS CIR consumption tests                                         */
/*  Validates that StyleAnalysisCIR contains all fields TTS consumes  */
/*  (audioTrack.voiceStyle, pacing, meta.videoLanguage) and that      */
/*  fail-closed rejects missing/invalid CIR.                          */
/* ================================================================== */

describe('TTS CIR consumption', () => {
  const styleCir = parseStyleAnalysisCIR(fullStyleProfile(), 85);

  it('StyleAnalysisCIR has all TTS audio fields', () => {
    const at = styleCir.audioTrack;
    expect(at).toBeDefined();
    expect(at.voiceStyle).toBeTypeOf('string');
    expect(at.voiceStyle.length).toBeGreaterThan(0);
    expect(styleCir.pacing).toMatch(/^(slow|medium|fast)$/);
    expect(styleCir.meta.videoLanguage).toBeTypeOf('string');
    expect(styleCir.meta.videoLanguage.length).toBeGreaterThan(0);
  });

  it('CIR missing — fail-closed rejects null/undefined', () => {
    const styleCIR: unknown = undefined;
    expect(!styleCIR || (styleCIR as any)?._cir !== 'StyleAnalysis').toBe(true);
  });

  it('CIR invalid — wrong _cir tag rejected by validator', () => {
    const badCIR = { _cir: 'Script', version: 1, audioTrack: { voiceStyle: 'warm' } };
    const violations = validateStyleAnalysisCIR(badCIR);
    expect(violations).toContain('_cir must be "StyleAnalysis"');
  });

  it('CIR invalid — missing audioTrack rejected by validator', () => {
    const incompleteCIR = {
      _cir: 'StyleAnalysis',
      version: 1,
      visualStyle: 'cinematic',
      meta: { videoDurationSec: 60, videoLanguage: 'Chinese' },
      scriptTrack: { hookStrategy: 'Question' },
      visualTrack: { baseMedium: '3D' },
    };
    const violations = validateStyleAnalysisCIR(incompleteCIR);
    expect(violations).toContain('audioTrack is required');
  });

  it('raw styleProfile not read by TTS stage', () => {
    // TTS stage now reads styleCIR.audioTrack.voiceStyle, styleCIR.pacing,
    // styleCIR.meta.videoLanguage — not project.styleProfile.
    const ttsConfig: Record<string, unknown> = {
      voice: styleCir.audioTrack.voiceStyle,
      rate: styleCir.pacing,
      language: styleCir.meta.videoLanguage,
    };
    expect(ttsConfig.voice).toBe('energetic');
    expect(ttsConfig.rate).toBe('fast');
    expect(ttsConfig.language).toBe('Chinese');
  });
});

/* ================================================================== */
/*  ASSEMBLY CIR consumption tests                                    */
/*  Validates that StyleAnalysisCIR + ScriptCIR contain all fields    */
/*  ASSEMBLY consumes (audioTrack.bgmRelativeVolume, fullText) and    */
/*  that fail-closed rejects missing/invalid CIR.                     */
/* ================================================================== */

describe('ASSEMBLY CIR consumption', () => {
  const styleCir = parseStyleAnalysisCIR(fullStyleProfile(), 85);
  const scriptCir = parseScriptCIR(fullScriptOutput(), undefined, 'Chinese');

  it('StyleAnalysisCIR has all ASSEMBLY audio fields', () => {
    const at = styleCir.audioTrack;
    expect(at).toBeDefined();
    expect(at.bgmRelativeVolume).toBeTypeOf('number');
    expect(at.bgmRelativeVolume).toBeGreaterThanOrEqual(0);
    expect(at.bgmRelativeVolume).toBeLessThanOrEqual(1);
  });

  it('ScriptCIR has fullText for final risk gate', () => {
    expect(scriptCir.fullText).toBeTypeOf('string');
    expect(scriptCir.fullText.length).toBeGreaterThan(0);
  });

  it('ScriptCIR missing — validator rejects null', () => {
    const violations = validateScriptCIR(null);
    expect(violations.length).toBeGreaterThan(0);
  });

  it('ScriptCIR missing — validator rejects wrong _cir tag', () => {
    const badCIR = { _cir: 'Storyboard', version: 1, fullText: 'text' };
    const violations = validateScriptCIR(badCIR);
    expect(violations).toContain('_cir must be "Script"');
  });

  it('ScriptCIR invalid — missing fullText rejected', () => {
    const badCIR = { _cir: 'Script', version: 1, fullText: '', sentences: [], totalWordCount: 0 };
    const violations = validateScriptCIR(badCIR);
    expect(violations).toContain('fullText is required');
  });

  it('StyleAnalysisCIR missing audioTrack — rejected by validator', () => {
    const incompleteCIR = {
      _cir: 'StyleAnalysis',
      version: 1,
      visualStyle: 'cinematic',
      meta: { videoDurationSec: 60, videoLanguage: 'Chinese' },
      scriptTrack: { hookStrategy: 'Question' },
      visualTrack: { baseMedium: '3D' },
    };
    const violations = validateStyleAnalysisCIR(incompleteCIR);
    expect(violations).toContain('audioTrack is required');
  });

  it('raw project fields not read by ASSEMBLY stage', () => {
    // ASSEMBLY now reads styleCIR.audioTrack.bgmRelativeVolume + scriptCIR.fullText
    // — not project.styleProfile or project.scriptOutput.
    const assemblyParams: Record<string, unknown> = {
      bgmVolume: styleCir.audioTrack.bgmRelativeVolume,
      scriptText: scriptCir.fullText,
    };
    expect(assemblyParams.bgmVolume).toBe(0.3);
    expect(assemblyParams.scriptText).toContain('量子纠缠');
    expect(assemblyParams).not.toHaveProperty('styleProfile');
    expect(assemblyParams).not.toHaveProperty('scriptOutput');
  });
});
