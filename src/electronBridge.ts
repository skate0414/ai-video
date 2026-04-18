/* ------------------------------------------------------------------ */
/*  electronBridge.ts — Backend-side bridge to Electron's internal     */
/*  browser via Chrome DevTools Protocol (CDP).                        */
/*                                                                     */
/*  When running inside the Electron shell (ELECTRON_SHELL=1), this    */
/*  module replaces Playwright's external Chrome launching with CDP     */
/*  connections to Electron's internal WebContentsView tabs.            */
/*                                                                     */
/*  Architecture:                                                      */
/*    Backend (this module)                                            */
/*      ├── HTTP → Electron automation-server (create/close tabs)      */
/*      └── CDP  → Electron browser (via remote-debugging-port)        */
/*               └── Playwright Page objects for automation            */
/* ------------------------------------------------------------------ */

import { chromium, type Browser, type BrowserContext, type Page } from 'playwright';
import {
  CDP_PORT,
  AUTOMATION_CTRL_PORT,
  CDP_READY_TIMEOUT_MS,
  CDP_CONNECT_TIMEOUT_MS,
  CDP_MAX_RETRIES,
  CDP_PROBE_REQUEST_TIMEOUT_MS,
  CDP_PROBE_POLL_INTERVAL_MS,
  CDP_RETRY_BACKOFF_BASE_MS,
  CDP_STABILIZATION_DELAY_MS,
} from './constants.js';

const CONTROL_BASE = `http://127.0.0.1:${AUTOMATION_CTRL_PORT}`;

/* ------------------------------------------------------------------ */
/*  CDP readiness probe — wait for the debugger endpoint to respond    */
/* ------------------------------------------------------------------ */

/**
 * Poll the CDP `/json/version` endpoint until it responds successfully
 * with a valid WebSocket debugger URL, or the timeout is exceeded.
 * This ensures Electron's remote-debugging port is fully initialised
 * before Playwright tries to connect.
 *
 * After the HTTP endpoint responds, a short stabilization delay is applied
 * to let the WebSocket handler finish initialisation — the HTTP server can
 * be ready before the WebSocket upgrade path is, which causes
 * `connectOverCDP` to time out even though the probe succeeds.
 */
async function waitForCdpReady(timeoutMs: number = CDP_READY_TIMEOUT_MS): Promise<void> {
  const url = `http://127.0.0.1:${CDP_PORT}/json/version`;
  const start = Date.now();
  let lastError = '';

  while (Date.now() - start < timeoutMs) {
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), CDP_PROBE_REQUEST_TIMEOUT_MS);
      const resp = await fetch(url, { signal: controller.signal });
      clearTimeout(timer);
      if (resp.ok) {
        // Verify the response contains a valid WebSocket debugger URL.
        // If the URL is missing, Electron's CDP is only partially ready.
        try {
          const body = await resp.json() as Record<string, unknown>;
          const wsUrl = body?.webSocketDebuggerUrl;
          if (typeof wsUrl !== 'string' || !wsUrl.startsWith('ws')) {
            lastError = `CDP /json/version responded but webSocketDebuggerUrl is missing or invalid (got: ${String(wsUrl)})`;
            await new Promise((resolve) => setTimeout(resolve, CDP_PROBE_POLL_INTERVAL_MS));
            continue;
          }
        } catch (parseErr) {
          // Log but proceed — Playwright will attempt the connection anyway.
          console.warn(
            `[ElectronBridge] CDP /json/version returned 200 but response was not parseable JSON:`,
            parseErr instanceof Error ? parseErr.message : String(parseErr),
          );
        }

        const elapsed = Date.now() - start;
        console.log(`[ElectronBridge] CDP endpoint ready on port ${CDP_PORT} (waited ${elapsed}ms)`);

        // Brief stabilization delay: the HTTP server may be up before the
        // WebSocket upgrade handler is fully initialised.
        await new Promise((resolve) => setTimeout(resolve, CDP_STABILIZATION_DELAY_MS));
        return;
      }
      lastError = `HTTP ${resp.status}`;
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
    await new Promise((resolve) => setTimeout(resolve, CDP_PROBE_POLL_INTERVAL_MS));
  }
  throw new Error(
    `[ElectronBridge] CDP endpoint on port ${CDP_PORT} not reachable after ${timeoutMs}ms. ` +
    `Last error: ${lastError}. ` +
    `Ensure Electron is running with --remote-debugging-port=${CDP_PORT}. ` +
    `If running standalone (non-Electron), unset the ELECTRON_SHELL environment variable.`,
  );
}

/* ------------------------------------------------------------------ */
/*  Singleton CDP connection to Electron                               */
/* ------------------------------------------------------------------ */

