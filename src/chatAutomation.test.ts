import { describe, it, expect } from 'vitest';

/**
 * chatAutomation depends on a live Playwright browser, so real integration
 * tests require a running browser.  Here we verify the module exports are
 * structurally correct (smoke test).
 */
describe('chatAutomation – module structure', () => {
  it('exports expected functions', async () => {
    const mod = await import('./chatAutomation.js');
    expect(typeof mod.openChat).toBe('function');
    expect(typeof mod.sendPrompt).toBe('function');
    expect(typeof mod.checkQuotaExhausted).toBe('function');
  });
});
