/* ------------------------------------------------------------------ */
/*  AI Chat Automation Workbench – type definitions                    */
/* ------------------------------------------------------------------ */

/* ---- Re-export shared types (single source of truth: shared/types.ts) ---- */

export type {
  ProviderId,
  ChatMode,
  ProviderInfo,
  Account,
  ModelOption,
  TaskItem,
  WorkbenchState,
  SelectorStrategy,
  SelectorChain,
  SiteAutomationConfig,
  SelectorHealth,
} from '../shared/types.js';

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
  /** Selector to click to open the model picker dropdown. */
  modelPickerTrigger?: string;
  /** Selector for each model option inside the opened dropdown. */
  modelOptionSelector?: string;
  /** Selector for the "+" / attachment button next to the chat input. */
  fileUploadTrigger?: string;
}

/** Events pushed to the UI via SSE. */
export type WorkbenchEvent =
  | { type: 'state'; payload: WorkbenchState }
  | { type: 'task_started'; payload: { taskId: string; accountId: string } }
  | { type: 'task_done'; payload: { taskId: string; answer: string } }
  | { type: 'task_failed'; payload: { taskId: string; error: string } }
  | { type: 'quota_exhausted'; payload: { accountId: string } }
  | { type: 'account_switched'; payload: { fromAccountId: string; toAccountId: string } }
  | { type: 'login_browser_opened'; payload: { accountId: string } }
  | { type: 'login_browser_closed'; payload: { accountId: string } }
  | { type: 'models_detected'; payload: { provider: ProviderId; models: ModelOption[] } }
  | { type: 'stopped'; payload: Record<string, never> }
  // Pipeline events
  | { type: 'pipeline_created'; payload: { projectId: string } }
  | { type: 'pipeline_stage'; payload: { projectId: string; stage: string; status: string; progress?: number } }
  | { type: 'pipeline_artifact'; payload: { projectId: string; stage: string; artifactType: string; summary?: string } }
  | { type: 'pipeline_log'; payload: { projectId: string; entry: { id: string; timestamp: string; message: string; type: string; stage?: string } } }
  | { type: 'pipeline_error'; payload: { projectId: string; stage: string; error: string } }
  | { type: 'pipeline_complete'; payload: { projectId: string } };
