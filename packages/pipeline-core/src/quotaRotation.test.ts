import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  isQuotaError,
  hasQuotaSignal,
  CapabilityQuotaTracker,
  tryWithRotation,
  capabilityQuota,
} from './quotaRotation.js';
import { quotaBus } from './quotaBus.js';
import type { AiResource } from './runtimeTypes.js';

/* ---- helpers ---- */

function makeResource(
  id: string,
  provider = 'gemini',
  caps: AiResource['capabilities'] = { text: true, image: true, video: true },
  quotaExhausted = false,
): AiResource {
  return {
    id,
    type: 'api',
    provider,
    label: `Resource ${id}`,
    siteUrl: 'https://example.com',
    profileDir: `/tmp/profile-${id}`,
    quotaExhausted,
    capabilities: caps,
  };
}

/* ---- isQuotaError ---- */

describe('isQuotaError', () => {
  it('returns false for non-objects', () => {
    expect(isQuotaError(null)).toBe(false);
    expect(isQuotaError(undefined)).toBe(false);
    expect(isQuotaError('string')).toBe(false);
    expect(isQuotaError(42)).toBe(false);
  });

  it('returns true when isQuotaError flag is set on the error object', () => {
    expect(isQuotaError({ isQuotaError: true, message: 'any' })).toBe(true);
  });

  it('returns true for 429 status', () => {
    expect(isQuotaError({ status: 429 })).toBe(true);
  });

  it('returns true for 503 status', () => {
    expect(isQuotaError({ status: 503 })).toBe(true);
  });

  it('returns false for unrelated HTTP status', () => {
    expect(isQuotaError({ status: 500 })).toBe(false);
    expect(isQuotaError({ status: 400 })).toBe(false);
  });

  it('matches "quota" in the message', () => {
    expect(isQuotaError(new Error('You have exceeded your quota'))).toBe(true);
  });

  it('matches "rate limit" in the message', () => {
    expect(isQuotaError(new Error('rate limit reached'))).toBe(true);
  });

  it('matches "resource_exhausted" in the message', () => {
    expect(isQuotaError(new Error('RESOURCE_EXHAUSTED for API call'))).toBe(true);
  });

  it('matches "usage cap" in the message', () => {
    expect(isQuotaError(new Error('You have hit the usage cap'))).toBe(true);
  });

  it('matches "free plan limit" in the message', () => {
    expect(isQuotaError(new Error('free plan limit exceeded'))).toBe(true);
  });

  it('matches "too many requests" in the message', () => {
    expect(isQuotaError(new Error('Too many requests sent'))).toBe(true);
  });

  it('matches Chinese quota phrase "请求过于频繁"', () => {
    expect(isQuotaError(new Error('请求过于频繁'))).toBe(true);
  });

  it('matches Chinese quota phrase "已达到.*使用上限"', () => {
    expect(isQuotaError(new Error('已达到今日使用上限'))).toBe(true);
  });

  it('returns false for generic server errors', () => {
    expect(isQuotaError(new Error('Internal server error'))).toBe(false);
    expect(isQuotaError(new Error('Connection refused'))).toBe(false);
  });
});

/* ---- hasQuotaSignal ---- */

describe('hasQuotaSignal', () => {
  it('returns true when text contains "free plan limit"', () => {
    expect(hasQuotaSignal('You have reached the free plan limit')).toBe(true);
  });

  it('returns true when text contains "usage cap"', () => {
    expect(hasQuotaSignal('Your usage cap has been reached')).toBe(true);
  });

  it('returns true when text contains "quota"', () => {
    expect(hasQuotaSignal('quota exceeded')).toBe(true);
  });

  it('returns true when text contains "rate limit"', () => {
    expect(hasQuotaSignal('rate limit hit')).toBe(true);
  });

  it('returns true when text contains "too many requests"', () => {
    expect(hasQuotaSignal('Too many requests, slow down')).toBe(true);
  });

  it('returns true when text contains "limit resets"', () => {
    expect(hasQuotaSignal('Your limit resets tomorrow')).toBe(true);
  });

  it('returns true when text contains "image generation requests"', () => {
    expect(hasQuotaSignal('You have used all image generation requests')).toBe(true);
  });

  it('returns false for unrelated text', () => {
    expect(hasQuotaSignal('Video generated successfully')).toBe(false);
    expect(hasQuotaSignal('')).toBe(false);
  });

  it('is case-insensitive', () => {
    expect(hasQuotaSignal('QUOTA EXCEEDED')).toBe(true);
    expect(hasQuotaSignal('Rate Limit')).toBe(true);
  });
});

/* ---- CapabilityQuotaTracker ---- */

