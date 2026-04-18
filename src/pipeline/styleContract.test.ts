/* ------------------------------------------------------------------ */
/*  Tests for StyleProfile Contract validation + computed fields      */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import {
  validateStyleContract,
  computeDerivedFields,
  resolvePath,
  STYLE_CONTRACT,
} from './styleContract.js';
import type { StyleProfile } from './types.js';

/* ---- Helper: build a profile with all CRITICAL fields present ---- */

function fullProfile(): StyleProfile {
  return {
    visualStyle: 'cinematic',
    pacing: 'fast',
    tone: 'excited',
    colorPalette: ['#FF0000'],
    narrativeStructure: ['Hook', 'Body', 'Conclusion'],
    fullTranscript: '这是一个完整的测试转录文本。包含多个句子。用于验证合约逻辑。',
    wordsPerMinute: 250,
    meta: {
      video_duration_sec: 120,
      video_language: 'Chinese',
      video_type: 'explainer',
    },
    track_a_script: {
      sentence_length_max: 25,
      hook_strategy: 'Question',
    },
    track_b_visual: {
      base_medium: '3D animation',
      scene_avg_duration_sec: 4,
    },
  };
}

describe('resolvePath', () => {
  it('resolves top-level fields', () => {
    const p = fullProfile();
    expect(resolvePath(p, 'fullTranscript')).toBe(p.fullTranscript);
  });

  it('resolves nested fields', () => {
    const p = fullProfile();
    expect(resolvePath(p, 'meta.video_duration_sec')).toBe(120);
  });

  it('returns undefined for missing nested paths', () => {
    const p: StyleProfile = { visualStyle: 'x', pacing: 'x', tone: 'x', colorPalette: [], narrativeStructure: [] };
    expect(resolvePath(p, 'meta.video_duration_sec')).toBeUndefined();
  });
});

describe('validateStyleContract', () => {
  it('returns score 100 when all CRITICAL fields are present and confident', () => {
    const result = validateStyleContract(fullProfile());
    expect(result.score).toBe(100);
    expect(result.missingCritical).toEqual([]);
    expect(result.lowConfidenceCritical).toEqual([]);
    expect(result.retryPromptFragment).toBeNull();
  });

  it('detects missing CRITICAL fields', () => {
    const p = fullProfile();
    delete p.meta;
    const result = validateStyleContract(p);
    expect(result.missingCritical).toContain('meta.video_duration_sec');
    expect(result.missingCritical).toContain('meta.video_language');
    expect(result.score).toBeLessThan(100);
    expect(result.retryPromptFragment).toContain('meta.video_duration_sec');
  });

  it('detects low-confidence CRITICAL fields', () => {
    const p = fullProfile();
    p.nodeConfidence = { scene_avg_duration_sec: 'guess' };
    const result = validateStyleContract(p);
    expect(result.lowConfidenceCritical).toContain('track_b_visual.scene_avg_duration_sec');
    expect(result.score).toBeLessThan(100);
    expect(result.retryPromptFragment).toContain('scene_avg_duration_sec');
  });

  it('detects missing IMPORTANT fields', () => {
    const p = fullProfile();
    // narrativeStructure is IMPORTANT — make it empty
    p.narrativeStructure = [];
    const result = validateStyleContract(p);
    expect(result.missingImportant).toContain('narrativeStructure');
    // score only based on CRITICAL, so should still be 100
    expect(result.score).toBe(100);
  });

  it('handles empty profile gracefully', () => {
    const p: StyleProfile = { visualStyle: '', pacing: '', tone: '', colorPalette: [], narrativeStructure: [] };
    const result = validateStyleContract(p);
    expect(result.missingCritical.length).toBeGreaterThan(0);
    expect(result.score).toBe(0);
    expect(result.retryPromptFragment).toBeTruthy();
  });

  it('counts criticalPresent and criticalTotal correctly', () => {
    const p = fullProfile();
    const result = validateStyleContract(p);
    const criticalCount = STYLE_CONTRACT.filter(f => f.tier === 'CRITICAL').length;
    expect(result.criticalTotal).toBe(criticalCount);
    expect(result.criticalPresent).toBe(criticalCount);
  });
});

