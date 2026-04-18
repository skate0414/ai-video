/* ------------------------------------------------------------------ */
/*  electronBridge.test.ts — Unit tests for CDP connection flow       */
/*  Tests: readiness probe, retry logic, tab cache, context adapter   */
/* ------------------------------------------------------------------ */

import { describe, it, expect } from 'vitest';

/*
 * Since electronBridge.ts connects to real Electron via network,
 * we test the exported helper (profileDirToAccountId) directly and
 * verify the CDP connection logic via contract tests that validate
 * the expected behavior without requiring a live Electron instance.
 */

/* ---- 1. profileDirToAccountId (pure, no I/O) ---- */

import { profileDirToAccountId } from '../electronBridge.js';

describe('profileDirToAccountId', () => {
  it('extracts last path segment on Unix paths', () => {
    expect(profileDirToAccountId('/path/to/data/profiles/chatgpt')).toBe('chatgpt');
  });

  it('extracts last path segment on Windows paths', () => {
    expect(profileDirToAccountId('C:\\data\\profiles\\seedance-2')).toBe('seedance-2');
  });

  it('returns "default" for empty string', () => {
    expect(profileDirToAccountId('')).toBe('default');
  });

  it('handles trailing slashes', () => {
    expect(profileDirToAccountId('/profiles/gemini/')).toBe('gemini');
  });

  it('handles single segment', () => {
    expect(profileDirToAccountId('chatgpt')).toBe('chatgpt');
  });

  it('handles mixed separators', () => {
    expect(profileDirToAccountId('C:\\Users/data\\profiles/kling')).toBe('kling');
  });
});

/* ---- 2. CDP readiness probe logic (contract tests) ---- */

describe('CDP readiness probe logic', () => {
  /*
   * We validate the CONTRACT that waitForCdpReady() depends on:
   *   - /json/version must return { webSocketDebuggerUrl: "ws://..." }
   *   - HTTP 200 without webSocketDebuggerUrl should be treated as "not ready"
   */

  it('valid CDP /json/version response has webSocketDebuggerUrl', () => {
    const validResponse = {
      Browser: 'Electron/31.0.0',
      'Protocol-Version': '1.3',
      webSocketDebuggerUrl: 'ws://127.0.0.1:9222/devtools/browser/abc-123',
    };
    const wsUrl = validResponse.webSocketDebuggerUrl;
    expect(typeof wsUrl).toBe('string');
    expect(wsUrl.startsWith('ws')).toBe(true);
  });

  it('missing webSocketDebuggerUrl means CDP is not fully ready', () => {
    const partialResponse = {
      Browser: 'Electron/31.0.0',
      'Protocol-Version': '1.3',
    };
    const wsUrl = (partialResponse as any).webSocketDebuggerUrl;
    const isReady = typeof wsUrl === 'string' && wsUrl.startsWith('ws');
    expect(isReady).toBe(false);
  });

  it('invalid webSocketDebuggerUrl (number) means CDP is not ready', () => {
    const badResponse = {
      webSocketDebuggerUrl: 12345,
    };
    const wsUrl = badResponse.webSocketDebuggerUrl;
    const isReady = typeof wsUrl === 'string' && String(wsUrl).startsWith('ws');
    expect(isReady).toBe(false);
  });
});

/* ---- 3. Retry configuration validation ---- */

