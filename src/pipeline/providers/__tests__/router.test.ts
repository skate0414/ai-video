import { describe, it, expect, beforeEach } from 'vitest';
import { PluginRegistry } from '../registry.js';
import { resolvePlugin } from '../router.js';
import type { ProviderPlugin } from '../types.js';

/* ---- Helper ---- */

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

describe('resolvePlugin', () => {
  let registry: PluginRegistry;

  beforeEach(() => {
    registry = new PluginRegistry();
  });

  it('returns user override as __override__ pluginId', () => {
    registry.register(makePlugin({ id: 'p1' }));
    const decision = resolvePlugin('RESEARCH', 'fact_research', registry, {
      fact_research: { adapter: 'api', model: 'custom-model', provider: 'custom' },
    });

    expect(decision.pluginId).toBe('__override__');
    expect(decision.adapter).toBe('api');
    expect(decision.model).toBe('custom-model');
    expect(decision.provider).toBe('custom');
  });

  it('falls back to legacy routing when no plugins match', () => {
    // Empty registry — no plugins can handle video_generation
    const decision = resolvePlugin('VIDEO_GEN', 'video_generation', registry);

    expect(decision.pluginId).toBe('__legacy__');
    expect(decision.adapter).toBeDefined();
  });

  it('selects highest-scored plugin', () => {
    registry.register(makePlugin({
      id: 'generic',
      capabilities: { text: true, imageGeneration: true, videoGeneration: false, tts: false, fileUpload: false, webSearch: false },
    }));
    registry.register(makePlugin({
      id: 'specialist',
      capabilities: { text: true, imageGeneration: true, videoGeneration: false, tts: false, fileUpload: false, webSearch: false },
      routing: [{
        stages: ['REFERENCE_IMAGE'],
        taskTypes: ['image_generation'],
        priority: 10,
      }],
    }));

    const decision = resolvePlugin('REFERENCE_IMAGE', 'image_generation', registry);
    expect(decision.pluginId).toBe('specialist');
  });

  it('resolves model from routing rule', () => {
    registry.register(makePlugin({
      id: 'with-model',
      routing: [{
        stages: ['RESEARCH'],
        taskTypes: ['fact_research'],
        defaultModel: 'my-model-v2',
      }],
    }));

    const decision = resolvePlugin('RESEARCH', 'fact_research', registry);
    expect(decision.model).toBe('my-model-v2');
  });

  it('swaps to next candidate when primary is quota-exhausted', () => {
    registry.register(makePlugin({
      id: 'primary',
      costTier: 'free',
      routing: [{ taskTypes: ['fact_research'], priority: 10 }],
    }));
    registry.register(makePlugin({
      id: 'secondary',
      costTier: 'free',
    }));

    registry.markQuotaExhausted('primary');

    const decision = resolvePlugin('RESEARCH', 'fact_research', registry);
    // findForTask scores the exhausted 'primary' at -1000 penalty,
    // so 'secondary' (non-exhausted) becomes the top candidate.
    expect(decision.pluginId).toBe('secondary');
  });

  it('does not provide fallback', () => {
    registry.register(makePlugin({ id: 'free-1', costTier: 'free' }));
    registry.register(makePlugin({ id: 'paid-1', costTier: 'paid', adapterType: 'api' }));

    const decision = resolvePlugin('RESEARCH', 'fact_research', registry);
    expect(decision.fallbackPluginId).toBeUndefined();
  });
});
