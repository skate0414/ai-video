import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { SELECTOR_HEALTH_CHECK_INTERVAL_MS } from './constants.js';
import { WB_EVENT } from './types.js';

vi.mock('./selectorResolver.js', () => ({
  probeSelectors: vi.fn(),
  selectorToChain: vi.fn((selector: string) => [{ selector, method: 'css', priority: 1 }]),
}));

vi.mock('./chatAutomation.js', () => ({
  autoDetectSelectors: vi.fn(async () => ({ promptInput: '#p' })),
  autoDetectVideoSelectors: vi.fn(async () => ({ promptInput: '#vp' })),
  cleanupDebugScreenshots: vi.fn(async () => {}),
}));

import { probeSelectors } from './selectorResolver.js';
import { autoDetectSelectors, autoDetectVideoSelectors, cleanupDebugScreenshots } from './chatAutomation.js';
import { HealthMonitor } from './healthMonitor.js';

describe('HealthMonitor', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  function makeMonitor(overrides?: {
    pageDead?: boolean;
    resourceType?: 'chat' | 'video' | 'image';
  }) {
    const page = {
      title: vi.fn(async () => {
        if (overrides?.pageDead) throw new Error('dead page');
        return 'title';
      }),
    } as any;

    const selectorService = {
      getSelectors: vi.fn(() => ({
        promptInput: 'textarea',
        sendButton: 'button[type=submit]',
        responseBlock: '.response',
        readyIndicator: 'textarea',
      })),
      getCachedChains: vi.fn(() => undefined),
      setCachedChain: vi.fn(),
      persistSelectorCache: vi.fn(),
      applyDetectedSelectors: vi.fn(),
      applyDetectedVideoSelectors: vi.fn(),
    } as any;

    const emit = vi.fn();

    const monitor = new HealthMonitor({
      selectorService,
      getActivePage: () => page,
      getActiveAccountId: () => 'acc-1',
      getResourceType: () => overrides?.resourceType ?? 'chat',
      getResourceProvider: () => 'chatgpt',
      emit,
    });

    return { monitor, selectorService, emit };
  }

  it('start schedules periodic checks and cleanup, stop cancels timer', async () => {
    vi.mocked(probeSelectors).mockResolvedValue({
      healthScore: 100,
      brokenSelectors: [],
      selectorDetails: [],
    } as any);

    const { monitor } = makeMonitor();
    monitor.start();

    await vi.advanceTimersByTimeAsync(SELECTOR_HEALTH_CHECK_INTERVAL_MS);
    expect(probeSelectors).toHaveBeenCalled();
    expect(cleanupDebugScreenshots).toHaveBeenCalled();

    monitor.stop();
    const called = vi.mocked(probeSelectors).mock.calls.length;
    await vi.advanceTimersByTimeAsync(SELECTOR_HEALTH_CHECK_INTERVAL_MS);
    expect(vi.mocked(probeSelectors).mock.calls.length).toBe(called);
  });

  it('emits warning and triggers auto-detect for low health (chat resource)', async () => {
    vi.mocked(probeSelectors).mockResolvedValue({
      healthScore: 50,
      brokenSelectors: ['promptInput'],
      selectorDetails: [
        {
          name: 'promptInput',
          strategies: [
            {
              strategy: { selector: 'textarea', method: 'css', priority: 1 },
              matched: false,
            },
          ],
        },
      ],
    } as any);

    const { monitor, selectorService, emit } = makeMonitor({ resourceType: 'chat' });
    monitor.start();

    await vi.advanceTimersByTimeAsync(SELECTOR_HEALTH_CHECK_INTERVAL_MS);

    expect(emit).toHaveBeenCalledWith(expect.objectContaining({ type: WB_EVENT.SELECTOR_HEALTH_WARNING }));
    expect(selectorService.persistSelectorCache).toHaveBeenCalled();
    expect(autoDetectSelectors).toHaveBeenCalled();
    expect(selectorService.applyDetectedSelectors).toHaveBeenCalled();
  });

  it('triggers video selector re-detection for video resources', async () => {
    vi.mocked(probeSelectors).mockResolvedValue({
      healthScore: 40,
      brokenSelectors: ['promptInput'],
      selectorDetails: [],
    } as any);

    const { monitor, selectorService } = makeMonitor({ resourceType: 'video' });
    monitor.start();

    await vi.advanceTimersByTimeAsync(SELECTOR_HEALTH_CHECK_INTERVAL_MS);

    expect(autoDetectVideoSelectors).toHaveBeenCalled();
    expect(selectorService.applyDetectedVideoSelectors).toHaveBeenCalled();
  });

  it('returns early when active page is dead', async () => {
    vi.mocked(probeSelectors).mockResolvedValue({
      healthScore: 100,
      brokenSelectors: [],
      selectorDetails: [],
    } as any);

    const { monitor } = makeMonitor({ pageDead: true });
    monitor.start();

    await vi.advanceTimersByTimeAsync(SELECTOR_HEALTH_CHECK_INTERVAL_MS);
    expect(probeSelectors).not.toHaveBeenCalled();
  });
});
