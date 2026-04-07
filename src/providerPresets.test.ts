import { describe, it, expect } from 'vitest';
import { listPresets, getPreset, PROVIDER_PRESETS } from './providerPresets.js';
import type { SiteAutomationConfig } from './types.js';

describe('providerPresets', () => {
  it('contains at least 5 presets', () => {
    const keys = Object.keys(PROVIDER_PRESETS);
    expect(keys.length).toBeGreaterThanOrEqual(5);
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

  describe('jimeng-video preset', () => {
    it('has the expected config values', () => {
      const preset = PROVIDER_PRESETS['jimeng-video'];
      expect(preset.type).toBe('video');
      expect(preset.siteUrl).toContain('jimeng.jianying.com');
      expect(preset.capabilities.video).toBe(true);
      expect(preset.selectors.promptInput.length).toBeGreaterThanOrEqual(2);
      expect(preset.selectors.generateButton!.length).toBeGreaterThanOrEqual(2);
      expect(preset.selectors.resultElement!.length).toBeGreaterThanOrEqual(2);
      expect(preset.timing.maxWaitMs).toBe(300_000);
    });

    it('promptInput chain uses textarea with highest priority', () => {
      const preset = PROVIDER_PRESETS['jimeng-video'];
      const sorted = [...preset.selectors.promptInput].sort((a, b) => b.priority - a.priority);
      expect(sorted[0].selector).toBe('textarea');
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
});