let _browser: Browser | null = null;
let _connectPromise: Promise<Browser> | null = null;

/**
 * Force-disconnect the current CDP connection and reconnect.
 *
 * Call this when the existing Playwright Browser object has a stale target
 * list — e.g. after an Electron tab was destroyed and a new WebContentsView
 * was created.  The fresh connection re-discovers all current CDP targets.
 */
async function reconnectCdp(): Promise<Browser> {
  if (_browser) {
    try { await _browser.close(); } catch { /* already gone */ }
    _browser = null;
  }
  _connectPromise = null;
  return getElectronBrowser();
}

async function getElectronBrowser(): Promise<Browser> {
  if (_browser?.isConnected()) return _browser;

  if (_connectPromise) return _connectPromise;

  _connectPromise = (async () => {
    // Wait for CDP endpoint to be reachable before attempting Playwright connection
    await waitForCdpReady();

    let lastError: unknown;
    for (let attempt = 1; attempt <= CDP_MAX_RETRIES; attempt++) {
      try {
        console.log(
          `[ElectronBridge] Connecting to Electron CDP on port ${CDP_PORT}` +
          ` (attempt ${attempt}/${CDP_MAX_RETRIES}, timeout ${CDP_CONNECT_TIMEOUT_MS}ms)...`,
        );
        const browser = await chromium.connectOverCDP(`http://127.0.0.1:${CDP_PORT}`, {
          timeout: CDP_CONNECT_TIMEOUT_MS,
        });
        const ctxCount = browser.contexts().length;
        const pageCount = browser.contexts().reduce((n, c) => n + c.pages().length, 0);
        console.log(`[ElectronBridge] Connected (${ctxCount} contexts, ${pageCount} pages)`);

        browser.on('disconnected', () => {
          console.warn('[ElectronBridge] CDP connection lost');
          _browser = null;
          _connectPromise = null;
        });

        _browser = browser;
        return browser;
      } catch (err) {
        lastError = err;
        const msg = err instanceof Error ? err.message : String(err);
        if (attempt < CDP_MAX_RETRIES) {
          const backoffMs = CDP_RETRY_BACKOFF_BASE_MS * attempt;
          console.warn(
            `[ElectronBridge] connectOverCDP attempt ${attempt} failed: ${msg}. ` +
            `Retrying in ${backoffMs}ms...`,
          );
          await new Promise((resolve) => setTimeout(resolve, backoffMs));
        } else {
          console.error(
            `[ElectronBridge] connectOverCDP failed after ${CDP_MAX_RETRIES} attempts: ${msg}`,
          );
        }
      }
    }
    throw new Error(
      `[ElectronBridge] Failed to connect to Electron CDP on port ${CDP_PORT} ` +
      `after ${CDP_MAX_RETRIES} attempts (timeout ${CDP_CONNECT_TIMEOUT_MS}ms each). ` +
      `Ensure Electron is running with --remote-debugging-port=${CDP_PORT} and the ` +
      `WebSocket endpoint is accessible. You can increase the per-attempt timeout via ` +
      `ELECTRON_CDP_CONNECT_TIMEOUT (current: ${CDP_CONNECT_TIMEOUT_MS}ms). ` +
      `Original error: ${lastError instanceof Error ? lastError.message : String(lastError)}`,
    );
  })();

  try {
    return await _connectPromise;
  } finally {
    _connectPromise = null;
  }
}

/* ------------------------------------------------------------------ */
/*  Communication with Electron's automation control server            */
/* ------------------------------------------------------------------ */

interface TabCreateResult {
  tabId: string;
  reused?: boolean;
}

interface TabListResult {
  tabs: Array<{
    id: string;
    title: string;
    url: string;
    isAppTab: boolean;
    isAutomation: boolean;
    partition: string;
  }>;
}

async function controlRequest(
  method: string,
  path: string,
  body?: unknown,
): Promise<unknown> {
  const url = `${CONTROL_BASE}${path}`;
  const authToken = process.env.ELECTRON_AUTOMATION_TOKEN ?? '';
  const headers: Record<string, string> = {
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...(body ? { 'Content-Type': 'application/json' } : {}),
  };
  const response = await fetch(url, {
    method,
    headers,
    body: body ? JSON.stringify(body) : undefined,
  });
  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `[ElectronBridge] Control request ${method} ${path} failed: ${response.status} ${text}`,
    );
  }
  return response.json();
}

/* ------------------------------------------------------------------ */
/*  Tab lifecycle via control server                                   */
/* ------------------------------------------------------------------ */

