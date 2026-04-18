/**
 * tab-manager.ts — Tab lifecycle management using Electron WebContentsView.
 *
 * Each tab is an Electron WebContentsView embedded in the main BrowserWindow.
 * This gives us:
 *   - Full browser-like tab experience (each tab is an independent web page)
 *   - Per-tab session isolation (via Electron partitions from session-manager)
 *   - Automation-friendly: tabs can be controlled from the main process
 *   - No separate Chrome windows popping up
 *
 * Architecture:
 *   BrowserWindow
 *   ├── Tab bar area (top ~40px) — rendered by the shell UI (renderer/index.html)
 *   └── Content area (remaining space) — one WebContentsView per tab, shown/hidden
 */

import {
  type BrowserWindow,
  type View,
  WebContentsView,
  type WebContents,
  session,
} from 'electron';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** Path to the stealth preload script (CJS) that injects Chrome-like
 *  overrides (navigator.webdriver, userAgentData, plugins, etc.) into
 *  the main world before any page script runs. */
const STEALTH_PRELOAD = path.join(__dirname, 'stealth-preload.cjs');

export interface Tab {
  id: string;
  title: string;
  url: string;
  /** The Electron WebContentsView backing this tab. */
  view: WebContentsView;
  /** Session partition for cookie isolation. */
  partition: string;
  /** Whether this is the built-in app UI tab (cannot be closed). */
  isAppTab: boolean;
  /** Whether this tab was created for automation (can be hidden). */
  isAutomation: boolean;
}

/** Height of the tab bar in pixels. */
const TAB_BAR_HEIGHT = 40;

export class TabManager {
  private tabs = new Map<string, Tab>();
  private activeTabId: string | null = null;
  private nextId = 1;
  private window: BrowserWindow;
  private container: View;
  private tabBarView: WebContentsView | null;
  private onChange: () => void;

  constructor(
    window: BrowserWindow,
    container: View,
    tabBarView: WebContentsView | null,
    onChange: () => void,
  ) {
    this.window = window;
    this.container = container;
    this.tabBarView = tabBarView;
    this.onChange = onChange;

    // Resize ALL tab views when window resizes (all share the same bounds)
    window.on('resize', () => this.layoutAllTabs());
  }

  /**
   * Create a new tab and optionally navigate to a URL.
   */
  createTab(options: {
    url: string;
    title?: string;
    partition?: string;
    isAppTab?: boolean;
    isAutomation?: boolean;
    active?: boolean;
  }): Tab {
    const id = `tab-${this.nextId++}`;
    const partition = options.partition ?? 'persist:default';
    const sess = session.fromPartition(partition);

    // Non-app tabs (login / automation) get the stealth preload that
    // overrides navigator.webdriver, userAgentData, etc. before page
    // scripts run.  App-UI tabs don't need it.
    const webPrefs: Electron.WebPreferences = {
      session: sess,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Disable background throttling for non-app tabs so that AI chat
      // automation keeps running at full speed even when the tab is not
      // the active/visible one.  Without this, Chromium defers timers,
      // pauses requestAnimationFrame, and delays WebSocket handlers in
      // background tabs — causing AI response streaming to stall and
      // the 120-second automation timeout to fire.
      backgroundThrottling: options.isAppTab ? undefined : false,
    };
    if (!options.isAppTab) {
      webPrefs.preload = STEALTH_PRELOAD;
    }

    const view = new WebContentsView({ webPreferences: webPrefs });

    const tab: Tab = {
      id,
      title: options.title ?? 'New Tab',
      url: options.url,
      view,
      partition,
      isAppTab: options.isAppTab ?? false,
      isAutomation: options.isAutomation ?? false,
    };

    // Track title changes
    view.webContents.on('page-title-updated', (_event, title) => {
      tab.title = title;
      this.onChange();
    });

    // Track URL changes
    view.webContents.on('did-navigate', (_event, url) => {
      tab.url = url;
      this.onChange();
    });

    view.webContents.on('did-navigate-in-page', (_event, url) => {
      tab.url = url;
      this.onChange();
    });

    this.tabs.set(id, tab);

    // Stealth: strip Electron/app identifiers from the session UA so
    // HTTP-level User-Agent headers look like standard Chrome.
    view.webContents.session.setUserAgent(
      view.webContents.session.getUserAgent()
        .replace(/\s*ai-video-browser-shell\/[\d.]+/, '')
        .replace(/\s*Electron\/[\d.]+/, ''),
    );

    // Override Sec-Ch-Ua headers on this session to remove Electron brand.
    // (Account sessions already have this via session-manager, but
    //  user-created tabs using persist:default also need it.)
    const tabSess = view.webContents.session;
    tabSess.webRequest.onBeforeSendHeaders((details, callback) => {
      const headers = { ...details.requestHeaders };
      for (const key of Object.keys(headers)) {
        const lk = key.toLowerCase();
        if (lk === 'sec-ch-ua') {
          headers[key] = '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"';
        }
        if (lk === 'sec-ch-ua-full-version-list') {
          headers[key] = '"Chromium";v="136.0.0.0", "Google Chrome";v="136.0.0.0", "Not.A/Brand";v="99.0.0.0"';
        }
      }
      callback({ requestHeaders: headers });
    });

    // Load the URL
    view.webContents.loadURL(options.url);

    // Add view to window (hidden initially — only shown if active)
    this.container.addChildView(view);

    // Ensure the tab bar stays on top of all tab content views
    this.raiseTabBar();

    if (options.active !== false) {
      this.switchToTab(id);
    } else {
      // All tabs get full-size bounds (stacked).  The active tab is
      // brought to front via z-ordering in switchToTab().  This ensures
      // Playwright has a real viewport for background automation tabs.
      this.layoutFullSize(view);
    }

    this.onChange();
    return tab;
  }

