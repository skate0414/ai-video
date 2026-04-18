/**
 * preload.ts — Preload script for the Electron renderer process.
 *
 * Exposes a safe IPC bridge (`window.electronAPI`) that the shell UI
 * (tab bar, navigation controls) uses to communicate with the main process.
 *
 * This script runs in an isolated context (contextIsolation: true) and only
 * exposes specific IPC channels — no direct access to Node.js or Electron APIs.
 */

import { contextBridge, ipcRenderer } from 'electron';

/**
 * The API exposed to the renderer via `window.electronAPI`.
 */
const electronAPI = {
  /* ---- Tab lifecycle ---- */

  /** Get current state of all tabs. */
  getTabState: (): Promise<{
    tabs: Array<{
      id: string;
      title: string;
      url: string;
      isAppTab: boolean;
      isAutomation: boolean;
    }>;
    activeTabId: string | null;
  }> => ipcRenderer.invoke('tabs:getState'),

  /** Create a new tab. */
  createTab: (options: {
    url: string;
    title?: string;
    partition?: string;
  }): Promise<{ id: string; title: string; url: string }> =>
    ipcRenderer.invoke('tabs:create', options),

  /** Create a tab for a specific account. */
  createTabForAccount: (options: {
    url: string;
    accountId: string;
    title?: string;
    isAutomation?: boolean;
  }): Promise<{ id: string; title: string; url: string }> =>
    ipcRenderer.invoke('tabs:createForAccount', options),

  /** Switch to a tab. */
  switchTab: (tabId: string): Promise<boolean> =>
    ipcRenderer.invoke('tabs:switch', tabId),

  /** Close a tab. */
  closeTab: (tabId: string): Promise<boolean> =>
    ipcRenderer.invoke('tabs:close', tabId),

  /* ---- Navigation ---- */

  /** Navigate a tab to a URL. */
  navigate: (options: {
    tabId: string;
    url: string;
  }): Promise<boolean> => ipcRenderer.invoke('tabs:navigate', options),

  /** Reload the active tab. */
  reload: (): Promise<void> => ipcRenderer.invoke('tabs:reload'),

  /** Go back in the active tab. */
  goBack: (): Promise<void> => ipcRenderer.invoke('tabs:goBack'),

  /** Go forward in the active tab. */
  goForward: (): Promise<void> => ipcRenderer.invoke('tabs:goForward'),

  /* ---- Session management ---- */

  /** Clear session for an account. */
  clearSession: (accountId: string): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('sessions:clear', accountId),

  /* ---- Events from main process ---- */

  /** Listen for tab state changes. Returns a cleanup function to remove the listener. */
  onTabsChanged: (callback: () => void): (() => void) => {
    const handler = () => callback();
    ipcRenderer.on('tabs:changed', handler);
    return () => ipcRenderer.removeListener('tabs:changed', handler);
  },
};

// Expose the API to the renderer via contextBridge
contextBridge.exposeInMainWorld('electronAPI', electronAPI);

// Type declaration for the renderer
export type ElectronAPI = typeof electronAPI;
