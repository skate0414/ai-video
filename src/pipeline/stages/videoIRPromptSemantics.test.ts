import { describe, it, expect } from 'vitest';
import {
  getAspectRatioFromVideoIR,
  getVideoIRScene,
  buildImagePromptFromVideoIRScene,
  buildVideoPromptFromVideoIRScene,
  buildNegativePrompt,
} from './videoIRPromptSemantics.js';
import type { VideoIR, VideoIRScene } from '../../cir/types.js';

function makeIR(overrides?: Partial<VideoIR>): VideoIR {
  return {
    resolution: { w: 1920, h: 1080 },
    fps: 30,
    scenes: [],
    ...overrides,
  } as VideoIR;
}

function makeScene(overrides?: Partial<VideoIRScene>): VideoIRScene {
  return {
    index: 1,
    visualPrompt: 'A cosmic nebula expanding',
    colorPalette: ['#000', '#FFF'],
    lightingStyle: 'cinematic',
    visualStyle: 'photorealistic',
    assetType: 'video',
    transition: 'fade',
    durationSec: 5,
    emphasis: 'standard',
    ...overrides,
  } as VideoIRScene;
}

describe('getAspectRatioFromVideoIR', () => {
  it('returns 16:9 for 1920x1080', () => {
    expect(getAspectRatioFromVideoIR(makeIR())).toBe('16:9');
  });

  it('returns 9:16 for 1080x1920', () => {
    expect(getAspectRatioFromVideoIR(makeIR({ resolution: { w: 1080, h: 1920 } }))).toBe('9:16');
  });

  it('returns 1:1 for 1080x1080', () => {
    expect(getAspectRatioFromVideoIR(makeIR({ resolution: { w: 1080, h: 1080 } }))).toBe('1:1');
  });

  it('returns 4:3 for 1024x768', () => {
    expect(getAspectRatioFromVideoIR(makeIR({ resolution: { w: 1024, h: 768 } }))).toBe('4:3');
  });

  it('returns 16:9 for zero width', () => {
    expect(getAspectRatioFromVideoIR(makeIR({ resolution: { w: 0, h: 1080 } }))).toBe('16:9');
  });

  it('returns 16:9 for negative height', () => {
    expect(getAspectRatioFromVideoIR(makeIR({ resolution: { w: 1920, h: -100 } }))).toBe('16:9');
  });

  it('returns 16:9 for NaN resolution', () => {
    expect(getAspectRatioFromVideoIR(makeIR({ resolution: { w: NaN, h: 1080 } }))).toBe('16:9');
  });

  it('returns 16:9 for Infinity resolution', () => {
    expect(getAspectRatioFromVideoIR(makeIR({ resolution: { w: Infinity, h: 1080 } }))).toBe('16:9');
  });
});

describe('getVideoIRScene', () => {
  const scenes = [makeScene({ index: 1 }), makeScene({ index: 2 })];

  it('returns scene by number (1-indexed)', () => {
    const ir = makeIR({ scenes });
    const scene = getVideoIRScene(ir, 1, 0);
    expect(scene.index).toBe(1);
  });

  it('returns second scene for sceneNumber=2', () => {
    const ir = makeIR({ scenes });
    const scene = getVideoIRScene(ir, 2, 0);
    expect(scene.index).toBe(2);
  });

  it('falls back to index when scene not found by number', () => {
    const ir = makeIR({ scenes });
    const scene = getVideoIRScene(ir, 99, 1);
    expect(scene.index).toBe(2);
  });

  it('throws when neither number nor index matches', () => {
    const ir = makeIR({ scenes: [makeScene()] });
    expect(() => getVideoIRScene(ir, 99, 99)).toThrow('VideoIR scene not found');
  });
});

