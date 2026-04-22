/* ------------------------------------------------------------------ */
/*  Tests for CIR parsers                                             */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import {
  parseStoryboardCIR,
  parseStyleAnalysisCIR,
  parseResearchCIR,
  parseScriptCIR,
  buildVideoIR,
} from '../parsers.js';
import { CIRValidationError, AIParseError } from '../errors.js';
import type { Scene, StyleProfile, ResearchData, ScriptOutput, CalibrationData } from '@ai-video/pipeline-core/pipelineTypes.js';
import type { StoryboardCIR, TemporalPlanCIR, StyleAnalysisCIR, ShotCIR } from '../types.js';

/* ---- Helpers ---- */

function makeScene(id: string, visualPrompt: string, overrides: Partial<Scene> = {}): Scene {
  return {
    id,
    number: parseInt(id.replace(/\D/g, ''), 10) || 1,
    narrative: `Scene ${id} narrative text.`,
    visualPrompt,
    assetType: 'video',
    estimatedDuration: 5,
    productionSpecs: { camera: 'wide', lighting: 'soft', sound: 'ambient', notes: '' },
    status: 'pending' as const,
    logs: [],
    ...overrides,
  } as Scene;
}

function makeStyleProfile(overrides: Partial<StyleProfile> = {}): StyleProfile {
  return {
    visualStyle: 'cinematic',
    pacing: 'medium',
    tone: 'informative',
    colorPalette: ['#FF0000', '#00FF00'],
    narrativeStructure: ['Hook', 'Body', 'Conclusion'],
    meta: { video_language: 'Chinese', video_duration_sec: 60, video_type: 'explainer' },
    wordCount: 300,
    wordsPerMinute: 150,
    fullTranscript: 'Hello world',
    ...overrides,
  };
}

function makeScriptOutput(overrides: Partial<ScriptOutput> = {}): ScriptOutput {
  return {
    scriptText: 'This is a well-formed test script sentence. It has multiple sentences here.',
    usedFactIDs: ['f1'],
    factUsage: [],
    totalWordCount: 12,
    totalEstimatedDuration: 30,
    ...overrides,
  };
}

/* ================================================================== */
/*  parseStoryboardCIR                                                */
/* ================================================================== */

describe('parseStoryboardCIR — A3: visual prompt validation', () => {
  it('throws CIRValidationError when a visual prompt is too short (< 20 chars)', () => {
    const scenes = [
      makeScene('s1', 'A detailed 3D animation of the sun.'),
      makeScene('s2', 'Short'),
    ];
    expect(() => parseStoryboardCIR(scenes)).toThrow(CIRValidationError);
  });

  it('passes when all visual prompts are >= 20 chars', () => {
    const scenes = [
      makeScene('s1', 'A sweeping 3D animation showing the surface of the sun with solar flares.'),
      makeScene('s2', 'A close-up of Earth from space showing the blue atmosphere and oceans.'),
    ];
    const cir = parseStoryboardCIR(scenes);
    expect(cir.totalScenes).toBe(2);
  });

  it('throws AIParseError for empty scenes array', () => {
    expect(() => parseStoryboardCIR([])).toThrow(AIParseError);
  });

  it('throws AIParseError for null/undefined scenes', () => {
    expect(() => parseStoryboardCIR(null as any)).toThrow(AIParseError);
  });

  it('counts video vs image scenes correctly', () => {
    const scenes = [
      makeScene('s1', 'A detailed 3D animation of a mountain range in sunset.', { assetType: 'video' }),
      makeScene('s2', 'A detailed illustration of a forest clearing.', { assetType: 'image' }),
      makeScene('s3', 'A dramatic wide shot of ocean waves crashing.', { assetType: 'video' }),
    ];
    const cir = parseStoryboardCIR(scenes);
    expect(cir.videoSceneCount).toBe(2);
    expect(cir.imageSceneCount).toBe(1);
    expect(cir._cir).toBe('Storyboard');
    expect(cir.version).toBe(1);
  });

  it('computes totalDurationSec from scenes estimatedDuration', () => {
    const scenes = [
      makeScene('s1', 'A detailed 3D animation of an underwater world.', { estimatedDuration: 10 }),
      makeScene('s2', 'A beautiful close-up of a coral reef formation.', { estimatedDuration: 15 }),
    ];
    const cir = parseStoryboardCIR(scenes);
    expect(cir.totalDurationSec).toBe(25);
  });

  it('defaults estimatedDuration to 5 when missing', () => {
    const scenes = [
      makeScene('s1', 'A detailed 3D animation of stars in outer space.', { estimatedDuration: undefined } as any),
    ];
    const cir = parseStoryboardCIR(scenes);
    expect(cir.scenes[0]!.targetDurationSec).toBe(5);
  });

  it('maps productionSpecs correctly', () => {
    const scenes = [
      makeScene('s1', 'A detailed 3D scene with production specs provided.', {
        productionSpecs: { camera: 'close-up', lighting: 'dramatic', sound: 'cinematic', notes: 'focus on face' },
      }),
    ];
    const cir = parseStoryboardCIR(scenes);
    expect(cir.scenes[0]!.production.camera).toBe('close-up');
    expect(cir.scenes[0]!.production.lighting).toBe('dramatic');
  });

  it('defaults productionSpecs to empty strings when missing', () => {
    const scenes = [
      makeScene('s1', 'A detailed 3D animation scene without production specs.', {
        productionSpecs: undefined,
      } as any),
    ];
    const cir = parseStoryboardCIR(scenes);
    expect(cir.scenes[0]!.production.camera).toBe('');
  });
});

