import { describe, it, expect, beforeEach, vi } from 'vitest';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Workbench } from '../workbench.js';
import type { EventEmitter } from 'node:events';

/* ------------------------------------------------------------------ */
/*  Browser Lifecycle – crash detection, cleanup, event emission       */
/* ------------------------------------------------------------------ */

/**
 * Creates a minimal mock BrowserContext + Page for testing crash/close
 * listeners without requiring a live browser.
 */
function createMockPageAndContext() {
  // Track registered listeners so tests can trigger events
  const pageListeners = new Map<string, Set<(...args: any[]) => void>>();
  const ctxListeners = new Map<string, Set<(...args: any[]) => void>>();

  const mockPage = {
    on: vi.fn((event: string, fn: (...args: any[]) => void) => {
      if (!pageListeners.has(event)) pageListeners.set(event, new Set());
      pageListeners.get(event)!.add(fn);
    }),
    close: vi.fn().mockResolvedValue(undefined),
    title: vi.fn().mockResolvedValue('Test Page'),
    goto: vi.fn().mockResolvedValue(undefined),
    locator: vi.fn().mockReturnValue({
      first: vi.fn().mockReturnThis(),
      count: vi.fn().mockResolvedValue(0),
    }),
    waitForTimeout: vi.fn().mockResolvedValue(undefined),
    // Emit helper for tests
    _emit(event: string, ...args: any[]) {
      for (const fn of pageListeners.get(event) ?? []) fn(...args);
    },
  };

  const mockContext = {
    on: vi.fn((event: string, fn: (...args: any[]) => void) => {
      if (!ctxListeners.has(event)) ctxListeners.set(event, new Set());
      ctxListeners.get(event)!.add(fn);
    }),
    close: vi.fn().mockResolvedValue(undefined),
    pages: vi.fn().mockReturnValue([mockPage]),
    newPage: vi.fn().mockResolvedValue(mockPage),
    // Emit helper for tests
    _emit(event: string, ...args: any[]) {
      for (const fn of ctxListeners.get(event) ?? []) fn(...args);
    },
  };

  return { mockPage, mockContext, pageListeners, ctxListeners };
}

