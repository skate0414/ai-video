/* ------------------------------------------------------------------ */
/*  Tests for CIR validators                                          */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import {
  validateFormatSignature,
  validateStyleAnalysisCIR,
  validateScriptCIR,
  validateShotCIR,
  validateStoryboardCIR,
  validateVideoIR,
} from '../contracts.js';

describe('validateFormatSignature', () => {
  const validFS = {
    _type: 'FormatSignature',
    hookTemplate: '[hook]',
    closingTemplate: '[close]',
    sentenceLengthSequence: [10, 20],
    transitionPositions: [3],
    transitionPatterns: ['但是'],
    arcSentenceAllocation: [3, 5],
    arcStageLabels: ['hook', 'body'],
    signaturePhrases: ['你知道吗'],
    emotionalArcShape: [0.5, 0.8],
    seriesVisualMotifs: {
      hookMotif: 'zoom',
      mechanismMotif: 'diagram',
      climaxMotif: 'burst',
      reflectionMotif: 'fade',
    },
  };

  it('passes valid FormatSignature', () => {
    expect(validateFormatSignature(validFS)).toEqual([]);
  });

  it('rejects null', () => {
    expect(validateFormatSignature(null)).toContain('FormatSignature is null or not an object');
  });

  it('rejects wrong _type', () => {
    expect(validateFormatSignature({ ...validFS, _type: 'Wrong' })).toContain('_type must be "FormatSignature"');
  });

  it('rejects _error field', () => {
    const errors = validateFormatSignature({ ...validFS, _error: 'extraction failed' });
    expect(errors.some(e => e.includes('extraction error'))).toBe(true);
  });

  it('requires all array/string fields', () => {
    const errors = validateFormatSignature({ _type: 'FormatSignature' });
    expect(errors).toContain('hookTemplate must be a string');
    expect(errors).toContain('closingTemplate must be a string');
    expect(errors).toContain('sentenceLengthSequence must be an array');
    expect(errors).toContain('transitionPositions must be an array');
    expect(errors).toContain('transitionPatterns must be an array');
    expect(errors).toContain('arcSentenceAllocation must be an array');
    expect(errors).toContain('arcStageLabels must be an array');
    expect(errors).toContain('signaturePhrases must be an array');
    expect(errors).toContain('emotionalArcShape must be an array');
    expect(errors).toContain('seriesVisualMotifs must be an object');
  });
});

describe('validateStyleAnalysisCIR', () => {
  it('rejects null', () => {
    expect(validateStyleAnalysisCIR(null)).toContain('CIR is null or not an object');
  });

  it('rejects wrong _cir', () => {
    expect(validateStyleAnalysisCIR({ _cir: 'Wrong' })).toContain('_cir must be "StyleAnalysis"');
  });

  it('requires all major fields', () => {
    const errors = validateStyleAnalysisCIR({ _cir: 'StyleAnalysis' });
    expect(errors).toContain('visualStyle is required');
    expect(errors).toContain('meta is required');
    expect(errors).toContain('scriptTrack is required');
    expect(errors).toContain('visualTrack is required');
    expect(errors).toContain('audioTrack is required');
  });

  it('checks meta fields', () => {
    const errors = validateStyleAnalysisCIR({
      _cir: 'StyleAnalysis',
      visualStyle: 'anime',
      meta: { videoDurationSec: -1, videoLanguage: '' },
      scriptTrack: {},
      visualTrack: {},
      audioTrack: {},
    });
    expect(errors.some(e => e.includes('videoDurationSec'))).toBe(true);
    expect(errors.some(e => e.includes('videoLanguage'))).toBe(true);
  });
});

describe('validateScriptCIR', () => {
  it('rejects null', () => {
    expect(validateScriptCIR(null)).toContain('CIR is null or not an object');
  });

  it('requires all fields', () => {
    const errors = validateScriptCIR({ _cir: 'Script' });
    expect(errors).toContain('fullText is required');
    expect(errors).toContain('sentences must be an array');
    expect(errors).toContain('totalWordCount must be a number');
    expect(errors).toContain('safety is required');
    expect(errors).toContain('calibration is required');
  });
});

describe('validateShotCIR', () => {
  it('rejects null', () => {
    expect(validateShotCIR(null)).toContain('CIR is null or not an object');
  });

  it('requires all fields', () => {
    const errors = validateShotCIR({ _cir: 'ShotAnalysis' });
    expect(errors).toContain('shots must be an array');
    expect(errors).toContain('totalShots must be a non-negative number');
    expect(errors).toContain('videoDurationSec must be positive');
    expect(errors).toContain('rhythmSignature must be an array');
  });
});

describe('validateStoryboardCIR', () => {
  it('rejects null', () => {
    expect(validateStoryboardCIR(null)).toContain('CIR is null or not an object');
  });

  it('requires scenes array', () => {
    const errors = validateStoryboardCIR({ _cir: 'Storyboard' });
    expect(errors).toContain('scenes must be an array');
  });

  it('rejects empty scenes', () => {
    const errors = validateStoryboardCIR({ _cir: 'Storyboard', scenes: [] });
    expect(errors).toContain('scenes must not be empty');
  });

  it('passes with valid data', () => {
    expect(validateStoryboardCIR({ _cir: 'Storyboard', scenes: [{}] })).toEqual([]);
  });
});

describe('validateVideoIR', () => {
  const validIR = {
    _cir: 'VideoIR',
    version: 1,
    targetDurationSec: 60,
    fps: 30,
    language: 'zh-CN',
    avSyncPolicy: 'audio-primary',
    bgmRelativeVolume: 0.15,
    resolution: { w: 1920, h: 1080 },
    scenes: [{
      index: 0,
      sentenceIndices: [0],
      narrative: 'test',
      visualPrompt: 'test prompt',
      colorPalette: ['#000'],
      lightingStyle: 'natural',
      visualStyle: 'realistic',
      assetType: 'video',
      cameraMovement: 'static',
      rawDurationSec: 5,
      apiDurationSec: 5,
      ttsBudgetSec: 4.5,
      ttsVoice: 'zh-CN-XiaoxiaoNeural',
      ttsRate: '+0%',
      emphasis: 'normal',
      narrativePhase: 'hook',
      transitionToNext: 'cut',
      production: { camera: 'wide', lighting: 'soft' },
    }],
  };

  it('passes valid IR', () => {
    expect(validateVideoIR(validIR)).toEqual([]);
  });

  it('rejects null', () => {
    expect(validateVideoIR(null)).toContain('CIR is null or not an object');
  });

  it('checks top-level fields', () => {
    const errors = validateVideoIR({});
    expect(errors.some(e => e.includes('_cir'))).toBe(true);
    expect(errors.some(e => e.includes('version'))).toBe(true);
    expect(errors.some(e => e.includes('targetDurationSec'))).toBe(true);
    expect(errors.some(e => e.includes('fps'))).toBe(true);
    expect(errors.some(e => e.includes('language'))).toBe(true);
  });

  it('checks resolution object', () => {
    const errors = validateVideoIR({ ...validIR, resolution: null });
    expect(errors.some(e => e.includes('resolution is required'))).toBe(true);
  });

  it('checks scene fields', () => {
    const bad = { ...validIR, scenes: [{ index: 0 }] };
    const errors = validateVideoIR(bad);
    expect(errors.some(e => e.includes('narrative'))).toBe(true);
    expect(errors.some(e => e.includes('visualPrompt'))).toBe(true);
  });

  it('rejects empty scenes array', () => {
    expect(validateVideoIR({ ...validIR, scenes: [] }).some(e => e.includes('must not be empty'))).toBe(true);
  });
});