/* ================================================================== */
/*  parseStyleAnalysisCIR                                             */
/* ================================================================== */

describe('parseStyleAnalysisCIR', () => {
  it('parses a minimal valid profile', () => {
    const profile = makeStyleProfile();
    const cir = parseStyleAnalysisCIR(profile, 85);
    expect(cir._cir).toBe('StyleAnalysis');
    expect(cir.version).toBe(1);
    expect(cir.visualStyle).toBe('cinematic');
    expect(cir.pacing).toBe('medium');
    expect(cir.contractScore).toBe(85);
    expect(cir.colorPalette).toEqual(['#FF0000', '#00FF00']);
  });

  it('normalises pacing: slow', () => {
    const cir = parseStyleAnalysisCIR(makeStyleProfile({ pacing: 'slow' }), 80);
    expect(cir.pacing).toBe('slow');
  });

  it('normalises pacing: fast', () => {
    const cir = parseStyleAnalysisCIR(makeStyleProfile({ pacing: 'fast' }), 80);
    expect(cir.pacing).toBe('fast');
  });

  it('normalises unknown pacing to medium', () => {
    const cir = parseStyleAnalysisCIR(makeStyleProfile({ pacing: 'hyper' }), 80);
    expect(cir.pacing).toBe('medium');
  });

  it('normalises undefined pacing to medium', () => {
    const cir = parseStyleAnalysisCIR(makeStyleProfile({ pacing: undefined }), 80);
    expect(cir.pacing).toBe('medium');
  });

  it('defaults empty colorPalette to black and white', () => {
    const cir = parseStyleAnalysisCIR(makeStyleProfile({ colorPalette: [] }), 80);
    expect(cir.colorPalette).toEqual(['#000000', '#FFFFFF']);
  });

  it('populates meta from profile.meta', () => {
    const cir = parseStyleAnalysisCIR(
      makeStyleProfile({ meta: { video_language: 'English', video_duration_sec: 120, video_type: 'tutorial' } }),
      90,
    );
    expect(cir.meta.videoLanguage).toBe('English');
    expect(cir.meta.videoDurationSec).toBe(120);
    expect(cir.meta.videoType).toBe('tutorial');
  });

  it('defaults meta when missing', () => {
    const cir = parseStyleAnalysisCIR(makeStyleProfile({ meta: undefined }), 90);
    expect(cir.meta.videoLanguage).toBe('Chinese');
    expect(cir.meta.videoDurationSec).toBe(60);
  });

  it('normalises legacy visual_metaphor_mapping format (key:value)', () => {
    const profile = makeStyleProfile({
      track_b_visual: {
        visual_metaphor_mapping: { 'gravity': 'falling apple', 'speed': 'rocket' },
      },
    });
    const cir = parseStyleAnalysisCIR(profile, 80);
    expect(cir.visualTrack.visualMetaphorMapping.examples).toHaveLength(2);
    expect(cir.visualTrack.visualMetaphorMapping.examples[0]!.concept).toBe('gravity');
    expect(cir.visualTrack.visualMetaphorMapping.examples[0]!.visual).toBe('falling apple');
  });

  it('normalises new visual_metaphor_mapping format (rule + examples)', () => {
    const profile = makeStyleProfile({
      track_b_visual: {
        visual_metaphor_mapping: {
          rule: 'use nature metaphors',
          examples: [{ concept: 'growth', metaphor_visual: 'plant sprouting' }],
        } as any,
      },
    });
    const cir = parseStyleAnalysisCIR(profile, 80);
    expect(cir.visualTrack.visualMetaphorMapping.rule).toBe('use nature metaphors');
    expect(cir.visualTrack.visualMetaphorMapping.examples[0]!.visual).toBe('plant sprouting');
  });

  it('populates scriptTrack from track_a_script', () => {
    const profile = makeStyleProfile({
      track_a_script: {
        hook_strategy: 'Question',
        sentence_length_max: 40,
        sentence_length_avg: 20,
        metaphor_count: 5,
      },
    });
    const cir = parseStyleAnalysisCIR(profile, 80);
    expect(cir.scriptTrack.hookStrategy).toBe('Question');
    expect(cir.scriptTrack.sentenceLengthMax).toBe(40);
    expect(cir.scriptTrack.metaphorCount).toBe(5);
  });

  it('populates audioTrack from track_c_audio', () => {
    const profile = makeStyleProfile({
      track_c_audio: {
        bgm_genre: 'electronic',
        bgm_mood: 'upbeat',
        bgm_tempo: 'fast',
        bgm_relative_volume: 0.5,
        voice_style: 'energetic',
      },
    });
    const cir = parseStyleAnalysisCIR(profile, 80);
    expect(cir.audioTrack.bgmGenre).toBe('electronic');
    expect(cir.audioTrack.bgmRelativeVolume).toBe(0.5);
    expect(cir.audioTrack.voiceStyle).toBe('energetic');
  });

  it('populates computed fields', () => {
    const cir = parseStyleAnalysisCIR(
      makeStyleProfile({ wordCount: 500, wordsPerMinute: 200, fullTranscript: 'text' }),
      80,
    );
    expect(cir.computed.wordCount).toBe(500);
    expect(cir.computed.wordsPerMinute).toBe(200);
    expect(cir.computed.fullTranscript).toBe('text');
  });

  it('passes confidence through from nodeConfidence', () => {
    const cir = parseStyleAnalysisCIR(
      makeStyleProfile({ nodeConfidence: { visualStyle: 'confident', pacing: 'inferred' } }),
      80,
    );
    expect(cir.confidence.visualStyle).toBe('confident');
    expect(cir.confidence.pacing).toBe('inferred');
  });

  /* ---- packagingTrack parsing ---- */
  it('populates packagingTrack from track_d_packaging', () => {
    const profile = makeStyleProfile({
      track_d_packaging: {
        subtitle_position: 'top',
        subtitle_has_shadow: false,
        subtitle_has_backdrop: true,
        subtitle_font_size: 'large',
        subtitle_primary_color: '#FFAA00',
        subtitle_outline_color: '#000000',
        subtitle_font_category: 'serif',
        transition_dominant_style: 'dissolve',
        transition_estimated_duration_sec: 1.5,
        has_intro_card: true,
        intro_card_duration_sec: 3,
        has_fade_in: true,
        fade_in_duration_sec: 0.8,
        has_outro_card: false,
        outro_card_duration_sec: 0,
        has_fade_out: true,
        fade_out_duration_sec: 1.2,
      },
    });
    const cir = parseStyleAnalysisCIR(profile, 80);
    expect(cir.packagingTrack.subtitlePosition).toBe('top');
    expect(cir.packagingTrack.subtitleHasShadow).toBe(false);
    expect(cir.packagingTrack.subtitleHasBackdrop).toBe(true);
    expect(cir.packagingTrack.subtitleFontSize).toBe('large');
    expect(cir.packagingTrack.subtitlePrimaryColor).toBe('#FFAA00');
    expect(cir.packagingTrack.subtitleOutlineColor).toBe('#000000');
    expect(cir.packagingTrack.subtitleFontCategory).toBe('serif');
    expect(cir.packagingTrack.transitionDominantStyle).toBe('dissolve');
    expect(cir.packagingTrack.transitionEstimatedDurationSec).toBe(1.5);
    expect(cir.packagingTrack.hasIntroCard).toBe(true);
    expect(cir.packagingTrack.introCardDurationSec).toBe(3);
    expect(cir.packagingTrack.hasFadeIn).toBe(true);
    expect(cir.packagingTrack.fadeInDurationSec).toBe(0.8);
    expect(cir.packagingTrack.hasOutroCard).toBe(false);
    expect(cir.packagingTrack.outroCardDurationSec).toBe(0);
    expect(cir.packagingTrack.hasFadeOut).toBe(true);
    expect(cir.packagingTrack.fadeOutDurationSec).toBe(1.2);
  });

  it('defaults packagingTrack when track_d_packaging is missing', () => {
    const cir = parseStyleAnalysisCIR(makeStyleProfile(), 80);
    expect(cir.packagingTrack.subtitlePosition).toBe('bottom');
    expect(cir.packagingTrack.subtitleHasShadow).toBe(true);
    expect(cir.packagingTrack.subtitleHasBackdrop).toBe(false);
    expect(cir.packagingTrack.subtitleFontSize).toBe('medium');
    expect(cir.packagingTrack.subtitlePrimaryColor).toBe('#FFFFFF');
    expect(cir.packagingTrack.subtitleOutlineColor).toBe('#000000');
    expect(cir.packagingTrack.subtitleFontCategory).toBe('sans-serif');
    expect(cir.packagingTrack.transitionDominantStyle).toBe('cut');
    expect(cir.packagingTrack.transitionEstimatedDurationSec).toBe(0.5);
    expect(cir.packagingTrack.hasIntroCard).toBe(false);
    expect(cir.packagingTrack.hasFadeIn).toBe(false);
    expect(cir.packagingTrack.hasFadeOut).toBe(false);
    expect(cir.packagingTrack.hasOutroCard).toBe(false);
  });

  it('normalises invalid packagingTrack values to defaults', () => {
    const profile = makeStyleProfile({
      track_d_packaging: {
        subtitle_position: 'middle',     // invalid → 'bottom'
        subtitle_font_size: 'huge',      // invalid → 'medium'
        subtitle_font_category: 'cursive', // invalid → 'sans-serif'
        transition_dominant_style: 'spin', // invalid → 'cut'
        subtitle_primary_color: 'red',     // invalid hex → '#FFFFFF'
        transition_estimated_duration_sec: 99, // clamped to 5
      },
    });
    const cir = parseStyleAnalysisCIR(profile, 80);
    expect(cir.packagingTrack.subtitlePosition).toBe('bottom');
    expect(cir.packagingTrack.subtitleFontSize).toBe('medium');
    expect(cir.packagingTrack.subtitleFontCategory).toBe('sans-serif');
    expect(cir.packagingTrack.transitionDominantStyle).toBe('cut');
    expect(cir.packagingTrack.subtitlePrimaryColor).toBe('#FFFFFF');
    expect(cir.packagingTrack.transitionEstimatedDurationSec).toBe(5);
  });

  it('handles subtitle_font_size as a number (normalised to closest label)', () => {
    const profile = makeStyleProfile({
      track_d_packaging: {
        subtitle_font_size: 18,   // number → String('18') → normalise → 'medium' fallback
      },
    });
    const cir = parseStyleAnalysisCIR(profile, 80);
    // A numeric value that doesn't match 'small'|'medium'|'large' normalises to 'medium'
    expect(cir.packagingTrack.subtitleFontSize).toBe('medium');
  });

  it('handles subtitle_font_size as a recognised string number alias ("large")', () => {
    const profile = makeStyleProfile({
      track_d_packaging: {
        subtitle_font_size: 'large',
      },
    });
    const cir = parseStyleAnalysisCIR(profile, 80);
    expect(cir.packagingTrack.subtitleFontSize).toBe('large');
  });
});

