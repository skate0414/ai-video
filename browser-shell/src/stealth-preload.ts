/**
 * stealth-preload.ts — Preload script that injects Chrome stealth overrides
 * into the main world BEFORE any page script runs.
 *
 * Using webFrame.executeJavaScript() from a preload is the reliable way to
 * modify page globals (navigator.webdriver, navigator.userAgentData, etc.)
 * before page scripts can detect them.  This avoids the conflict between
 * webContents.debugger.attach() and --remote-debugging-port that crashes
 * the Electron process.
 *
 * Compiled as CJS (stealth-preload.cjs) since Electron preloads with
 * contextIsolation must be CommonJS.
 */

const { webFrame } = require('electron');

const stealthCode = `(function() {
  // 1. navigator.webdriver = false
  Object.defineProperty(navigator, 'webdriver', {
    get: function() { return false; },
    configurable: true,
  });

  // 2. navigator.userAgentData — remove Electron brand, add Chrome
  try {
    var brands = [
      { brand: 'Chromium',       version: '136' },
      { brand: 'Google Chrome',  version: '136' },
      { brand: 'Not.A/Brand',    version: '99'  },
    ];
    var uaData = {
      brands: brands,
      mobile: false,
      platform: 'macOS',
      getHighEntropyValues: function(hints) {
        return Promise.resolve({
          brands: brands,
          mobile: false,
          platform: 'macOS',
          platformVersion: '15.0.0',
          architecture: 'arm',
          bitness: '64',
          model: '',
          uaFullVersion: '136.0.0.0',
          fullVersionList: brands.map(function(b) {
            return { brand: b.brand, version: b.version + '.0.0.0' };
          }),
        });
      },
      toJSON: function() {
        return { brands: brands, mobile: false, platform: 'macOS' };
      },
    };
    Object.defineProperty(navigator, 'userAgentData', {
      get: function() { return uaData; },
      configurable: true,
    });
  } catch(e) {}

  // 3. window.chrome — Google checks chrome.runtime, chrome.app, chrome.csi,
  //    chrome.loadTimes
  if (!window.chrome) { window.chrome = {}; }
  if (!window.chrome.runtime) {
    window.chrome.runtime = {
      connect: function() {},
      sendMessage: function() {},
      id: undefined,
    };
  }
  if (!window.chrome.app) {
    window.chrome.app = {
      isInstalled: false,
      InstallState: {
        DISABLED: 'disabled',
        INSTALLED: 'installed',
        NOT_INSTALLED: 'not_installed',
      },
      RunningState: {
        CANNOT_RUN: 'cannot_run',
        READY_TO_RUN: 'ready_to_run',
        RUNNING: 'running',
      },
    };
  }
  if (!window.chrome.csi) {
    window.chrome.csi = function() {
      return { startE: Date.now(), onloadT: 0, pageT: Date.now(), tran: 15 };
    };
  }
  if (!window.chrome.loadTimes) {
    window.chrome.loadTimes = function() {
      return {
        requestTime: Date.now() / 1000,
        startLoadTime: Date.now() / 1000,
        commitLoadTime: Date.now() / 1000,
        finishDocumentLoadTime: Date.now() / 1000,
        finishLoadTime: Date.now() / 1000,
        firstPaintTime: Date.now() / 1000,
        firstPaintAfterLoadTime: 0,
        navigationType: 'Other',
        wasFetchedViaSpdy: false,
        wasNpnNegotiated: true,
        npnNegotiatedProtocol: 'h2',
        wasAlternateProtocolAvailable: false,
        connectionInfo: 'h2',
      };
    };
  }

  // 4. navigator.plugins — Electron has empty plugins; fake common ones
  Object.defineProperty(navigator, 'plugins', {
    get: function() {
      var arr = [
        { name: 'Chrome PDF Plugin',  filename: 'internal-pdf-viewer', description: 'Portable Document Format', length: 1 },
        { name: 'Chrome PDF Viewer',  filename: 'mhjfbmdgcfjbbpaeojofohoefgiehjai', description: '', length: 1 },
        { name: 'Native Client',      filename: 'internal-nacl-plugin', description: '', length: 2 },
      ];
      arr.item = function(i) { return this[i] || null; };
      arr.namedItem = function(n) {
        return this.find(function(p) { return p.name === n; }) || null;
      };
      arr.refresh = function() {};
      return arr;
    },
    configurable: true,
  });

  // 5. navigator.languages — ensure it's non-empty
  if (!navigator.languages || navigator.languages.length === 0) {
    Object.defineProperty(navigator, 'languages', {
      get: function() { return ['zh-CN', 'zh', 'en']; },
      configurable: true,
    });
  }

  // 6. window.Notification — Electron may lack this
  if (typeof Notification === 'undefined') {
    window.Notification = {
      permission: 'default',
      requestPermission: function() { return Promise.resolve('default'); },
    };
  }

  // 7. navigator.permissions.query — return realistic results
  var origQuery = navigator.permissions && navigator.permissions.query;
  if (navigator.permissions) {
    navigator.permissions.query = function(desc) {
      if (desc && desc.name === 'notifications') {
        return Promise.resolve({ state: Notification.permission, onchange: null });
      }
      return origQuery
        ? origQuery.call(navigator.permissions, desc)
        : Promise.reject(new TypeError('Invalid permission'));
    };
  }
})();`;

// Inject into the main world — this runs before any page <script>.
// Wrapped in try/catch so a missing or broken webFrame can never crash the renderer.
try {
  webFrame.executeJavaScript(stealthCode).catch(() => {});
} catch {
  // webFrame.executeJavaScript may not be available in all Electron versions
}