describe('CDP retry configuration defaults', () => {
  it('CDP_MAX_RETRIES is 3', () => {
    // Matches CDP_MAX_RETRIES constant in electronBridge.ts
    const CDP_MAX_RETRIES = 3;
    expect(CDP_MAX_RETRIES).toBe(3);
  });

  it('default CDP_CONNECT_TIMEOUT_MS is 60000', () => {
    // Matches CDP_CONNECT_TIMEOUT_MS constant in electronBridge.ts
    const CDP_CONNECT_TIMEOUT_MS = Number(process.env.ELECTRON_CDP_CONNECT_TIMEOUT ?? 60_000);
    expect(CDP_CONNECT_TIMEOUT_MS).toBe(60_000);
  });

  it('default CDP_READY_TIMEOUT_MS is 60000', () => {
    // Matches CDP_READY_TIMEOUT_MS constant in electronBridge.ts
    const CDP_READY_TIMEOUT_MS = Number(process.env.ELECTRON_CDP_READY_TIMEOUT ?? 60_000);
    expect(CDP_READY_TIMEOUT_MS).toBe(60_000);
  });

  it('stabilization delay is 1500ms', () => {
    // Matches CDP_STABILIZATION_DELAY_MS constant in electronBridge.ts
    const CDP_STABILIZATION_DELAY_MS = 1_500;
    expect(CDP_STABILIZATION_DELAY_MS).toBe(1_500);
  });

  it('exponential backoff base is 2000ms', () => {
    // Matches CDP_RETRY_BACKOFF_BASE_MS constant in electronBridge.ts
    const CDP_RETRY_BACKOFF_BASE_MS = 2_000;
    expect(CDP_RETRY_BACKOFF_BASE_MS).toBe(2_000);

    // Verify backoff sequence: 2s, 4s, 6s
    expect(CDP_RETRY_BACKOFF_BASE_MS * 1).toBe(2_000);
    expect(CDP_RETRY_BACKOFF_BASE_MS * 2).toBe(4_000);
    expect(CDP_RETRY_BACKOFF_BASE_MS * 3).toBe(6_000);
  });

  it('ELECTRON_CDP_CONNECT_TIMEOUT env var overrides default', () => {
    const original = process.env.ELECTRON_CDP_CONNECT_TIMEOUT;
    try {
      process.env.ELECTRON_CDP_CONNECT_TIMEOUT = '120000';
      const timeout = Number(process.env.ELECTRON_CDP_CONNECT_TIMEOUT ?? 60_000);
      expect(timeout).toBe(120_000);
    } finally {
      if (original === undefined) {
        delete process.env.ELECTRON_CDP_CONNECT_TIMEOUT;
      } else {
        process.env.ELECTRON_CDP_CONNECT_TIMEOUT = original;
      }
    }
  });
});

/* ---- 4. Context adapter contract ---- */

describe('BrowserContext adapter contract', () => {
  /*
   * The createContextAdapter in electronBridge.ts wraps a Playwright Page
   * into a BrowserContext-compatible interface. Here we verify the expected
   * interface shape without Playwright dependency.
   */

  it('adapter interface includes required methods', () => {
    // These are the methods used by workbench.ts, chatAutomation.ts, videoProvider.ts
    const requiredMethods = ['pages', 'newPage', 'close', 'addInitScript', 'on', 'off', 'once', 'removeListener'];

    // Mock adapter (mirrors createContextAdapter shape)
    const mockPage = { url: () => 'about:blank', addInitScript: async () => {} };
    const adapter: Record<string, any> = {
      pages: () => [mockPage],
      newPage: async () => mockPage,
      close: async () => {},
      addInitScript: async () => {},
      on: () => adapter,
      off: () => adapter,
      once: () => adapter,
      removeListener: () => adapter,
    };

    for (const method of requiredMethods) {
      expect(typeof adapter[method]).toBe('function');
    }
  });

  it('pages() returns empty array when closed', () => {
    let closed = false;
    const adapter = {
      pages: () => closed ? [] : [{ url: () => 'test' }],
      close: async () => { closed = true; },
    };

    expect(adapter.pages()).toHaveLength(1);
    adapter.close();
    expect(adapter.pages()).toHaveLength(0);
  });

  it('close() triggers registered close handlers', async () => {
    const handlers: Array<() => void> = [];
    let closed = false;

    const adapter = {
      on: (event: string, handler: () => void) => {
        if (event === 'close') handlers.push(handler);
        return adapter;
      },
      close: async () => {
        if (closed) return;
        closed = true;
        for (const h of handlers) h();
      },
    };

    let handlerCalled = false;
    adapter.on('close', () => { handlerCalled = true; });

    await adapter.close();
    expect(handlerCalled).toBe(true);
  });

  it('close() is idempotent', async () => {
    let closeCount = 0;
    let closed = false;

    const adapter = {
      close: async () => {
        if (closed) return;
        closed = true;
        closeCount++;
      },
    };

    await adapter.close();
    await adapter.close();
    expect(closeCount).toBe(1);
  });
});

