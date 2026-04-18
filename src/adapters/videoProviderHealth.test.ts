import { describe, it, expect, vi } from 'vitest';
import { VideoProviderHealthMonitor } from './videoProviderHealth.js';
import type { SiteAutomationConfig } from '../types.js';

function createMockConfig(id: string, label: string): SiteAutomationConfig {
  return {
    id,
    label,
    type: 'video',
    siteUrl: `https://${id}.example.com`,
    capabilities: { video: true },
    selectors: {
      promptInput: [{ selector: 'textarea', method: 'css', priority: 1 }],
    },
    timing: { maxWaitMs: 60000, pollIntervalMs: 2000, hydrationDelayMs: 1000 },
    profileDir: `/tmp/${id}`,
  };
}

describe('VideoProviderHealthMonitor', () => {
  it('registers a provider and reports healthy by default', () => {
    const monitor = new VideoProviderHealthMonitor();
    monitor.register(createMockConfig('jimeng', '即梦'));

    const all = monitor.getAll();
    expect(all).toHaveLength(1);
    expect(all[0].status).toBe('healthy');
    expect(all[0].healthScore).toBe(100);
  });

  it('marks provider as degraded after broken selectors', () => {
    const monitor = new VideoProviderHealthMonitor();
    monitor.register(createMockConfig('jimeng', '即梦'));

    monitor.recordProbeResult('jimeng', {
      success: true,
      brokenSelectors: ['downloadButton'],
      healthScore: 70,
    });

    expect(monitor.get('jimeng')?.status).toBe('degraded');
    expect(monitor.get('jimeng')?.brokenSelectors).toContain('downloadButton');
  });

  it('marks provider as down after 3 consecutive failures', () => {
    const monitor = new VideoProviderHealthMonitor();
    monitor.register(createMockConfig('kling', '可灵'));

    monitor.recordFailure('kling', 'selector not found');
    expect(monitor.get('kling')?.status).toBe('degraded');

    monitor.recordFailure('kling', 'timeout');
    expect(monitor.get('kling')?.status).toBe('degraded');

    monitor.recordFailure('kling', 'page crashed');
    expect(monitor.get('kling')?.status).toBe('down');
    expect(monitor.get('kling')?.consecutiveFailures).toBe(3);
  });

  it('resets to healthy after a success', () => {
    const monitor = new VideoProviderHealthMonitor();
    monitor.register(createMockConfig('jimeng', '即梦'));

    monitor.recordFailure('jimeng', 'error');
    monitor.recordFailure('jimeng', 'error');
    expect(monitor.get('jimeng')?.status).toBe('degraded');

    monitor.recordSuccess('jimeng');
    expect(monitor.get('jimeng')?.status).toBe('healthy');
    expect(monitor.get('jimeng')?.consecutiveFailures).toBe(0);
  });

  it('emits provider_degraded event on status change', () => {
    const monitor = new VideoProviderHealthMonitor();
    monitor.register(createMockConfig('kling', '可灵'));
    const events: any[] = [];
    monitor.onEvent((e) => events.push(e));

    monitor.recordProbeResult('kling', {
      success: true,
      brokenSelectors: ['generateButton'],
      healthScore: 50,
    });

    expect(events).toHaveLength(2); // health_changed + degraded
    expect(events[1].type).toBe('provider_degraded');
    expect(events[1].payload.providerId).toBe('kling');
  });

  it('emits provider_down event after 3 failures', () => {
    const monitor = new VideoProviderHealthMonitor();
    monitor.register(createMockConfig('jimeng', '即梦'));
    const events: any[] = [];
    monitor.onEvent((e) => events.push(e));

    monitor.recordFailure('jimeng', 'err1');
    monitor.recordFailure('jimeng', 'err2');
    monitor.recordFailure('jimeng', 'err3');

    const downEvents = events.filter(e => e.type === 'provider_down');
    expect(downEvents).toHaveLength(1);
    expect(downEvents[0].payload.providerId).toBe('jimeng');
  });

  it('isUsable returns false when provider is down', () => {
    const monitor = new VideoProviderHealthMonitor();
    monitor.register(createMockConfig('jimeng', '即梦'));

    expect(monitor.isUsable('jimeng')).toBe(true);

    monitor.recordFailure('jimeng', 'err');
    monitor.recordFailure('jimeng', 'err');
    monitor.recordFailure('jimeng', 'err');

    expect(monitor.isUsable('jimeng')).toBe(false);
  });

  it('getRecommendation suggests alternative when requested provider is down', () => {
    const monitor = new VideoProviderHealthMonitor();
    monitor.register(createMockConfig('jimeng', '即梦'));
    monitor.register(createMockConfig('kling', '可灵'));

    // Take jimeng down
    monitor.recordFailure('jimeng', 'err');
    monitor.recordFailure('jimeng', 'err');
    monitor.recordFailure('jimeng', 'err');

    const rec = monitor.getRecommendation('jimeng');
    expect(rec.useProvider).toBe('kling');
    expect(rec.useApi).toBe(false);
  });

  it('getRecommendation suggests API when all providers are down', () => {
    const monitor = new VideoProviderHealthMonitor();
    monitor.register(createMockConfig('jimeng', '即梦'));

    // Take jimeng down
    monitor.recordFailure('jimeng', 'err');
    monitor.recordFailure('jimeng', 'err');
    monitor.recordFailure('jimeng', 'err');

    const rec = monitor.getRecommendation('jimeng');
    expect(rec.useProvider).toBeNull();
    expect(rec.useApi).toBe(true);
  });

  it('toJSON returns a serializable snapshot', () => {
    const monitor = new VideoProviderHealthMonitor();
    monitor.register(createMockConfig('jimeng', '即梦'));

    const snap = monitor.toJSON();
    expect(snap.jimeng).toBeDefined();
    expect(snap.jimeng.providerId).toBe('jimeng');
    expect(snap.jimeng.status).toBe('healthy');
  });

  it('unsubscribe works for event listeners', () => {
    const monitor = new VideoProviderHealthMonitor();
    monitor.register(createMockConfig('jimeng', '即梦'));

    const events: any[] = [];
    const unsub = monitor.onEvent((e) => events.push(e));

    monitor.recordFailure('jimeng', 'err');
    expect(events.length).toBeGreaterThan(0);

    const count = events.length;
    unsub();
    monitor.recordFailure('jimeng', 'err');
    expect(events.length).toBe(count); // No new events after unsubscribe
  });
});
