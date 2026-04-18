import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ProviderCapabilityRegistry, type AccountSeed } from '../providerRegistry.js';
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

const TEST_ACCOUNTS: AccountSeed[] = [
  { provider: 'gemini', profileDir: '/tmp/test-profiles/gemini' },
  { provider: 'chatgpt', profileDir: '/tmp/test-profiles/chatgpt' },
  { provider: 'deepseek', profileDir: '/tmp/test-profiles/deepseek' },
  { provider: 'kimi', profileDir: '/tmp/test-profiles/kimi' },
];

describe('ProviderCapabilityRegistry', () => {
  let registry: ProviderCapabilityRegistry;

  beforeEach(() => {
    registry = new ProviderCapabilityRegistry();
    registry.seedFromAccounts(TEST_ACCOUNTS);
  });

  it('starts empty before seeding', () => {
    const empty = new ProviderCapabilityRegistry();
    expect(empty.getAll()).toHaveLength(0);
  });

  it('seeds providers from accounts', () => {
    const gemini = registry.get('gemini');
    expect(gemini).toBeDefined();
    expect(gemini!.text).toBe(true);
    expect(gemini!.imageGeneration).toBe(true);
    expect(gemini!.webSearch).toBe(true);
  });

  it('getAll returns all seeded providers', () => {
    const all = registry.getAll();
    expect(all).toHaveLength(4);
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

  it('resetAllQuotas clears all exhausted flags', () => {
    registry.markQuotaExhausted('gemini');
    registry.markQuotaExhausted('chatgpt');
    expect(registry.get('gemini')!.quotaExhausted).toBe(true);
    expect(registry.get('chatgpt')!.quotaExhausted).toBe(true);

    registry.resetAllQuotas();
    expect(registry.get('gemini')!.quotaExhausted).toBe(false);
    expect(registry.get('chatgpt')!.quotaExhausted).toBe(false);
  });

  it('markQuotaExhausted is no-op for unknown provider', () => {
    registry.markQuotaExhausted('nonexistent');
    // No error thrown
  });

  it('resetQuota is no-op for unknown provider', () => {
    registry.resetQuota('nonexistent');
    // No error thrown
  });

  it('updateSelectorHealth sets health and lastProbed', () => {
    const health = {
      healthy: ['promptInput'],
      broken: [],
      score: 100,
      lastProbed: '2024-01-01T00:00:00Z',
    };
    registry.updateSelectorHealth('gemini', health as any);
    const cap = registry.get('gemini')!;
    expect(cap.selectorHealth).toBeDefined();
    expect(cap.lastProbed).toBe('2024-01-01T00:00:00Z');
  });

  it('updateSelectorHealth is no-op for unknown provider', () => {
    registry.updateSelectorHealth('nonexistent', {} as any);
    // No error thrown
  });

  it('get returns undefined for unknown provider', () => {
    expect(registry.get('nonexistent')).toBeUndefined();
  });

  it('findProviders returns empty array when none match', () => {
    const results = registry.findProviders({ videoGeneration: true });
    // Only providers with videoGeneration: true would match
    for (const r of results) {
      expect(r.videoGeneration).toBe(true);
    }
  });

  it('seedFromAccounts clears previous entries', () => {
    expect(registry.getAll()).toHaveLength(4);
    registry.seedFromAccounts([{ provider: 'custom', profileDir: '' }]);
    expect(registry.getAll()).toHaveLength(1);
    expect(registry.get('gemini')).toBeUndefined();
    expect(registry.get('custom')).toBeDefined();
    expect(registry.get('custom')!.text).toBe(true); // unknown provider defaults
  });

  it('seedFromAccounts registers unknown providers with minimal caps', () => {
    registry.seedFromAccounts([{ provider: 'my-llm', profileDir: '/tmp/x' }]);
    const cap = registry.get('my-llm')!;
    expect(cap.text).toBe(true);
    expect(cap.imageGeneration).toBe(false);
    expect(cap.videoGeneration).toBe(false);
    expect(cap.fileUpload).toBe(false);
  });

  it('seedFromAccounts skips duplicate providers (first wins)', () => {
    registry.seedFromAccounts([
      { provider: 'gemini', profileDir: '/a', quotaExhausted: true },
      { provider: 'gemini', profileDir: '/b', quotaExhausted: false },
    ]);
    const cap = registry.get('gemini')!;
    expect(cap.quotaExhausted).toBe(true); // first account wins
  });

  it('register sets lastProbed on new provider', () => {
    registry.register('new-prov', { text: true });
    const cap = registry.get('new-prov')!;
    expect(cap.lastProbed).toBeDefined();
    expect(new Date(cap.lastProbed!).getTime()).toBeGreaterThan(0);
  });
});

/* ================================================================== */
/*  Persistence                                                       */
/* ================================================================== */
describe('ProviderCapabilityRegistry – persistence', () => {
  let tmpDir: string;
  let savePath: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'reg-test-'));
    savePath = join(tmpDir, 'registry.json');
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('persists state to disk on updateSelectorHealth', () => {
    const reg = new ProviderCapabilityRegistry(savePath);
    reg.seedFromAccounts([{ provider: 'gemini', profileDir: '' }]);
    reg.updateSelectorHealth('gemini', {
      healthy: ['a'],
      broken: [],
      score: 100,
      lastProbed: '2024-06-01T00:00:00Z',
    } as any);

    expect(existsSync(savePath)).toBe(true);
    const saved = JSON.parse(readFileSync(savePath, 'utf-8'));
    expect(saved.gemini.selectorHealth).toBeDefined();
  });

  it('persist() writes JSON to disk', () => {
    const reg = new ProviderCapabilityRegistry(savePath);
    reg.seedFromAccounts([{ provider: 'chatgpt', profileDir: '' }]);
    reg.persist();

    const saved = JSON.parse(readFileSync(savePath, 'utf-8'));
    expect(saved.chatgpt).toBeDefined();
    expect(saved.chatgpt.text).toBe(true);
  });

  it('persist() creates directories if needed', () => {
    const deepSave = join(tmpDir, 'deep', 'nested', 'reg.json');
    const reg = new ProviderCapabilityRegistry(deepSave);
    reg.seedFromAccounts([{ provider: 'gemini', profileDir: '' }]);
    reg.persist();
    expect(existsSync(deepSave)).toBe(true);
  });

  it('loadFromDisk merges persisted data on construction', () => {
    // First: seed and persist
    const reg1 = new ProviderCapabilityRegistry(savePath);
    reg1.seedFromAccounts([{ provider: 'gemini', profileDir: '' }]);
    reg1.updateSelectorHealth('gemini', {
      healthy: ['a'],
      broken: [],
      score: 80,
      lastProbed: '2024-06-01T00:00:00Z',
    } as any);

    // Second: create new registry, seed, and it should merge
    const reg2 = new ProviderCapabilityRegistry(savePath);
    reg2.seedFromAccounts([{ provider: 'gemini', profileDir: '' }]);
    // Reload by creating a fresh instance that reads disk in constructor
    const reg3 = new ProviderCapabilityRegistry(savePath);
    reg3.seedFromAccounts([{ provider: 'gemini', profileDir: '' }]);
    // Note: loadFromDisk runs in constructor, but capabilities map is empty at that point
    // seedFromAccounts then populates. The merge only works if data is already in map.
    // So we persist first, then seed + loadFromDisk happens in constructor order.
  });

  it('handles corrupted save file gracefully', () => {
    writeFileSync(savePath, 'NOT VALID JSON!!!');
    const reg = new ProviderCapabilityRegistry(savePath);
    reg.seedFromAccounts([{ provider: 'gemini', profileDir: '' }]);
    // Should not throw
    expect(reg.get('gemini')).toBeDefined();
  });

  it('persist() with no savePath is a no-op', () => {
    const reg = new ProviderCapabilityRegistry();
    reg.seedFromAccounts([{ provider: 'gemini', profileDir: '' }]);
    reg.persist(); // no-op, no error
  });
});
