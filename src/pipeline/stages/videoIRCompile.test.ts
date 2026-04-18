import { describe, expect, it } from 'vitest';

import { compileVideoIR } from './videoIRCompile.js';
import { deepFreeze } from '../../cir/errors.js';
import type {
  ScriptCIR,
  StoryboardCIR,
  StyleAnalysisCIR,
  TemporalPlanCIR,
} from '../../cir/types.js';

function makeScriptCIR(): ScriptCIR {
  return {
    _cir: 'Script',
    version: 1,
    fullText: '第一句。第二句。第三句。',
    sentences: [
      { index: 0, text: '第一句。', beatIndex: 0, factReferences: ['f1'], estimatedDurationSec: 4 },
      { index: 1, text: '第二句。', beatIndex: 1, factReferences: [], estimatedDurationSec: 5 },
      { index: 2, text: '第三句。', beatIndex: 2, factReferences: ['f2'], estimatedDurationSec: 6 },
    ],
    totalWordCount: 18,
    totalDurationSec: 15,
    usedFactIDs: ['f1', 'f2'],
    safety: { isHighRisk: false, categories: [], needsManualReview: false },
    styleConsistencyScore: 95,
    calibration: {
      targetWordCount: 18,
      targetWordCountMin: 15,
      targetWordCountMax: 20,
      targetDurationSec: 15,
      speechRate: 'medium',
    },
  };
}

function makeStoryboardCIR(): StoryboardCIR {
  return {
    _cir: 'Storyboard',
    version: 1,
    scenes: [
      {
        id: 'scene_1',
        index: 0,
        narrative: '第一句。',
        visualPrompt: 'A cinematic sunrise over mountains with volumetric light.',
        production: { camera: 'wide', lighting: 'golden', sound: 'ambient', notes: '' },
        targetDurationSec: 5,
        assetType: 'video',
      },
      {
        id: 'scene_2',
        index: 1,
        narrative: '第二句。',
        visualPrompt: 'A detailed macro view of particles floating in soft blue light.',
        production: { camera: 'macro', lighting: 'soft', sound: 'hum', notes: '' },
        targetDurationSec: 5,
        assetType: 'image',
      },
      {
        id: 'scene_3',
        index: 2,
        narrative: '第三句。',
        visualPrompt: 'A futuristic orbital view with dynamic motion trails and stars.',
        production: { camera: 'orbit', lighting: 'space', sound: 'swell', notes: '' },
        targetDurationSec: 5,
        assetType: 'image',
      },
    ],
    totalScenes: 3,
    videoSceneCount: 1,
    imageSceneCount: 2,
    totalDurationSec: 15,
  };
}

function makeTemporalPlanCIR(): TemporalPlanCIR {
  return {
    _cir: 'TemporalPlan',
    version: 1,
    totalDurationSec: 15,
    totalSentences: 3,
    pacing: 'medium',
    scenes: [
      {
        sentenceIndex: 0,
        text: '第一句。',
        charCount: 3,
        semanticWeight: 0.8,
        emotionIntensity: 0.6,
        narrativePhase: 'hook',
        isTransition: false,
        rawDurationSec: 4.5,
        apiDurationSec: 5,
        ttsBudgetSec: 4.5,
        emphasis: 'normal',
      },
      {
        sentenceIndex: 1,
        text: '第二句。',
        charCount: 3,
        semanticWeight: 0.4,
        emotionIntensity: 0.5,
        narrativePhase: 'build',
        isTransition: false,
        rawDurationSec: 5,
        apiDurationSec: 5,
        ttsBudgetSec: 5,
        emphasis: 'normal',
      },
      {
        sentenceIndex: 2,
        text: '第三句。',
        charCount: 3,
        semanticWeight: 0.8,
        emotionIntensity: 0.7,
        narrativePhase: 'cta',
        isTransition: true,
        rawDurationSec: 5.5,
        apiDurationSec: 5,
        ttsBudgetSec: 5.5,
        emphasis: 'slow',
      },
    ],
    durationBudget: {
      allocated: 15,
      target: 15,
      deviation: 0,
    },
  };
}

