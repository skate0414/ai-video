/**
 * Pure-logic tests for RefinePage and ScriptPage patterns.
 * These test the state transformation logic without rendering full page components.
 */
import { describe, it, expect } from 'vitest';
import {
  SUBTITLE_PRESETS,
  DEFAULT_REFINE_OPTIONS,
} from '../types';
import type {
  SubtitlePreset,
  SubtitleStyle,
  RefineOptions,
} from '../types';

/* ---- updateSubtitleStyleCustom auto-switch ---- */

/**
 * Mirrors the state update logic in RefinePage.updateSubtitleStyleCustom:
 * any manual tweak to subtitleStyle should auto-switch subtitlePreset to 'custom'.
 */
function applySubtitleStyleCustom(
  prev: RefineOptions,
  updates: Partial<SubtitleStyle>,
): RefineOptions {
  return {
    ...prev,
    subtitlePreset: 'custom' as SubtitlePreset,
    subtitleStyle: { ...prev.subtitleStyle, ...updates },
  };
}

describe('updateSubtitleStyleCustom auto-switch', () => {
  it('switches preset to custom when modifying font size', () => {
    const initial: RefineOptions = {
      ...DEFAULT_REFINE_OPTIONS,
      subtitlePreset: 'classic_white',
      subtitleStyle: { ...SUBTITLE_PRESETS.classic_white },
    };
    const result = applySubtitleStyleCustom(initial, { fontSize: 32 });
    expect(result.subtitlePreset).toBe('custom');
    expect(result.subtitleStyle.fontSize).toBe(32);
  });

  it('switches from cinematic to custom when changing color', () => {
    const initial: RefineOptions = {
      ...DEFAULT_REFINE_OPTIONS,
      subtitlePreset: 'cinematic',
      subtitleStyle: { ...SUBTITLE_PRESETS.cinematic },
    };
    const result = applySubtitleStyleCustom(initial, { primaryColor: '#FF0000' });
    expect(result.subtitlePreset).toBe('custom');
    expect(result.subtitleStyle.primaryColor).toBe('#FF0000');
    // Other fields should be preserved from cinematic preset
    expect(result.subtitleStyle.fontName).toBe('Georgia');
  });

  it('preserves all unmodified fields', () => {
    const initial: RefineOptions = {
      ...DEFAULT_REFINE_OPTIONS,
      subtitlePreset: 'backdrop_black',
      subtitleStyle: { ...SUBTITLE_PRESETS.backdrop_black },
    };
    const result = applySubtitleStyleCustom(initial, { outlineWidth: 3 });
    expect(result.subtitleStyle.fontSize).toBe(SUBTITLE_PRESETS.backdrop_black.fontSize);
    expect(result.subtitleStyle.primaryColor).toBe(SUBTITLE_PRESETS.backdrop_black.primaryColor);
    expect(result.subtitleStyle.backdropEnabled).toBe(SUBTITLE_PRESETS.backdrop_black.backdropEnabled);
    expect(result.subtitleStyle.outlineWidth).toBe(3);
  });

  it('stays custom if already custom', () => {
    const initial: RefineOptions = {
      ...DEFAULT_REFINE_OPTIONS,
      subtitlePreset: 'custom',
      subtitleStyle: { ...SUBTITLE_PRESETS.custom, fontSize: 28 },
    };
    const result = applySubtitleStyleCustom(initial, { shadowEnabled: false });
    expect(result.subtitlePreset).toBe('custom');
    expect(result.subtitleStyle.fontSize).toBe(28);
    expect(result.subtitleStyle.shadowEnabled).toBe(false);
  });

  it('does not modify non-subtitle options', () => {
    const initial: RefineOptions = {
      ...DEFAULT_REFINE_OPTIONS,
      bgmVolume: 0.3,
      fadeInDuration: 2,
    };
    const result = applySubtitleStyleCustom(initial, { fontSize: 18 });
    expect(result.bgmVolume).toBe(0.3);
    expect(result.fadeInDuration).toBe(2);
  });
});

/* ---- issueSceneIndices computation ---- */

/**
 * Mirrors the useMemo logic in ScriptPage that computes issueSceneIndices
 * from qaReviewResult.
 */
function computeIssueSceneIndices(
  qaReviewResult: {
    unfilmableSentences?: Array<{ index: number; text: string; reason: string }>;
    issues?: string[];
    suspiciousNumericClaims?: Array<{ claim: string; reason: string }>;
  } | undefined,
): Set<number> {
  const indices = new Set<number>();
  const qa = qaReviewResult;
  if (qa?.unfilmableSentences) {
    for (const s of qa.unfilmableSentences) {
      if (s.index != null) indices.add(s.index);
    }
  }
  return indices;
}

describe('issueSceneIndices computation', () => {
  it('returns empty set when qaReviewResult is undefined', () => {
    const result = computeIssueSceneIndices(undefined);
    expect(result.size).toBe(0);
  });

  it('returns empty set when no unfilmable sentences', () => {
    const result = computeIssueSceneIndices({ issues: ['some issue'] });
    expect(result.size).toBe(0);
  });

  it('extracts indices from unfilmableSentences', () => {
    const result = computeIssueSceneIndices({
      unfilmableSentences: [
        { index: 2, text: 'abstract concept', reason: 'too abstract' },
        { index: 5, text: 'another one', reason: 'not visual' },
      ],
    });
    expect(result).toEqual(new Set([2, 5]));
  });

  it('deduplicates indices', () => {
    const result = computeIssueSceneIndices({
      unfilmableSentences: [
        { index: 3, text: 'a', reason: 'x' },
        { index: 3, text: 'b', reason: 'y' },
        { index: 7, text: 'c', reason: 'z' },
      ],
    });
    expect(result).toEqual(new Set([3, 7]));
    expect(result.size).toBe(2);
  });

  it('handles index 0 correctly', () => {
    const result = computeIssueSceneIndices({
      unfilmableSentences: [
        { index: 0, text: 'first scene', reason: 'abstract' },
      ],
    });
    expect(result.has(0)).toBe(true);
    expect(result.size).toBe(1);
  });

  it('ignores other QA fields without scene indices', () => {
    const result = computeIssueSceneIndices({
      issues: ['pacing issue', 'tone mismatch'],
      suspiciousNumericClaims: [{ claim: '100%', reason: 'unverified' }],
      unfilmableSentences: [{ index: 4, text: 'test', reason: 'r' }],
    });
    // Only unfilmableSentences contributes indices
    expect(result).toEqual(new Set([4]));
  });
});