describe('Workbench – browser lifecycle crash handling', () => {
  let wb: Workbench;
  let testId = 0;

  beforeEach(() => {
    const tempPath = join(tmpdir(), `wb-lifecycle-${Date.now()}-${++testId}.json`);
    wb = new Workbench(tempPath, true);
  });

  it('registerActivePageListeners registers crash and close handlers', () => {
    const { mockPage, mockContext } = createMockPageAndContext();

    // Access private method via cast
    const registerListeners = (wb as any).registerActivePageListeners.bind(wb);

    // Set active state
    (wb as any).activeContext = mockContext;
    (wb as any).activePage = mockPage;
    (wb as any).activeAccountId = 'test-account';

    registerListeners(mockPage, mockContext);

    // Verify listeners were registered
    expect(mockPage.on).toHaveBeenCalledWith('crash', expect.any(Function));
    expect(mockContext.on).toHaveBeenCalledWith('close', expect.any(Function));
  });

  it('page crash clears active state and emits SSE event', () => {
    const { mockPage, mockContext } = createMockPageAndContext();
    const events: any[] = [];
    wb.onEvent((e) => events.push(e));

    // Set active state
    (wb as any).activeContext = mockContext;
    (wb as any).activePage = mockPage;
    (wb as any).activeAccountId = 'test-account';
    (wb as any).activeChatSessionId = 'session-1';

    // Register listeners
    const registerListeners = (wb as any).registerActivePageListeners.bind(wb);
    registerListeners(mockPage, mockContext);

    // Simulate page crash
    mockPage._emit('crash');

    // Verify state cleared
    expect((wb as any).activePage).toBeNull();
    expect((wb as any).activeContext).toBeNull();
    expect((wb as any).activeAccountId).toBeNull();
    expect((wb as any).activeChatSessionId).toBeNull();

    // Verify SSE event emitted
    const crashEvent = events.find(e => e.type === 'active_page_crashed');
    expect(crashEvent).toBeDefined();
    expect(crashEvent.payload.accountId).toBe('test-account');
    expect(crashEvent.payload.reason).toBe('page_crash');
  });

  it('context close clears active state and emits SSE event', () => {
    const { mockPage, mockContext } = createMockPageAndContext();
    const events: any[] = [];
    wb.onEvent((e) => events.push(e));

    // Set active state
    (wb as any).activeContext = mockContext;
    (wb as any).activePage = mockPage;
    (wb as any).activeAccountId = 'test-account-2';
    (wb as any).activeChatSessionId = 'session-2';

    const registerListeners = (wb as any).registerActivePageListeners.bind(wb);
    registerListeners(mockPage, mockContext);

    // Simulate context close
    mockContext._emit('close');

    // Verify state cleared
    expect((wb as any).activePage).toBeNull();
    expect((wb as any).activeContext).toBeNull();
    expect((wb as any).activeAccountId).toBeNull();

    // Verify SSE event emitted
    const crashEvent = events.find(e => e.type === 'active_page_crashed');
    expect(crashEvent).toBeDefined();
    expect(crashEvent.payload.reason).toBe('context_closed');
  });

  it('stale crash listener on old page does NOT clear new active state', () => {
    const old = createMockPageAndContext();
    const fresh = createMockPageAndContext();

    // Register listeners on old page
    (wb as any).activeContext = old.mockContext;
    (wb as any).activePage = old.mockPage;
    (wb as any).activeAccountId = 'old-account';

    const registerListeners = (wb as any).registerActivePageListeners.bind(wb);
    registerListeners(old.mockPage, old.mockContext);

    // Switch to new page (simulating closeBrowser + ensureBrowser)
    (wb as any).activeContext = fresh.mockContext;
    (wb as any).activePage = fresh.mockPage;
    (wb as any).activeAccountId = 'new-account';

    // Old page crashes — should be ignored because activePage !== old.mockPage
    old.mockPage._emit('crash');

    // New state should be untouched
    expect((wb as any).activePage).toBe(fresh.mockPage);
    expect((wb as any).activeContext).toBe(fresh.mockContext);
    expect((wb as any).activeAccountId).toBe('new-account');
  });

  it('closeBrowser() is idempotent — double call does not throw', async () => {
    // No active context — should be a no-op
    await expect((wb as any).closeBrowser()).resolves.toBeUndefined();
    await expect((wb as any).closeBrowser()).resolves.toBeUndefined();
  });

  it('closeBrowser() calls page.close() before context.close()', async () => {
    const { mockPage, mockContext } = createMockPageAndContext();
    const callOrder: string[] = [];

    mockPage.close = vi.fn().mockImplementation(() => {
      callOrder.push('page.close');
      return Promise.resolve();
    });
    mockContext.close = vi.fn().mockImplementation(() => {
      callOrder.push('context.close');
      return Promise.resolve();
    });

    // Set active state manually (no real browser)
    (wb as any).activeContext = mockContext;
    (wb as any).activePage = mockPage;
    (wb as any).activeAccountId = null; // no account → skip profile cleanup

    await (wb as any).closeBrowser();

    expect(callOrder).toEqual(['page.close', 'context.close']);
    expect((wb as any).activePage).toBeNull();
    expect((wb as any).activeContext).toBeNull();
  });

  it('closeBrowser() tolerates page.close() failure', async () => {
    const { mockPage, mockContext } = createMockPageAndContext();
    mockPage.close = vi.fn().mockRejectedValue(new Error('Target closed'));

    (wb as any).activeContext = mockContext;
    (wb as any).activePage = mockPage;
    (wb as any).activeAccountId = null;

    // Should not throw
    await expect((wb as any).closeBrowser()).resolves.toBeUndefined();

    // Context should still be closed
    expect(mockContext.close).toHaveBeenCalled();
    expect((wb as any).activeContext).toBeNull();
  });
});
