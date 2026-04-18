import { describe, it, expect, beforeEach } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ResourceManager } from './resourceManager.js';

describe('ResourceManager', () => {
  let mgr: ResourceManager;
  let testId = 0;

  beforeEach(() => {
    const tempPath = join(tmpdir(), `res-test-${Date.now()}-${++testId}.json`);
    mgr = new ResourceManager(tempPath, true);
  });

  it('starts empty', () => {
    expect(mgr.all()).toHaveLength(0);
    expect(mgr.availableCount()).toBe(0);
  });

  it('adds a chat resource via addAccount compat', () => {
    const acc = mgr.addAccount('chatgpt', 'My GPT', '/tmp/profile-gpt');
    expect(acc.provider).toBe('chatgpt');
    expect(acc.label).toBe('My GPT');
    expect(acc.quotaExhausted).toBe(false);
    expect(mgr.all()).toHaveLength(1);
    expect(mgr.all()[0].type).toBe('chat');
  });

  it('adds a resource with addResource', () => {
    const r = mgr.addResource({
      type: 'video',
      provider: 'sora',
      label: 'Sora Video',
      siteUrl: 'https://sora.com/',
      profileDir: '/tmp/sora',
      capabilities: { video: true },
    });
    expect(r.type).toBe('video');
    expect(r.id).toBeTruthy();
    expect(mgr.all()).toHaveLength(1);
  });

  it('removes a resource', () => {
    const acc = mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
    expect(mgr.removeResource(acc.id)).toBe(true);
    expect(mgr.all()).toHaveLength(0);
  });

  it('returns false when removing non-existent resource', () => {
    expect(mgr.removeResource('nope')).toBe(false);
  });

  it('filters by type', () => {
    mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
    mgr.addResource({
      type: 'video',
      provider: 'sora',
      label: 'Sora',
      siteUrl: 'https://sora.com/',
      profileDir: '/tmp/sora',
      capabilities: { video: true },
    });
    expect(mgr.byType('chat')).toHaveLength(1);
    expect(mgr.byType('video')).toHaveLength(1);
  });

  it('filters by capability', () => {
    mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
    mgr.addResource({
      type: 'video',
      provider: 'sora',
      label: 'Sora',
      siteUrl: 'https://sora.com/',
      profileDir: '/tmp/sora',
      capabilities: { video: true },
    });
    expect(mgr.byCapability('text')).toHaveLength(1);
    expect(mgr.byCapability('video')).toHaveLength(1);
  });

  it('picks preferred provider first (compat)', () => {
    mgr.addAccount('gemini', 'Gemini 1', '/tmp/g1');
    mgr.addAccount('chatgpt', 'GPT 1', '/tmp/gpt1');
    const pick = mgr.pickAccount('chatgpt');
    expect(pick?.provider).toBe('chatgpt');
  });

  it('falls back when preferred provider unavailable', () => {
    mgr.addAccount('gemini', 'Gemini 1', '/tmp/g1');
    const pick = mgr.pickAccount('chatgpt');
    expect(pick?.provider).toBe('gemini');
  });

  it('returns undefined when all quotas exhausted', () => {
    const a1 = mgr.addAccount('chatgpt', 'GPT 1', '/tmp/p1');
    const a2 = mgr.addAccount('gemini', 'Gemini 1', '/tmp/p2');
    mgr.markQuotaExhausted(a1.id);
    mgr.markQuotaExhausted(a2.id);
    expect(mgr.pickAccount()).toBeUndefined();
    expect(mgr.availableCount()).toBe(0);
  });

  it('skips exhausted resources when picking', () => {
    const a1 = mgr.addAccount('chatgpt', 'GPT 1', '/tmp/p1');
    mgr.addAccount('gemini', 'Gemini 1', '/tmp/p2');
    mgr.markQuotaExhausted(a1.id);
    const pick = mgr.pickAccount();
    expect(pick?.provider).toBe('gemini');
  });

  it('resets quota for a single resource', () => {
    const a = mgr.addAccount('chatgpt', 'GPT', '/tmp/p');
    mgr.markQuotaExhausted(a.id);
    expect(mgr.availableCount()).toBe(0);
    mgr.resetQuota(a.id);
    expect(mgr.availableCount()).toBe(1);
    expect(mgr.get(a.id)?.quotaResetAt).toBeTruthy();
  });

  it('resets all quotas', () => {
    const a1 = mgr.addAccount('chatgpt', 'GPT 1', '/tmp/p1');
    const a2 = mgr.addAccount('gemini', 'Gemini 1', '/tmp/p2');
    mgr.markQuotaExhausted(a1.id);
    mgr.markQuotaExhausted(a2.id);
    mgr.resetAllQuotas();
    expect(mgr.availableCount()).toBe(2);
  });

  it('allAccounts returns only chat-type resources', () => {
    mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
    mgr.addResource({
      type: 'video',
      provider: 'sora',
      label: 'Sora',
      siteUrl: 'https://sora.com/',
      profileDir: '/tmp/sora',
      capabilities: { video: true },
    });
    expect(mgr.allAccounts()).toHaveLength(1);
    expect(mgr.allAccounts()[0].provider).toBe('chatgpt');
  });

  it('getVideoProviderConfig returns null when no video resources', () => {
    mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
    expect(mgr.getVideoProviderConfig()).toBeNull();
  });

  it('getVideoProviderConfig returns config from video resource', () => {
    mgr.addResource({
      type: 'video',
      provider: 'sora',
      label: 'Sora',
      siteUrl: 'https://sora.com/',
      profileDir: '/tmp/sora',
      capabilities: { video: true },
    });
    const cfg = mgr.getVideoProviderConfig();
    expect(cfg).not.toBeNull();
    expect(cfg!.url).toBe('https://sora.com/');
    expect(cfg!.profileDir).toBe('/tmp/sora');
  });

  it('pickResource selects by capability', () => {
    mgr.addResource({
      type: 'video',
      provider: 'sora',
      label: 'Sora',
      siteUrl: 'https://sora.com/',
      profileDir: '/tmp/sora',
      capabilities: { video: true },
    });
    mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
    const video = mgr.pickResource('video');
    expect(video?.provider).toBe('sora');
    const text = mgr.pickResource('text');
    expect(text?.provider).toBe('chatgpt');
  });

  describe('auto quota reset', () => {
    it('auto-resets quota after reset window expires', () => {
      mgr.setResetWindow(1000); // 1 second window for testing
      const a = mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
      mgr.markQuotaExhausted(a.id);
      expect(mgr.get(a.id)?.quotaExhausted).toBe(true);
      expect(mgr.get(a.id)?.quotaExhaustedAt).toBeTruthy();

      // Simulate time passing by backdating the exhaustedAt timestamp
      const resource = mgr.get(a.id)!;
      resource.quotaExhaustedAt = new Date(Date.now() - 2000).toISOString();

      const resetCount = mgr.checkAndResetQuotas();
      expect(resetCount).toBe(1);
      expect(mgr.get(a.id)?.quotaExhausted).toBe(false);
      expect(mgr.get(a.id)?.quotaResetAt).toBeTruthy();
    });

    it('does not reset if within reset window', () => {
      mgr.setResetWindow(60_000); // 1 minute
      const a = mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
      mgr.markQuotaExhausted(a.id);

      const resetCount = mgr.checkAndResetQuotas();
      expect(resetCount).toBe(0);
      expect(mgr.get(a.id)?.quotaExhausted).toBe(true);
    });

    it('auto-reset disabled when resetWindow=0', () => {
      mgr.setResetWindow(0);
      const a = mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
      mgr.markQuotaExhausted(a.id);
      const resource = mgr.get(a.id)!;
      resource.quotaExhaustedAt = new Date(Date.now() - 100_000_000).toISOString();

      const resetCount = mgr.checkAndResetQuotas();
      expect(resetCount).toBe(0);
    });

    it('pickResource triggers auto-reset before selecting', () => {
      mgr.setResetWindow(1000);
      const a = mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
      mgr.markQuotaExhausted(a.id);

      // All exhausted → normally returns undefined
      expect(mgr.pickResource('text')).toBeUndefined();

      // Backdate and try again
      const resource = mgr.get(a.id)!;
      resource.quotaExhaustedAt = new Date(Date.now() - 2000).toISOString();

      const picked = mgr.pickResource('text');
      expect(picked).toBeDefined();
      expect(picked?.provider).toBe('chatgpt');
    });

    it('markQuotaExhausted records quotaExhaustedAt timestamp', () => {
      const a = mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
      mgr.markQuotaExhausted(a.id);
      const resource = mgr.get(a.id)!;
      expect(resource.quotaExhaustedAt).toBeTruthy();
      const ts = new Date(resource.quotaExhaustedAt!).getTime();
      expect(ts).toBeGreaterThan(Date.now() - 5000);
      expect(ts).toBeLessThanOrEqual(Date.now());
    });
  });
  describe('syncApiKeys', () => {
    it('adds gemini API resource', () => {
      mgr.syncApiKeys({ geminiApiKey: 'AIzaSyB12345678901234567890' });
      const apiResources = mgr.byType('api');
      expect(apiResources).toHaveLength(1);
      expect(apiResources[0].provider).toBe('gemini');
      expect(apiResources[0].capabilities.text).toBe(true);
      expect(apiResources[0].capabilities.image).toBe(true);
      expect(apiResources[0].apiKeyMasked).toBe('AIzaSyB123...');
    });

    it('adds aivideomaker API resources', () => {
      mgr.syncApiKeys({ aivideomakerApiKeys: ['key_aaa_111', 'key_bbb_222'] });
      const apiResources = mgr.byType('api');
      expect(apiResources).toHaveLength(2);
      expect(apiResources[0].provider).toBe('aivideomaker');
      expect(apiResources[0].capabilities.video).toBe(true);
      expect(apiResources[1].provider).toBe('aivideomaker');
    });

    it('removes keys that no longer exist', () => {
      mgr.syncApiKeys({ aivideomakerApiKeys: ['key_aaa_111'] });
      expect(mgr.byType('api')).toHaveLength(1);
      mgr.syncApiKeys({ aivideomakerApiKeys: [] });
      expect(mgr.byType('api')).toHaveLength(0);
    });

    it('preserves existing keys unchanged', () => {
      mgr.syncApiKeys({ aivideomakerApiKeys: ['key_aaa_111'] });
      const first = mgr.byType('api')[0];
      mgr.syncApiKeys({ aivideomakerApiKeys: ['key_aaa_111'] });
      const second = mgr.byType('api')[0];
      expect(second.id).toBe(first.id); // same resource preserved
    });

    it('handles both gemini and aivideomaker together', () => {
      mgr.syncApiKeys({ geminiApiKey: 'AIzaSyB12345678901234567890', aivideomakerApiKeys: ['key_aaa_111'] });
      expect(mgr.byType('api')).toHaveLength(2);
    });
  });

  describe('round-robin', () => {
    it('rotates through resources on successive picks', () => {
      mgr.addAccount('chatgpt', 'GPT 1', '/tmp/p1');
      mgr.addAccount('gemini', 'Gemini 1', '/tmp/g1');
      const pick1 = mgr.pickResource('text');
      const pick2 = mgr.pickResource('text');
      const pick3 = mgr.pickResource('text');
      // Should alternate between the two
      expect(pick1?.provider).not.toBe(pick2?.provider);
      expect(pick3?.provider).toBe(pick1?.provider);
    });
  });

  describe('persistence', () => {
    it('persists and reloads resources', () => {
      const tempPath = join(tmpdir(), `res-persist-${Date.now()}.json`);
      const mgr1 = new ResourceManager(tempPath, true);
      mgr1.addAccount('chatgpt', 'GPT', '/tmp/p1');
      mgr1.addResource({
        type: 'video',
        provider: 'sora',
        label: 'Sora',
        siteUrl: 'https://sora.com/',
        profileDir: '/tmp/sora',
        capabilities: { video: true },
      });
      // Create new manager from same path — should reload
      const mgr2 = new ResourceManager(tempPath);
      expect(mgr2.all()).toHaveLength(2);
      expect(mgr2.byType('chat')).toHaveLength(1);
      expect(mgr2.byType('video')).toHaveLength(1);
    });
  });

  describe('compat', () => {
    it('removeAccount delegates to removeResource', () => {
      const acc = mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
      expect(mgr.removeAccount(acc.id)).toBe(true);
      expect(mgr.all()).toHaveLength(0);
    });

    it('pickAccount returns Account shape', () => {
      mgr.addAccount('chatgpt', 'GPT', '/tmp/p1');
      const acc = mgr.pickAccount();
      expect(acc).toBeDefined();
      expect(acc!.provider).toBe('chatgpt');
      expect(acc!.label).toBe('GPT');
      expect(acc!).toHaveProperty('id');
      expect(acc!).toHaveProperty('profileDir');
    });
  });

  describe('getVideoProviderConfig details', () => {
    it('includes selectors and timing from video resource', () => {
      mgr.addResource({
        type: 'video',
        provider: 'kling',
        label: 'Kling',
        siteUrl: 'https://kling.com/',
        profileDir: '/tmp/kling',
        capabilities: { video: true },
        selectors: {
          promptInput: 'textarea.prompt',
          generateButton: 'button.gen',
          resultElement: 'video.result',
          imageUploadTrigger: 'input[type="file"]',
          progressIndicator: '.progress',
          downloadButton: 'a.download',
        },
        timing: { maxWaitMs: 600_000 },
        queueDetection: { queueKeywords: ['.queue'] } as any,
      });
      const cfg = mgr.getVideoProviderConfig()!;
      expect(cfg.promptInput).toBe('textarea.prompt');
      expect(cfg.generateButton).toBe('button.gen');
      expect(cfg.videoResult).toBe('video.result');
      expect(cfg.imageUploadTrigger).toBe('input[type="file"]');
      expect(cfg.progressIndicator).toBe('.progress');
      expect(cfg.downloadButton).toBe('a.download');
      expect(cfg.maxWaitMs).toBe(600_000);
      expect(cfg.queueDetection).toEqual({ queueKeywords: ['.queue'] });
    });

    it('returns profileDirs from all video resources', () => {
      mgr.addResource({
        type: 'video',
        provider: 'kling',
        label: 'Kling 1',
        siteUrl: 'https://kling.com/',
        profileDir: '/tmp/kling1',
        capabilities: { video: true },
      });
      mgr.addResource({
        type: 'video',
        provider: 'kling',
        label: 'Kling 2',
        siteUrl: 'https://kling.com/',
        profileDir: '/tmp/kling2',
        capabilities: { video: true },
      });
      const cfg = mgr.getVideoProviderConfig()!;
      expect(cfg.profileDirs).toEqual(['/tmp/kling1', '/tmp/kling2']);
    });
  });

  it('markQuotaExhausted / resetQuota no-op for unknown id', () => {
    mgr.markQuotaExhausted('nonexistent');
    mgr.resetQuota('nonexistent');
    // Should not throw
    expect(mgr.all()).toHaveLength(0);
  });

  it('get returns undefined for unknown id', () => {
    expect(mgr.get('nonexistent')).toBeUndefined();
  });

  it('pickResource returns undefined for empty list', () => {
    expect(mgr.pickResource('text')).toBeUndefined();
    expect(mgr.pickResource('video')).toBeUndefined();
  });});
