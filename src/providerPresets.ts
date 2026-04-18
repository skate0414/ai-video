/* ------------------------------------------------------------------ */
/*  Provider Presets — ready-to-use SiteAutomationConfig templates     */
/*  for known free-tier AI sites. Users can import these presets       */
/*  from the UI and customize selectors if needed.                     */
/* ------------------------------------------------------------------ */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import type { SiteAutomationConfig, QueueDetectionConfig } from './types.js';
import { resolveDataDir } from './dataDir.js';

/* ---- Queue detection rules loaded from JSON data sources ---- */

/**
 * Load queue-detection presets from JSON data files.
 *
 * Search order:
 * 1. User data directory (overrides) — `queue-detection-overrides.json`
 * 2. User data directory — `queue-detection-presets.json`
 * 3. Bundled `data/queue-detection-presets.json` — shipped defaults
 *
 * User overrides are merged on top of bundled defaults per provider.
 */
function loadQueueDetectionPresets(): Record<string, QueueDetectionConfig> {
  const BUNDLED_FILE = 'queue-detection-presets.json';
  const OVERRIDE_FILE = 'queue-detection-overrides.json';

  let bundled: Record<string, QueueDetectionConfig> = {};
  let overrides: Record<string, QueueDetectionConfig> = {};

  // 1. Load bundled defaults
  const dataDir = resolveDataDir();
  let bundledPath = join(dataDir, BUNDLED_FILE);
  if (!existsSync(bundledPath)) {
    bundledPath = resolve('data', BUNDLED_FILE);
  }
  if (existsSync(bundledPath)) {
    try { bundled = JSON.parse(readFileSync(bundledPath, 'utf-8')); } catch { /* ignore */ }
  }

  // 2. Load user overrides
  const overridePath = join(dataDir, OVERRIDE_FILE);
  if (existsSync(overridePath)) {
    try { overrides = JSON.parse(readFileSync(overridePath, 'utf-8')); } catch { /* ignore */ }
  }

  // 3. Merge: overrides replace bundled per-provider
  return { ...bundled, ...overrides };
}

let _queuePresetCache: Record<string, QueueDetectionConfig> | null = null;

/** Get merged queue detection presets (cached). */
export function getQueueDetectionPresets(): Record<string, QueueDetectionConfig> {
  if (!_queuePresetCache) _queuePresetCache = loadQueueDetectionPresets();
  return _queuePresetCache;
}

/** Invalidate cache so next access re-reads from disk. */
export function invalidateQueueDetectionCache(): void {
  _queuePresetCache = null;
}

/**
 * Save user queue detection overrides to the data directory.
 * Merges the given entries into the existing overrides file.
 */
export function saveQueueDetectionOverrides(overrides: Record<string, QueueDetectionConfig>): void {
  const dataDir = resolveDataDir();
  const overridePath = join(dataDir, 'queue-detection-overrides.json');

  // Load existing overrides to merge
  let existing: Record<string, QueueDetectionConfig> = {};
  if (existsSync(overridePath)) {
    try { existing = JSON.parse(readFileSync(overridePath, 'utf-8')); } catch { /* ignore */ }
  }

  const merged = { ...existing, ...overrides };
  mkdirSync(dataDir, { recursive: true });
  writeFileSync(overridePath, JSON.stringify(merged, null, 2), 'utf-8');
  invalidateQueueDetectionCache();
}

/**
 * Delete a provider's queue detection override.
 * Returns true if an entry was removed.
 */
export function deleteQueueDetectionOverride(providerId: string): boolean {
  const dataDir = resolveDataDir();
  const overridePath = join(dataDir, 'queue-detection-overrides.json');
  if (!existsSync(overridePath)) return false;

  let existing: Record<string, QueueDetectionConfig> = {};
  try { existing = JSON.parse(readFileSync(overridePath, 'utf-8')); } catch { return false; }

  if (!(providerId in existing)) return false;
  delete existing[providerId];
  writeFileSync(overridePath, JSON.stringify(existing, null, 2), 'utf-8');
  invalidateQueueDetectionCache();
  return true;
}

/**
 * All built-in presets keyed by a stable identifier.
 *
 * These are "factory defaults" — importing a preset copies it into the
 * user's configuration where it can be customised freely.
 */
