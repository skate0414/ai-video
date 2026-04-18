import { describe, it, expect } from 'vitest';
import {
  sanitizePromptForJimeng,
  sanitizePromptForKling,
  detectQueueStateFromText,
  legacyConfigToSiteConfig,
} from './videoProvider.js';
import type { VideoProviderConfig } from './videoProvider.js';

describe('sanitizePromptForJimeng', () => {
  it('returns unchanged text when no sensitive words present', () => {
    const input = 'A beautiful sunset over the ocean';
    expect(sanitizePromptForJimeng(input)).toBe(input);
  });

  it('replaces "brain" with "glowing sphere"', () => {
    expect(sanitizePromptForJimeng('The brain is complex')).toBe('The glowing sphere is complex');
  });

  it('replaces "neural pathway" with "flowing light streams"', () => {
    expect(sanitizePromptForJimeng('neural pathways in the cortex')).toContain('flowing light streams');
  });

  it('replaces "neural network" with "interconnected light network"', () => {
    expect(sanitizePromptForJimeng('a neural network structure')).toContain('interconnected light network');
  });

  it('replaces "neuron" with "glowing orb"', () => {
    expect(sanitizePromptForJimeng('a single neuron firing')).toContain('glowing orb');
  });

  it('replaces "consciousness" with "inner awareness"', () => {
    expect(sanitizePromptForJimeng('human consciousness expands')).toContain('inner awareness');
  });

  it('replaces "blood vessels" with "glowing channels"', () => {
    expect(sanitizePromptForJimeng('blood vessels branching')).toContain('glowing channels');
  });

  it('replaces "blood" alone with "life energy"', () => {
    expect(sanitizePromptForJimeng('blood circulation')).toContain('life energy');
  });

  it('replaces Chinese anatomical terms', () => {
    expect(sanitizePromptForJimeng('大脑结构')).toContain('发光球体');
    expect(sanitizePromptForJimeng('神经元活动')).toContain('光点');
    expect(sanitizePromptForJimeng('血管网络')).toContain('能量通道');
  });

  it('is case-insensitive for English words', () => {
    expect(sanitizePromptForJimeng('The BRAIN and the Brain')).not.toMatch(/brain/i);
  });

  it('handles multiple replacements in one prompt', () => {
    const input = 'The brain sends signals through neural pathways via neurons';
    const result = sanitizePromptForJimeng(input);
    expect(result).not.toMatch(/brain/i);
    expect(result).not.toMatch(/neural/i);
    expect(result).not.toMatch(/neuron/i);
  });
});

describe('sanitizePromptForKling', () => {
  it('returns unchanged text when no sensitive words present', () => {
    const input = 'A beautiful garden with flowers';
    expect(sanitizePromptForKling(input)).toBe(input);
  });

  it('replaces chemical-related terms', () => {
    expect(sanitizePromptForKling('chemical substances')).toContain('luminous essence');
    expect(sanitizePromptForKling('a molecule structure')).toContain('glowing particle');
  });

  it('replaces drug-related terms', () => {
    expect(sanitizePromptForKling('drug effects')).toContain('healing light');
    expect(sanitizePromptForKling('a toxin spreading')).toContain('dark mist');
  });

  it('replaces medical terms', () => {
    expect(sanitizePromptForKling('brain activity')).toContain('glowing sphere');
    expect(sanitizePromptForKling('cancer cells')).toContain('dark cluster');
    expect(sanitizePromptForKling('a tumor grows')).toContain('shadow mass');
    expect(sanitizePromptForKling('virus spreading')).toContain('dark spore');
  });

  it('replaces violence-related terms', () => {
    expect(sanitizePromptForKling('an explosion happens')).toContain('burst of light');
    expect(sanitizePromptForKling('destroy the building')).toContain('dissolving');
    expect(sanitizePromptForKling('weapon on the table')).toContain('tool');
  });

  it('replaces Chinese sensitive terms', () => {
    expect(sanitizePromptForKling('化学物质')).toContain('发光精华');
    expect(sanitizePromptForKling('病毒扩散')).toContain('暗色浮尘');
    expect(sanitizePromptForKling('肿瘤增长')).toContain('暗影');
    expect(sanitizePromptForKling('死亡场景')).toContain('静止');
  });

  it('handles multiple sensitive terms in one prompt', () => {
    const input = 'The virus attacks blood vessels and destroys organs';
    const result = sanitizePromptForKling(input);
    expect(result).not.toMatch(/virus/i);
    expect(result).not.toMatch(/blood/i);
    expect(result).not.toMatch(/destroys/i);
    expect(result).not.toMatch(/organs/i);
  });
});

