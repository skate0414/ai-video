import { describe, it, expect, vi } from 'vitest';
import { FallbackAdapter, FallbackBlockedError } from './fallbackAdapter.js';
import type { AIAdapter, GenerationResult } from '../pipeline/types.js';

function createMockAdapter(name: string, overrides?: Partial<AIAdapter>): AIAdapter {
  return {
    provider: name,
    generateText: vi.fn(async () => ({ text: `${name}-text` })),
    generateImage: vi.fn(async () => ({ text: `${name}-image` })),
    generateVideo: vi.fn(async () => ({ text: `${name}-video` })),
    ...overrides,
  };
}

function createQuotaError(message = 'quota exceeded'): Error {
  const err = new Error(message) as any;
  err.isQuotaError = true;
  return err;
}

function create429Error(): Error {
  const err = new Error('Too Many Requests') as any;
  err.status = 429;
  return err;
}

describe('FallbackAdapter', () => {
  describe('provider label', () => {
    it('composes provider name from primary and fallback', () => {
      const primary = createMockAdapter('primary');
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback);
      expect(adapter.provider).toBe('fallback(primary→fallback)');
    });
  });

  describe('generateText', () => {
    it('uses primary adapter on success', async () => {
      const primary = createMockAdapter('primary');
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback);

      const result = await adapter.generateText('model', 'prompt');
      expect(result.text).toBe('primary-text');
      expect(primary.generateText).toHaveBeenCalledOnce();
      expect(fallback.generateText).not.toHaveBeenCalled();
    });

    it('falls back on quota error', async () => {
      const primary = createMockAdapter('primary', {
        generateText: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback);

      const result = await adapter.generateText('model', 'prompt');
      expect(result.text).toBe('fallback-text');
      expect(fallback.generateText).toHaveBeenCalledOnce();
    });

    it('falls back on 429 error', async () => {
      const primary = createMockAdapter('primary', {
        generateText: vi.fn(async () => { throw create429Error(); }),
      });
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback);

      const result = await adapter.generateText('model', 'prompt');
      expect(result.text).toBe('fallback-text');
    });

    it('throws non-quota errors without falling back', async () => {
      const primary = createMockAdapter('primary', {
        generateText: vi.fn(async () => { throw new Error('network error'); }),
      });
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback);

      await expect(adapter.generateText('model', 'prompt')).rejects.toThrow('network error');
      expect(fallback.generateText).not.toHaveBeenCalled();
    });
  });

  describe('generateImage', () => {
    it('uses primary adapter on success', async () => {
      const primary = createMockAdapter('primary');
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback);

      const result = await adapter.generateImage('model', 'prompt');
      expect(result.text).toBe('primary-image');
    });

    it('falls back on quota error', async () => {
      const primary = createMockAdapter('primary', {
        generateImage: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback);

      const result = await adapter.generateImage('model', 'prompt');
      expect(result.text).toBe('fallback-image');
    });
  });

  describe('generateVideo', () => {
    it('uses primary adapter on success', async () => {
      const primary = createMockAdapter('primary');
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback);

      const result = await adapter.generateVideo('model', 'prompt');
      expect(result.text).toBe('primary-video');
    });

    it('falls back on quota error', async () => {
      const primary = createMockAdapter('primary', {
        generateVideo: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback);

      const result = await adapter.generateVideo('model', 'prompt');
      expect(result.text).toBe('fallback-video');
    });
  });

  describe('generateSpeech', () => {
    it('uses primary generateSpeech on success', async () => {
      const primary = createMockAdapter('primary', {
        generateSpeech: vi.fn(async () => ({ audioUrl: '/primary.mp3' })),
      });
      const fallback = createMockAdapter('fallback', {
        generateSpeech: vi.fn(async () => ({ audioUrl: '/fallback.mp3' })),
      });
      const adapter = new FallbackAdapter(primary, fallback);

      const result = await adapter.generateSpeech('Hello', 'voice1');
      expect(result.audioUrl).toBe('/primary.mp3');
    });

    it('falls back on quota error', async () => {
      const primary = createMockAdapter('primary', {
        generateSpeech: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback', {
        generateSpeech: vi.fn(async () => ({ audioUrl: '/fallback.mp3' })),
      });
      const adapter = new FallbackAdapter(primary, fallback);

      const result = await adapter.generateSpeech('Hello', 'voice1');
      expect(result.audioUrl).toBe('/fallback.mp3');
    });

    it('uses fallback when primary lacks generateSpeech', async () => {
      const primary = createMockAdapter('primary');
      // primary has no generateSpeech
      const fallback = createMockAdapter('fallback', {
        generateSpeech: vi.fn(async () => ({ audioUrl: '/fallback.mp3' })),
      });
      const adapter = new FallbackAdapter(primary, fallback);

      const result = await adapter.generateSpeech('Hello');
      expect(result.audioUrl).toBe('/fallback.mp3');
    });

    it('throws when neither adapter supports generateSpeech', async () => {
      const primary = createMockAdapter('primary');
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback);

      await expect(adapter.generateSpeech('Hello')).rejects.toThrow('Neither primary nor fallback');
    });
  });

  describe('uploadFile', () => {
    it('uses primary uploadFile on success', async () => {
      const primary = createMockAdapter('primary', {
        uploadFile: vi.fn(async () => ({ uri: 'primary://file', mimeType: 'text/plain' })),
      });
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback);

      const result = await adapter.uploadFile({ name: 'test.txt', path: '/tmp/test.txt', mimeType: 'text/plain' });
      expect(result.uri).toBe('primary://file');
    });

    it('falls back on quota error', async () => {
      const primary = createMockAdapter('primary', {
        uploadFile: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback', {
        uploadFile: vi.fn(async () => ({ uri: 'fallback://file', mimeType: 'text/plain' })),
      });
      const adapter = new FallbackAdapter(primary, fallback);

      const result = await adapter.uploadFile({ name: 'test.txt', path: '/tmp/test.txt', mimeType: 'text/plain' });
      expect(result.uri).toBe('fallback://file');
    });

    it('throws when neither adapter supports uploadFile', async () => {
      const primary = createMockAdapter('primary');
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback);

      await expect(adapter.uploadFile({ name: 'f', path: '/f', mimeType: 'x' })).rejects.toThrow('Neither primary nor fallback');
    });
  });

  describe('fallback policy', () => {
    it('policy=block throws FallbackBlockedError instead of falling back', async () => {
      const primary = createMockAdapter('primary', {
        generateText: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback, { policy: 'block' });

      await expect(adapter.generateText('model', 'prompt')).rejects.toThrow(FallbackBlockedError);
      expect(fallback.generateText).not.toHaveBeenCalled();
    });

    it('policy=confirm calls confirmFn and proceeds when approved', async () => {
      const primary = createMockAdapter('primary', {
        generateText: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback');
      const confirmFn = vi.fn(async () => true);
      const adapter = new FallbackAdapter(primary, fallback, { policy: 'confirm', confirmFn });

      const result = await adapter.generateText('model', 'prompt');
      expect(confirmFn).toHaveBeenCalledOnce();
      expect(result.text).toBe('fallback-text');
    });

    it('policy=confirm throws FallbackBlockedError when user declines', async () => {
      const primary = createMockAdapter('primary', {
        generateText: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback');
      const confirmFn = vi.fn(async () => false);
      const adapter = new FallbackAdapter(primary, fallback, { policy: 'confirm', confirmFn });

      await expect(adapter.generateText('model', 'prompt')).rejects.toThrow(FallbackBlockedError);
      expect(fallback.generateText).not.toHaveBeenCalled();
    });

    it('policy=auto falls back silently (legacy behaviour)', async () => {
      const primary = createMockAdapter('primary', {
        generateText: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback, { policy: 'auto' });

      const result = await adapter.generateText('model', 'prompt');
      expect(result.text).toBe('fallback-text');
    });

    it('onFallback listener is called on quota error', async () => {
      const primary = createMockAdapter('primary', {
        generateText: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback');
      const onFallback = vi.fn();
      const adapter = new FallbackAdapter(primary, fallback, { policy: 'auto', onFallback });

      await adapter.generateText('model', 'prompt');
      expect(onFallback).toHaveBeenCalledOnce();
      expect(onFallback.mock.calls[0][0]).toMatchObject({
        type: 'fallback_triggered',
        primaryProvider: 'primary',
        fallbackProvider: 'fallback',
        method: 'generateText',
      });
    });

    it('tracks fallbackCount and fallbackCostUsd', async () => {
      const primary = createMockAdapter('primary', {
        generateText: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback, { policy: 'auto' });

      await adapter.generateText('model', 'prompt');
      await adapter.generateText('model', 'prompt2');
      expect(adapter.fallbackCount).toBe(2);
      expect(adapter.fallbackCostUsd).toBeGreaterThan(0);
    });

    it('budgetChecker blocks fallback when budget exhausted', async () => {
      const primary = createMockAdapter('primary', {
        generateText: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback, {
        policy: 'auto',
        budgetChecker: () => ({
          withinBudget: false,
          currentCostUsd: 10,
          maxBudgetUsd: 5,
          remainingUsd: 0,
        }),
      });

      await expect(adapter.generateText('model', 'prompt')).rejects.toThrow(FallbackBlockedError);
      expect(fallback.generateText).not.toHaveBeenCalled();
    });

    it('budgetChecker blocks fallback when remaining < estimated cost', async () => {
      const primary = createMockAdapter('primary', {
        generateVideo: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback, {
        policy: 'auto',
        budgetChecker: () => ({
          withinBudget: true,
          currentCostUsd: 4.95,
          maxBudgetUsd: 5,
          remainingUsd: 0.05, // $0.05 remaining but generateVideo costs $0.10
        }),
      });

      await expect(adapter.generateVideo('model', 'prompt')).rejects.toThrow(FallbackBlockedError);
      expect(fallback.generateVideo).not.toHaveBeenCalled();
    });

    it('budgetChecker allows fallback when sufficient budget remains', async () => {
      const primary = createMockAdapter('primary', {
        generateText: vi.fn(async () => { throw createQuotaError(); }),
      });
      const fallback = createMockAdapter('fallback');
      const adapter = new FallbackAdapter(primary, fallback, {
        policy: 'auto',
        budgetChecker: () => ({
          withinBudget: true,
          currentCostUsd: 1,
          maxBudgetUsd: 100,
          remainingUsd: 99,
        }),
      });

      const result = await adapter.generateText('model', 'prompt');
      expect(result.text).toBe('fallback-text');
    });
  });
});
