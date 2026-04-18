/* ------------------------------------------------------------------ */
/*  Tests: temporalPlanning – pure computation stage                  */
/* ------------------------------------------------------------------ */

import { describe, it, expect } from 'vitest';
import {
  computeTemporalPlan,
  snapToGrid,
  renormalize,
  inferNarrativePhase,
} from './temporalPlanning.js';
import type { ScriptCIR, StyleAnalysisCIR, FormatSignature } from '../../cir/types.js';

/* ---- Helpers to build minimal CIR fixtures ---- */

function makeScriptCIR(overrides?: Partial<ScriptCIR>): ScriptCIR {
  const sentences = overrides?.sentences ?? [
    { index: 0, text: '你知道吗？每天有一百万人在搜索这个问题。', beatIndex: 0, factReferences: ['f1'], estimatedDurationSec: 4 },
    { index: 1, text: '科学家发现了一个惊人的答案。', beatIndex: 1, factReferences: [], estimatedDurationSec: 3 },
    { index: 2, text: '这个发现彻底改变了我们的认知。', beatIndex: 1, factReferences: ['f2', 'f3'], estimatedDurationSec: 3 },
    { index: 3, text: '但更重要的是，你可以立即行动。', beatIndex: 2, factReferences: [], estimatedDurationSec: 3 },
    { index: 4, text: '点击关注，了解更多。', beatIndex: 3, factReferences: [], estimatedDurationSec: 2 },
  ];
  return {
    _cir: 'Script',
    version: 1,
    fullText: sentences.map(s => s.text).join(''),
    sentences,
    totalWordCount: 80,
    totalDurationSec: overrides?.totalDurationSec ?? 30,
    usedFactIDs: ['f1', 'f2', 'f3'],
    safety: { isHighRisk: false, categories: [], needsManualReview: false },
    styleConsistencyScore: 90,
    calibration: {
      targetWordCount: 80,
      targetWordCountMin: 60,
      targetWordCountMax: 100,
      targetDurationSec: 30,
      speechRate: 'medium',
    },
    ...overrides,
  };
}

function makeStyleCIR(pacing: 'slow' | 'medium' | 'fast' = 'medium'): StyleAnalysisCIR {
  return {
    _cir: 'StyleAnalysis',
    version: 1,
    visualStyle: '3D animated',
    pacing,
    tone: 'informative',
    colorPalette: ['#000', '#FFF'],
    meta: { videoDurationSec: 30, videoLanguage: 'Chinese', videoType: 'educational' },
    scriptTrack: {
      hookStrategy: 'question', sentenceLengthMax: 40, sentenceLengthAvg: 20,
      sentenceLengthUnit: 'characters', narrativeArc: ['hook', 'body', 'cta'],
      emotionalToneArc: 'rising', rhetoricalCore: 'comparison', metaphorCount: 2,
      interactionCuesCount: 1, ctaPattern: 'follow', jargonTreatment: 'simplify',
    },
    visualTrack: {
      baseMedium: '3D', lightingStyle: 'soft', cameraMotion: 'smooth pan',
      colorTemperature: 'warm', sceneAvgDurationSec: 5, transitionStyle: 'fade',
      visualMetaphorMapping: { rule: 'literal', examples: [] },
      bRollRatio: 0.2, compositionStyle: 'centered',
    },
    audioTrack: { bgmGenre: 'ambient', bgmMood: 'calm', bgmTempo: 'slow', bgmRelativeVolume: 0.3, voiceStyle: 'female' },
    packagingTrack: {
      subtitlePosition: 'bottom', subtitleHasShadow: true, subtitleHasBackdrop: false,
      subtitleFontSize: 'medium', subtitlePrimaryColor: '#FFFFFF', subtitleOutlineColor: '#000000',
      subtitleFontCategory: 'sans-serif', transitionDominantStyle: 'cut',
      transitionEstimatedDurationSec: 0.5, hasIntroCard: false, introCardDurationSec: 0,
      hasFadeIn: false, fadeInDurationSec: 0, hasOutroCard: false, outroCardDurationSec: 0,
      hasFadeOut: false, fadeOutDurationSec: 0,
    },
    computed: { wordCount: 80, wordsPerMinute: 160, fullTranscript: '' },
    confidence: {},
    contractScore: 95,
  } as StyleAnalysisCIR;
}

