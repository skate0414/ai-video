/* ------------------------------------------------------------------ */
/*  Tests for n-gram contamination detection                          */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import { checkContamination, segmentWords } from './contamination.js';

describe('segmentWords', () => {
  it('segments Chinese text into words', () => {
    const words = segmentWords('量子纠缠是物理学中的基本现象');
    expect(words.length).toBeGreaterThan(2);
    expect(words.every(w => w.length > 0)).toBe(true);
  });

  it('segments mixed Chinese-English text', () => {
    const words = segmentWords('这是一个关于AI的测试');
    expect(words.length).toBeGreaterThan(2);
  });

  it('returns empty for empty input', () => {
    expect(segmentWords('')).toEqual([]);
  });
});

describe('checkContamination', () => {
  it('returns 0 for empty inputs', () => {
    expect(checkContamination('', '参考文本')).toEqual({ score: 0, overlappingPhrases: [], isBlocking: false });
    expect(checkContamination('脚本文本', '')).toEqual({ score: 0, overlappingPhrases: [], isBlocking: false });
  });

  it('returns 0 for texts too short to form n-grams', () => {
    const result = checkContamination('短', '短文');
    expect(result.score).toBe(0);
  });

  it('detects high overlap when script copies reference', () => {
    const ref = '每秒钟太阳都在将数百万吨氢转化为氦释放出惊人的能量这颗恒星的直径约为地球的一百零九倍';
    const script = ref; // identical copy
    const result = checkContamination(script, ref);
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.isBlocking).toBe(true);
    expect(result.overlappingPhrases.length).toBeGreaterThan(0);
  });

  it('returns low overlap for distinct texts', () => {
    const ref = '太阳是太阳系中心的恒星它通过核聚变将氢转化为氦释放光和热';
    const script = '黑洞是宇宙中最神秘的天体之一连光线都无法逃脱它的引力束缚';
    const result = checkContamination(script, ref);
    expect(result.score).toBeLessThan(0.1);
    expect(result.isBlocking).toBe(false);
  });

  it('limits overlappingPhrases to 10', () => {
    // Create a very large overlapping text
    const long = '这是一段非常非常长的文本用来测试短语数量限制功能是否正常工作我们需要确保数组不会超过十个元素因此这段文本要足够长才能产生足够多的重叠词组而且必须完全一模一样';
    const result = checkContamination(long, long);
    expect(result.overlappingPhrases.length).toBeLessThanOrEqual(10);
  });
});
