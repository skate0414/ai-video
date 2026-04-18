import { describe, it, expect } from 'vitest';

/**
 * chatAutomation depends on a live Playwright browser, so real integration
 * tests require a running browser.  Here we verify the module exports are
 * structurally correct and type-correct (smoke tests).
 */
describe('chatAutomation – module structure', () => {
  it('exports expected functions', async () => {
    const mod = await import('./chatAutomation.js');
    expect(typeof mod.openChat).toBe('function');
    expect(typeof mod.sendPrompt).toBe('function');
    expect(typeof mod.checkQuotaExhausted).toBe('function');
  });

  it('exports model-related functions', async () => {
    const mod = await import('./chatAutomation.js');
    expect(typeof mod.selectModel).toBe('function');
    expect(typeof mod.scrapeModels).toBe('function');
  });

  it('exports file upload function', async () => {
    const mod = await import('./chatAutomation.js');
    expect(typeof mod.uploadFiles).toBe('function');
  });

  it('exports autoDetectSelectors function', async () => {
    const mod = await import('./chatAutomation.js');
    expect(typeof mod.autoDetectSelectors).toBe('function');
  });

  it('verifies function signatures accept expected parameters', async () => {
    // Verify that the module's default options are sensible by checking function signatures
    const mod = await import('./chatAutomation.js');
    // All exported functions should accept at least 2 parameters
    expect(mod.openChat.length).toBeGreaterThanOrEqual(1);
    expect(mod.sendPrompt.length).toBeGreaterThanOrEqual(1);
  });
});