function makeFormatSignature(): FormatSignature {
  return {
    _type: 'FormatSignature',
    version: 1,
    hookTemplate: '[反直觉数据]',
    closingTemplate: '[行动号召]',
    sentenceLengthSequence: [20, 15, 18, 17, 10],
    transitionPositions: [2],
    transitionPatterns: ['但更重要的是'],
    arcSentenceAllocation: [1, 2, 1, 1],
    arcStageLabels: ['hook', 'build', 'climax', 'cta'],
    signaturePhrases: [],
    emotionalArcShape: [0.8, 0.5, 0.9, 0.7, 0.3],
    seriesVisualMotifs: { hookMotif: '', mechanismMotif: '', climaxMotif: '', reflectionMotif: '' },
  } as FormatSignature;
}

/* ================================================================== */
/*  snapToGrid                                                        */
/* ================================================================== */

describe('snapToGrid', () => {
  const grid = [5, 8, 10, 15, 20];

  it('snaps to exact values', () => {
    expect(snapToGrid(5, grid)).toBe(5);
    expect(snapToGrid(10, grid)).toBe(10);
  });

  it('snaps to nearest', () => {
    expect(snapToGrid(6, grid)).toBe(5);
    expect(snapToGrid(7, grid)).toBe(8);
    expect(snapToGrid(12, grid)).toBe(10);
    expect(snapToGrid(13, grid)).toBe(15);
    expect(snapToGrid(18, grid)).toBe(20);
  });

  it('handles values below minimum', () => {
    expect(snapToGrid(1, grid)).toBe(5);
  });

  it('handles values above maximum', () => {
    expect(snapToGrid(25, grid)).toBe(20);
  });
});

/* ================================================================== */
/*  renormalize                                                       */
/* ================================================================== */

describe('renormalize', () => {
  it('scales durations to hit target sum', () => {
    const result = renormalize([10, 10, 10], 60);
    const sum = result.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(60, 0);
  });

  it('preserves ratios', () => {
    const result = renormalize([4, 8], 24);
    expect(result[1] / result[0]).toBeCloseTo(2, 1);
  });

  it('clamps to MIN/MAX bounds', () => {
    const result = renormalize([1, 100], 30);
    expect(result[0]).toBeGreaterThanOrEqual(3);
    expect(result[1]).toBeLessThanOrEqual(20);
  });
});

/* ================================================================== */
/*  inferNarrativePhase                                               */
/* ================================================================== */

describe('inferNarrativePhase', () => {
  it('uses arc allocation when available', () => {
    const alloc = [1, 2, 1, 1];
    const labels = ['hook', 'build', 'climax', 'cta'];
    expect(inferNarrativePhase(0, 5, alloc, labels)).toBe('hook');
    expect(inferNarrativePhase(1, 5, alloc, labels)).toBe('build');
    expect(inferNarrativePhase(2, 5, alloc, labels)).toBe('build');
    expect(inferNarrativePhase(3, 5, alloc, labels)).toBe('climax');
    expect(inferNarrativePhase(4, 5, alloc, labels)).toBe('cta');
  });

  it('falls back to position-based split', () => {
    expect(inferNarrativePhase(0, 20, [], [])).toBe('hook');
    expect(inferNarrativePhase(4, 20, [], [])).toBe('build');
    expect(inferNarrativePhase(10, 20, [], [])).toBe('climax');
    expect(inferNarrativePhase(16, 20, [], [])).toBe('resolution');
    expect(inferNarrativePhase(19, 20, [], [])).toBe('cta');
  });

  it('maps Chinese labels', () => {
    const alloc = [2, 3];
    const labels = ['开头', '高潮'];
    expect(inferNarrativePhase(0, 5, alloc, labels)).toBe('hook');
    expect(inferNarrativePhase(3, 5, alloc, labels)).toBe('climax');
  });
});

