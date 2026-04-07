/* ------------------------------------------------------------------ */
/*  Provider Presets — ready-to-use SiteAutomationConfig templates     */
/*  for known free-tier AI sites. Users can import these presets       */
/*  from the UI and customize selectors if needed.                     */
/* ------------------------------------------------------------------ */

import type { SiteAutomationConfig } from './types.js';

/**
 * All built-in presets keyed by a stable identifier.
 *
 * These are "factory defaults" — importing a preset copies it into the
 * user's configuration where it can be customised freely.
 */
export const PROVIDER_PRESETS: Record<string, SiteAutomationConfig> = {
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
        { selector: 'button[data-testid="send-button"]', method: 'css', priority: 3 },
      ],
      responseBlock: [
        { selector: '[data-message-author-role="assistant"]', method: 'css', priority: 3 },
      ],
      readyIndicator: [
        { selector: '#prompt-textarea', method: 'css', priority: 3 },
      ],
      quotaExhaustedIndicator: [
        { selector: "text=You've reached the current usage cap", method: 'text', priority: 3 },
      ],
      modelPickerTrigger: [
        { selector: 'button[data-testid="model-switcher-dropdown-button"]', method: 'css', priority: 3 },
      ],
      modelOptionSelector: [
        { selector: '[data-testid="model-switcher-dropdown"] [role="menuitem"]', method: 'css', priority: 3 },
        { selector: '[data-testid="model-switcher-dropdown"] [role="option"]', method: 'css', priority: 2 },
      ],
      fileUploadTrigger: [
        { selector: 'button[aria-label="Attach files"]', method: 'css', priority: 3 },
        { selector: 'button[data-testid="composer-attach-button"]', method: 'css', priority: 2 },
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

  /* ---- Video providers ---- */

  'jimeng-video': {
    id: 'jimeng-video',
    label: '即梦（视频生成）',
    type: 'video',
    siteUrl: 'https://jimeng.jianying.com/ai-tool/home?type=video&workspace=0',
    capabilities: { video: true, fileUpload: true },
    selectors: {
      promptInput: [
        { selector: 'textarea', method: 'css', priority: 3 },
        { selector: 'div[contenteditable="true"]', method: 'css', priority: 2 },
        { selector: '[role="textbox"]', method: 'css', priority: 1 },
      ],
      generateButton: [
        { selector: 'button:has-text("生成")', method: 'css', priority: 3 },
        { selector: 'button:has-text("发送")', method: 'css', priority: 2 },
        { selector: '[role="button"]:has-text("生成")', method: 'css', priority: 1 },
      ],
      resultElement: [
        { selector: 'video', method: 'css', priority: 3 },
        { selector: '.jimeng-enhancer-video-panel video', method: 'css', priority: 2 },
        { selector: '[class*="video"] video', method: 'css', priority: 1 },
      ],
      progressIndicator: [
        { selector: '[class*="loading"]', method: 'css', priority: 4 },
        { selector: '[class*="progress"]', method: 'css', priority: 3 },
        { selector: '[class*="spin"]', method: 'css', priority: 2 },
        { selector: '.semi-spin', method: 'css', priority: 1 },
      ],
      downloadButton: [
        { selector: 'button:has-text("下载")', method: 'css', priority: 3 },
        { selector: 'button:has-text("导出")', method: 'css', priority: 2 },
        { selector: 'a[download]', method: 'css', priority: 1 },
      ],
      imageUploadTrigger: [
        { selector: 'input[type="file"]', method: 'css', priority: 3 },
        { selector: 'button:has-text("上传")', method: 'css', priority: 2 },
        { selector: '[class*="upload"]', method: 'css', priority: 1 },
      ],
    },
    timing: { maxWaitMs: 300_000, pollIntervalMs: 5_000, hydrationDelayMs: 3_000 },
    profileDir: '',
    dailyLimits: { videos: 5 },
  },

  seedance: {
    id: 'seedance',
    label: 'Seedance',
    type: 'video',
    siteUrl: 'https://seedance.ai',
    capabilities: { video: true, fileUpload: true },
    selectors: {
      promptInput: [
        { selector: 'textarea[placeholder*="prompt"]', method: 'css', priority: 3 },
        { selector: 'textarea[placeholder*="描述"]', method: 'css', priority: 2 },
        { selector: 'textarea', method: 'css', priority: 1 },
      ],
      generateButton: [
        { selector: 'button[type="submit"]', method: 'css', priority: 3 },
        { selector: 'button:has-text("Generate")', method: 'css', priority: 2 },
        { selector: 'button:has-text("生成")', method: 'css', priority: 1 },
      ],
      resultElement: [
        { selector: 'video', method: 'css', priority: 3 },
        { selector: '[class*="result"] video', method: 'css', priority: 2 },
        { selector: '[class*="preview"] video', method: 'css', priority: 1 },
      ],
      downloadButton: [
        { selector: 'a[download]', method: 'css', priority: 3 },
        { selector: 'button:has-text("Download")', method: 'css', priority: 2 },
        { selector: 'button:has-text("下载")', method: 'css', priority: 1 },
      ],
      imageUploadTrigger: [
        { selector: 'button[aria-label*="upload"]', method: 'css', priority: 3 },
        { selector: '[class*="upload"]', method: 'css', priority: 2 },
        { selector: 'input[type="file"]', method: 'css', priority: 1 },
      ],
    },
    timing: { maxWaitMs: 300_000, pollIntervalMs: 5_000, hydrationDelayMs: 3_000 },
    profileDir: '',
    dailyLimits: { videos: 5 },
  },

  /* ---- Image providers ---- */

  'jimeng-image': {
    id: 'jimeng-image',
    label: '即梦（图片生成）',
    type: 'image',
    siteUrl: 'https://jimeng.jianying.com/ai-tool/home?type=image&workspace=0',
    capabilities: { image: true },
    selectors: {
      promptInput: [
        { selector: 'textarea', method: 'css', priority: 3 },
        { selector: 'div[contenteditable="true"]', method: 'css', priority: 2 },
        { selector: '[role="textbox"]', method: 'css', priority: 1 },
      ],
      generateButton: [
        { selector: 'button:has-text("生成")', method: 'css', priority: 3 },
        { selector: 'button:has-text("发送")', method: 'css', priority: 2 },
      ],
      resultElement: [
        { selector: 'img[class*="result"]', method: 'css', priority: 3 },
        { selector: '[class*="result"] img', method: 'css', priority: 2 },
        { selector: '[class*="image"] img', method: 'css', priority: 1 },
      ],
      progressIndicator: [
        { selector: '[class*="loading"]', method: 'css', priority: 3 },
        { selector: '[class*="progress"]', method: 'css', priority: 2 },
        { selector: '.semi-spin', method: 'css', priority: 1 },
      ],
      downloadButton: [
        { selector: 'button:has-text("下载")', method: 'css', priority: 3 },
        { selector: 'a[download]', method: 'css', priority: 2 },
      ],
    },
    timing: { maxWaitMs: 120_000, pollIntervalMs: 3_000, hydrationDelayMs: 3_000 },
    profileDir: '',
    dailyLimits: { images: 10 },
  },
};

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
 */
export function getPreset(id: string): SiteAutomationConfig | undefined {
  const preset = PROVIDER_PRESETS[id];
  if (!preset) return undefined;
  return JSON.parse(JSON.stringify(preset)) as SiteAutomationConfig;
}
