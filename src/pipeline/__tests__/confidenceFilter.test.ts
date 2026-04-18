/* ------------------------------------------------------------------ */
/*  Tests: confidenceFilter – confidence-aware field injection        */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import {
  classifyField,
  shouldInject,
  constraintLine,
  filterStyleFields,
} from '../stages/confidenceFilter.js';
import type { StyleAnalysisCIR } from '../../cir/types.js';

describe('classifyField', () => {
  it('marks confident as hard', () => {
    const f = classifyField(30, 'confident');
    expect(f.isHard).toBe(true);
    expect(f.confidence).toBe('confident');
  });

  it('marks computed as hard', () => {
    const f = classifyField(200, 'computed');
    expect(f.isHard).toBe(true);
  });

  it('marks inferred as soft', () => {
    const f = classifyField(20, 'inferred');
    expect(f.isHard).toBe(false);
  });

  it('marks guess as soft', () => {
    const f = classifyField(5, 'guess');
    expect(f.isHard).toBe(false);
  });

  it('defaults to guess when undefined', () => {
    const f = classifyField(10, undefined);
    expect(f.confidence).toBe('guess');
    expect(f.isHard).toBe(false);
  });
});

describe('shouldInject', () => {
  it('returns true for confident', () => expect(shouldInject('confident')).toBe(true));
  it('returns true for computed', () => expect(shouldInject('computed')).toBe(true));
  it('returns true for inferred', () => expect(shouldInject('inferred')).toBe(true));
  it('returns false for guess', () => expect(shouldInject('guess')).toBe(false));
  it('returns false for undefined', () => expect(shouldInject(undefined)).toBe(false));
});

describe('constraintLine', () => {
  it('returns HARD line for confident fields', () => {
    const line = constraintLine('Max Length', 30, 'confident');
    expect(line).toContain('HARD');
    expect(line).toContain('30');
  });

  it('returns flexible line for inferred fields', () => {
    const line = constraintLine('Max Length', 30, 'inferred');
    expect(line).toContain('approximately');
    expect(line).toContain('flexible');
  });

  it('returns null for guess fields', () => {
    expect(constraintLine('Max Length', 30, 'guess')).toBeNull();
  });

  it('returns null for undefined confidence', () => {
    expect(constraintLine('Max Length', 30, undefined)).toBeNull();
  });
});

describe('filterStyleFields', () => {
  const baseCIR: StyleAnalysisCIR = {
    _cir: 'StyleAnalysis',
    version: 1,
    visualStyle: '3D Animation',
    pacing: 'medium',
    tone: 'educational',
    colorPalette: ['#fff'],
    meta: { videoDurationSec: 60, videoLanguage: 'Chinese', videoType: 'science' },
    scriptTrack: {
      hookStrategy: 'data_anchor',
      sentenceLengthMax: 30,
      sentenceLengthAvg: 18,
      sentenceLengthUnit: 'characters',
      narrativeArc: ['hook', 'body', 'climax'],
      emotionalToneArc: 'rising',
      rhetoricalCore: 'rhetorical question',
      metaphorCount: 3,
      interactionCuesCount: 2,
      ctaPattern: 'subscribe',
      jargonTreatment: 'simplify',
    },
    visualTrack: {
      baseMedium: '3D animation',
      lightingStyle: 'soft',
      cameraMotion: 'pan',
      colorTemperature: 'warm',
      sceneAvgDurationSec: 4,
      transitionStyle: 'cut',
      visualMetaphorMapping: { rule: 'abstract→concrete', examples: [] },
      bRollRatio: 0.2,
      compositionStyle: 'centered',
    },
    audioTrack: {
      bgmGenre: 'ambient',
      bgmMood: 'curious',
      bgmTempo: 'medium',
      bgmRelativeVolume: 0.3,
      voiceStyle: 'narrator',
    },
    packagingTrack: {
      subtitlePosition: 'bottom', subtitleHasShadow: true, subtitleHasBackdrop: false,
      subtitleFontSize: 'medium', subtitlePrimaryColor: '#FFFFFF', subtitleOutlineColor: '#000000',
      subtitleFontCategory: 'sans-serif', transitionDominantStyle: 'cut',
      transitionEstimatedDurationSec: 0.5, hasIntroCard: false, introCardDurationSec: 0,
      hasFadeIn: false, fadeInDurationSec: 0, hasOutroCard: false, outroCardDurationSec: 0,
      hasFadeOut: false, fadeOutDurationSec: 0,
    },
    computed: { wordCount: 300, wordsPerMinute: 250, fullTranscript: '' },
    confidence: {
      hookStrategy: 'confident',
      sentenceLengthMax: 'guess',
      metaphorCount: 'inferred',
      rhetoricalCore: 'confident',
      ctaPattern: 'guess',
    },
    contractScore: 80,
  };

  it('puts confident fields in hardConstraints', () => {
    const result = filterStyleFields(baseCIR);
    expect(result.hardConstraints).toHaveProperty('hookStrategy');
    expect(result.hardConstraints).toHaveProperty('rhetoricalCore');
  });

  it('puts inferred fields in softGuidance', () => {
    const result = filterStyleFields(baseCIR);
    expect(result.softGuidance).toHaveProperty('metaphorCount');
  });

  it('skips guess fields', () => {
    const result = filterStyleFields(baseCIR);
    expect(result.skipped).toContain('sentenceLengthMax');
    expect(result.skipped).toContain('ctaPattern');
    expect(result.hardConstraints).not.toHaveProperty('sentenceLengthMax');
    expect(result.softGuidance).not.toHaveProperty('sentenceLengthMax');
  });
});
