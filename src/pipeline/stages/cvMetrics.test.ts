import { describe, it, expect, vi } from 'vitest';
import { blendCVScore, type CVQualityMetrics } from './cvMetrics.js';

// Unit tests for pure functions (SSIM/sharpness computation tests are integration-level
// since they require FFmpeg; we test the blending logic here which is the scoring core).

describe('blendCVScore', () => {
  it('returns original score when no CV metrics available', () => {
    const cv: CVQualityMetrics = {};
    expect(blendCVScore(80, cv)).toBeCloseTo(80);
  });

  it('blends SSIM and sharpness into visual score', () => {
    const cv: CVQualityMetrics = { ssim: 0.92, sharpness: 85 };
    // expected: 80 * 0.6 + 92 * 0.25 + 85 * 0.15 = 48 + 23 + 12.75 = 83.75
    expect(blendCVScore(80, cv)).toBeCloseTo(83.75);
  });

  it('blends sharpness only when SSIM is missing', () => {
    const cv: CVQualityMetrics = { sharpness: 60 };
    // expected: 80 * 0.85 + 60 * 0.15 = 68 + 9 = 77
    expect(blendCVScore(80, cv)).toBeCloseTo(77);
  });

  it('uses default sharpness 70 when only SSIM is available', () => {
    const cv: CVQualityMetrics = { ssim: 0.95 };
    // expected: 80 * 0.6 + 95 * 0.25 + 70 * 0.15 = 48 + 23.75 + 10.5 = 82.25
    expect(blendCVScore(80, cv)).toBeCloseTo(82.25);
  });

  it('clamps to 0-100 range', () => {
    const cv: CVQualityMetrics = { ssim: 1.0, sharpness: 100 };
    expect(blendCVScore(100, cv)).toBeLessThanOrEqual(100);
    expect(blendCVScore(0, { ssim: 0, sharpness: 0 })).toBeGreaterThanOrEqual(0);
  });

  it('handles perfect scores', () => {
    const cv: CVQualityMetrics = { ssim: 1.0, sharpness: 100 };
    // 100 * 0.6 + 100 * 0.25 + 100 * 0.15 = 100
    expect(blendCVScore(100, cv)).toBeCloseTo(100);
  });

  it('handles histogram similarity without affecting blend', () => {
    // histogramSimilarity is tracked but doesn't directly affect blendCVScore
    const cv: CVQualityMetrics = { ssim: 0.8, sharpness: 75, histogramSimilarity: 90 };
    // expected: 80 * 0.6 + 80 * 0.25 + 75 * 0.15 = 48 + 20 + 11.25 = 79.25
    expect(blendCVScore(80, cv)).toBeCloseTo(79.25);
  });
});

describe('CVQualityMetrics type', () => {
  it('allows all fields optional', () => {
    const empty: CVQualityMetrics = {};
    expect(empty.ssim).toBeUndefined();
    expect(empty.sharpness).toBeUndefined();
    expect(empty.histogramSimilarity).toBeUndefined();
  });
});
