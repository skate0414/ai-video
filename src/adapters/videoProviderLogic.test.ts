import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  legacyConfigToSiteConfig,
  generateVideoViaSiteConfig,
  videoHealthMonitor,
} from './videoProvider.js';
import type { SiteAutomationConfig } from '../types.js';

/* ------------------------------------------------------------------ */
/*  legacyConfigToSiteConfig – pure conversion, no browser needed     */
/* ------------------------------------------------------------------ */

describe('legacyConfigToSiteConfig', () => {
  const baseConfig = {
    url: 'https://jimeng.jianying.com/ai-tool/video/generate',
    promptInput: 'textarea.prompt',
    generateButton: 'button.submit',
    videoResult: 'video.result',
    profileDir: '/tmp/profiles/acct1',
  };

  it('converts a Jimeng config with correct defaults', () => {
    const site = legacyConfigToSiteConfig(baseConfig);
    expect(site.id).toBe('custom-video');
    expect(site.type).toBe('video');
    expect(site.label).toContain('即梦');
    expect(site.siteUrl).toBe(baseConfig.url);
    expect(site.timing.maxWaitMs).toBe(3_900_000);
    expect(site.timing.hydrationDelayMs).toBe(3_000);
    expect(site.selectors.promptInput).toBeDefined();
    expect(site.selectors.generateButton).toBeDefined();
  });

  it('detects Kling provider from URL', () => {
    const klingConfig = { ...baseConfig, url: 'https://klingai.com/video' };
    const site = legacyConfigToSiteConfig(klingConfig);
    expect(site.label).toContain('可灵');
    expect(site.timing.hydrationDelayMs).toBe(8_000);
  });

  it('uses explicit provider when set', () => {
    const cfg = { ...baseConfig, provider: 'kling' as const };
    const site = legacyConfigToSiteConfig(cfg);
    expect(site.label).toContain('可灵');
  });

  it('includes optional selectors when present', () => {
    const cfg = {
      ...baseConfig,
      progressIndicator: 'div.progress',
      downloadButton: 'button.download',
      imageUploadTrigger: 'button.upload',
    };
    const site = legacyConfigToSiteConfig(cfg);
    expect(site.selectors.progressIndicator).toBeDefined();
    expect(site.selectors.downloadButton).toBeDefined();
    expect(site.selectors.imageUploadTrigger).toBeDefined();
  });

  it('respects custom maxWaitMs', () => {
    const cfg = { ...baseConfig, maxWaitMs: 60_000 };
    const site = legacyConfigToSiteConfig(cfg);
    expect(site.timing.maxWaitMs).toBe(60_000);
  });

  it('accepts a custom id parameter', () => {
    const site = legacyConfigToSiteConfig(baseConfig, 'my-video-provider');
    expect(site.id).toBe('my-video-provider');
  });
});

/* ------------------------------------------------------------------ */
/*  generateVideoViaSiteConfig – error paths with mocked browser      */
/* ------------------------------------------------------------------ */