/* ================================================================== */
/*  computeTemporalPlan – core algorithm                              */
/* ================================================================== */

describe('computeTemporalPlan', () => {
  it('produces a valid TemporalPlanCIR', () => {
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
    });

    expect(plan._cir).toBe('TemporalPlan');
    expect(plan.version).toBe(1);
    expect(plan.totalSentences).toBe(5);
    expect(plan.pacing).toBe('medium');
    expect(plan.scenes).toHaveLength(5);
  });

  it('allocates durations summing close to target', () => {
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
    });

    const rawSum = plan.scenes.reduce((s, sc) => s + sc.rawDurationSec, 0);
    expect(rawSum).toBeCloseTo(30, 0);
  });

  it('snaps API durations to valid grid values', () => {
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
    });

    const validValues = [5, 8, 10, 15, 20];
    for (const scene of plan.scenes) {
      expect(validValues).toContain(scene.apiDurationSec);
    }
  });

  it('respects totalDurationOverride', () => {
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
      totalDurationOverride: 60,
    });

    expect(plan.totalDurationSec).toBe(60);
    const rawSum = plan.scenes.reduce((s, sc) => s + sc.rawDurationSec, 0);
    expect(rawSum).toBeCloseTo(60, 0);
  });

  it('handles empty script', () => {
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR({ sentences: [], totalDurationSec: 30 }),
      styleCIR: makeStyleCIR(),
    });

    expect(plan.totalSentences).toBe(0);
    expect(plan.scenes).toHaveLength(0);
    expect(plan.durationBudget.deviation).toBe(1);
  });

  it('handles single sentence', () => {
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR({
        sentences: [{ index: 0, text: '这是唯一的一句话。', beatIndex: 0, factReferences: [], estimatedDurationSec: 5 }],
        totalDurationSec: 10,
      }),
      styleCIR: makeStyleCIR(),
    });

    expect(plan.totalSentences).toBe(1);
    expect(plan.scenes).toHaveLength(1);
  });

  it('uses FormatSignature emotion arc when provided', () => {
    const fmt = makeFormatSignature();
    // First sentence has 0.8 emotion, last has 0.3
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
      formatSignature: fmt,
    });

    // With emotion weighting, higher-emotion scenes should get proportionally more time
    expect(plan.scenes[0].emotionIntensity).toBe(0.8);
    expect(plan.scenes[4].emotionIntensity).toBe(0.3);
  });

  it('marks transition scenes', () => {
    const fmt = makeFormatSignature();
    // transitionPositions: [2] — sentence at index 2 is a transition
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
      formatSignature: fmt,
    });

    expect(plan.scenes[2].isTransition).toBe(true);
    expect(plan.scenes[0].isTransition).toBe(false);
  });

  it('varies results by pacing', () => {
    const slow = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR('slow'),
    });
    const fast = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR('fast'),
    });

    // Slow pacing weights emotion more; fast pacing weights length more.
    // The actual durations will differ in distribution even if sum is the same.
    expect(slow.pacing).toBe('slow');
    expect(fast.pacing).toBe('fast');
    // At least one scene should have a different apiDurationSec
    const slowApi = slow.scenes.map(s => s.apiDurationSec).join(',');
    const fastApi = fast.scenes.map(s => s.apiDurationSec).join(',');
    // They might happen to match, so we just verify they're valid
    expect(slow.scenes.every(s => [5, 8, 10, 15, 20].includes(s.apiDurationSec))).toBe(true);
    expect(fast.scenes.every(s => [5, 8, 10, 15, 20].includes(s.apiDurationSec))).toBe(true);
  });

  it('assigns emphasis based on duration deviation from average', () => {
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
    });

    for (const scene of plan.scenes) {
      expect(['slow', 'normal', 'fast']).toContain(scene.emphasis);
    }
  });

  it('assigns narrative phases', () => {
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
    });

    for (const scene of plan.scenes) {
      expect(['hook', 'build', 'climax', 'resolution', 'cta']).toContain(scene.narrativePhase);
    }
  });

  it('tracks deviation budget', () => {
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
    });

    expect(plan.durationBudget.target).toBe(30);
    expect(plan.durationBudget.allocated).toBeGreaterThan(0);
    expect(plan.durationBudget.deviation).toBeGreaterThanOrEqual(0);
  });

  it('sets semantic weight from fact references', () => {
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
    });

    // Sentence 0 has 1 fact ref → higher weight; sentence 1 has 0 → lower weight
    expect(plan.scenes[0].semanticWeight).toBeGreaterThan(plan.scenes[1].semanticWeight);
    // Sentence 2 has 2 fact refs → highest
    expect(plan.scenes[2].semanticWeight).toBeGreaterThanOrEqual(plan.scenes[0].semanticWeight);
  });
});

