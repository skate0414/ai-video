import { describe, it, expect, vi, beforeEach } from 'vitest';
import { WB_EVENT } from './types.js';

vi.mock('./browserManager.js', () => ({
  launchPersistentContextWithRetry: vi.fn(),
}));

vi.mock('./chatAutomation.js', () => ({
  autoDetectSelectors: vi.fn(async () => ({ promptInput: '#p', sendButton: '#s' })),
  autoDetectVideoSelectors: vi.fn(async () => ({ promptInput: '#vp', generateButton: '#vg' })),
  scrapeModels: vi.fn(async () => [{ id: 'model-1', label: 'Model 1' }]),
}));

vi.mock('./providerPresets.js', () => ({
  getPreset: vi.fn(),
}));

vi.mock('./dataDir.js', () => ({
  isElectronShell: vi.fn(() => false),
}));

import { launchPersistentContextWithRetry } from './browserManager.js';
import { getPreset } from './providerPresets.js';
import { autoDetectVideoSelectors } from './chatAutomation.js';
import { LoginBrowserManager } from './loginBrowserManager.js';

function makeContext() {
  let closeHandler: (() => void) | null = null;
  const page = {
    goto: vi.fn(async () => {}),
    waitForSelector: vi.fn(async () => {}),
    waitForTimeout: vi.fn(async () => {}),
  } as any;

  const context = {
    pages: vi.fn(() => [page]),
    newPage: vi.fn(async () => page),
    on: vi.fn((event: string, cb: () => void) => {
      if (event === 'close') closeHandler = cb;
    }),
    close: vi.fn(async () => {
      closeHandler?.();
    }),
  } as any;

  return { page, context };
}

describe('LoginBrowserManager', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  function makeManager(overrides?: {
    account?: any;
    selectorsThrows?: boolean;
  }) {
    const sink = { emit: vi.fn(), emitState: vi.fn() };
    const selectorService = {
      getSelectors: overrides?.selectorsThrows
        ? vi.fn(() => { throw new Error('no selectors'); })
        : vi.fn(() => ({ chatUrl: 'https://chat.example', readyIndicator: 'textarea' })),
      applyDetectedSelectors: vi.fn(),
      applyDetectedVideoSelectors: vi.fn(),
    } as any;
    const modelStore = { set: vi.fn() } as any;
    const resources = {
      get: vi.fn(() => {
        if (overrides && 'account' in overrides) return overrides.account;
        return {
          id: 'acc-1',
          provider: 'chatgpt',
          profileDir: '/tmp/profile-1',
        };
      }),
    } as any;

    const mgr = new LoginBrowserManager({
      selectorService,
      modelStore,
      resources,
      sink,
      closeBrowser: vi.fn(async () => {}),
    });

    return { mgr, sink, selectorService, modelStore, resources };
  }

  it('throws when account does not exist', async () => {
    const { mgr } = makeManager({ account: null });
    await expect(mgr.open('missing')).rejects.toThrow('Account missing not found');
  });

  it('opens login browser and emits opened event', async () => {
    const { context } = makeContext();
    vi.mocked(launchPersistentContextWithRetry).mockResolvedValue(context);
    const { mgr, sink } = makeManager();

    await mgr.open('acc-1');

    expect(launchPersistentContextWithRetry).toHaveBeenCalled();
    expect(sink.emit).toHaveBeenCalledWith(expect.objectContaining({ type: WB_EVENT.LOGIN_BROWSER_OPENED }));
    expect(mgr.has('acc-1')).toBe(true);
  });

  it('close removes session and emits closed event', async () => {
    const { context } = makeContext();
    vi.mocked(launchPersistentContextWithRetry).mockResolvedValue(context);
    const { mgr, sink } = makeManager();

    await mgr.open('acc-1');
    await mgr.close('acc-1');

    expect(context.close).toHaveBeenCalled();
    expect(mgr.has('acc-1')).toBe(false);
    expect(sink.emit).toHaveBeenCalledWith(expect.objectContaining({ type: WB_EVENT.LOGIN_BROWSER_CLOSED }));
  });

  it('autoDetectModels stores detected models and emits event', async () => {
    const { page } = makeContext();
    const { mgr, modelStore, sink } = makeManager();

    await mgr.autoDetectModels(page as any, 'chatgpt');

    expect(modelStore.set).toHaveBeenCalledWith('chatgpt', [expect.objectContaining({ id: 'model-1' })]);
    expect(sink.emit).toHaveBeenCalledWith(expect.objectContaining({ type: WB_EVENT.MODELS_DETECTED }));
  });

  it('falls back to preset siteUrl and applies video selectors for video providers', async () => {
    const { context } = makeContext();
    vi.mocked(launchPersistentContextWithRetry).mockResolvedValue(context);
    vi.mocked(getPreset).mockReturnValue({ siteUrl: 'https://video.example' } as any);

    const { mgr, selectorService } = makeManager({ selectorsThrows: true });

    await mgr.open('acc-1');

    await vi.waitFor(() => {
      expect(autoDetectVideoSelectors).toHaveBeenCalled();
      expect(selectorService.applyDetectedVideoSelectors).toHaveBeenCalled();
    });
  });

  it('keys() returns iterator of session keys', async () => {
    const { context } = makeContext();
    vi.mocked(launchPersistentContextWithRetry).mockResolvedValue(context);
    const { mgr } = makeManager();

    await mgr.open('acc-1');
    const keys = [...mgr.keys()];
    expect(keys).toContain('acc-1');
  });

  it('keys() returns empty iterator when no sessions', () => {
    const { mgr } = makeManager();
    expect([...mgr.keys()]).toEqual([]);
  });

  it('close is no-op for unknown session', async () => {
    const { mgr, sink } = makeManager();
    await mgr.close('nonexistent');
    // Should not throw and should not emit closed event
    expect(sink.emit).not.toHaveBeenCalledWith(
      expect.objectContaining({ type: WB_EVENT.LOGIN_BROWSER_CLOSED }),
    );
  });

  it('context close event auto-removes session', async () => {
    const { context } = makeContext();
    vi.mocked(launchPersistentContextWithRetry).mockResolvedValue(context);
    const { mgr } = makeManager();

    await mgr.open('acc-1');
    expect(mgr.has('acc-1')).toBe(true);

    // Simulate the browser context closing on its own
    const closeHandler = vi.mocked(context.on).mock.calls.find((c: any) => c[0] === 'close');
    if (closeHandler) {
      (closeHandler[1] as () => void)();
    }

    expect(mgr.has('acc-1')).toBe(false);
  });
});
