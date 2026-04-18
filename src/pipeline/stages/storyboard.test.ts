import { describe, expect, it } from 'vitest';

import { runStoryboard } from './storyboard.js';
import type { AIAdapter } from '../types.js';
import type { ScriptCIR, StyleAnalysisCIR } from '../../cir/types.js';

function makeStyleCIR(): StyleAnalysisCIR {
  return {
    _cir: 'StyleAnalysis',
    version: 1,
    visualStyle: 'cinematic',
    pacing: 'medium',
    tone: 'informative',
    colorPalette: ['#111111', '#eeeeee'],
    meta: { videoDurationSec: 20, videoLanguage: 'Chinese', videoType: 'explainer' },
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
    computed: { wordCount: 20, wordsPerMinute: 180, fullTranscript: '' },
    confidence: {},
    contractScore: 100,
  };
}

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
    totalWordCount: 20,
    totalDurationSec: 15,
    usedFactIDs: ['f1', 'f2'],
    safety: { isHighRisk: false, categories: [], needsManualReview: false },
    styleConsistencyScore: 95,
    calibration: {
      targetWordCount: 20,
      targetWordCountMin: 18,
      targetWordCountMax: 22,
      targetDurationSec: 15,
      speechRate: 'medium',
    },
  };
}

function makeAdapter(sceneCount: number): AIAdapter {
  return {
    provider: 'mock',
    async generateText() {
      return {
        text: JSON.stringify({
          scenes: Array.from({ length: sceneCount }, (_, index) => ({
            visualPrompt: `Detailed cinematic visual prompt ${index + 1} with dramatic lighting and motion.`,
            productionSpecs: { camera: 'wide', lighting: 'dramatic', sound: 'ambient' },
            assetType: index === 0 ? 'video' : 'image',
          })),
        }),
      };
    },
    async generateImage() {
      return {};
    },
    async generateVideo() {
      return {};
    },
  };
}

describe('runStoryboard', () => {
  it('preserves script sentence count and order even when AI returns fewer scenes', async () => {
    const scenes = await runStoryboard(makeAdapter(2), {
      topic: '太阳',
      styleCIR: makeStyleCIR(),
      scriptCIR: makeScriptCIR(),
    });

    expect(scenes).toHaveLength(3);
    expect(scenes.map((scene) => scene.narrative)).toEqual(['第一句。', '第二句。', '第三句。']);
    expect(scenes[0].visualPrompt).toContain('Detailed cinematic visual prompt 1');
    expect(scenes[2].visualPrompt).toContain('3D animated scene depicting');
  });

  it('ignores extra AI scenes beyond the compiler-owned structure', async () => {
    const scenes = await runStoryboard(makeAdapter(5), {
      topic: '太阳',
      styleCIR: makeStyleCIR(),
      scriptCIR: makeScriptCIR(),
    });

    expect(scenes).toHaveLength(3);
    expect(scenes[0].number).toBe(1);
    expect(scenes[1].number).toBe(2);
    expect(scenes[2].number).toBe(3);
  });

  it('enriches short visual prompts with style/camera/lighting context', async () => {
    const terseAdapter: AIAdapter = {
      provider: 'mock',
      async generateText() {
        return {
          text: JSON.stringify({
            scenes: [{
              visualPrompt: '太阳升起。',
              productionSpecs: { camera: '', lighting: '', sound: 'ambient' },
            }],
          }),
        };
      },
      async generateImage() { return {}; },
      async generateVideo() { return {}; },
    };

    const scenes = await runStoryboard(terseAdapter, {
      topic: '太阳',
      styleCIR: makeStyleCIR(),
      scriptCIR: makeScriptCIR(),
    });

    expect(scenes[0].visualPrompt).toContain('Style: cinematic');
    expect(scenes[0].visualPrompt).toContain('Camera: smooth');
    expect(scenes[0].visualPrompt).toContain('Lighting: dramatic');
  });

  it('applies high-strength storyboard replication scaffold from reference scenes', async () => {
    const scenes = await runStoryboard(makeAdapter(3), {
      topic: '太阳',
      styleCIR: makeStyleCIR(),
      scriptCIR: makeScriptCIR(),
      replicationSettings: {
        enabled: true,
        strength: 'high',
        sourceProjectId: 'proj_ref',
        referenceScenes: [
          {
            number: 1,
            narrative: '参考镜头一',
            visualPrompt: 'slow orbit camera around glowing star core with dramatic rim light',
            camera: 'orbit shot',
            lighting: 'rim light',
            estimatedDuration: 7,
          },
        ],
      },
    });

    expect(scenes[0].productionSpecs.camera).toBe('orbit shot');
    expect(scenes[0].productionSpecs.lighting).toBe('rim light');
    expect(scenes[0].estimatedDuration).toBe(7);
    expect(scenes[0].visualPrompt).toContain('Shot rhythm reference:');
  });
});