/* ================================================================== */
/*  parseResearchCIR                                                  */
/* ================================================================== */

describe('parseResearchCIR', () => {
  it('parses facts with sources', () => {
    const data: ResearchData = {
      facts: [
        {
          id: 'f1',
          content: 'Water boils at 100°C',
          sources: [{ url: 'https://example.com', title: 'Science Book', reliability: 0.9 }],
          aggConfidence: 0.95,
          type: 'verified',
        },
      ],
    };
    const cir = parseResearchCIR(data);
    expect(cir._cir).toBe('Research');
    expect(cir.facts).toHaveLength(1);
    expect(cir.facts[0]!.id).toBe('f1');
    expect(cir.facts[0]!.verificationStatus).toBe('verified');
    expect(cir.facts[0]!.sources[0]!.url).toBe('https://example.com');
  });

  it('defaults type to unverified', () => {
    const data: ResearchData = {
      facts: [{ id: 'f1', content: 'Test', sources: [], aggConfidence: 0.5 }],
    };
    const cir = parseResearchCIR(data);
    expect(cir.facts[0]!.verificationStatus).toBe('unverified');
  });

  it('parses myths and glossary', () => {
    const data: ResearchData = {
      facts: [],
      myths: ['Myth 1'],
      glossary: [{ term: 'CIR', definition: 'Canonical Intermediate Representation' }],
    };
    const cir = parseResearchCIR(data);
    expect(cir.myths).toEqual(['Myth 1']);
    expect(cir.glossary[0]!.term).toBe('CIR');
  });

  it('defaults optional fields', () => {
    const data: ResearchData = { facts: [] };
    const cir = parseResearchCIR(data);
    expect(cir.myths).toEqual([]);
    expect(cir.glossary).toEqual([]);
    expect(cir.claimVerifications).toEqual([]);
  });

  it('parses claimVerifications', () => {
    const data: ResearchData = {
      facts: [],
      claimVerifications: [
        { claim: 'Earth is flat', verdict: 'debunked', correction: 'Earth is round', confidence: 0.99 },
      ],
    };
    const cir = parseResearchCIR(data);
    expect(cir.claimVerifications).toHaveLength(1);
    expect(cir.claimVerifications[0]!.verdict).toBe('debunked');
    expect(cir.claimVerifications[0]!.correction).toBe('Earth is round');
  });
});

