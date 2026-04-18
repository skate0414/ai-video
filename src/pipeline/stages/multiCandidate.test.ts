import { describe, it, expect, vi } from 'vitest';
import { pickBestCandidate } from './multiCandidate.js';

describe('pickBestCandidate', () => {
  it('returns single result when count is 1', async () => {
    const generate = vi.fn().mockResolvedValue('single');
    const score = vi.fn().mockReturnValue(75);

    const best = await pickBestCandidate(generate, score, 1);
    expect(best.result).toBe('single');
    expect(best.score).toBe(75);
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('picks the highest-scoring candidate', async () => {
    const items = ['low', 'high', 'mid'];
    const scores: Record<string, number> = { low: 30, high: 95, mid: 60 };

    const best = await pickBestCandidate(
      async (i) => items[i],
      (candidate) => scores[candidate as string],
      3,
    );

    expect(best.result).toBe('high');
    expect(best.score).toBe(95);
  });

  it('caps candidate count at 5', async () => {
    const generate = vi.fn().mockImplementation(async (i: number) => `item_${i}`);
    const score = vi.fn().mockReturnValue(50);

    await pickBestCandidate(generate, score, 10);
    expect(generate).toHaveBeenCalledTimes(5);
  });

  it('handles partial failures gracefully', async () => {
    let callCount = 0;
    const generate = async (_i: number) => {
      callCount++;
      if (callCount === 2) throw new Error('boom');
      return `ok_${callCount}`;
    };
    const score = vi.fn().mockReturnValue(60);

    const best = await pickBestCandidate(generate, score, 3);
    expect(best.result).toMatch(/^ok_/);
    expect(best.score).toBe(60);
  });

  it('falls back to single generate when all candidates fail', async () => {
    let attempts = 0;
    const generate = async (_i: number) => {
      attempts++;
      // First N parallel calls all fail, but the final fallback succeeds
      if (attempts <= 3) throw new Error('fail');
      return 'fallback';
    };
    const score = vi.fn().mockReturnValue(42);

    const best = await pickBestCandidate(generate, score, 3);
    expect(best.result).toBe('fallback');
    expect(best.score).toBe(42);
  });

  it('treats count <= 0 as 1', async () => {
    const generate = vi.fn().mockResolvedValue('only');
    const score = vi.fn().mockReturnValue(80);

    const best = await pickBestCandidate(generate, score, 0);
    expect(best.result).toBe('only');
    expect(generate).toHaveBeenCalledTimes(1);
  });
});