export const PROVIDER_PRESETS: Readonly<Record<string, SiteAutomationConfig>> = Object.freeze({
  /* ---- Video providers ---- */

  klingai: {
    id: 'klingai',
    label: '可灵 (Kling AI)',
    type: 'video',
    siteUrl: 'https://klingai.com/',
    capabilities: { video: true, image: true },
    selectors: {
      promptInput: [
        { selector: 'textarea[placeholder*="描述"]', method: 'css', priority: 3 },
        { selector: 'textarea[placeholder*="escri"]', method: 'css', priority: 2 },
        { selector: 'textarea', method: 'css', priority: 1 },
      ],
      generateButton: [
        { selector: 'button:has-text("生成")', method: 'text', priority: 3 },
        { selector: 'button:has-text("Generate")', method: 'text', priority: 2 },
        { selector: 'button[class*="generate" i]', method: 'css', priority: 1 },
      ],
      resultElement: [
        { selector: 'video', method: 'css', priority: 3 },
        { selector: '[class*="video-player"]', method: 'css', priority: 2 },
      ],
      progressIndicator: [
        { selector: '[class*="progress"]', method: 'css', priority: 3 },
        { selector: '[class*="loading"]', method: 'css', priority: 2 },
        { selector: '[class*="generating"]', method: 'css', priority: 1 },
      ],
      downloadButton: [
        { selector: 'a[download]', method: 'css', priority: 5 },
        { selector: 'button:has-text("下载")', method: 'text', priority: 4 },
        { selector: 'button:has-text("Download")', method: 'text', priority: 3 },
        { selector: 'button:has-text("保存")', method: 'text', priority: 2 },
        { selector: 'button:has-text("Save")', method: 'text', priority: 1 },
      ],
      imageUploadTrigger: [
        { selector: 'input[type="file"][accept*="image"]', method: 'css', priority: 3 },
        { selector: 'button[class*="upload" i]', method: 'css', priority: 2 },
        { selector: '[class*="upload-trigger"]', method: 'css', priority: 1 },
      ],
    },
    timing: { maxWaitMs: 300_000, pollIntervalMs: 3_000, hydrationDelayMs: 3_000 },
    profileDir: '',
    dailyLimits: { videos: 10 },
  },

  /* ---- Chat providers ---- */

  chatgpt: {
    id: 'chatgpt',
    label: 'ChatGPT',
    type: 'chat',
    siteUrl: 'https://chatgpt.com/',
    capabilities: { text: true, image: true, fileUpload: true, webSearch: true },
    selectors: {
      promptInput: [
        { selector: '#prompt-textarea', method: 'css', priority: 3 },
        { selector: 'textarea', method: 'css', priority: 1 },
      ],
      sendButton: [
        { selector: 'button[data-testid="send-button"]', method: 'css', priority: 5 },
        { selector: 'button[aria-label="Send prompt"]', method: 'css', priority: 4 },
        { selector: 'button[aria-label="发送提示"]', method: 'css', priority: 3 },
        { selector: 'button[aria-label="发送"]', method: 'css', priority: 2 },
        { selector: 'button[type="submit"]', method: 'css', priority: 1 },
      ],
      responseBlock: [
        { selector: '[data-message-author-role="assistant"]', method: 'css', priority: 3 },
      ],
      readyIndicator: [
        { selector: '#prompt-textarea', method: 'css', priority: 3 },
      ],
      quotaExhaustedIndicator: [
        { selector: "text=You've reached the current usage cap", method: 'text', priority: 5 },
        { selector: 'text=您已达到当前使用上限', method: 'text', priority: 4 },
        { selector: 'text=usage cap', method: 'text', priority: 3 },
        { selector: 'text=rate limit', method: 'text', priority: 2 },
        { selector: 'text=too many requests', method: 'text', priority: 1 },
      ],
      modelPickerTrigger: [
        { selector: 'button[data-testid="model-switcher-dropdown-button"]', method: 'css', priority: 3 },
      ],
      modelOptionSelector: [
        { selector: '[data-testid="model-switcher-dropdown"] [role="menuitem"]', method: 'css', priority: 3 },
        { selector: '[data-testid="model-switcher-dropdown"] [role="option"]', method: 'css', priority: 2 },
      ],
      fileUploadTrigger: [
        { selector: 'button[aria-label="Attach files"]', method: 'css', priority: 5 },
        { selector: 'button[aria-label="附加文件"]', method: 'css', priority: 4 },
        { selector: 'button[data-testid="composer-attach-button"]', method: 'css', priority: 3 },
        { selector: 'button[aria-label*="上传"]', method: 'css', priority: 2 },
        { selector: 'input[type="file"]', method: 'css', priority: 1 },
      ],
    },
    timing: { maxWaitMs: 180_000, pollIntervalMs: 2_000, hydrationDelayMs: 2_000 },
    profileDir: '',
    dailyLimits: { text: 40 },
  },

  gemini: {
    id: 'gemini',
    label: 'Gemini',
    type: 'chat',
    siteUrl: 'https://gemini.google.com/app',
    capabilities: { text: true, image: true, fileUpload: true, webSearch: true },
    selectors: {
      promptInput: [
        // Gemini 2025+ uses contenteditable with role="textbox" (no longer .ql-editor)
        { selector: '[contenteditable="true"][role="textbox"]', method: 'css', priority: 5 },
        { selector: '[contenteditable="true"][aria-label*="Ask Gemini"]', method: 'css', priority: 4 },
        { selector: '.ql-editor[contenteditable="true"]', method: 'css', priority: 3 },
        { selector: 'div[contenteditable="true"][aria-label]', method: 'css', priority: 2 },
        { selector: 'div[contenteditable="true"]', method: 'css', priority: 1 },
      ],
      sendButton: [
        { selector: 'button[aria-label="Send message"]', method: 'css', priority: 4 },
        { selector: 'button[aria-label*="Send"]', method: 'css', priority: 3 },
        { selector: 'button[aria-label*="发送"]', method: 'css', priority: 2 },
        { selector: 'button[type="submit"]', method: 'css', priority: 1 },
      ],
      responseBlock: [
        // Gemini 2025+ uses various response container patterns
        { selector: '[data-message-author-role="assistant"]', method: 'css', priority: 5 },
        { selector: 'message-content [class*="markdown"]', method: 'css', priority: 4 },
        { selector: '.model-response-text', method: 'css', priority: 3 },
        { selector: '[class*="response-container"] [class*="markdown"]', method: 'css', priority: 2 },
        { selector: '[class*="markdown"]', method: 'css', priority: 1 },
      ],
      readyIndicator: [
        { selector: '[contenteditable="true"][role="textbox"]', method: 'css', priority: 5 },
        { selector: '[contenteditable="true"][aria-label*="Ask Gemini"]', method: 'css', priority: 4 },
        { selector: '.ql-editor[contenteditable="true"]', method: 'css', priority: 3 },
        { selector: 'div[contenteditable="true"][aria-label]', method: 'css', priority: 2 },
        { selector: 'div[contenteditable="true"]', method: 'css', priority: 1 },
      ],
      quotaExhaustedIndicator: [
        { selector: 'text=quota', method: 'text', priority: 3 },
        { selector: 'text=limit reached', method: 'text', priority: 2 },
        { selector: 'text=rate limit', method: 'text', priority: 1 },
      ],
      modelPickerTrigger: [
        { selector: 'button[data-test-id="model-selector"]', method: 'css', priority: 4 },
        { selector: 'button[aria-label*="model" i]', method: 'css', priority: 3 },
        { selector: 'mat-select[aria-label*="model"]', method: 'css', priority: 2 },
        { selector: 'button[aria-haspopup="listbox"]', method: 'css', priority: 1 },
      ],
      modelOptionSelector: [
        { selector: 'mat-option', method: 'css', priority: 3 },
        { selector: '[role="option"]', method: 'css', priority: 2 },
        { selector: '[role="menuitem"]', method: 'css', priority: 1 },
      ],
      fileUploadTrigger: [
        { selector: 'button[aria-label="Open upload file menu"]', method: 'css', priority: 8 },
        { selector: 'button.upload-card-button', method: 'css', priority: 7 },
        { selector: 'button:has-text("Tools")', method: 'css', priority: 6 },
        { selector: 'button:has-text("工具")', method: 'css', priority: 5 },
        { selector: 'button[aria-label*="Upload" i]', method: 'css', priority: 5 },
        { selector: 'button[aria-label*="上传"]', method: 'css', priority: 4 },
        { selector: 'button[aria-label*="Add file" i]', method: 'css', priority: 3 },
        { selector: 'button[aria-label*="Attach" i]', method: 'css', priority: 2 },
        { selector: 'button[data-test-id="upload-button"]', method: 'css', priority: 1 },
      ],
    },
    // Gemini 2025+ interface has a longer hydration cycle after redesign
    timing: { maxWaitMs: 180_000, pollIntervalMs: 2_000, hydrationDelayMs: 3_000 },
    profileDir: '',
    dailyLimits: { text: 50, images: 10 },
  },

  deepseek: {
    id: 'deepseek',
    label: 'DeepSeek',
    type: 'chat',
    siteUrl: 'https://chat.deepseek.com/',
    capabilities: { text: true, webSearch: true },
    selectors: {
      promptInput: [
        { selector: 'textarea#chat-input', method: 'css', priority: 3 },
        { selector: 'textarea', method: 'css', priority: 1 },
      ],
      sendButton: [
        { selector: 'div[class*="send"]', method: 'css', priority: 3 },
      ],
      responseBlock: [
        { selector: '.ds-markdown', method: 'css', priority: 3 },
      ],
      readyIndicator: [
        { selector: 'textarea#chat-input', method: 'css', priority: 3 },
      ],
      quotaExhaustedIndicator: [
        { selector: 'text=limit', method: 'text', priority: 3 },
      ],
      modelPickerTrigger: [
        { selector: 'div[class*="model-select"]', method: 'css', priority: 3 },
        { selector: 'div[class*="ModelSelector"]', method: 'css', priority: 2 },
      ],
      modelOptionSelector: [
        { selector: 'div[class*="model-option"]', method: 'css', priority: 3 },
        { selector: 'div[class*="ModelOption"]', method: 'css', priority: 2 },
        { selector: '[role="option"]', method: 'css', priority: 1 },
      ],
      fileUploadTrigger: [
        { selector: 'div[class*="upload"]', method: 'css', priority: 3 },
        { selector: 'button[class*="upload"]', method: 'css', priority: 2 },
        { selector: 'input[type="file"]', method: 'css', priority: 1 },
      ],
    },
    timing: { maxWaitMs: 180_000, pollIntervalMs: 2_000, hydrationDelayMs: 2_000 },
    profileDir: '',
    dailyLimits: { text: 50 },
  },

  kimi: {
    id: 'kimi',
    label: 'Kimi',
    type: 'chat',
    siteUrl: 'https://kimi.moonshot.cn/',
    capabilities: { text: true, fileUpload: true, webSearch: true },
    selectors: {
      promptInput: [
        { selector: '[data-testid="msh-chatinput-editor"]', method: 'css', priority: 3 },
      ],
      sendButton: [
        { selector: '[data-testid="msh-chatinput-send-button"]', method: 'css', priority: 3 },
      ],
      responseBlock: [
        { selector: '.markdown-container', method: 'css', priority: 3 },
      ],
      readyIndicator: [
        { selector: '[data-testid="msh-chatinput-editor"]', method: 'css', priority: 3 },
      ],
      quotaExhaustedIndicator: [
        { selector: 'text=limit', method: 'text', priority: 3 },
      ],
      modelPickerTrigger: [
        { selector: '[data-testid="msh-model-switcher"]', method: 'css', priority: 3 },
        { selector: 'button[class*="model"]', method: 'css', priority: 1 },
      ],
      modelOptionSelector: [
        { selector: '[data-testid*="model-option"]', method: 'css', priority: 3 },
        { selector: '[role="option"]', method: 'css', priority: 2 },
        { selector: '[role="menuitem"]', method: 'css', priority: 1 },
      ],
      fileUploadTrigger: [
        { selector: '[data-testid="msh-chatinput-fileupload"]', method: 'css', priority: 3 },
        { selector: 'button[class*="upload"]', method: 'css', priority: 2 },
        { selector: 'button[aria-label*="上传"]', method: 'css', priority: 1 },
      ],
    },
    timing: { maxWaitMs: 180_000, pollIntervalMs: 2_000, hydrationDelayMs: 2_000 },
    profileDir: '',
    dailyLimits: { text: 50 },
  },

});