/* ================================================================== */
/*  parseScriptCIR                                                    */
/* ================================================================== */

describe('parseScriptCIR', () => {
  it('parses a valid script', () => {
    const cir = parseScriptCIR(makeScriptOutput(), undefined, 'English');
    expect(cir._cir).toBe('Script');
    expect(cir.fullText).toContain('well-formed test script');
    expect(cir.sentences.length).toBeGreaterThan(0);
    expect(cir.totalWordCount).toBe(12);
  });

  it('throws AIParseError for empty scriptText', () => {
    expect(() => parseScriptCIR(makeScriptOutput({ scriptText: '' }), undefined, 'English'))
      .toThrow(AIParseError);
  });

  it('throws AIParseError for whitespace-only scriptText', () => {
    expect(() => parseScriptCIR(makeScriptOutput({ scriptText: '   ' }), undefined, 'English'))
      .toThrow(AIParseError);
  });

  it('splits on Chinese sentence endings', () => {
    const cir = parseScriptCIR(
      makeScriptOutput({ scriptText: '你好世界。这是测试！最后一句？', totalWordCount: 10 }),
      undefined,
      'Chinese',
    );
    expect(cir.sentences.length).toBe(3);
  });

  it('does not split on period between digits', () => {
    const cir = parseScriptCIR(
      makeScriptOutput({ scriptText: 'The rate is 0.01 percent. Done.', totalWordCount: 6 }),
      undefined,
      'English',
    );
    // Should not split "0.01" → should yield 2 sentences ("The rate..." and "Done")
    expect(cir.sentences.length).toBe(2);
  });

  it('uses calibrationData when provided', () => {
    const cal: CalibrationData = {
      calibration: {
        reference_total_words: 500,
        reference_duration_sec: 120,
        actual_speech_rate: '300 cpm',
        new_video_target_duration_sec: 90,
        target_word_count: 400,
        target_word_count_min: '360',
        target_word_count_max: '440',
      },
      verified_facts: [],
    };
    const cir = parseScriptCIR(makeScriptOutput(), cal, 'English');
    expect(cir.calibration.targetWordCount).toBe(400);
    expect(cir.calibration.targetDurationSec).toBe(90);
    expect(cir.calibration.speechRate).toBe('300 cpm');
  });

  it('falls back to output.calibration when calibrationData is undefined', () => {
    const output = makeScriptOutput({
      calibration: {
        reference_total_words: 100,
        reference_duration_sec: 60,
        actual_speech_rate: '200 cpm',
        new_video_target_duration_sec: 45,
        target_word_count: 200,
        target_word_count_min: '180',
        target_word_count_max: '220',
      },
    });
    const cir = parseScriptCIR(output, undefined, 'English');
    expect(cir.calibration.targetWordCount).toBe(200);
  });

  it('populates safety metadata', () => {
    const output = makeScriptOutput({
      safetyMetadata: { isHighRisk: true, riskCategories: ['violence'], needsManualReview: true },
    });
    const cir = parseScriptCIR(output, undefined, 'English');
    expect(cir.safety.isHighRisk).toBe(true);
    expect(cir.safety.categories).toContain('violence');
    expect(cir.safety.needsManualReview).toBe(true);
  });

  it('counts Chinese words correctly (CJK + ASCII)', () => {
    const output = makeScriptOutput({
      scriptText: '你好world。测试test！',
      totalWordCount: undefined,
    });
    const cir = parseScriptCIR(output, undefined, 'Chinese');
    // 4 CJK chars + 2 ASCII words = 6
    expect(cir.totalWordCount).toBe(6);
  });

  it('counts English words by whitespace split', () => {
    const output = makeScriptOutput({
      scriptText: 'Hello world test sentence here.',
      totalWordCount: undefined,
    });
    const cir = parseScriptCIR(output, undefined, 'English');
    expect(cir.totalWordCount).toBe(5);
  });

  it('assigns factReferences from factUsage', () => {
    const output = makeScriptOutput({
      scriptText: 'The f1 fact is important. Another sentence.',
      factUsage: [{ factId: 'f1', usageType: 'verbatim' }],
    });
    const cir = parseScriptCIR(output, undefined, 'English');
    const matched = cir.sentences.find(s => s.factReferences.includes('f1'));
    expect(matched).toBeDefined();
  });
});

