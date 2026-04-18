/**
 * tabs.js — Tab bar UI logic (runs in the renderer process).
 *
 * Communicates with the main process via `window.electronAPI` (exposed by preload.ts)
 * to create, switch, and close tabs. Renders the tab strip and handles user interactions.
 *
 * This file is plain JavaScript because it runs in the renderer BrowserView
 * which does not go through the TypeScript build pipeline.
 */

/* ---- DOM references ---- */

const tabsContainer = document.getElementById('tabs-container');
const newTabBtn = document.getElementById('new-tab-btn');
const backBtn = document.getElementById('back-btn');
const forwardBtn = document.getElementById('forward-btn');
const reloadBtn = document.getElementById('reload-btn');

/* ---- State ---- */

/** @type {{ tabs: Array<{ id: string, title: string, url: string, isAppTab: boolean, isAutomation: boolean }>, activeTabId: string | null }} */
let currentState = { tabs: [], activeTabId: null };

/* ---- Render ---- */

/**
 * Get an emoji icon for a tab based on its properties/URL.
 * @param {{ isAppTab: boolean, isAutomation: boolean, url: string }} tab
 * @returns {string}
 */
function getTabIcon(tab) {
  if (tab.isAppTab) return '🏠';
  if (tab.isAutomation) return '⚡';

  const url = tab.url.toLowerCase();
  if (url.includes('chatgpt') || url.includes('openai')) return '💬';
  if (url.includes('claude') || url.includes('anthropic')) return '🤖';
  if (url.includes('gemini') || url.includes('google')) return '✨';
  if (url.includes('deepseek')) return '🔍';
  if (url.includes('kimi')) return '🌙';
  return '🌐';
}

function renderTabs() {
  tabsContainer.innerHTML = '';

  for (const tab of currentState.tabs) {
    const tabEl = document.createElement('div');
    tabEl.className = 'tab';
    if (tab.id === currentState.activeTabId) tabEl.classList.add('active');
    if (tab.isAppTab) tabEl.classList.add('app-tab');
    if (tab.isAutomation) tabEl.classList.add('automation-tab');

    // Icon
    const iconEl = document.createElement('span');
    iconEl.className = 'tab-icon';
    iconEl.textContent = getTabIcon(tab);

    // Title
    const titleEl = document.createElement('span');
    titleEl.className = 'tab-title';
    titleEl.textContent = tab.title || 'New Tab';
    titleEl.title = tab.title + '\n' + tab.url;

    // Close button (not for app tab)
    const closeEl = document.createElement('button');
    closeEl.className = 'tab-close';
    closeEl.textContent = '×';
    closeEl.addEventListener('click', function (e) {
      e.stopPropagation();
      window.electronAPI.closeTab(tab.id);
    });

    tabEl.appendChild(iconEl);
    tabEl.appendChild(titleEl);
    if (!tab.isAppTab) {
      tabEl.appendChild(closeEl);
    }

    // Click to switch tab
    tabEl.addEventListener('click', function () {
      window.electronAPI.switchTab(tab.id);
    });

    // Middle-click to close
    tabEl.addEventListener('auxclick', function (e) {
      if (e.button === 1 && !tab.isAppTab) {
        window.electronAPI.closeTab(tab.id);
      }
    });

    tabsContainer.appendChild(tabEl);
  }
}

/* ---- Event handlers ---- */

async function refreshState() {
  try {
    currentState = await window.electronAPI.getTabState();
    renderTabs();
  } catch (err) {
    console.error('[TabBar] Failed to get tab state:', err);
  }
}

// New tab button
newTabBtn.addEventListener('click', function () {
  window.electronAPI.createTab({
    url: 'about:blank',
    title: 'New Tab',
  });
});

// Navigation buttons
backBtn.addEventListener('click', function () { window.electronAPI.goBack(); });
forwardBtn.addEventListener('click', function () { window.electronAPI.goForward(); });
reloadBtn.addEventListener('click', function () { window.electronAPI.reload(); });

// Keyboard shortcuts
document.addEventListener('keydown', function (e) {
  // Ctrl/Cmd + T: New tab
  if ((e.ctrlKey || e.metaKey) && e.key === 't') {
    e.preventDefault();
    window.electronAPI.createTab({
      url: 'about:blank',
      title: 'New Tab',
    });
  }

  // Ctrl/Cmd + W: Close tab
  if ((e.ctrlKey || e.metaKey) && e.key === 'w') {
    e.preventDefault();
    if (currentState.activeTabId) {
      window.electronAPI.closeTab(currentState.activeTabId);
    }
  }

  // Ctrl/Cmd + R: Reload
  if ((e.ctrlKey || e.metaKey) && e.key === 'r') {
    e.preventDefault();
    window.electronAPI.reload();
  }
});

/* ---- Listen for changes from main process ---- */

window.electronAPI.onTabsChanged(function () {
  refreshState();
});

// Initial render
refreshState();