describe('CapabilityQuotaTracker', () => {
  let tracker: CapabilityQuotaTracker;

  beforeEach(() => {
    tracker = new CapabilityQuotaTracker();
    quotaBus.resetAll();
  });

  it('starts with nothing exhausted', () => {
    expect(tracker.isExhausted('res1', 'text')).toBe(false);
  });

  it('marks a resource-capability pair as exhausted', () => {
    tracker.markExhausted('res1', 'image');
    expect(tracker.isExhausted('res1', 'image')).toBe(true);
  });

  it('exhaustion is per-capability (one capability does not affect another)', () => {
    tracker.markExhausted('res1', 'text');
    expect(tracker.isExhausted('res1', 'text')).toBe(true);
    expect(tracker.isExhausted('res1', 'image')).toBe(false);
  });

  it('exhaustion is per-resource (one resource does not affect another)', () => {
    tracker.markExhausted('res1', 'video');
    expect(tracker.isExhausted('res1', 'video')).toBe(true);
    expect(tracker.isExhausted('res2', 'video')).toBe(false);
  });

  it('reset() clears a specific resource-capability pair', () => {
    tracker.markExhausted('res1', 'text');
    tracker.reset('res1', 'text');
    expect(tracker.isExhausted('res1', 'text')).toBe(false);
  });

  it('resetAll() clears all exhausted states', () => {
    tracker.markExhausted('res1', 'text');
    tracker.markExhausted('res2', 'image');
    tracker.resetAll();
    expect(tracker.isExhausted('res1', 'text')).toBe(false);
    expect(tracker.isExhausted('res2', 'image')).toBe(false);
  });

  it('auto-resets when resetWindowMs has elapsed', () => {
    tracker.resetWindowMs = 1; // 1 ms window
    tracker.markExhausted('res1', 'text');
    // Advance time by overwriting exhaustedAt directly via a second mark
    return new Promise<void>((resolve) => {
      setTimeout(() => {
        // After > 1 ms the tracker should auto-reset
        expect(tracker.isExhausted('res1', 'text')).toBe(false);
        resolve();
      }, 10);
    });
  });

  it('does not auto-reset when resetWindowMs = 0', () => {
    tracker.resetWindowMs = 0;
    tracker.markExhausted('res1', 'text');
    expect(tracker.isExhausted('res1', 'text')).toBe(true);
  });

  describe('availableCount', () => {
    it('returns total resources with the capability when none exhausted', () => {
      const resources = [
        makeResource('a', 'gemini', { text: true, video: true }),
        makeResource('b', 'gemini', { text: true, video: true }),
      ];
      expect(tracker.availableCount(resources, 'video')).toBe(2);
    });

    it('excludes resources where quotaExhausted flag is set on the resource itself', () => {
      const resources = [
        makeResource('a', 'gemini', { video: true }, false),
        makeResource('b', 'gemini', { video: true }, true), // resource-level flag
      ];
      expect(tracker.availableCount(resources, 'video')).toBe(1);
    });

    it('excludes resources tracked as exhausted in the tracker', () => {
      const resources = [
        makeResource('a', 'gemini', { text: true }),
        makeResource('b', 'gemini', { text: true }),
      ];
      tracker.markExhausted('a', 'text');
      expect(tracker.availableCount(resources, 'text')).toBe(1);
    });

    it('excludes resources that do not have the requested capability', () => {
      const resources = [
        makeResource('a', 'gemini', { text: true }),
        makeResource('b', 'gemini', { image: true }),
      ];
      expect(tracker.availableCount(resources, 'video')).toBe(0);
    });
  });

  describe('allExhausted', () => {
    it('returns true when no resources have the capability', () => {
      const resources = [makeResource('a', 'gemini', { text: true })];
      expect(tracker.allExhausted(resources, 'video')).toBe(true);
    });

    it('returns false when at least one resource is available', () => {
      const resources = [
        makeResource('a', 'gemini', { video: true }),
        makeResource('b', 'gemini', { video: true }),
      ];
      tracker.markExhausted('a', 'video');
      expect(tracker.allExhausted(resources, 'video')).toBe(false);
    });

    it('returns true when all resources are tracker-exhausted', () => {
      const resources = [
        makeResource('a', 'gemini', { text: true }),
        makeResource('b', 'gemini', { text: true }),
      ];
      tracker.markExhausted('a', 'text');
      tracker.markExhausted('b', 'text');
      expect(tracker.allExhausted(resources, 'text')).toBe(true);
    });
  });
});

/* ---- tryWithRotation ---- */

