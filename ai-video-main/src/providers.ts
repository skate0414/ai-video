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
    // Verified 2026-04-02: <div id="prompt-textarea" class="ProseMirror" contenteditable="true" role="textbox">
    promptInput: '#prompt-textarea',
    // Verified 2026-04-02: <button data-testid="send-button" aria-label="发送提示" class="composer-submit-btn">
    // Only visible when input has text. Fallback to Enter key in sendPrompt() if not found.
    sendButton: 'button[data-testid="send-button"], button.composer-submit-btn, button[aria-label="发送提示"], button[aria-label*="Send" i]',
    // Verified 2026-04-02: <div data-message-author-role="assistant" class="text-message ..."> confirmed working
    responseBlock: '[data-message-author-role="assistant"]',
    readyIndicator: '#prompt-textarea',
    quotaExhaustedIndicator: 'text=You\'ve reached the current usage cap, text=You\'ve hit the free plan limit',
    quotaTextPatterns: ['usage cap', 'free plan limit', 'image generation requests', 'rate limit'],
    modelPickerTrigger: 'button[data-testid="model-switcher-dropdown-button"]',
    modelOptionSelector: '[data-testid="model-switcher-dropdown"] [role="menuitem"], [data-testid="model-switcher-dropdown"] [role="option"]',
    // Verified 2026-04-02: ChatGPT has direct input[type="file"] elements (no button click needed)
    // #upload-files = general files, #upload-photos = images, #upload-camera = camera
    fileUploadTrigger: 'input#upload-files, button[aria-label="Attach files"], button[data-testid="composer-attach-button"]',
  },

  gemini: {
    chatUrl: 'https://gemini.google.com/app',
    // Verified 2026-04-02: <div class="ql-editor" contenteditable="true" role="textbox" aria-label="Enter a prompt for Gemini"> inside <RICH-TEXTAREA>
    promptInput: '.ql-editor[contenteditable="true"], [contenteditable="true"][aria-label="Enter a prompt for Gemini"], [contenteditable="true"][role="textbox"], rich-textarea [contenteditable="true"]',
    // Verified 2026-04-02: <button class="send-button submit" aria-label="Send message">
    sendButton: 'button.send-button, button[aria-label="Send message"], [aria-label*="Send" i], [aria-label*="发送"]',
    // Verified 2026-04-02: <STRUCTURED-CONTENT-CONTAINER class="model-response-text"> (textLen:51, pure AI text)
    // Parent chain: div.response-content → div.response-container-content (textLen:64, includes "Gemini said" prefix)
    responseBlock: '.model-response-text, .response-container-content, .response-content, .presented-response-container',
    readyIndicator: '.ql-editor[contenteditable="true"], [aria-label="Enter a prompt for Gemini"]',
    quotaExhaustedIndicator: 'text=quota',
    // Verified 2026-04-02: <div class="model-picker-container">
    modelPickerTrigger: '.model-picker-container button, button[aria-label*="model" i], button[aria-haspopup="listbox"]',
    modelOptionSelector: 'mat-option, [role="option"], [role="menuitem"]',
    // Verified 2026-04-02: <button class="upload-card-button" aria-label="Open upload file menu">
    // This is a two-step menu: click this button first, then select "Upload from computer" in the popup menu.
    fileUploadTrigger: 'button[aria-label="Open upload file menu"], button.upload-card-button, [aria-label*="upload file menu" i], [aria-label*="Upload" i], [aria-label*="上传"]',
  },

  deepseek: {
    chatUrl: 'https://chat.deepseek.com/',
    promptInput: 'textarea#chat-input',
    sendButton: 'div[class*="send"], button[type="submit"]',
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
