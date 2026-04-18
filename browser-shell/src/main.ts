/**
 * main.ts — Electron main process entry point for the AI Video Pipeline browser shell.
 *
 * Architecture:
 *   ┌─────────────────────────────────────────────────────────────┐
 *   │  Electron BrowserWindow                                     │
 *   │  ┌──────────────────────────────────────────────────────┐   │
 *   │  │  Tab Bar (renderer/index.html via BrowserView)       │   │
 *   │  │  [🏠 Dashboard] [💬 ChatGPT] [🤖 Claude] [+ New]   │   │
 *   │  ├──────────────────────────────────────────────────────┤   │
 *   │  │                                                      │   │
 *   │  │  Active Tab Content (WebContentsView)                │   │
 *   │  │  Each tab has its own session partition for           │   │
 *   │  │  cookie isolation (multi-account support)             │   │
 *   │  │                                                      │   │
 *   │  └──────────────────────────────────────────────────────┘   │
 *   └─────────────────────────────────────────────────────────────┘
 *
 * The backend (Node.js) runs as a child process on port 3220.
 * The first tab loads the app UI from http://127.0.0.1:3220.
 * Automation/login pages open as additional tabs instead of separate windows.
 */

import { app, BrowserWindow, View, WebContentsView } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/* ---- Load .env from project root (if present) ---- */
try {
  // app.getAppPath() → browser-shell/, parent = monorepo root where .env lives
  const projectRoot = path.resolve(app.getAppPath(), '..');
  const envPath = path.join(projectRoot, '.env');
  if (existsSync(envPath)) {
    for (const line of readFileSync(envPath, 'utf-8').split('\n')) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eq = trimmed.indexOf('=');
      if (eq <= 0) continue;
      const key = trimmed.slice(0, eq).trim();
      const val = trimmed.slice(eq + 1).trim().replace(/^["']|["']$/g, '');
      if (!process.env[key]) process.env[key] = val;
    }
    console.log('[Main] Loaded .env from', envPath);
  }
} catch (e) { console.warn('[Main] Failed to load .env:', e); }

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

import { TabManager } from './tab-manager.js';
import { registerIpcHandlers } from './ipc-handlers.js';
import { BootOrchestrator, type BootCallbacks } from './boot-orchestrator.js';
import { resolveBackendPath, buildBackendEnv, resolveProjectRoot } from './backend-launcher.js';
import { startAutomationServer } from './automation-server.js';

/* ------------------------------------------------------------------ */
/*  Enable Chrome DevTools Protocol for backend Playwright automation  */
/*  The backend connects via CDP to control Electron tabs instead of   */
/*  launching external Chrome windows.                                 */
/* ------------------------------------------------------------------ */

const CDP_PORT = 9222;
const AUTOMATION_CONTROL_PORT = 3221;

app.commandLine.appendSwitch('remote-debugging-port', String(CDP_PORT));
app.commandLine.appendSwitch('remote-allow-origins', '*');

// Stealth: hide automation signals so Google OAuth and other services
// don't reject the browser as "unsafe".
app.commandLine.appendSwitch('disable-blink-features', 'AutomationControlled');

// Proxy: if HTTP_PROXY or HTTPS_PROXY is set, route all Chromium traffic
// through it. Essential for users in regions that need a proxy to reach
// Google / OpenAI / Anthropic services.
const PROXY_URL = process.env.HTTPS_PROXY || process.env.https_proxy
  || process.env.HTTP_PROXY || process.env.http_proxy || '';

/** Parse a proxy URL, stripping embedded credentials for Chromium. */
function parseProxyUrl(raw: string): { server: string; username?: string; password?: string } {
  try {
    const u = new URL(raw);
    const username = decodeURIComponent(u.username) || undefined;
    const password = decodeURIComponent(u.password) || undefined;
    // Chromium --proxy-server only accepts scheme://host:port (no auth)
    u.username = '';
    u.password = '';
    return { server: u.toString().replace(/\/$/, ''), username, password };
  } catch {
    return { server: raw };
  }
}

let proxyCredentials: { username?: string; password?: string } = {};

if (PROXY_URL) {
  const parsed = parseProxyUrl(PROXY_URL);
  proxyCredentials = { username: parsed.username, password: parsed.password };
  app.commandLine.appendSwitch('proxy-server', parsed.server);
  // Bypass proxy for local backend and localhost services
  app.commandLine.appendSwitch('proxy-bypass-list', '127.0.0.1;localhost;<local>');
  console.log(`[Main] Proxy enabled: ${parsed.server}`);
}

// Prevent WebRTC from leaking the real IP address
app.commandLine.appendSwitch('force-webrtc-ip-handling-policy', 'disable_non_proxied_udp');

function resolveAppUrl(): string {
  // Explicit URL override takes priority (e.g. Vite dev server in dev:desktop mode)
  if (process.env.AI_VIDEO_UI_URL) {
    return process.env.AI_VIDEO_UI_URL;
  }
  // __dirname at runtime = browser-shell/dist/browser-shell/src/
  // Need to go up 4 levels to reach the repo root where ui/ lives
  const uiDistIndexPath = path.resolve(__dirname, '..', '..', '..', '..', 'ui', 'dist', 'index.html');
  if (existsSync(uiDistIndexPath)) {
    return pathToFileURL(uiDistIndexPath).toString();
  }
  const fallbackPage = path.join(__dirname, 'renderer', 'app-missing.html');
  return pathToFileURL(fallbackPage).toString();
}

const APP_URL = resolveAppUrl();

let mainWindow: BrowserWindow | null = null;
let tabManager: TabManager | null = null;
let tabBarView: WebContentsView | null = null;
let rootView: View | null = null;

/** Height of the tab bar in pixels. Must match TAB_BAR_HEIGHT in tab-manager.ts */
const TAB_BAR_HEIGHT = 40;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'AI Video Pipeline',
    frame: true,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Initialize the window's own webContents so it becomes a valid CDP
  // target (Playwright's connectOverCDP hangs on uninitialised targets).
  mainWindow.loadURL('about:blank');

  // Replace the default content view with a clean View container.
  // The BrowserWindow's own webContents (about:blank) remains alive for
  // CDP compatibility but is no longer rendered, preventing it from
  // occluding the tab bar and tab content views.
  rootView = new View();
  mainWindow.contentView = rootView;

  // ── Tab bar (top strip) ──
  tabBarView = new WebContentsView({
    webPreferences: {
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  rootView.addChildView(tabBarView);
  layoutTabBar();

  // Load the tab bar UI
  const tabBarPath = path.join(__dirname, 'renderer', 'index.html');
  tabBarView.webContents.loadFile(tabBarPath);

  // ── Tab Manager ──
  tabManager = new TabManager(mainWindow, rootView, tabBarView, () => {
    tabBarView?.webContents.send('tabs:changed');
  });

  // ── IPC Handlers ──
  registerIpcHandlers(tabManager);

  // ── Resize tab bar on window resize ──
  mainWindow.on('resize', () => layoutTabBar());

  mainWindow.on('closed', () => {
    mainWindow = null;
    tabManager = null;
    tabBarView = null;
    rootView = null;
  });
}

/**
 * Position the tab bar WebContentsView at the top of the window.
 */
function layoutTabBar(): void {
  if (!mainWindow || !tabBarView) return;
  const [width] = mainWindow.getContentSize();
  tabBarView.setBounds({
    x: 0,
    y: 0,
    width,
    height: TAB_BAR_HEIGHT,
  });
}

/* ------------------------------------------------------------------ */
/*  Boot orchestrator — unified startup state machine                  */
/*  Replaces the ad-hoc startup() + backend-launcher lifecycle with    */
/*  a formal FSM:  IDLE → WINDOW → AUTOMATION → PORT_CHECK →          */
/*  BACKEND_SPAWN → HEALTH_WAIT → READY                               */
/* ------------------------------------------------------------------ */

let boot = new BootOrchestrator({
  backendPort: 3220,
  cdpPort: CDP_PORT,
});

const bootCallbacks: BootCallbacks = {
  createWindow: () => createWindow(),
  startAutomation: () => {
    if (tabManager) {
      startAutomationServer(tabManager, AUTOMATION_CONTROL_PORT);
    }
  },
  openAppTab: () => {
    tabManager?.createTab({
      url: APP_URL,
      title: '🏠 AI Video Pipeline',
      partition: 'persist:app-ui',
      isAppTab: true,
      active: true,
    });
  },
  resolveBackend: () => {
    const { command, args } = resolveBackendPath();
    return {
      command,
      args,
      env: buildBackendEnv(),
      cwd: resolveProjectRoot(),
    };
  },
};

/* ------------------------------------------------------------------ */
/*  App lifecycle                                                      */
/* ------------------------------------------------------------------ */

app.whenReady().then(() => boot.boot(bootCallbacks));

// Handle proxy authentication — Chromium fires this when the proxy
// responds with 407 Proxy-Authentication-Required.
app.on('login', (event, _webContents, request, authInfo, callback) => {
  if (authInfo.isProxy && proxyCredentials.username) {
    event.preventDefault();
    callback(proxyCredentials.username, proxyCredentials.password ?? '');
  }
});

app.on('window-all-closed', () => {
  boot.shutdown();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  // macOS: re-create window when dock icon is clicked
  if (BrowserWindow.getAllWindows().length === 0) {
    boot = new BootOrchestrator({
      backendPort: 3220,
      cdpPort: CDP_PORT,
    });
    boot.boot(bootCallbacks);
  }
});

app.on('before-quit', () => {
  boot.shutdown();
});