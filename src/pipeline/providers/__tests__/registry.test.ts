import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from '../registry.js';
import type { ProviderPlugin, PluginDeps } from '../types.js';

/* ---- Helpers ---- */

function makePlugin(overrides: Partial<ProviderPlugin> & { id: string }): ProviderPlugin {
  return {
    name: overrides.id,
    adapterType: 'chat',
    capabilities: {
      text: true,
      imageGeneration: false,
      videoGeneration: false,
      tts: false,
      fileUpload: false,
      webSearch: false,
    },
    costTier: 'free',
    createAdapter: () => undefined,
    ...overrides,
  };
}

const mockAdapter = {
  provider: 'test',
  generateText: async () => ({ text: 'ok' }),
  generateImage: async () => ({ text: 'ok' }),
  generateVideo: async () => ({ text: 'ok' }),
};

/* ---- Tests ---- */

describe('PluginRegistry', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  describe('register / get / getAll', () => {
    it('registers and retrieves a plugin by id', () => {
      const p = makePlugin({ id: 'test-1' });
      registry.register(p);

      expect(registry.get('test-1')).toBe(p);
      expect(registry.getAll()).toHaveLength(1);
    });

    it('overwrites plugin with same id', () => {
      registry.register(makePlugin({ id: 'dup', name: 'first' }));
      registry.register(makePlugin({ id: 'dup', name: 'second' }));

      expect(registry.get('dup')?.name).toBe('second');
      expect(registry.getAll()).toHaveLength(1);
    });

    it('returns undefined for unknown id', () => {
      expect(registry.get('nonexistent')).toBeUndefined();
    });
  });

  describe('findForTask', () => {
    it('filters by required capability', () => {
      registry.register(makePlugin({ id: 'text-only', capabilities: { text: true, imageGeneration: false, videoGeneration: false, tts: false, fileUpload: false, webSearch: false } }));
      registry.register(makePlugin({ id: 'img', capabilities: { text: false, imageGeneration: true, videoGeneration: false, tts: false, fileUpload: false, webSearch: false } }));

      const results = registry.findForTask('REFERENCE_IMAGE', 'image_generation');
      expect(results).toHaveLength(1);
      expect(results[0].plugin.id).toBe('img');
    });

    it('scores routing rule matches higher', () => {
      registry.register(makePlugin({
        id: 'generic',
        capabilities: { text: true, imageGeneration: true, videoGeneration: false, tts: false, fileUpload: false, webSearch: false },
      }));
      registry.register(makePlugin({
        id: 'specialized',
        capabilities: { text: true, imageGeneration: true, videoGeneration: false, tts: false, fileUpload: false, webSearch: false },
        routing: [{
          stages: ['REFERENCE_IMAGE'],
          taskTypes: ['image_generation'],
          priority: 10,
        }],
      }));

      const results = registry.findForTask('REFERENCE_IMAGE', 'image_generation');
      expect(results[0].plugin.id).toBe('specialized');
    });

    it('penalizes quota-exhausted plugins', () => {
      registry.register(makePlugin({ id: 'p1' }));
      registry.register(makePlugin({ id: 'p2' }));
      registry.markQuotaExhausted('p1');

      const results = registry.findForTask('RESEARCH', 'fact_research');
      expect(results[0].plugin.id).toBe('p2');
      expect(results[1].plugin.id).toBe('p1');
      expect(results[1].quotaExhausted).toBe(true);
    });

    it('prefers free plugins', () => {
      registry.register(makePlugin({ id: 'paid', costTier: 'paid' }));
      registry.register(makePlugin({ id: 'free', costTier: 'free' }));

      const results = registry.findForTask('RESEARCH', 'fact_research');
      expect(results[0].plugin.id).toBe('free');
    });

    it('returns empty array when no plugin has required capability', () => {
      registry.register(makePlugin({
        id: 'text-only',
        capabilities: { text: true, imageGeneration: false, videoGeneration: false, tts: false, fileUpload: false, webSearch: false },
      }));

      const results = registry.findForTask('VIDEO_GEN', 'video_generation');
      expect(results).toHaveLength(0);
    });

    it('handles unknown task type by defaulting to text capability', () => {
      registry.register(makePlugin({ id: 'p1' }));
      const results = registry.findForTask('ASSEMBLY', 'unknown_task');
      expect(results).toHaveLength(1);
    });
  });

  describe('createAdapter', () => {
    it('delegates to plugin factory', () => {
      registry.register(makePlugin({
        id: 'factory-test',
        createAdapter: () => mockAdapter,
      }));

      const adapter = registry.createAdapter('factory-test', {} as PluginDeps);
      expect(adapter).toBe(mockAdapter);
    });

    it('returns undefined for unknown plugin', () => {
      expect(registry.createAdapter('nope', {} as PluginDeps)).toBeUndefined();
    });
  });

  describe('quota management', () => {
    it('marks and resets quota', () => {
      registry.register(makePlugin({ id: 'q1' }));

      expect(registry.getState('q1')?.quotaExhausted).toBe(false);

      registry.markQuotaExhausted('q1');
      expect(registry.getState('q1')?.quotaExhausted).toBe(true);

      registry.resetQuota('q1');
      expect(registry.getState('q1')?.quotaExhausted).toBe(false);
    });

    it('resetAllQuotas resets all plugins', () => {
      registry.register(makePlugin({ id: 'a' }));
      registry.register(makePlugin({ id: 'b' }));
      registry.markQuotaExhausted('a');
      registry.markQuotaExhausted('b');

      registry.resetAllQuotas();

      expect(registry.getState('a')?.quotaExhausted).toBe(false);
      expect(registry.getState('b')?.quotaExhausted).toBe(false);
    });

    it('no-ops for unknown plugin ids', () => {
      // Should not throw
      registry.markQuotaExhausted('ghost');
      registry.resetQuota('ghost');
    });
  });

  describe('toJSON', () => {
    it('serializes all plugins with state', () => {
      registry.register(makePlugin({ id: 'p1', costTier: 'free', models: ['m1'] }));
      registry.register(makePlugin({ id: 'p2', costTier: 'paid' }));
      registry.markQuotaExhausted('p2');

      const json = registry.toJSON();

      expect(json.p1.quotaExhausted).toBe(false);
      expect(json.p1.costTier).toBe('free');
      expect(json.p1.models).toEqual(['m1']);
      expect(json.p2.quotaExhausted).toBe(true);
      expect(json.p2.costTier).toBe('paid');
    });
  });
});
