import { describe, it, expect } from 'vitest';
import {
  computeOverallScore,
  scoreVisualAgainstRef,
  buildSceneQualityScore,
  shouldRetryBasedOnVisual,
  shouldDegradeBasedOnOverall,
  DEFAULT_VISUAL_CONSISTENCY_THRESHOLD,
  DEFAULT_OVERALL_THRESHOLD,
} from '../sceneQuality.js';
import type { VisualDNA } from '../stages/visualConsistency.js';
import type { Scene } from '../types.js';

describe('sceneQuality utilities', () => {
  it('computeOverallScore calculates weighted average', () => {
    const s = { visualConsistency: 80, audioCompleteness: 100, assetIntegrity: 50, overall: 0 } as const;
    const out = computeOverallScore(s as any);
    // 80*0.5 + 100*0.2 + 50*0.3 = 40 + 20 + 15 = 75
    expect(out).toBeCloseTo(75);
  });

  it('scoreVisualAgainstRef returns 100 when DNA is missing', () => {
    expect(scoreVisualAgainstRef(undefined, undefined)).toBe(100);
    const mock: VisualDNA = { dominantColors: ['#fff'], brightness: 'medium', colorTemperature: 'neutral', styleKeywords: ['photorealistic'] };
    expect(scoreVisualAgainstRef(mock, undefined)).toBe(100);
    expect(scoreVisualAgainstRef(undefined, mock)).toBe(100);
  });

  it('scoreVisualAgainstRef returns high score for identical DNAs', () => {
    const a: VisualDNA = { dominantColors: ['#111', '#222'], brightness: 'bright', colorTemperature: 'warm', styleKeywords: ['3D animated', 'soft lighting'] };
    const b = { ...a } as VisualDNA;
    expect(scoreVisualAgainstRef(a, b)).toBeGreaterThanOrEqual(99);
  });

  it('buildSceneQualityScore derives fields from scene metadata', () => {
    const scene: Scene = {
      id: 's1',
      number: 1,
      narrative: 'n',
      visualPrompt: 'p',
      productionSpecs: {},
      estimatedDuration: 3,
      assetType: 'video',
      status: 'done',
      logs: [],
      audioUrl: '/tmp/a.mp3',
      assetUrl: '/tmp/asset.mp4',
    } as unknown as Scene;

    const q = buildSceneQualityScore(scene, 82.5);
    expect(q.visualConsistency).toBeCloseTo(82.5);
    expect(q.audioCompleteness).toBe(100);
    expect(q.assetIntegrity).toBe(100);
    expect(q.overall).toBeCloseTo(computeOverallScore(q));
  });

  it('retry and degrade predicates respect thresholds', () => {
    const belowVisual = DEFAULT_VISUAL_CONSISTENCY_THRESHOLD - 1;
    const atVisual = DEFAULT_VISUAL_CONSISTENCY_THRESHOLD;
    expect(shouldRetryBasedOnVisual(belowVisual)).toBe(true);
    expect(shouldRetryBasedOnVisual(atVisual)).toBe(false);

    const belowOverall = DEFAULT_OVERALL_THRESHOLD - 1;
    const atOverall = DEFAULT_OVERALL_THRESHOLD;
    expect(shouldDegradeBasedOnOverall(belowOverall)).toBe(true);
    expect(shouldDegradeBasedOnOverall(atOverall)).toBe(false);
  });

  it('buildSceneQualityScore blends CV metrics when provided', () => {
    const scene: Scene = {
      id: 's1', number: 1, narrative: 'n', visualPrompt: 'p',
      productionSpecs: {}, estimatedDuration: 3, assetType: 'video',
      status: 'done', logs: [], audioUrl: '/a.mp3', assetUrl: '/v.mp4',
    } as unknown as Scene;

    const cv = { ssim: 0.9, sharpness: 80 };
    const q = buildSceneQualityScore(scene, 70, cv);
    // adjusted = 70 * 0.6 + 90 * 0.25 + 80 * 0.15 = 42 + 22.5 + 12 = 76.5
    expect(q.visualConsistency).toBeCloseTo(76.5);
    expect(q.cv).toEqual(cv);
  });

  it('buildSceneQualityScore blends sharpness-only CV', () => {
    const scene: Scene = {
      id: 's2', number: 2, narrative: 'n', visualPrompt: 'p',
      productionSpecs: {}, estimatedDuration: 3, assetType: 'video',
      status: 'done', logs: [], audioUrl: '/a.mp3', assetUrl: '/v.mp4',
    } as unknown as Scene;

    const cv = { sharpness: 60 };
    const q = buildSceneQualityScore(scene, 80, cv);
    // adjusted = 80 * 0.85 + 60 * 0.15 = 68 + 9 = 77
    expect(q.visualConsistency).toBeCloseTo(77);
  });
});
