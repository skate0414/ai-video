import type { ModelOption, BuiltinProviderId, ProviderSelectors } from './types.js';

/** IDs of the built-in providers. */
export const BUILTIN_PROVIDER_IDS: BuiltinProviderId[] = ['chatgpt', 'gemini', 'deepseek', 'kimi'];

/** Display labels for built-in providers. */
export const BUILTIN_PROVIDER_LABELS: Record<BuiltinProviderId, string> = {
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
};

/**
 * Default selector maps for known free-tier AI chat websites.
 *
 * These selectors are fragile by nature – the target sites update their
 * DOM regularly.  The workbench UI includes a "Selector Debugger" so the
 * operator can keep them up-to-date without touching code.
 */
export const DEFAULT_PROVIDERS: Record<BuiltinProviderId, ProviderSelectors> = {
  chatgpt: {
    chatUrl: 'https://chatgpt.com/',
    promptInput: '#prompt-textarea',
    sendButton: 'button[data-testid="send-button"]',
    responseBlock: '[data-message-author-role="assistant"]',
    readyIndicator: '#prompt-textarea',
    quotaExhaustedIndicator: 'text=You\'ve reached the current usage cap',
    modelPickerTrigger: 'button[data-testid="model-switcher-dropdown-button"]',
    modelOptionSelector: '[data-testid="model-switcher-dropdown"] [role="menuitem"], [data-testid="model-switcher-dropdown"] [role="option"]',
    fileUploadTrigger: 'button[aria-label="Attach files"], button[data-testid="composer-attach-button"]',
  },

  gemini: {
    chatUrl: 'https://gemini.google.com/app',
    // Gemini 2025+ uses contenteditable with role="textbox" (no longer .ql-editor)
    promptInput: '[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label*="Ask Gemini"], .ql-editor[contenteditable="true"], div[contenteditable="true"]',
    sendButton: 'button[aria-label="Send message"], button[aria-label*="Send"], button[aria-label*="发送"], button[type="submit"]',
    responseBlock: '[data-message-author-role="assistant"], .model-response-text, [class*="markdown"]',
    readyIndicator: '[contenteditable="true"][role="textbox"], [contenteditable="true"][aria-label*="Ask Gemini"], .ql-editor[contenteditable="true"], div[contenteditable="true"]',
    quotaExhaustedIndicator: 'text=quota',
    modelPickerTrigger: 'button[data-test-id="model-selector"], button[aria-label*="model" i], mat-select[aria-label*="model"], button[aria-haspopup="listbox"]',
    modelOptionSelector: 'mat-option, [role="option"], [role="menuitem"]',
    fileUploadTrigger: 'button[aria-label*="Upload" i], button[aria-label*="上传"], button[aria-label*="Add file" i], button[aria-label*="Attach" i], button[data-test-id="upload-button"]',
  },

  deepseek: {
    chatUrl: 'https://chat.deepseek.com/',
    promptInput: 'textarea#chat-input',
    sendButton: 'div[class*="send"]',
    responseBlock: '.ds-markdown',
    readyIndicator: 'textarea#chat-input',
    quotaExhaustedIndicator: 'text=limit',
    modelPickerTrigger: 'div[class*="model-select"], div[class*="ModelSelector"]',
    modelOptionSelector: 'div[class*="model-option"], div[class*="ModelOption"], [role="option"]',
    fileUploadTrigger: 'div[class*="upload"], button[class*="upload"], input[type="file"]',
  },

  kimi: {
    chatUrl: 'https://kimi.moonshot.cn/',
    promptInput: '[data-testid="msh-chatinput-editor"]',
    sendButton: '[data-testid="msh-chatinput-send-button"]',
    responseBlock: '.markdown-container',
    readyIndicator: '[data-testid="msh-chatinput-editor"]',
    quotaExhaustedIndicator: 'text=limit',
    modelPickerTrigger: '[data-testid="msh-model-switcher"], button[class*="model"]',
    modelOptionSelector: '[data-testid*="model-option"], [role="option"], [role="menuitem"]',
    fileUploadTrigger: '[data-testid="msh-chatinput-fileupload"], button[class*="upload"], button[aria-label*="上传"]',
  },
};

/**
 * Fallback model lists per provider.
 *
 * These are used only when dynamic model detection has not been run.
 * Each provider has a single "Default" entry that uses whatever model
 * the site defaults to (no click actions needed).
 *
 * After running "Detect Models" from the UI, the platform will use the
 * dynamically detected list instead.
 */
export const PROVIDER_MODELS: Record<string, ModelOption[]> = {
  chatgpt: [{ id: 'default', label: 'Default' }],
  gemini: [{ id: 'default', label: 'Default' }],
  deepseek: [{ id: 'default', label: 'Default' }],
  kimi: [{ id: 'default', label: 'Default' }],
};