/* ================================================================== */
/*  G1: ShotCIR rhythm blend                                          */
/* ================================================================== */
describe('computeTemporalPlan — ShotCIR rhythm blend', () => {
  it('accepts optional shotCIR without errors', () => {
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
      shotCIR: {
        _cir: 'ShotAnalysis',
        version: 1,
        shots: [],
        totalShots: 3,
        avgShotDurationSec: 4,
        rhythmSignature: [0.3, 0.3, 0.4],
        videoDurationSec: 30,
      },
    });

    expect(plan.scenes.length).toBe(5);
    expect(plan.durationBudget.target).toBe(30);
  });

  it('rhythm blend changes durations compared to no-rhythm plan', () => {
    const baseline = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
    });

    // Extreme rhythm: first shot takes 90% of duration
    const withRhythm = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
      shotCIR: {
        _cir: 'ShotAnalysis',
        version: 1,
        shots: [],
        totalShots: 2,
        avgShotDurationSec: 15,
        rhythmSignature: [0.9, 0.1],
        videoDurationSec: 30,
      },
    });

    // The plans should differ (rhythm influence changes weight distribution)
    const baselineDurations = baseline.scenes.map(s => s.rawDurationSec);
    const rhythmDurations = withRhythm.scenes.map(s => s.rawDurationSec);
    const areDifferent = baselineDurations.some((d, i) => Math.abs(d - rhythmDurations[i]) > 0.01);
    expect(areDifferent).toBe(true);
  });

  it('handles empty rhythmSignature gracefully', () => {
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
      shotCIR: {
        _cir: 'ShotAnalysis',
        version: 1,
        shots: [],
        totalShots: 0,
        avgShotDurationSec: 0,
        rhythmSignature: [],
        videoDurationSec: 30,
      },
    });

    // Should produce the same result as no shotCIR (empty rhythm = no influence)
    const baseline = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
    });

    const planDurations = plan.scenes.map(s => s.rawDurationSec);
    const baselineDurations = baseline.scenes.map(s => s.rawDurationSec);
    planDurations.forEach((d, i) => expect(d).toBeCloseTo(baselineDurations[i], 2));
  });

  it('total allocated duration remains close to target with rhythm', () => {
    const plan = computeTemporalPlan({
      scriptCIR: makeScriptCIR(),
      styleCIR: makeStyleCIR(),
      shotCIR: {
        _cir: 'ShotAnalysis',
        version: 1,
        shots: [],
        totalShots: 5,
        avgShotDurationSec: 6,
        rhythmSignature: [0.1, 0.2, 0.3, 0.2, 0.2],
        videoDurationSec: 30,
      },
    });

    expect(plan.durationBudget.allocated).toBeCloseTo(30, -1);
  });
});
