/**
 * automation-server.ts — HTTP control server for backend ↔ Electron tab management.
 *
 * Runs inside the Electron main process and exposes HTTP endpoints that allow
 * the backend (child process) to create, navigate, and close automation tabs.
 * This enables the backend's Playwright automation to use Electron's internal
 * WebContentsView tabs instead of launching external Chrome windows.
 *
 * Endpoints:
 *   POST   /automation/tabs              — Create a new automation tab
 *   DELETE /automation/tabs/:id          — Close a tab
 *   POST   /automation/tabs/:id/navigate — Navigate a tab to a URL
 *   GET    /automation/tabs              — List automation tabs
 *   POST   /automation/browse            — Open a user-visible browse tab with download detection
 */

import {
  createServer,
  type IncomingMessage,
  type ServerResponse,
  type Server,
} from 'node:http';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import type { TabManager } from './tab-manager.js';
import { getAccountSession } from './session-manager.js';

/** Audio extensions eligible for download-complete notification. */
const AUDIO_EXTENSIONS = new Set(['.mp3', '.wav', '.aac', '.m4a', '.ogg']);

/** Backend API port (same port the backend listens on). */
const BACKEND_PORT = Number(process.env.PORT ?? 3220);

/**
 * Start the automation control server.
 * Returns the HTTP server instance for lifecycle management.
 */