describe('computeDerivedFields', () => {
  it('computes wordCount from Chinese transcript', () => {
    const p = fullProfile();
    p.fullTranscript = '这是测试文本包含十个汉字和abc';
    p.meta = { video_duration_sec: 60, video_language: 'Chinese', video_type: 'explainer' };
    computeDerivedFields(p);
    // 13 CJK chars + 1 ASCII word = 14
    expect(p.wordCount).toBe(14);
    expect(p.nodeConfidence?.['wordCount']).toBe('computed');
  });

  it('computes wordsPerMinute from duration', () => {
    const p = fullProfile();
    p.fullTranscript = '这是测试文本包含十个汉字和abc';
    p.meta = { video_duration_sec: 120, video_language: 'Chinese', video_type: 'explainer' };
    computeDerivedFields(p);
    // 14 words / (120/60) = 7
    expect(p.wordsPerMinute).toBe(7);
    expect(p.nodeConfidence?.['wordsPerMinute']).toBe('computed');
  });

  it('computes sentence_length_avg and sentence_length_max', () => {
    const p = fullProfile();
    p.fullTranscript = '短句。这是一个比较长的句子用来测试。中等长度句子。';
    p.meta = { video_duration_sec: 60, video_language: 'Chinese', video_type: 'explainer' };
    computeDerivedFields(p);
    expect(p.track_a_script?.sentence_length_avg).toBeGreaterThan(0);
    expect(p.track_a_script?.sentence_length_max).toBeGreaterThan(0);
    expect(p.track_a_script!.sentence_length_max!).toBeGreaterThanOrEqual(p.track_a_script!.sentence_length_avg!);
    expect(p.nodeConfidence?.['sentence_length_max']).toBe('computed');
  });

  it('does nothing when fullTranscript is empty', () => {
    const p = fullProfile();
    p.fullTranscript = '';
    const originalWC = p.wordCount;
    computeDerivedFields(p);
    expect(p.wordCount).toBe(originalWC);
  });

  it('does nothing when fullTranscript is undefined', () => {
    const p = fullProfile();
    delete p.fullTranscript;
    computeDerivedFields(p);
    expect(p.nodeConfidence?.['wordCount']).toBeUndefined();
  });

  it('handles English text correctly', () => {
    const p: StyleProfile = {
      visualStyle: 'cinematic', pacing: 'medium', tone: 'informative',
      colorPalette: [], narrativeStructure: [],
      fullTranscript: 'This is a test sentence. Another one here.',
      meta: { video_duration_sec: 30, video_language: 'English', video_type: 'explainer' },
    };
    computeDerivedFields(p);
    // 'This is a test sentence' = 5, 'Another one here' = 3 → total 8
    expect(p.wordCount).toBe(8);
    expect(p.wordsPerMinute).toBe(16); // 8 / 0.5
  });

  it('initialises track_a_script if not present', () => {
    const p: StyleProfile = {
      visualStyle: 'x', pacing: 'x', tone: 'x', colorPalette: [], narrativeStructure: [],
      fullTranscript: '句子一。句子二。',
      meta: { video_duration_sec: 60, video_language: 'Chinese', video_type: 'explainer' },
    };
    computeDerivedFields(p);
    expect(p.track_a_script).toBeDefined();
    expect(p.track_a_script!.sentence_length_avg).toBeGreaterThan(0);
  });

  it('does not split on decimal points like 0.01%', () => {
    const p: StyleProfile = {
      visualStyle: 'x', pacing: 'x', tone: 'x', colorPalette: [], narrativeStructure: [],
      fullTranscript: '地球历经46亿年演化，人类仅占0.01%的时间。这是第二句话。',
      meta: { video_duration_sec: 60, video_language: 'Chinese', video_type: 'explainer' },
    };
    computeDerivedFields(p);
    // Should produce 2 sentences, not 3 ("0." should not be a split point)
    // Sentence 1: ~17 chars, Sentence 2: ~6 chars → avg ~11, max ~17
    expect(p.track_a_script!.sentence_length_avg!).toBeLessThan(20);
    expect(p.track_a_script!.sentence_length_max!).toBeLessThan(25);
  });

  it('falls back to space-based splitting when transcript lacks punctuation', () => {
    const p: StyleProfile = {
      visualStyle: 'x', pacing: 'x', tone: 'x', colorPalette: [], narrativeStructure: [],
      fullTranscript: '这可能是你第一次认识到 你的身体究竟有多爱你 在你的身体中 每天都会有细胞产生癌变 都是身体在拯救你 而你却不懂得珍惜它',
      meta: { video_duration_sec: 60, video_language: 'Chinese', video_type: 'explainer' },
    };
    computeDerivedFields(p);
    // Without punctuation, should fall back to space splitting (6 segments)
    // avg should be ~8 chars, not ~50 (the whole text)
    expect(p.track_a_script!.sentence_length_avg!).toBeLessThan(15);
    expect(p.track_a_script!.sentence_length_max!).toBeLessThan(20);
  });
});
