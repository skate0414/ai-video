/* ------------------------------------------------------------------ */
/*  Prompt resolver – runtime prompt override layer                   */
/*  Implements project-level prompt overrides following the same      */
/*  pattern as modelOverrides and stageProviderOverrides.             */
/*  Priority: project.promptOverrides[name] > default from prompts.ts*/
/* ------------------------------------------------------------------ */

import type { PipelineProject } from './types.js';
import * as defaults from './prompts.js';

/** Map of all exported prompt constant names to their default text. */
const PROMPT_DEFAULTS: Record<string, string> = {};

// Build defaults map from all string exports of prompts.ts
for (const [key, value] of Object.entries(defaults)) {
  if (typeof value === 'string') {
    PROMPT_DEFAULTS[key] = value;
  }
}

/**
 * Resolve a prompt template by name.
 * Project-level override takes priority over the hardcoded default.
 */
export function resolvePrompt(
  promptName: string,
  project?: Pick<PipelineProject, 'promptOverrides'>,
): string {
  const override = project?.promptOverrides?.[promptName];
  if (override != null) return override;
  return PROMPT_DEFAULTS[promptName] ?? '';
}

/**
 * Return all known prompt names with their default text,
 * active override (if any), and the effective value.
 */
export function getAllPrompts(
  project?: Pick<PipelineProject, 'promptOverrides'>,
): Record<string, { default: string; override: string | null; active: string }> {
  const result: Record<string, { default: string; override: string | null; active: string }> = {};
  for (const [name, defaultText] of Object.entries(PROMPT_DEFAULTS)) {
    const override = project?.promptOverrides?.[name] ?? null;
    result[name] = {
      default: defaultText,
      override,
      active: override ?? defaultText,
    };
  }
  return result;
}

/**
 * Return all prompt constant names (for listing available overrides).
 */
export function getPromptNames(): string[] {
  return Object.keys(PROMPT_DEFAULTS);
}

/**
 * Return default text for a specific prompt.
 */
export function getPromptDefault(promptName: string): string | undefined {
  return PROMPT_DEFAULTS[promptName];
}