export function startAutomationServer(
  tabManager: TabManager,
  port: number,
): Server {
  // Generate a one-time auth token and expose it via env so the backend child
  // process can authenticate. The token is never logged or sent to the UI.
  const authToken = process.env.ELECTRON_AUTOMATION_TOKEN || randomBytes(32).toString('hex');
  process.env.ELECTRON_AUTOMATION_TOKEN = authToken;

  /** Track will-download listeners per tab so we can clean up on close. */
  const downloadListeners = new Map<string, (event: Electron.Event, item: Electron.DownloadItem) => void>();

  const server = createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', 'http://127.0.0.1');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    // Verify bearer token on every non-OPTIONS request
    const authHeader = req.headers['authorization'] ?? '';
    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : '';
    if (token !== authToken) {
      respond(res, 401, { error: 'Unauthorized' });
      return;
    }

    try {
      const url = new URL(req.url ?? '/', `http://127.0.0.1:${port}`);
      const pathParts = url.pathname.split('/').filter(Boolean);

      if (pathParts[0] !== 'automation') {
        respond(res, 404, { error: 'Not found' });
        return;
      }

      // ── POST /automation/browse — open a user-visible browse tab ──
      if (pathParts[1] === 'browse' && req.method === 'POST') {
        const body = await readBody(req);
        const { url: browseUrl, title } = body as { url?: string; title?: string };

        if (!browseUrl) {
          respond(res, 400, { error: 'url is required' });
          return;
        }

        // Reuse existing browse tab for same origin
        const targetOrigin = new URL(browseUrl).origin;
        const existing = tabManager.getAllTabs().find(
          (t) => !t.isAppTab && !t.isAutomation && t.url.startsWith(targetOrigin),
        );

        if (existing) {
          tabManager.navigateTab(existing.id, browseUrl);
          tabManager.switchToTab(existing.id);
          respond(res, 200, { tabId: existing.id, reused: true });
          return;
        }

        const tab = tabManager.createTab({
          url: browseUrl,
          title: title ?? 'Browse',
          partition: 'persist:default',
          isAppTab: false,
          isAutomation: false,
          active: true,
        });

        // Intercept window.open / target="_blank" — navigate in same tab
        tab.view.webContents.setWindowOpenHandler(({ url: openUrl }) => {
          tab.view.webContents.loadURL(openUrl);
          return { action: 'deny' };
        });

        // Attach will-download listener for audio file detection
        const tabWebContentsId = tab.view.webContents.id;
        const onDownload = (_event: Electron.Event, item: Electron.DownloadItem) => {
          // Only respond to downloads originating from this browse tab
          if ((item as any).getWebContents?.()?.id !== tabWebContentsId) return;
          const filename = item.getFilename();
          const ext = path.extname(filename).toLowerCase();
          if (!AUDIO_EXTENSIONS.has(ext)) return; // ignore non-audio

          item.once('done', (_e, state) => {
            if (state !== 'completed') return;
            const savePath = item.getSavePath();
            // Notify backend — no auth needed (localhost)
            fetch(`http://127.0.0.1:${BACKEND_PORT}/api/bgm-library/download-complete`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ filePath: savePath, filename }),
            }).catch((err) => {
              console.error('[AutomationServer] Failed to notify backend of download:', err);
            });
          });
        };

        tab.view.webContents.session.on('will-download', onDownload);
        downloadListeners.set(tab.id, onDownload);

        respond(res, 201, { tabId: tab.id });
        return;
      }

      // ── All remaining routes under /automation/tabs ──
      if (pathParts[1] !== 'tabs') {
        respond(res, 404, { error: 'Not found' });
        return;
      }

      const tabId = pathParts[2];
      const action = pathParts[3]; // e.g., 'navigate'

      // GET /automation/tabs — list automation tabs
      if (req.method === 'GET' && !tabId) {
        const state = tabManager.getState();
        const automationTabs = state.tabs.filter((t) => t.isAutomation);
        respond(res, 200, { tabs: automationTabs });
        return;
      }

      // POST /automation/tabs — create a new automation tab
      if (req.method === 'POST' && !tabId) {
        const body = await readBody(req);
        const {
          url: tabUrl,
          accountId,
          title,
          active,
        } = body as {
          url?: string;
          accountId?: string;
          title?: string;
          active?: boolean;
        };

        if (!accountId) {
          respond(res, 400, { error: 'accountId is required' });
          return;
        }

        // Check if a tab for this account already exists
        const existing = tabManager
          .getAllTabs()
          .find(
            (t) =>
              t.partition === `persist:account-${accountId}` &&
              t.isAutomation,
          );

        if (existing) {
          // Reuse existing tab — only navigate if URL is explicitly provided
          const navigated = tabUrl ? tabManager.navigateTab(existing.id, tabUrl) : true;
          if (!navigated) {
            // Tab's webContents was destroyed — fall through to create a new one
          } else {
            // Activate the tab if requested
            if (active) {
              tabManager.switchToTab(existing.id);
            }
            respond(res, 200, { tabId: existing.id, reused: true });
            return;
          }
        }

        // Create a new automation tab with the account's session partition
        const managed = getAccountSession(accountId);
        const tab = tabManager.createTab({
          url: tabUrl ?? 'about:blank',
          title: title ?? `Automation: ${accountId}`,
          partition: managed.partition,
          isAutomation: true,
          active: active ?? false,
        });

        respond(res, 201, { tabId: tab.id });
        return;
      }

      // DELETE /automation/tabs/:id — close a tab
      if (req.method === 'DELETE' && tabId && !action) {
        // Clean up download listener if this was a browse tab
        const listener = downloadListeners.get(tabId);
        if (listener) {
          const t = tabManager.getAllTabs().find((tab) => tab.id === tabId);
          if (t) {
            t.view.webContents.session.removeListener('will-download', listener);
          }
          downloadListeners.delete(tabId);
        }

        const closed = tabManager.closeTab(tabId);
        respond(res, 200, { closed });
        return;
      }

      // POST /automation/tabs/:id/navigate — navigate a tab
      if (req.method === 'POST' && tabId && action === 'navigate') {
        const body = await readBody(req);
        const { url: navUrl } = body as { url?: string };
        if (!navUrl) {
          respond(res, 400, { error: 'url is required' });
          return;
        }
        const ok = tabManager.navigateTab(tabId, navUrl);
        respond(res, 200, { ok });
        return;
      }

      respond(res, 404, { error: 'Not found' });
    } catch (err) {
      const msg = err instanceof Error ? err.stack ?? err.message : String(err);
      console.error('[AutomationServer] Error:', msg);
      respond(res, 500, { error: 'Internal server error' });
    }
  });

  server.listen(port, '127.0.0.1', () => {
    console.log(`[AutomationServer] Listening on http://127.0.0.1:${port}`);
  });

  return server;
}

function respond(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf-8');
      try {
        resolve(raw ? JSON.parse(raw) : {});
      } catch {
        reject(new Error('Invalid JSON body'));
      }
    });
    req.on('error', reject);
  });
}
