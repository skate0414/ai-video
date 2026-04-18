/* ------------------------------------------------------------------ */
/*  AI Chat Automation Workbench – type definitions                    */
/* ------------------------------------------------------------------ */

/* ---- Re-export shared types (single source of truth: shared/types.ts) ---- */

export type {
  ProviderId,
  ChatMode,
  ProviderInfo,
  Account,
  AiResource,
  AiResourceType,
  ModelOption,
  TaskItem,
  WorkbenchState,
  SelectorStrategy,
  SelectorChain,
  QueueEtaPattern,
  QueueDetectionConfig,
  SiteAutomationConfig,
  SelectorHealth,
  WorkbenchEvent,
} from '../shared/types.js';

export { WB_EVENT } from '../shared/types.js';

import type { ProviderId, ModelOption, WorkbenchState } from '../shared/types.js';

/* ---- Backend-only types ---- */

/** Built-in provider identifiers. */
export type BuiltinProviderId = 'chatgpt' | 'gemini' | 'deepseek' | 'kimi';

/** CSS / aria selectors that describe how to interact with a provider page. */
export interface ProviderSelectors {
  /** URL to open for a new chat session. */
  chatUrl: string;
  /** Selector for the prompt input (textarea / contenteditable). */
  promptInput: string;
  /** Selector for the send button (if Enter alone is insufficient). */
  sendButton?: string;
  /** Selector for the most-recent assistant response block. */
  responseBlock: string;
  /** Selector whose presence means "ready to accept a prompt". */
  readyIndicator: string;
  /** Selector or text pattern that indicates the free quota is used up. */
  quotaExhaustedIndicator?: string;
  /** Text substrings to detect quota/rate-limit messages (case-insensitive check). */
  quotaTextPatterns?: string[];
  /** Selector to click to open the model picker dropdown. */
  modelPickerTrigger?: string;
  /** Selector for each model option inside the opened dropdown. */
  modelOptionSelector?: string;
  /** Selector for the "+" / attachment button next to the chat input. */
  fileUploadTrigger?: string;
}