async function createTab(
  accountId: string,
  url?: string,
  active?: boolean,
  title?: string,
): Promise<TabCreateResult> {
  return (await controlRequest('POST', '/automation/tabs', {
    accountId,
    url: url ?? 'about:blank',
    title: title ?? `Automation: ${accountId}`,
    active: active ?? false,
  })) as TabCreateResult;
}

async function closeTab(tabId: string): Promise<void> {
  await controlRequest('DELETE', `/automation/tabs/${encodeURIComponent(tabId)}`);
}

async function listAutomationTabs(): Promise<TabListResult> {
  return (await controlRequest('GET', '/automation/tabs')) as TabListResult;
}

/* ------------------------------------------------------------------ */
/*  Page discovery — find a Playwright Page by URL pattern             */
/* ------------------------------------------------------------------ */

async function findPageByUrl(
  browser: Browser,
  urlPattern: string,
  timeoutMs = 10_000,
): Promise<Page | null> {
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const context of browser.contexts()) {
      for (const page of context.pages()) {
        try {
          if (page.url().includes(urlPattern)) return page;
        } catch {
          /* page might have been destroyed */
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  return null;
}

/* ------------------------------------------------------------------ */
/*  Profile directory → account ID mapping                             */
/* ------------------------------------------------------------------ */

/**
 * Derive a stable account identifier from a profile directory path.
 *   /path/to/data/profiles/chatgpt   → chatgpt
 *   /path/to/data/profiles/seedance-2 → seedance-2
 *   C:\data\profiles\chatgpt          → chatgpt
 */
export function profileDirToAccountId(profileDir: string): string {
  const parts = profileDir.replace(/\\/g, '/').split('/').filter(Boolean);
  return parts[parts.length - 1] ?? 'default';
}

/* ------------------------------------------------------------------ */
/*  BrowserContext-compatible adapter around an Electron tab            */
/*                                                                     */
/*  Implements the subset of BrowserContext methods used by             */
/*  workbench.ts, chatAutomation.ts, and videoProvider.ts:             */
/*    pages(), newPage(), close(), addInitScript(), on('close')        */
/* ------------------------------------------------------------------ */

function createContextAdapter(page: Page, tabId: string, accountId: string): BrowserContext {
  const closeHandlers: Array<() => void> = [];
  let closed = false;

  // eslint-disable-next-line @typescript-eslint/no-explicit-any -- minimal adapter
  const adapter: Record<string, any> = {
    pages: (): Page[] => {
      if (closed || page.isClosed()) return [];
      try {
        page.url(); // verify alive
        return [page];
      } catch {
        return [];
      }
    },

    newPage: async (): Promise<Page> => {
      if (closed || page.isClosed()) {
        throw new Error('[ElectronBridge] Cannot create page — tab has been closed');
      }
      return page;
    },

    close: async (): Promise<void> => {
      if (closed) return;
      closed = true;
      // Remove from tab cache so stale entries can't be reused
      tabCache.delete(accountId);
      try {
        await closeTab(tabId);
      } catch (err) {
        console.warn('[ElectronBridge] Failed to close tab:', err);
      }
      for (const handler of closeHandlers) {
        try {
          handler();
        } catch {
          /* ignore handler errors */
        }
      }
    },

    addInitScript: async (script: string | { path: string }): Promise<void> => {
      if (typeof script === 'string') {
        await page.addInitScript(script);
      }
    },

    on: (event: string, handler: (...args: unknown[]) => void) => {
      if (event === 'close') {
        closeHandlers.push(handler as () => void);
      }
      return adapter;
    },

    /* Stubs for other EventEmitter methods that callers might reference */
    off: () => adapter,
    once: () => adapter,
    removeListener: () => adapter,
  };

  return adapter as unknown as BrowserContext;
}

/* ------------------------------------------------------------------ */
/*  Per-account tab cache (mirrors browserManager's contextCache)      */
/* ------------------------------------------------------------------ */

interface CachedTab {
  tabId: string;
  page: Page;
  adapter: BrowserContext;
  refCount: number;
}

const tabCache = new Map<string, CachedTab>();
const tabLocks = new Map<string, Promise<BrowserContext>>();

/* ------------------------------------------------------------------ */
/*  Public API — drop-in replacements for browserManager functions     */
/* ------------------------------------------------------------------ */

/**
 * Acquire a BrowserContext-compatible adapter backed by an Electron tab.
 * Replaces browserManager.acquireContext() when running in Electron.
 */
export async function acquireElectronContext(
  profileDir: string,
  options?: { active?: boolean },
): Promise<BrowserContext> {
  const accountId = profileDirToAccountId(profileDir);

  // Fast path — reuse cached tab
  const cached = tabCache.get(accountId);
  if (cached) {
    cached.refCount++;
    try {
      if (cached.page.isClosed()) throw new Error('page is closed');
      cached.page.url(); // verify alive
      return cached.adapter;
    } catch {
      console.warn(`[ElectronBridge] Cached tab for "${accountId}" is dead — recreating`);
      tabCache.delete(accountId);
    }
  }

  // Serialize per-account to avoid concurrent tab creation
  const existingLock = tabLocks.get(accountId);
  if (existingLock) {
    const ctx = await existingLock;
    const entry = tabCache.get(accountId);
    if (entry) {
      entry.refCount++;
      return ctx;
    }
  }

  const launchPromise = (async (): Promise<BrowserContext> => {
    let browser = await getElectronBrowser();

    // Check if Electron already has a tab for this account
    let tabId: string | undefined;
    let page: Page | null = null;

    try {
      const existing = await listAutomationTabs();
      const match = existing.tabs.find(
        (t) => t.partition === `persist:account-${accountId}`,
      );
      if (match) {
        tabId = match.id;
        // Find the page in the CDP connection by its current URL
        if (match.url && match.url !== 'about:blank') {
          page = await findPageByUrl(browser, match.url, 3_000);
          if (!page) {
            // CDP target list may be stale — reconnect and retry
            console.warn(
              `[ElectronBridge] Existing tab for "${accountId}" not found in CDP — forcing reconnect`,
            );
            browser = await reconnectCdp();
            page = await findPageByUrl(browser, match.url, 5_000);
          }
        }
      }
    } catch {
      /* control server might not be ready yet */
    }

    if (!page) {
      // Create a new tab with a unique marker URL for reliable page discovery
      const marker = `electron-bridge-${accountId}-${Date.now()}`;
      const markerUrl = `about:blank#${marker}`;
      const result = await createTab(
        accountId,
        markerUrl,
        options?.active,
      );
      tabId = result.tabId;

      // Wait for the page to appear in the CDP connection.
      // The existing Playwright connection may have a stale target list
      // when a WebContentsView was destroyed and recreated (e.g. login → pipeline).
      page = await findPageByUrl(browser, marker, 5_000);

      if (!page) {
        // Stale CDP connection — force reconnect so Playwright rediscovers all targets
        console.warn(
          `[ElectronBridge] Page not found in existing CDP connection for "${accountId}" — forcing CDP reconnect`,
        );
        const freshBrowser = await reconnectCdp();
        page = await findPageByUrl(freshBrowser, marker, 10_000);
      }

      if (!page) {
        throw new Error(
          `[ElectronBridge] Failed to find CDP page for account "${accountId}" ` +
            `(marker: ${marker}). Ensure Electron's remote-debugging-port is enabled.`,
        );
      }
    }

    // Apply the esbuild __name polyfill (same as browserManager does)
    await page.addInitScript(
      'if(typeof __name==="undefined"){window.__name=(fn,_)=>fn}',
    );

    const adapter = createContextAdapter(page, tabId!, accountId);
    tabCache.set(accountId, { tabId: tabId!, page, adapter, refCount: 1 });
    return adapter;
  })();

  tabLocks.set(accountId, launchPromise);
  try {
    return await launchPromise;
  } finally {
    tabLocks.delete(accountId);
  }
}

/**
 * Release an Electron tab context. Closes the tab when refCount reaches 0.
 * Replaces browserManager.releaseContext() when running in Electron.
 */
export async function releaseElectronContext(profileDir: string): Promise<void> {
  const accountId = profileDirToAccountId(profileDir);
  const cached = tabCache.get(accountId);
  if (!cached) return;

  cached.refCount--;
  if (cached.refCount <= 0) {
    tabCache.delete(accountId);
    await cached.adapter.close().catch(() => {});
  }
}

/**
 * Launch a BrowserContext-compatible adapter for one-off use.
 * Replaces launchPersistentContextWithRetry() when running in Electron.
 *
 * The `retries` and `viewport` options are ignored in Electron mode since
 * Electron manages the tab lifecycle and window sizing.
 */
export async function launchElectronContext(
  profileDir: string,
  options?: { retries?: number; viewport?: { width: number; height: number }; active?: boolean },
): Promise<BrowserContext> {
  return acquireElectronContext(profileDir, { active: options?.active });
}

/**
 * Disconnect the CDP connection to Electron and clear all cached tabs.
 */
export async function disconnectElectron(): Promise<void> {
  for (const cached of tabCache.values()) {
    await cached.adapter.close().catch(() => {});
  }
  tabCache.clear();

  if (_browser?.isConnected()) {
    await _browser.close().catch(() => {});
  }
  _browser = null;
  _connectPromise = null;
}