describe('tryWithRotation', () => {
  beforeEach(() => {
    quotaBus.resetAll();
  });

  it('returns the result from the first successful attempt', async () => {
    const resourceA = makeResource('a', 'gemini', { text: true });
    const mockManager = {
      pickResource: vi.fn().mockReturnValueOnce(resourceA).mockReturnValue(undefined),
      markQuotaExhausted: vi.fn(),
    };

    const result = await tryWithRotation({
      resourceManager: mockManager as any,
      capability: 'text',
      operation: async (r) => `value-${r.id}`,
    });

    expect(result).not.toBeNull();
    expect(result!.result).toBe('value-a');
    expect(result!.resource).toBe(resourceA);
    expect(mockManager.markQuotaExhausted).not.toHaveBeenCalled();
  });

  it('returns null when no resources are available', async () => {
    const mockManager = {
      pickResource: vi.fn().mockReturnValue(undefined),
      markQuotaExhausted: vi.fn(),
    };

    const result = await tryWithRotation({
      resourceManager: mockManager as any,
      capability: 'image',
      operation: async () => 'value',
    });

    expect(result).toBeNull();
  });

  it('skips quota-exhausted resources and tries the next one', async () => {
    const resourceA = makeResource('a', 'gemini', { text: true });
    const resourceB = makeResource('b', 'gemini', { text: true });
    let callCount = 0;
    const mockManager = {
      pickResource: vi.fn()
        .mockReturnValueOnce(resourceA)
        .mockReturnValueOnce(resourceB)
        .mockReturnValue(undefined),
      markQuotaExhausted: vi.fn(),
    };

    const result = await tryWithRotation({
      resourceManager: mockManager as any,
      capability: 'text',
      operation: async (r) => {
        callCount++;
        if (r.id === 'a') {
          const err: any = new Error('quota exceeded');
          err.isQuotaError = true;
          throw err;
        }
        return `value-${r.id}`;
      },
    });

    expect(result).not.toBeNull();
    expect(result!.result).toBe('value-b');
    expect(mockManager.markQuotaExhausted).toHaveBeenCalledWith('a');
    expect(callCount).toBe(2);
  });

  it('returns null when all resources are quota-exhausted', async () => {
    const resourceA = makeResource('a');
    const mockManager = {
      pickResource: vi.fn().mockReturnValueOnce(resourceA).mockReturnValue(undefined),
      markQuotaExhausted: vi.fn(),
    };

    const result = await tryWithRotation({
      resourceManager: mockManager as any,
      capability: 'text',
      operation: async () => {
        const err: any = new Error('quota exceeded');
        err.isQuotaError = true;
        throw err;
      },
    });

    expect(result).toBeNull();
    expect(mockManager.markQuotaExhausted).toHaveBeenCalledWith('a');
  });

  it('propagates non-quota errors immediately without trying other resources', async () => {
    const resourceA = makeResource('a');
    const mockManager = {
      pickResource: vi.fn().mockReturnValue(resourceA),
      markQuotaExhausted: vi.fn(),
    };

    await expect(
      tryWithRotation({
        resourceManager: mockManager as any,
        capability: 'text',
        operation: async () => {
          throw new Error('unexpected network failure');
        },
      }),
    ).rejects.toThrow('unexpected network failure');

    expect(mockManager.markQuotaExhausted).not.toHaveBeenCalled();
  });

  it('does not retry the same resource twice (deduplication)', async () => {
    const resourceA = makeResource('a');
    const mockManager = {
      // Always returns the same resource
      pickResource: vi.fn().mockReturnValue(resourceA),
      markQuotaExhausted: vi.fn(),
    };

    const result = await tryWithRotation({
      resourceManager: mockManager as any,
      capability: 'text',
      operation: async () => {
        const err: any = new Error('quota');
        err.isQuotaError = true;
        throw err;
      },
    });

    expect(result).toBeNull();
    // Operation should only have been called once (dedup breaks the loop)
    expect(mockManager.markQuotaExhausted).toHaveBeenCalledTimes(1);
  });

  it('uses a custom isQuotaErr predicate when provided', async () => {
    const resourceA = makeResource('a');
    const resourceB = makeResource('b');
    const mockManager = {
      pickResource: vi.fn()
        .mockReturnValueOnce(resourceA)
        .mockReturnValueOnce(resourceB)
        .mockReturnValue(undefined),
      markQuotaExhausted: vi.fn(),
    };

    const result = await tryWithRotation({
      resourceManager: mockManager as any,
      capability: 'text',
      isQuotaErr: (err) => (err as any).code === 'MY_QUOTA',
      operation: async (r) => {
        if (r.id === 'a') {
          const err: any = new Error('custom quota');
          err.code = 'MY_QUOTA';
          throw err;
        }
        return 'ok';
      },
    });

    expect(result!.result).toBe('ok');
    expect(mockManager.markQuotaExhausted).toHaveBeenCalledWith('a');
  });
});
