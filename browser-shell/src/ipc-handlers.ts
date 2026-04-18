/**
 * ipc-handlers.ts — IPC handlers for tab/session operations from the renderer.
 *
 * The renderer (tab bar UI) communicates with the main process via IPC to:
 *   - Create, switch, and close tabs
 *   - Navigate tabs (back, forward, reload)
 *   - Open automation/login pages as new tabs
 *   - Get current tab state for rendering
 *
 * These handlers bridge the renderer ↔ main process boundary,
 * keeping all browser context management in the main process.
 */

import { ipcMain } from 'electron';
import type { TabManager } from './tab-manager.js';
import { getAccountSession, clearAccountSession } from './session-manager.js';

/**
 * Register all IPC handlers. Called once from main.ts during app setup.
 */
export function registerIpcHandlers(tabManager: TabManager): void {
  /* ---- Tab lifecycle ---- */

  /** Get current tab state for rendering the tab bar. */
  ipcMain.handle('tabs:getState', () => {
    return tabManager.getState();
  });

  /** Create a new general-purpose tab. */
  ipcMain.handle(
    'tabs:create',
    (_event, options: { url: string; title?: string; partition?: string }) => {
      const tab = tabManager.createTab({
        url: options.url,
        title: options.title,
        partition: options.partition ?? 'persist:default',
      });
      return { id: tab.id, title: tab.title, url: tab.url };
    },
  );

  /** Create a tab for a specific account (login/automation). */
  ipcMain.handle(
    'tabs:createForAccount',
    (
      _event,
      options: {
        url: string;
        accountId: string;
        title?: string;
        isAutomation?: boolean;
      },
    ) => {
      const managed = getAccountSession(options.accountId);
      const tab = tabManager.createTab({
        url: options.url,
        title: options.title ?? `Account: ${options.accountId}`,
        partition: managed.partition,
        isAutomation: options.isAutomation ?? false,
      });
      return { id: tab.id, title: tab.title, url: tab.url };
    },
  );

  /** Switch to a tab. */
  ipcMain.handle('tabs:switch', (_event, tabId: string) => {
    return tabManager.switchToTab(tabId);
  });

  /** Close a tab. */
  ipcMain.handle('tabs:close', (_event, tabId: string) => {
    return tabManager.closeTab(tabId);
  });

  /* ---- Navigation ---- */

  /** Navigate a tab to a new URL. */
  ipcMain.handle(
    'tabs:navigate',
    (_event, options: { tabId: string; url: string }) => {
      return tabManager.navigateTab(options.tabId, options.url);
    },
  );

  /** Reload the active tab. */
  ipcMain.handle('tabs:reload', () => {
    tabManager.reloadActiveTab();
  });

  /** Go back in the active tab. */
  ipcMain.handle('tabs:goBack', () => {
    tabManager.goBack();
  });

  /** Go forward in the active tab. */
  ipcMain.handle('tabs:goForward', () => {
    tabManager.goForward();
  });

  /* ---- Session management ---- */

  /** Clear session data for an account (logout). */
  ipcMain.handle('sessions:clear', async (_event, accountId: string) => {
    await clearAccountSession(accountId);
    return { ok: true };
  });

  /* ---- Automation integration ---- */

  /**
   * Open an automation page as a new tab (called by the backend via the UI).
   * This replaces Playwright's headless browser — instead of opening a
   * separate Chrome window, the page opens as a tab within the shell.
   */
  ipcMain.handle(
    'automation:openPage',
    (
      _event,
      options: {
        url: string;
        accountId: string;
        title?: string;
      },
    ) => {
      // Check if a tab for this account already exists
      const existing = tabManager
        .getAllTabs()
        .find(
          (t) => t.partition === `persist:account-${options.accountId}`,
        );

      if (existing) {
        // Reuse existing tab — navigate to new URL
        tabManager.navigateTab(existing.id, options.url);
        return { id: existing.id, title: existing.title, url: options.url };
      }

      // Create a new automation tab
      const managed = getAccountSession(options.accountId);
      const tab = tabManager.createTab({
        url: options.url,
        title: options.title ?? 'Automation',
        partition: managed.partition,
        isAutomation: true,
        active: false, // Don't steal focus from current work
      });
      return { id: tab.id, title: tab.title, url: tab.url };
    },
  );

  /**
   * Open a login page for manual authentication.
   * Unlike automation tabs, login tabs are shown immediately.
   */
  ipcMain.handle(
    'automation:openLoginPage',
    (
      _event,
      options: {
        url: string;
        accountId: string;
        title?: string;
      },
    ) => {
      const managed = getAccountSession(options.accountId);
      const tab = tabManager.createTab({
        url: options.url,
        title: options.title ?? `Login: ${options.accountId}`,
        partition: managed.partition,
        isAutomation: false,
        active: true, // Show login tab immediately
      });
      return { id: tab.id, title: tab.title, url: tab.url };
    },
  );
}
