/* ------------------------------------------------------------------ */
/*  Tests: qualityRouter – pure routing functions                     */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import { routeTask, selectAdapter, resolveProvider, DEFAULT_ROUTES } from '../qualityRouter.js';
import { ProviderCapabilityRegistry } from '../providerRegistry.js';
import type { AIAdapter } from '../types.js';

const mockChat: AIAdapter = { provider: 'chat', generateText: async () => ({ text: '' }), generateImage: async () => ({ text: '' }), generateVideo: async () => ({ text: '' }) };
const mockApi: AIAdapter = { provider: 'api', generateText: async () => ({ text: '' }), generateImage: async () => ({ text: '' }), generateVideo: async () => ({ text: '' }) };

describe('routeTask', () => {
  it('returns default route for known task types', () => {
    const decision = routeTask('RESEARCH', 'fact_research');
    expect(decision.adapter).toBe('chat');
    expect(decision.provider).toBe('chatgpt');
  });

  it('returns fallback for unknown task type', () => {
    const decision = routeTask('RESEARCH', 'unknown_task_xyz');
    expect(decision.adapter).toBe('chat');
    expect(decision.reason).toContain('Default');
  });

  it('preferrs user override when provided', () => {
    const decision = routeTask('RESEARCH', 'fact_research', {
      fact_research: { adapter: 'api', model: 'custom-model', provider: 'custom-prov' },
    });
    expect(decision.adapter).toBe('api');
    expect(decision.model).toBe('custom-model');
    expect(decision.provider).toBe('custom-prov');
    expect(decision.reason).toContain('User override');
  });

  it('video_generation defaults to API adapter', () => {
    const decision = routeTask('VIDEO_GEN', 'video_generation');
    expect(decision.adapter).toBe('api');
  });
});

describe('selectAdapter', () => {
  it('returns chatAdapter for chat decisions', () => {
    const adapter = selectAdapter({ adapter: 'chat', reason: 'test' }, mockChat, mockApi);
    expect(adapter).toBe(mockChat);
  });

  it('returns apiAdapter for API decisions when available', () => {
    const adapter = selectAdapter({ adapter: 'api', reason: 'test' }, mockChat, mockApi);
    expect(adapter).toBe(mockApi);
  });

  it('falls back to chatAdapter when API requested but no apiAdapter', () => {
    const adapter = selectAdapter({ adapter: 'api', reason: 'test' }, mockChat);
    expect(adapter).toBe(mockChat);
  });
});

describe('resolveProvider', () => {
  it('returns default decision when provider is available in registry', () => {
    const registry = new ProviderCapabilityRegistry();
    registry.seedFromAccounts([{ provider: 'chatgpt', profileDir: '' }]);
    const decision = resolveProvider('RESEARCH', 'fact_research', registry);
    expect(decision.provider).toBe('chatgpt');
  });

  it('falls back to alternative provider when preferred is exhausted', () => {
    const registry = new ProviderCapabilityRegistry();
    registry.seedFromAccounts([
      { provider: 'chatgpt', profileDir: '', quotaExhausted: true },
      { provider: 'gemini', profileDir: '' },
    ]);
    const decision = resolveProvider('RESEARCH', 'fact_research', registry);
    // chatgpt is exhausted, should fall back to gemini (has webSearch)
    expect(decision.provider).toBe('gemini');
    expect(decision.reason).toContain('配额已用完');
  });

  it('keeps API decision unchanged', () => {
    const registry = new ProviderCapabilityRegistry();
    const decision = resolveProvider('VIDEO_GEN', 'video_generation', registry);
    expect(decision.adapter).toBe('api');
  });

  it('keeps user override unchanged', () => {
    const registry = new ProviderCapabilityRegistry();
    const decision = resolveProvider('RESEARCH', 'fact_research', registry, {
      fact_research: { adapter: 'chat', model: 'my-model' },
    });
    expect(decision.model).toBe('my-model');
  });

  it('returns default when provider not in registry and no alternatives', () => {
    const registry = new ProviderCapabilityRegistry();
    // Empty registry — no providers registered
    const decision = resolveProvider('RESEARCH', 'fact_research', registry);
    // Should still return default since no alternative found
    expect(decision.adapter).toBe('chat');
  });
});

describe('DEFAULT_ROUTES', () => {
  it('is frozen', () => {
    expect(Object.isFrozen(DEFAULT_ROUTES)).toBe(true);
  });

  it('has entries for core task types', () => {
    expect(DEFAULT_ROUTES.fact_research).toBeDefined();
    expect(DEFAULT_ROUTES.script_generation).toBeDefined();
    expect(DEFAULT_ROUTES.image_generation).toBeDefined();
    expect(DEFAULT_ROUTES.video_generation).toBeDefined();
    expect(DEFAULT_ROUTES.tts).toBeDefined();
  });
});