  /**
   * Check if a tab's view is still usable (not destroyed).
   */
  private isTabAlive(tab: Tab): boolean {
    try {
      return !!tab.view?.webContents && !tab.view.webContents.isDestroyed();
    } catch {
      return false;
    }
  }

  /**
   * Switch to a specific tab by ID.
   */
  switchToTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;

    if (!this.isTabAlive(tab)) {
      // View is destroyed — clean up stale entry
      this.tabs.delete(tabId);
      this.onChange();
      return false;
    }

    this.activeTabId = tabId;

    // Bring the active tab's view to the front by re-adding it as the
    // topmost child (then re-add tab bar on top of everything).
    try { this.container.removeChildView(tab.view); } catch { /* ok */ }
    this.container.addChildView(tab.view);
    this.layoutFullSize(tab.view);
    this.raiseTabBar();

    tab.view.webContents.focus();
    this.onChange();
    return true;
  }

  /**
   * Close a tab by ID. Cannot close the app tab.
   */
  closeTab(tabId: string): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab || tab.isAppTab) return false;

    // If closing the active tab, switch to another
    if (this.activeTabId === tabId) {
      const tabIds = Array.from(this.tabs.keys());
      const currentIndex = tabIds.indexOf(tabId);
      const nextTabId =
        tabIds[currentIndex + 1] ?? tabIds[currentIndex - 1] ?? null;
      if (nextTabId) {
        this.switchToTab(nextTabId);
      }
    }

    this.container.removeChildView(tab.view);

    // Destroy the web contents to free resources (guard against already-destroyed views)
    try {
      if (tab.view.webContents && !tab.view.webContents.isDestroyed()) {
        tab.view.webContents.close();
      }
    } catch {
      /* webContents already gone */
    }

    this.tabs.delete(tabId);
    this.onChange();
    return true;
  }

  /**
   * Get the current state of all tabs (for rendering the tab bar).
   */
  getState(): {
    tabs: Array<{
      id: string;
      title: string;
      url: string;
      isAppTab: boolean;
      isAutomation: boolean;
      partition: string;
    }>;
    activeTabId: string | null;
  } {
    return {
      tabs: Array.from(this.tabs.values()).map((t) => ({
        id: t.id,
        title: t.title,
        url: t.url,
        isAppTab: t.isAppTab,
        isAutomation: t.isAutomation,
        partition: t.partition,
      })),
      activeTabId: this.activeTabId,
    };
  }

  /**
   * Navigate a specific tab to a new URL.
   */
  navigateTab(tabId: string, url: string): boolean {
    const tab = this.tabs.get(tabId);
    if (!tab) return false;
    if (!this.isTabAlive(tab)) {
      // Tab's renderer has crashed or been destroyed — remove the stale entry
      this.tabs.delete(tabId);
      this.onChange();
      return false;
    }
    tab.view.webContents.loadURL(url);
    return true;
  }

  /**
   * Reload the active tab.
   */
  reloadActiveTab(): void {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    tab?.view.webContents.reload();
  }

  /**
   * Go back in the active tab.
   */
  goBack(): void {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (tab?.view.webContents.canGoBack()) {
      tab.view.webContents.goBack();
    }
  }

  /**
   * Go forward in the active tab.
   */
  goForward(): void {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (tab?.view.webContents.canGoForward()) {
      tab.view.webContents.goForward();
    }
  }

  /**
   * Get a tab's WebContents for automation purposes.
   */
  getTabWebContents(tabId: string): WebContents | null {
    return this.tabs.get(tabId)?.view.webContents ?? null;
  }

  /**
   * Find a tab by URL pattern.
   */
  findTabByUrl(urlPattern: string): Tab | undefined {
    return Array.from(this.tabs.values()).find((t) =>
      t.url.includes(urlPattern),
    );
  }

  /**
   * Get all tabs.
   */
  getAllTabs(): Tab[] {
    return Array.from(this.tabs.values());
  }

  /**
   * Layout the active tab to fill the content area below the tab bar.
   */
  private layoutActiveTab(): void {
    if (!this.activeTabId) return;
    const tab = this.tabs.get(this.activeTabId);
    if (!tab) return;
    this.layoutFullSize(tab.view);
  }

  /**
   * Resize every tab view (all share the same bounds).
   */
  private layoutAllTabs(): void {
    for (const tab of this.tabs.values()) {
      this.layoutFullSize(tab.view);
    }
  }

  /**
   * Give a tab view the full content-area bounds (below the tab bar).
   * All tabs share the same bounds; z-ordering controls which is visible.
   */
  private layoutFullSize(view: WebContentsView): void {
    const [width, height] = this.window.getContentSize();
    view.setBounds({
      x: 0,
      y: TAB_BAR_HEIGHT,
      width,
      height: height - TAB_BAR_HEIGHT,
    });
  }

  /**
   * Re-add the tab bar view so it is the last (topmost) child,
   * preventing tab content views from drawing over it.
   */
  private raiseTabBar(): void {
    if (!this.tabBarView) return;
    try {
      this.container.removeChildView(this.tabBarView);
    } catch { /* may not be a child yet */ }
    this.container.addChildView(this.tabBarView);
  }
}