/* ================================================================== */
/*  buildVideoIR                                                      */
/* ================================================================== */

describe('buildVideoIR', () => {
  function makeStyleCIR(): StyleAnalysisCIR {
    return parseStyleAnalysisCIR(makeStyleProfile(), 90);
  }

  function makeStoryboardCIR(): StoryboardCIR {
    return parseStoryboardCIR([
      makeScene('s1', 'A detailed 3D scene of mountains and valleys at sunrise.', { assetType: 'video', estimatedDuration: 5 }),
      makeScene('s2', 'A close-up of flowers blooming in a spring meadow.', { assetType: 'image', estimatedDuration: 8 }),
    ]);
  }

  function makeTemporalPlan(): TemporalPlanCIR {
    return {
      _cir: 'TemporalPlan',
      version: 1,
      totalDurationSec: 13,
      totalSentences: 2,
      pacing: 'medium',
      scenes: [
        {
          sentenceIndex: 0, text: 'Scene 1 text', charCount: 12,
          semanticWeight: 0.5, emotionIntensity: 0.3, narrativePhase: 'hook',
          isTransition: false, rawDurationSec: 5.5, apiDurationSec: 5,
          ttsBudgetSec: 4, emphasis: 'normal',
        },
        {
          sentenceIndex: 1, text: 'Scene 2 text', charCount: 12,
          semanticWeight: 0.5, emotionIntensity: 0.5, narrativePhase: 'build',
          isTransition: false, rawDurationSec: 7.5, apiDurationSec: 8,
          ttsBudgetSec: 6, emphasis: 'slow',
        },
      ],
      durationBudget: { allocated: 13, target: 15, deviation: 0.13 },
    };
  }

  it('builds a valid VideoIR with defaults', () => {
    const ir = buildVideoIR({
      scriptCIR: parseScriptCIR(makeScriptOutput(), undefined, 'English'),
      storyboardCIR: makeStoryboardCIR(),
      temporalPlanCIR: makeTemporalPlan(),
      styleCIR: makeStyleCIR(),
      ttsVoice: 'zh-CN-XiaoxiaoNeural',
      ttsRate: '+5%',
    });
    expect(ir._cir).toBe('VideoIR');
    expect(ir.version).toBe(1);
    expect(ir.scenes).toHaveLength(2);
    expect(ir.resolution).toEqual({ w: 1280, h: 720 });
    expect(ir.fps).toBe(30);
    expect(ir.avSyncPolicy).toBe('audio-primary');
    expect(ir.language).toBe('Chinese');
  });

  it('applies custom resolution and fps', () => {
    const ir = buildVideoIR({
      scriptCIR: parseScriptCIR(makeScriptOutput(), undefined, 'English'),
      storyboardCIR: makeStoryboardCIR(),
      temporalPlanCIR: makeTemporalPlan(),
      styleCIR: makeStyleCIR(),
      ttsVoice: 'voice',
      ttsRate: undefined,
      resolution: { w: 1920, h: 1080 },
      fps: 60,
    });
    expect(ir.resolution).toEqual({ w: 1920, h: 1080 });
    expect(ir.fps).toBe(60);
  });

  it('promotes image scenes to video when in promotedVideoIndices', () => {
    const ir = buildVideoIR({
      scriptCIR: parseScriptCIR(makeScriptOutput(), undefined, 'English'),
      storyboardCIR: makeStoryboardCIR(),
      temporalPlanCIR: makeTemporalPlan(),
      styleCIR: makeStyleCIR(),
      ttsVoice: 'voice',
      ttsRate: undefined,
      promotedVideoIndices: new Set([1]),
    });
    // Scene 1 was 'image' in storyboard, promoted to 'video'
    expect(ir.scenes[1]!.assetType).toBe('video');
  });

  it('applies emphasis overrides to ttsRate', () => {
    const ir = buildVideoIR({
      scriptCIR: parseScriptCIR(makeScriptOutput(), undefined, 'English'),
      storyboardCIR: makeStoryboardCIR(),
      temporalPlanCIR: makeTemporalPlan(),
      styleCIR: makeStyleCIR(),
      ttsVoice: 'voice',
      ttsRate: '+5%',
    });
    // Scene 0 has emphasis 'normal' → EMPHASIS_OVERRIDES['normal'] is undefined → falls back to ttsRate '+5%'
    expect(ir.scenes[0]!.ttsRate).toBe('+5%');
    // Scene 1 has emphasis 'slow' → EMPHASIS_OVERRIDES['slow'] is '-8%'
    expect(ir.scenes[1]!.ttsRate).toBe('-8%');
  });

  it('sets last scene transitionToNext to none', () => {
    const ir = buildVideoIR({
      scriptCIR: parseScriptCIR(makeScriptOutput(), undefined, 'English'),
      storyboardCIR: makeStoryboardCIR(),
      temporalPlanCIR: makeTemporalPlan(),
      styleCIR: makeStyleCIR(),
      ttsVoice: 'voice',
      ttsRate: undefined,
    });
    expect(ir.scenes[ir.scenes.length - 1]!.transitionToNext).toBe('none');
  });

  it('maps transitions from ShotCIR', () => {
    const shotCIR: ShotCIR = {
      _cir: 'ShotAnalysis',
      version: 1,
      shots: [
        { index: 0, startSec: 0, endSec: 5, durationSec: 5, keyframePath: '', cameraMotion: '', transitionToNext: 'dissolve', dominantColors: [], subjectDescription: '' },
        { index: 1, startSec: 5, endSec: 10, durationSec: 5, keyframePath: '', cameraMotion: '', transitionToNext: 'fade', dominantColors: [], subjectDescription: '' },
      ],
      totalShots: 2,
      avgShotDurationSec: 5,
      rhythmSignature: [0.5, 0.5],
      videoDurationSec: 10,
    };
    const ir = buildVideoIR({
      scriptCIR: parseScriptCIR(makeScriptOutput(), undefined, 'English'),
      storyboardCIR: makeStoryboardCIR(),
      temporalPlanCIR: makeTemporalPlan(),
      styleCIR: makeStyleCIR(),
      ttsVoice: 'voice',
      ttsRate: undefined,
      shotCIR,
    });
    // First scene maps to shot 0 → 'dissolve'
    expect(ir.scenes[0]!.transitionToNext).toBe('dissolve');
    // Last scene always 'none'
    expect(ir.scenes[1]!.transitionToNext).toBe('none');
  });

  it('projects colorPalette and lightingStyle from styleCIR', () => {
    const ir = buildVideoIR({
      scriptCIR: parseScriptCIR(makeScriptOutput(), undefined, 'English'),
      storyboardCIR: makeStoryboardCIR(),
      temporalPlanCIR: makeTemporalPlan(),
      styleCIR: makeStyleCIR(),
      ttsVoice: 'voice',
      ttsRate: undefined,
    });
    expect(ir.scenes[0]!.colorPalette).toEqual(['#FF0000', '#00FF00']);
    expect(ir.scenes[0]!.lightingStyle).toBe('neutral');
    expect(ir.scenes[0]!.visualStyle).toBe('cinematic');
  });
});
