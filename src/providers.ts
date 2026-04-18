import type { ModelOption, BuiltinProviderId } from './types.js';

/** IDs of the built-in providers. */
export const BUILTIN_PROVIDER_IDS: readonly BuiltinProviderId[] = ['chatgpt', 'gemini', 'deepseek', 'kimi'] as const;

/** Display labels for built-in providers. */
export const BUILTIN_PROVIDER_LABELS: Readonly<Record<BuiltinProviderId, string>> = Object.freeze({
  chatgpt: 'ChatGPT',
  gemini: 'Gemini',
  deepseek: 'DeepSeek',
  kimi: 'Kimi',
});

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
export const PROVIDER_MODELS: Readonly<Record<string, readonly ModelOption[]>> = Object.freeze({
  chatgpt: Object.freeze([{ id: 'default', label: 'Default' }]),
  gemini: Object.freeze([{ id: 'default', label: 'Default' }]),
  deepseek: Object.freeze([{ id: 'default', label: 'Default' }]),
  kimi: Object.freeze([{ id: 'default', label: 'Default' }]),
});
