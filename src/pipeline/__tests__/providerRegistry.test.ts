import { describe, it, expect, beforeEach } from 'vitest';
import { ProviderCapabilityRegistry } from '../providerRegistry.js';

describe('ProviderCapabilityRegistry', () => {
  let registry: ProviderCapabilityRegistry;

  beforeEach(() => {
    registry = new ProviderCapabilityRegistry();
  });

  it('seeds with built-in providers on construction', () => {
    const gemini = registry.get('gemini');
    expect(gemini).toBeDefined();
    expect(gemini!.text).toBe(true);
    expect(gemini!.imageGeneration).toBe(true);
    expect(gemini!.webSearch).toBe(true);
  });

  it('getAll returns all providers', () => {
    const all = registry.getAll();
    expect(all.length).toBeGreaterThanOrEqual(4);
    const ids = all.map(p => p.providerId);
    expect(ids).toContain('gemini');
    expect(ids).toContain('chatgpt');
    expect(ids).toContain('deepseek');
  });

  it('register adds a new provider', () => {
    registry.register('claude', {
      text: true,
      imageGeneration: false,
      fileUpload: true,
    });
    const claude = registry.get('claude');
    expect(claude).toBeDefined();
    expect(claude!.text).toBe(true);
    expect(claude!.imageGeneration).toBe(false);
    expect(claude!.fileUpload).toBe(true);
  });

  it('register updates existing provider', () => {
    registry.register('gemini', { quotaExhausted: true });
    const gemini = registry.get('gemini');
    expect(gemini!.quotaExhausted).toBe(true);
    expect(gemini!.text).toBe(true); // unchanged
  });

  it('markQuotaExhausted sets flag', () => {
    registry.markQuotaExhausted('gemini');
    expect(registry.get('gemini')!.quotaExhausted).toBe(true);
  });

  it('resetQuota clears flag', () => {
    registry.markQuotaExhausted('gemini');
    registry.resetQuota('gemini');
    expect(registry.get('gemini')!.quotaExhausted).toBe(false);
  });

  it('findProviders returns matching providers', () => {
    const imageProviders = registry.findProviders({ imageGeneration: true });
    expect(imageProviders.length).toBeGreaterThanOrEqual(1);
    expect(imageProviders.every(p => p.imageGeneration)).toBe(true);
  });

  it('findProviders sorts non-exhausted first', () => {
    registry.markQuotaExhausted('gemini');
    const providers = registry.findProviders({ text: true });
    const geminiIdx = providers.findIndex(p => p.providerId === 'gemini');
    // Gemini should be at the end since it's exhausted
    expect(geminiIdx).toBe(providers.length - 1);
  });

  it('findProviders filters by multiple requirements', () => {
    const results = registry.findProviders({ text: true, webSearch: true, fileUpload: true });
    // Gemini and chatgpt should match; deepseek does not have fileUpload
    const ids = results.map(r => r.providerId);
    expect(ids).toContain('gemini');
    expect(ids).not.toContain('deepseek');
  });

  it('toJSON serializes all providers', () => {
    const json = registry.toJSON();
    expect(json.gemini).toBeDefined();
    expect(json.gemini.text).toBe(true);
  });
});