function makeStyleCIR(): StyleAnalysisCIR {
  return {
    _cir: 'StyleAnalysis',
    version: 1,
    visualStyle: 'cinematic',
    pacing: 'medium',
    tone: 'informative',
    colorPalette: ['#111111', '#eeeeee'],
    meta: { videoDurationSec: 15, videoLanguage: 'Chinese', videoType: 'explainer' },
    scriptTrack: {
      hookStrategy: 'question',
      sentenceLengthMax: 30,
      sentenceLengthAvg: 15,
      sentenceLengthUnit: 'characters',
      narrativeArc: ['hook', 'build', 'cta'],
      emotionalToneArc: 'rising',
      rhetoricalCore: 'comparison',
      metaphorCount: 1,
      interactionCuesCount: 1,
      ctaPattern: 'follow',
      jargonTreatment: 'simplified',
    },
    visualTrack: {
      baseMedium: '3D animation',
      lightingStyle: 'dramatic',
      cameraMotion: 'smooth',
      colorTemperature: 'warm',
      sceneAvgDurationSec: 5,
      transitionStyle: 'cut',
      visualMetaphorMapping: { rule: 'literal', examples: [] },
      bRollRatio: 0.2,
      compositionStyle: 'centered',
    },
    audioTrack: {
      bgmGenre: 'ambient',
      bgmMood: 'neutral',
      bgmTempo: 'medium',
      bgmRelativeVolume: 0.3,
      voiceStyle: 'female warm',
    },
    packagingTrack: {
      subtitlePosition: 'bottom', subtitleHasShadow: true, subtitleHasBackdrop: false,
      subtitleFontSize: 'medium', subtitlePrimaryColor: '#FFFFFF', subtitleOutlineColor: '#000000',
      subtitleFontCategory: 'sans-serif', transitionDominantStyle: 'cut',
      transitionEstimatedDurationSec: 0.5, hasIntroCard: false, introCardDurationSec: 0,
      hasFadeIn: false, fadeInDurationSec: 0, hasOutroCard: false, outroCardDurationSec: 0,
      hasFadeOut: false, fadeOutDurationSec: 0,
    },
    computed: { wordCount: 18, wordsPerMinute: 180, fullTranscript: '' },
    confidence: {},
    contractScore: 95,
  };
}

describe('compileVideoIR', () => {
  it('builds a fully resolved VideoIR from aligned inputs', () => {
    const videoIR = compileVideoIR({
      scriptCIR: makeScriptCIR(),
      storyboardCIR: makeStoryboardCIR(),
      temporalPlanCIR: makeTemporalPlanCIR(),
      styleCIR: makeStyleCIR(),
      minVideoScenes: 2,
    });

    expect(videoIR._cir).toBe('VideoIR');
    expect(videoIR.scenes).toHaveLength(3);
    expect(videoIR.avSyncPolicy).toBe('audio-primary');
    expect(videoIR.language).toBe('Chinese');
    expect(videoIR.scenes[0].ttsVoice).toBeTruthy();
    expect(videoIR.scenes[0].sentenceIndices).toEqual([0]);
    expect(videoIR.scenes[2].narrativePhase).toBe('cta');
  });

  it('promotes longest image scenes when minimum video scene count is not met', () => {
    const videoIR = compileVideoIR({
      scriptCIR: makeScriptCIR(),
      storyboardCIR: makeStoryboardCIR(),
      temporalPlanCIR: makeTemporalPlanCIR(),
      styleCIR: makeStyleCIR(),
      minVideoScenes: 2,
    });

    expect(videoIR.scenes.filter((scene) => scene.assetType === 'video')).toHaveLength(2);
  });

  it('auto-pads storyboard when scenes are fewer than script sentences', () => {
    const storyboardCIR = makeStoryboardCIR();
    const shortStoryboard: StoryboardCIR = {
      ...storyboardCIR,
      scenes: storyboardCIR.scenes.slice(0, 2),
      totalScenes: 2,
      imageSceneCount: 1,
    };

    const videoIR = compileVideoIR({
      scriptCIR: makeScriptCIR(),
      storyboardCIR: shortStoryboard,
      temporalPlanCIR: makeTemporalPlanCIR(),
      styleCIR: makeStyleCIR(),
    });
    // Should succeed rather than throw, with padded scenes
    expect(videoIR.scenes.length).toBe(makeScriptCIR().sentences.length);
  });

  it('deepFreeze makes VideoIR immutable (authority lock)', () => {
    const videoIR = deepFreeze(compileVideoIR({
      scriptCIR: makeScriptCIR(),
      storyboardCIR: makeStoryboardCIR(),
      temporalPlanCIR: makeTemporalPlanCIR(),
      styleCIR: makeStyleCIR(),
    }));

    // Top-level mutation
    expect(() => { (videoIR as any).targetDurationSec = 999; }).toThrow(TypeError);
    // Nested scene mutation
    expect(() => { (videoIR.scenes[0] as any).apiDurationSec = 999; }).toThrow(TypeError);
    // Nested scene array push
    expect(() => { (videoIR.scenes as any).push({}); }).toThrow(TypeError);
  });
});