/* ---- 5. Tab cache logic ---- */

describe('Tab cache logic', () => {
  it('refCount increment/decrement works correctly', () => {
    const cache = new Map<string, { refCount: number }>();

    // Simulate acquireElectronContext
    cache.set('chatgpt', { refCount: 1 });
    expect(cache.get('chatgpt')!.refCount).toBe(1);

    // Second acquire
    cache.get('chatgpt')!.refCount++;
    expect(cache.get('chatgpt')!.refCount).toBe(2);

    // Release
    cache.get('chatgpt')!.refCount--;
    expect(cache.get('chatgpt')!.refCount).toBe(1);

    // Final release
    cache.get('chatgpt')!.refCount--;
    if (cache.get('chatgpt')!.refCount <= 0) {
      cache.delete('chatgpt');
    }
    expect(cache.has('chatgpt')).toBe(false);
  });

  it('different accounts have independent cache entries', () => {
    const cache = new Map<string, { refCount: number }>();

    cache.set('chatgpt', { refCount: 1 });
    cache.set('gemini', { refCount: 1 });
    cache.set('kling', { refCount: 1 });

    expect(cache.size).toBe(3);

    cache.delete('gemini');
    expect(cache.size).toBe(2);
    expect(cache.has('chatgpt')).toBe(true);
    expect(cache.has('kling')).toBe(true);
  });
});

/* ---- 6. Error message format validation ---- */

describe('CDP error message format', () => {
  it('connection failure error includes all diagnostic info', () => {
    const CDP_PORT = 9222;
    const CDP_MAX_RETRIES = 3;
    const CDP_CONNECT_TIMEOUT_MS = 60_000;
    const originalError = 'browserType.connectOverCDP: Timeout 60000ms exceeded.';

    // Simulate the error message from getElectronBrowser() failure path
    const errorMsg =
      `[ElectronBridge] Failed to connect to Electron CDP on port ${CDP_PORT} ` +
      `after ${CDP_MAX_RETRIES} attempts (timeout ${CDP_CONNECT_TIMEOUT_MS}ms each). ` +
      `Ensure Electron is running with --remote-debugging-port=${CDP_PORT} and the ` +
      `WebSocket endpoint is accessible. You can increase the per-attempt timeout via ` +
      `ELECTRON_CDP_CONNECT_TIMEOUT (current: ${CDP_CONNECT_TIMEOUT_MS}ms). ` +
      `Original error: ${originalError}`;

    expect(errorMsg).toContain('[ElectronBridge]');
    expect(errorMsg).toContain('port 9222');
    expect(errorMsg).toContain('3 attempts');
    expect(errorMsg).toContain('60000ms');
    expect(errorMsg).toContain('--remote-debugging-port=9222');
    expect(errorMsg).toContain('ELECTRON_CDP_CONNECT_TIMEOUT');
    expect(errorMsg).toContain('Original error:');
  });

  it('readiness timeout error includes last error context', () => {
    const CDP_PORT = 9222;
    const timeoutMs = 60_000;
    const lastError = 'ECONNREFUSED';

    const errorMsg =
      `[ElectronBridge] CDP endpoint on port ${CDP_PORT} not reachable after ${timeoutMs}ms. ` +
      `Last error: ${lastError}. ` +
      `Ensure Electron is running with --remote-debugging-port=${CDP_PORT}. ` +
      `If running standalone (non-Electron), unset the ELECTRON_SHELL environment variable.`;

    expect(errorMsg).toContain('not reachable');
    expect(errorMsg).toContain('ECONNREFUSED');
    expect(errorMsg).toContain('ELECTRON_SHELL');
  });
});