describe('detectQueueStateFromText', () => {
  it('parses Chinese "X分Y秒" ETA when queued', () => {
    const state = detectQueueStateFromText('您正在排队\n(预计等待 ~13分46秒)\n免费任务按顺序渲染');
    expect(state.queued).toBe(true);
    expect(state.estimatedSec).toBe(13 * 60 + 46);
  });

  it('parses English "estimated wait" ETA', () => {
    const state = detectQueueStateFromText('You are in queue. Estimated wait ~8 min 30 sec.');
    expect(state.queued).toBe(true);
    expect(state.estimatedSec).toBe(8 * 60 + 30);
  });

  it('supports site-specific custom rules from presets/config', () => {
    const state = detectQueueStateFromText('Position #12. Wait: 04:15', {
      queueKeywords: ['position #'],
      etaPatterns: [{ regex: 'wait:\\s*(\\d{2}):(\\d{2})', minutesGroup: 1, secondsGroup: 2 }],
    });
    expect(state.queued).toBe(true);
    expect(state.estimatedSec).toBe(4 * 60 + 15);
  });

  it('returns queued=true with zero ETA when no pattern matches', () => {
    const state = detectQueueStateFromText('Currently in queue. Please wait...');
    expect(state.queued).toBe(true);
    expect(state.estimatedSec).toBe(0);
  });

  it('returns queued=false for unrelated page text', () => {
    const state = detectQueueStateFromText('Upload complete. Ready to generate.');
    expect(state.queued).toBe(false);
    expect(state.estimatedSec).toBe(0);
  });
});

/* ================================================================== */
/*  legacyConfigToSiteConfig                                         */
/* ================================================================== */
describe('legacyConfigToSiteConfig', () => {
  const baseConfig: VideoProviderConfig = {
    url: 'https://jimeng.jianying.com/ai-tool/generate',
    promptInput: '#prompt-textarea',
    generateButton: 'button.generate',
    videoResult: 'video.result',
    profileDir: '/tmp/profile',
  };

  it('converts minimal jimeng config', () => {
    const site = legacyConfigToSiteConfig(baseConfig);
    expect(site.id).toBe('custom-video');
    expect(site.label).toContain('即梦');
    expect(site.type).toBe('video');
    expect(site.siteUrl).toBe(baseConfig.url);
    expect(site.capabilities.video).toBe(true);
    expect(site.capabilities.fileUpload).toBe(false);
    expect(site.timing.maxWaitMs).toBe(3_900_000);
    expect(site.timing.hydrationDelayMs).toBe(3_000); // jimeng default
    expect(site.profileDir).toBe('/tmp/profile');
  });

  it('detects kling provider by URL', () => {
    const klingConfig: VideoProviderConfig = {
      ...baseConfig,
      url: 'https://klingai.com/generate',
    };
    const site = legacyConfigToSiteConfig(klingConfig);
    expect(site.label).toContain('可灵');
    expect(site.timing.hydrationDelayMs).toBe(8_000); // kling default
  });

  it('detects kling via kuaishou URL', () => {
    const klingConfig: VideoProviderConfig = {
      ...baseConfig,
      url: 'https://klingai.kuaishou.com/gen',
    };
    const site = legacyConfigToSiteConfig(klingConfig);
    expect(site.label).toContain('可灵');
  });

  it('respects explicit provider field', () => {
    const explicit: VideoProviderConfig = {
      ...baseConfig,
      provider: 'kling',
    };
    const site = legacyConfigToSiteConfig(explicit);
    expect(site.label).toContain('可灵');
    expect(site.timing.hydrationDelayMs).toBe(8_000);
  });

  it('uses custom id when provided', () => {
    const site = legacyConfigToSiteConfig(baseConfig, 'my-video-provider');
    expect(site.id).toBe('my-video-provider');
  });

  it('converts optional selectors when present', () => {
    const full: VideoProviderConfig = {
      ...baseConfig,
      progressIndicator: '.spinner',
      downloadButton: 'a.download',
      imageUploadTrigger: 'button.upload',
    };
    const site = legacyConfigToSiteConfig(full);
    expect(site.selectors.progressIndicator).toBeDefined();
    expect(site.selectors.downloadButton).toBeDefined();
    expect(site.selectors.imageUploadTrigger).toBeDefined();
    expect(site.capabilities.fileUpload).toBe(true);
  });

  it('omits optional selectors when absent', () => {
    const site = legacyConfigToSiteConfig(baseConfig);
    expect(site.selectors.progressIndicator).toBeUndefined();
    expect(site.selectors.downloadButton).toBeUndefined();
    expect(site.selectors.imageUploadTrigger).toBeUndefined();
  });

  it('passes queueDetection through', () => {
    const qd = { queueKeywords: ['排队'], etaPatterns: [] };
    const full: VideoProviderConfig = {
      ...baseConfig,
      queueDetection: qd as any,
    };
    const site = legacyConfigToSiteConfig(full);
    expect(site.queueDetection).toBe(qd);
  });

  it('uses provided maxWaitMs', () => {
    const custom: VideoProviderConfig = {
      ...baseConfig,
      maxWaitMs: 60_000,
    };
    const site = legacyConfigToSiteConfig(custom);
    expect(site.timing.maxWaitMs).toBe(60_000);
  });
});