describe('generateVideoViaSiteConfig error paths', () => {
  function createConfig(overrides: Partial<SiteAutomationConfig> = {}): SiteAutomationConfig {
    return {
      id: 'test-jimeng',
      label: '即梦 Test',
      type: 'video',
      siteUrl: 'https://jimeng.jianying.com/ai-tool/video/generate',
      capabilities: { video: true },
      selectors: {
        promptInput: [{ selector: 'textarea', method: 'css', priority: 1 }],
        generateButton: [{ selector: 'button.submit', method: 'css', priority: 1 }],
        resultElement: [{ selector: 'video', method: 'css', priority: 1 }],
      },
      timing: { maxWaitMs: 5_000, pollIntervalMs: 500, hydrationDelayMs: 100 },
      profileDir: '/tmp/test-profile-video',
      ...overrides,
    };
  }

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it('returns null when health monitor marks provider as down', async () => {
    const config = createConfig({ id: 'down-provider' });

    // Register and force provider down
    videoHealthMonitor.register(config);
    videoHealthMonitor.recordFailure(config.id, 'err1');
    videoHealthMonitor.recordFailure(config.id, 'err2');
    videoHealthMonitor.recordFailure(config.id, 'err3');
    expect(videoHealthMonitor.isUsable(config.id)).toBe(false);

    const result = await generateVideoViaSiteConfig(
      config,
      { prompt: 'test' },
      '/tmp/out',
      'test.mp4',
    );
    expect(result).toBeNull();

    // Clean up by resetting to healthy
    videoHealthMonitor.recordSuccess(config.id);
  });

  it('catches exceptions and returns null with health monitor update', async () => {
    // Use a config whose profileDir will cause acquireContext to fail
    // by mocking the browserManager
    const { acquireContext } = await import('../browserManager.js');
    vi.spyOn(await import('../browserManager.js'), 'acquireContext').mockRejectedValueOnce(
      new Error('Browser launch failed'),
    );

    const config = createConfig({ id: 'crash-provider' });
    videoHealthMonitor.register(config);
    videoHealthMonitor.recordSuccess(config.id); // ensure starts healthy

    const result = await generateVideoViaSiteConfig(
      config,
      { prompt: 'test video prompt' },
      '/tmp/out',
      'crash.mp4',
    );

    expect(result).toBeNull();
    // Health monitor should have recorded the failure
    const status = videoHealthMonitor.get(config.id);
    expect(status?.consecutiveFailures).toBeGreaterThan(0);
  });
});

/* ------------------------------------------------------------------ */
/*  generateVideoViaWeb – routing logic                                */
/*                                                                    */
/*  generateVideoViaWeb calls generateVideoViaSiteConfig internally.   */
/*  Since both are in the same module, vi.spyOn on the export doesn't */
/*  intercept internal calls. Instead we test the pure conversion      */
/*  (legacyConfigToSiteConfig) and the behavioral contract.            */
/* ------------------------------------------------------------------ */

describe('generateVideoViaWeb routing (unit)', () => {
  it('Kling config produces kling-video site config via legacyConfigToSiteConfig', () => {
    const site = legacyConfigToSiteConfig(
      {
        provider: 'kling',
        url: 'https://klingai.com/video',
        promptInput: 'textarea',
        generateButton: 'button',
        videoResult: 'video',
        profileDir: '/tmp/kling-prof',
      },
      'kling-video',
    );
    expect(site.id).toBe('kling-video');
    expect(site.label).toContain('可灵');
    expect(site.timing.hydrationDelayMs).toBe(8_000);
  });

  it('Jimeng agentUrl produces different siteUrl than standard url', () => {
    const agentSite = legacyConfigToSiteConfig({
      url: 'https://jimeng.jianying.com/ai-tool/video/agent',
      promptInput: 'textarea',
      generateButton: 'button',
      videoResult: 'video',
      profileDir: '/tmp/jimeng',
    });
    const stdSite = legacyConfigToSiteConfig({
      url: 'https://jimeng.jianying.com/ai-tool/video/generate',
      promptInput: 'textarea',
      generateButton: 'button',
      videoResult: 'video',
      profileDir: '/tmp/jimeng',
    }, 'jimeng-standard');

    expect(agentSite.siteUrl).toContain('agent');
    expect(stdSite.siteUrl).toContain('generate');
    expect(stdSite.id).toBe('jimeng-standard');
  });

  it('Jimeng config without explicit provider detected from URL', () => {
    const site = legacyConfigToSiteConfig({
      url: 'https://jimeng.jianying.com/ai-tool/video/generate',
      promptInput: 'textarea',
      generateButton: 'button',
      videoResult: 'video',
      profileDir: '/tmp/jimeng',
    });
    expect(site.label).toContain('即梦');
    expect(site.timing.hydrationDelayMs).toBe(3_000);
  });

  it('Kling detected from kuaishou URL variant', () => {
    const site = legacyConfigToSiteConfig({
      url: 'https://klingai.kuaishou.com/video',
      promptInput: 'textarea',
      generateButton: 'button',
      videoResult: 'video',
      profileDir: '/tmp/kling',
    });
    expect(site.label).toContain('可灵');
  });
});
