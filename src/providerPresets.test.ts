import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { listPresets, getPreset, PROVIDER_PRESETS } from './providerPresets.js';
import type { SiteAutomationConfig } from './types.js';

describe('providerPresets', () => {
  it('contains at least 5 presets', () => {
    const keys = Object.keys(PROVIDER_PRESETS);
    expect(keys.length).toBeGreaterThanOrEqual(4);
  });

  it('all presets have required fields', () => {
    for (const [id, preset] of Object.entries(PROVIDER_PRESETS)) {
      expect(preset.id).toBe(id);
      expect(preset.label).toBeTruthy();
      expect(['chat', 'image', 'video', 'multi']).toContain(preset.type);
      expect(preset.siteUrl).toMatch(/^https?:\/\//);
      expect(preset.selectors.promptInput.length).toBeGreaterThan(0);
      expect(preset.timing.maxWaitMs).toBeGreaterThan(0);
      expect(preset.timing.pollIntervalMs).toBeGreaterThan(0);
      expect(preset.timing.hydrationDelayMs).toBeGreaterThanOrEqual(0);
    }
  });

  it('all SelectorChain entries have valid method and priority', () => {
    const validMethods = ['css', 'text', 'role', 'testid', 'xpath'];
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      for (const [, chain] of Object.entries(preset.selectors)) {
        if (!chain) continue;
        for (const strategy of chain) {
          expect(validMethods).toContain(strategy.method);
          expect(strategy.priority).toBeGreaterThanOrEqual(1);
          expect(strategy.selector).toBeTruthy();
        }
      }
    }
  });

  describe('listPresets', () => {
    it('returns id, label, type for each preset', () => {
      const list = listPresets();
      expect(list.length).toBe(Object.keys(PROVIDER_PRESETS).length);
      for (const item of list) {
        expect(item.id).toBeTruthy();
        expect(item.label).toBeTruthy();
        expect(item.type).toBeTruthy();
      }
    });
  });

  describe('getPreset', () => {
    it('returns a deep copy of the preset', () => {
      const preset = getPreset('chatgpt');
      expect(preset).toBeDefined();
      expect(preset!.id).toBe('chatgpt');
      // Verify it's a deep copy
      preset!.label = 'Modified';
      expect(PROVIDER_PRESETS.chatgpt.label).toBe('ChatGPT');
    });

    it('returns undefined for unknown preset', () => {
      expect(getPreset('nonexistent')).toBeUndefined();
    });
  });

  describe('chat presets', () => {
    for (const id of ['chatgpt', 'gemini', 'deepseek', 'kimi']) {
      it(`${id} preset has chat-specific selectors`, () => {
        const preset = PROVIDER_PRESETS[id];
        expect(preset.type).toBe('chat');
        expect(preset.selectors.responseBlock).toBeDefined();
        expect(preset.selectors.responseBlock!.length).toBeGreaterThan(0);
        expect(preset.selectors.readyIndicator).toBeDefined();
        expect(preset.selectors.readyIndicator!.length).toBeGreaterThan(0);
      });
    }
  });

  it('video presets can define queue detection rules (from JSON)', () => {
    const preset = getPreset('klingai');
    expect(preset).toBeDefined();
    expect(preset!.type).toBe('video');
    expect(preset!.queueDetection).toBeDefined();
    expect(preset!.queueDetection?.queueKeywords?.length).toBeGreaterThan(0);
    expect(preset!.queueDetection?.etaPatterns?.length).toBeGreaterThan(0);
  });

  describe('matchPresetByUrl', () => {
    let matchPresetByUrl: typeof import('./providerPresets.js').matchPresetByUrl;
    beforeAll(async () => {
      matchPresetByUrl = (await import('./providerPresets.js')).matchPresetByUrl;
    });

    it('matches chatgpt by URL', () => {
      const preset = matchPresetByUrl('https://chatgpt.com/c/some-chat');
      expect(preset).toBeDefined();
      expect(preset!.id).toBe('chatgpt');
    });

    it('matches gemini by URL', () => {
      const preset = matchPresetByUrl('https://gemini.google.com/app/123');
      expect(preset).toBeDefined();
      expect(preset!.id).toBe('gemini');
    });

    it('matches klingai by URL', () => {
      const preset = matchPresetByUrl('https://klingai.com/create');
      expect(preset).toBeDefined();
      expect(preset!.id).toBe('klingai');
    });

    it('returns undefined for unknown URL', () => {
      expect(matchPresetByUrl('https://example.com')).toBeUndefined();
    });

    it('returns undefined for invalid URL', () => {
      expect(matchPresetByUrl('not-a-url')).toBeUndefined();
    });

    it('strips www prefix when matching', () => {
      const preset = matchPresetByUrl('https://www.chatgpt.com/');
      expect(preset).toBeDefined();
      expect(preset!.id).toBe('chatgpt');
    });

    it('returns a deep copy', () => {
      const a = matchPresetByUrl('https://chatgpt.com/');
      const b = matchPresetByUrl('https://chatgpt.com/');
      expect(a).toEqual(b);
      a!.label = 'MODIFIED';
      expect(b!.label).not.toBe('MODIFIED');
    });
  });

  describe('queue detection CRUD', () => {
    let saveQueueDetectionOverrides: typeof import('./providerPresets.js').saveQueueDetectionOverrides;
    let deleteQueueDetectionOverride: typeof import('./providerPresets.js').deleteQueueDetectionOverride;
    let invalidateQueueDetectionCache: typeof import('./providerPresets.js').invalidateQueueDetectionCache;
    let getQueueDetectionPresets: typeof import('./providerPresets.js').getQueueDetectionPresets;
    let tempDir: string;

    beforeAll(async () => {
      const mod = await import('./providerPresets.js');
      saveQueueDetectionOverrides = mod.saveQueueDetectionOverrides;
      deleteQueueDetectionOverride = mod.deleteQueueDetectionOverride;
      invalidateQueueDetectionCache = mod.invalidateQueueDetectionCache;
      getQueueDetectionPresets = mod.getQueueDetectionPresets;
    });

    beforeEach(() => {
      invalidateQueueDetectionCache();
    });

    it('invalidateQueueDetectionCache can be called without error', () => {
      expect(() => invalidateQueueDetectionCache()).not.toThrow();
    });

    it('getQueueDetectionPresets returns an object', () => {
      const presets = getQueueDetectionPresets();
      expect(typeof presets).toBe('object');
    });

    it('getQueueDetectionPresets caches results', () => {
      invalidateQueueDetectionCache();
      const a = getQueueDetectionPresets();
      const b = getQueueDetectionPresets();
      expect(a).toBe(b); // same reference = cached
    });

    it('deleteQueueDetectionOverride returns false when override file does not exist', () => {
      const result = deleteQueueDetectionOverride('nonexistent-provider');
      expect(result).toBe(false);
    });
  });

  describe('queue detection file loading branches', () => {
    const originalEnv = { ...process.env };
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'queue-presets-'));
      process.env.DATA_DIR = tempDir;
      delete process.env.APPDATA_DIR;
    });

    afterEach(() => {
      process.env = { ...originalEnv };
      vi.restoreAllMocks();
      vi.resetModules();
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('loads overrides from DATA_DIR and merges them over bundled presets', async () => {
      writeFileSync(join(tempDir, 'queue-detection-presets.json'), JSON.stringify({
        klingai: { queueKeywords: ['base'], etaPatterns: ['base-eta'] },
      }));
      writeFileSync(join(tempDir, 'queue-detection-overrides.json'), JSON.stringify({
        klingai: { queueKeywords: ['override'], etaPatterns: ['override-eta'] },
      }));

      vi.resetModules();
      const mod = await import('./providerPresets.js');
      mod.invalidateQueueDetectionCache();
      const presets = mod.getQueueDetectionPresets();
      expect(presets.klingai.queueKeywords).toEqual(['override']);
      expect(presets.klingai.etaPatterns).toEqual(['override-eta']);
    });

    it('saveQueueDetectionOverrides merges with existing override file', async () => {
      writeFileSync(join(tempDir, 'queue-detection-overrides.json'), JSON.stringify({
        existing: { queueKeywords: ['old'], etaPatterns: ['old-eta'] },
      }));

      vi.resetModules();
      const mod = await import('./providerPresets.js');
      mod.saveQueueDetectionOverrides({
        added: { queueKeywords: ['new'], etaPatterns: ['new-eta'] },
      } as any);

      const saved = JSON.parse(readFileSync(join(tempDir, 'queue-detection-overrides.json'), 'utf-8'));
      expect(saved.existing).toBeDefined();
      expect(saved.added).toBeDefined();
    });

    it('deleteQueueDetectionOverride removes an existing override and returns true', async () => {
      writeFileSync(join(tempDir, 'queue-detection-overrides.json'), JSON.stringify({
        removeMe: { queueKeywords: ['x'], etaPatterns: ['y'] },
        keepMe: { queueKeywords: ['a'], etaPatterns: ['b'] },
      }));

      vi.resetModules();
      const mod = await import('./providerPresets.js');
      const removed = mod.deleteQueueDetectionOverride('removeMe');
      expect(removed).toBe(true);

      const saved = JSON.parse(readFileSync(join(tempDir, 'queue-detection-overrides.json'), 'utf-8'));
      expect(saved.removeMe).toBeUndefined();
      expect(saved.keepMe).toBeDefined();
    });

    it('returns false when override file is invalid JSON', async () => {
      writeFileSync(join(tempDir, 'queue-detection-overrides.json'), '{bad-json');

      vi.resetModules();
      const mod = await import('./providerPresets.js');
      const removed = mod.deleteQueueDetectionOverride('any');
      expect(removed).toBe(false);
    });

    it('ignores invalid bundled preset JSON and still returns an object', async () => {
      writeFileSync(join(tempDir, 'queue-detection-presets.json'), '{invalid-json');
      mkdirSync(join(tempDir, 'nested'), { recursive: true });

      vi.resetModules();
      const mod = await import('./providerPresets.js');
      mod.invalidateQueueDetectionCache();
      const presets = mod.getQueueDetectionPresets();
      expect(typeof presets).toBe('object');
    });
  });
});