describe('buildImagePromptFromVideoIRScene', () => {
  it('fills template fields', () => {
    const scene = makeScene();
    const prompt = buildImagePromptFromVideoIRScene(scene, '16:9');
    expect(prompt).toContain('A cosmic nebula expanding');
    expect(prompt).toContain('#000, #FFF');
    expect(prompt).toContain('cinematic');
    expect(prompt).toContain('photorealistic');
    expect(prompt).toContain('16:9');
  });

  it('handles different aspect ratios', () => {
    const scene = makeScene();
    const prompt = buildImagePromptFromVideoIRScene(scene, '9:16');
    expect(prompt).toContain('9:16');
  });

  it('handles empty color palette', () => {
    const scene = makeScene({ colorPalette: [] });
    const prompt = buildImagePromptFromVideoIRScene(scene, '1:1');
    expect(prompt).toContain('1:1');
  });
});

describe('buildVideoPromptFromVideoIRScene', () => {
  it('fills template fields including duration', () => {
    const scene = makeScene();
    const prompt = buildVideoPromptFromVideoIRScene(scene, '16:9', 5);
    expect(prompt).toContain('A cosmic nebula expanding');
    expect(prompt).toContain('16:9');
    expect(prompt).toContain('5');
  });

  it('includes style anchor when provided', () => {
    const scene = makeScene();
    const prompt = buildVideoPromptFromVideoIRScene(scene, '16:9', 5, 'consistent-visual-anchor');
    expect(prompt).toContain('consistent-visual-anchor');
  });

  it('handles missing style anchor', () => {
    const scene = makeScene();
    const prompt = buildVideoPromptFromVideoIRScene(scene, '16:9', 5);
    // Should not crash, style_anchor slot filled with empty string
    expect(prompt).toContain(scene.visualPrompt);
  });
});

describe('buildNegativePrompt', () => {
  it('always includes base negative terms', () => {
    const neg = buildNegativePrompt('abstract painting');
    expect(neg).toContain('blurry');
    expect(neg).toContain('watermark');
    expect(neg).toContain('low resolution');
  });

  it('adds style-specific exclusions for cinematic', () => {
    const neg = buildNegativePrompt('Cinematic 4K');
    expect(neg).toContain('cartoon');
    expect(neg).toContain('anime');
    expect(neg).toContain('clip art');
  });

  it('adds style-specific exclusions for anime', () => {
    const neg = buildNegativePrompt('anime illustration');
    expect(neg).toContain('photorealistic');
    expect(neg).toContain('3D render');
  });

  it('adds exclusions for realistic styles', () => {
    const neg = buildNegativePrompt('hyper-realistic photography');
    expect(neg).toContain('cartoon');
    expect(neg).toContain('illustration');
  });

  it('returns base only for unrecognized styles', () => {
    const neg = buildNegativePrompt('surrealism');
    expect(neg).toBe('blurry, distorted, deformed, watermark, text overlay, low resolution, cropped, out of frame, duplicate, ugly');
  });
});

describe('buildImagePromptFromVideoIRScene – palette inheritance', () => {
  it('includes previous scene palette when provided', () => {
    const scene = makeScene({ colorPalette: ['#FF0000', '#00FF00'] });
    const prompt = buildImagePromptFromVideoIRScene(scene, '16:9', ['#0000FF', '#FFFF00']);
    expect(prompt).toContain('#0000FF');
    expect(prompt).toContain('#FFFF00');
    expect(prompt).toContain('Continuity from previous scene');
  });

  it('omits continuity text when no previous palette', () => {
    const scene = makeScene({ colorPalette: ['#FF0000', '#00FF00'] });
    const prompt = buildImagePromptFromVideoIRScene(scene, '16:9');
    expect(prompt).not.toContain('Continuity from previous scene');
    expect(prompt).toContain('#FF0000');
  });

  it('omits continuity text for empty previous palette', () => {
    const scene = makeScene({ colorPalette: ['#FF0000'] });
    const prompt = buildImagePromptFromVideoIRScene(scene, '16:9', []);
    expect(prompt).not.toContain('Continuity from previous scene');
  });
});
