import { describe, it, expect, vi } from 'vitest';
import { resolvePlugin } from './router.js';
import { PluginRegistry } from './registry.js';
import type { ProviderPlugin } from './types.js';

function makePlugin(overrides: Partial<ProviderPlugin> = {}): ProviderPlugin {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    adapterType: 'chat',
    capabilities: { text: true, imageGeneration: false, videoGeneration: false, webSearch: false, fileUpload: false, tts: false },
    costTier: 'free',
    routing: [{ taskTypes: ['text', 'script_generation'] }],
    createAdapter: () => undefined,
    ...overrides,
  };
}

describe('resolvePlugin', () => {
  it('returns user override when present', () => {
    const registry = new PluginRegistry();
    const decision = resolvePlugin('SCRIPT_GENERATION', 'script_generation', registry, {
      script_generation: { adapter: 'api', provider: 'openai', model: 'gpt-4' },
    } as any);
    expect(decision.pluginId).toBe('__override__');
    expect(decision.adapter).toBe('api');
    expect(decision.model).toBe('gpt-4');
    expect(decision.reason).toContain('User override');
  });

  it('falls back to legacy routing when no plugins registered', () => {
    const registry = new PluginRegistry();
    const decision = resolvePlugin('RESEARCH', 'fact_research', registry);
    expect(decision.pluginId).toBe('__legacy__');
    expect(decision.reason).toBeDefined();
  });

  it('selects registered plugin when available', () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin({
      id: 'gemini-chat',
      name: 'Gemini Chat',
      routing: [{ taskTypes: ['text', 'fact_research'], defaultModel: 'gemini-2.0-flash' }],
    });
    registry.register(plugin);
    const decision = resolvePlugin('RESEARCH', 'fact_research', registry);
    expect(decision.pluginId).toBe('gemini-chat');
    expect(decision.model).toBe('gemini-2.0-flash');
    expect(decision.reason).toContain('Gemini Chat');
  });

  it('resolves model from routing rules matching stage', () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin({
      id: 'chatgpt',
      name: 'ChatGPT',
      routing: [
        { stages: ['SCRIPT_GENERATION'], defaultModel: 'gpt-4o' },
        { stages: ['RESEARCH'], defaultModel: 'gpt-4-turbo' },
      ],
    });
    registry.register(plugin);
    const decision = resolvePlugin('SCRIPT_GENERATION', 'script_generation', registry);
    expect(decision.model).toBe('gpt-4o');
  });

  it('returns undefined model when no routing rules match', () => {
    const registry = new PluginRegistry();
    const plugin = makePlugin({
      id: 'simple',
      name: 'Simple',
      routing: [{ stages: ['QA_REVIEW'], taskTypes: ['text'], defaultModel: 'gpt-4' }],
    });
    registry.register(plugin);
    const decision = resolvePlugin('RESEARCH', 'text', registry);
    // RESEARCH stage not in QA_REVIEW routing → no model match
    expect(decision.model).toBeUndefined();
  });

  it('returns legacy adapter type and reason', () => {
    const registry = new PluginRegistry();
    const decision = resolvePlugin('TTS', 'tts', registry);
    expect(decision.pluginId).toBe('__legacy__');
    expect(decision.adapter).toBeDefined();
  });
});