/**
 * Get a list of all available preset IDs and labels, grouped by type.
 */
export function listPresets(): Array<{ id: string; label: string; type: string }> {
  return Object.values(PROVIDER_PRESETS).map(p => ({
    id: p.id,
    label: p.label,
    type: p.type,
  }));
}

/**
 * Get a deep copy of a preset by ID, ready for customisation.
 * Merges queue detection rules from JSON data sources.
 */
export function getPreset(id: string): SiteAutomationConfig | undefined {
  const preset = PROVIDER_PRESETS[id];
  if (!preset) return undefined;
  const copy = JSON.parse(JSON.stringify(preset)) as SiteAutomationConfig;
  // Merge queue detection from JSON data if available
  const queuePresets = getQueueDetectionPresets();
  if (queuePresets[id]) {
    copy.queueDetection = queuePresets[id];
  }
  return copy;
}

/**
 * Try to match a URL to an existing preset by comparing hostnames.
 * Returns the matched preset (deep copy) or undefined.
 */
export function matchPresetByUrl(url: string): SiteAutomationConfig | undefined {
  try {
    const host = new URL(url).hostname.replace(/^www\./, '');
    for (const preset of Object.values(PROVIDER_PRESETS)) {
      const presetHost = new URL(preset.siteUrl).hostname.replace(/^www\./, '');
      if (host === presetHost) {
        const copy = JSON.parse(JSON.stringify(preset)) as SiteAutomationConfig;
        const queuePresets = getQueueDetectionPresets();
        if (queuePresets[preset.id]) {
          copy.queueDetection = queuePresets[preset.id];
        }
        return copy;
      }
    }
  } catch { /* invalid URL */ }
  return undefined;
}
