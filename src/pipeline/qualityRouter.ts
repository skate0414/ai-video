/* ------------------------------------------------------------------ */
/*  BackendRouter – routes compilation tasks to chat adapters         */
/*  All stages use free chat adapters. Video generation uses          */
/*  aivideomaker API (free). No quality tiers — single free mode.    */
/* ------------------------------------------------------------------ */

import type { PipelineStage, AIAdapter, ModelOverrides } from '../pipeline/types.js';
import type { ProviderCapabilityRegistry } from './providerRegistry.js';

export type AdapterType = 'chat' | 'api';

export interface QualityDecision {
  adapter: AdapterType;
  provider?: string;
  model?: string;
  reason: string;
}

/**
 * Default routing rules — all stages use chat except video generation (API).
 * Maps each task type to a default provider preference.
 * C3: Exported for external inspection and override composition.
 */
export const DEFAULT_ROUTES: Readonly<Record<string, QualityDecision>> = Object.freeze({
  safety_check:      { adapter: 'chat', reason: 'Safety check is simple classification' },
  video_analysis:    { adapter: 'chat', provider: 'chatgpt', reason: 'ChatGPT for video style analysis (Gemini blocked)' },
  fact_research:     { adapter: 'chat', provider: 'chatgpt', reason: 'ChatGPT for research (Gemini blocked)' },
  claim_verification:{ adapter: 'chat', reason: 'Cross-verify with different provider account' },
  calibration:       { adapter: 'chat', reason: 'Simple calculation task' },
  narrative_map:     { adapter: 'chat', provider: 'chatgpt', reason: 'ChatGPT for narrative structure (Gemini blocked)' },
  script_generation: { adapter: 'chat', provider: 'claude', reason: 'Claude — best Chinese creative writing & instruction following' },
  script_skeleton:   { adapter: 'chat', provider: 'claude', reason: 'Claude — structural reasoning for skeleton' },
  script_writing:    { adapter: 'chat', provider: 'claude', reason: 'Claude — creative writing quality' },
  quality_review:    { adapter: 'chat', provider: 'chatgpt', reason: 'Cross-model QA — must differ from script generator to avoid self-review blind spots' },
  temporal_planning: { adapter: 'chat', reason: 'Pure computation — no AI provider needed' },
  visual_prompts:    { adapter: 'chat', provider: 'chatgpt', reason: 'ChatGPT for visual prompt generation (Gemini blocked)' },
  image_generation:  { adapter: 'chat', provider: 'chatgpt', reason: 'ChatGPT free chat can generate images' },
  video_generation:  { adapter: 'api', provider: 'aivideomaker', reason: 'aivideomaker free API for video generation' },
  tts:               { adapter: 'chat', reason: 'Use free TTS service (edge-tts)' },
  assembly:          { adapter: 'chat', reason: 'Assembly uses FFmpeg, not AI' },
  video_ir_compile:  { adapter: 'chat', reason: 'Pure computation — no AI provider needed' },
});

/**
 * Route a pipeline task to the appropriate adapter.
 * If the project has a per-task-type override, that takes priority.
 */
export function routeTask(
  _stage: PipelineStage,
  taskType: string,
  overrides?: ModelOverrides,
): QualityDecision {
  // Method C: per-task-type override takes priority
  if (overrides?.[taskType]) {
    const ov = overrides[taskType]!;
    return {
      adapter: ov.adapter,
      model: ov.model,
      provider: ov.provider,
      reason: `User override for ${taskType}`,
    };
  }

  return DEFAULT_ROUTES[taskType] ?? { adapter: 'chat', reason: 'Default route — free chat' };
}

/**
 * Select the appropriate adapter instance.
 * Always returns the chat adapter (free mode).
 * Only returns apiAdapter when the decision explicitly requests API.
 */
export function selectAdapter(
  decision: QualityDecision,
  chatAdapter: AIAdapter,
  apiAdapter?: AIAdapter,
): AIAdapter {
  if (decision.adapter === 'api' && apiAdapter) {
    return apiAdapter;
  }
  return chatAdapter;
}

/**
 * Resolve the best provider for a stage using the capability registry.
 * Falls back to the default route's provider if registry has no match.
 */
export function resolveProvider(
  stage: PipelineStage,
  taskType: string,
  registry: ProviderCapabilityRegistry,
  overrides?: ModelOverrides,
): QualityDecision {
  // Get base decision from route defaults
  const decision = routeTask(stage, taskType, overrides);

  // If user override or API mode, don't change provider
  if (decision.adapter === 'api') return decision;
  if (overrides?.[taskType]) return decision;

  // If the route specifies a provider, check if it's available in registry
  if (decision.provider) {
    const cap = registry.get(decision.provider);
    if (cap && !cap.quotaExhausted) return decision;

    // Provider exhausted or not found — try to find alternative
    const need: Record<string, boolean> = {};
    if (taskType === 'video_analysis' || taskType === 'fact_research') need.text = true;
    if (taskType === 'fact_research') need.webSearch = true;
    if (taskType === 'video_analysis') need.fileUpload = true;
    if (taskType === 'image_generation') need.imageGeneration = true;
    if (taskType === 'video_generation') need.videoGeneration = true;

    const alternatives = registry.findProviders(need);
    if (alternatives.length > 0) {
      return {
        ...decision,
        provider: alternatives[0].providerId,
        reason: `${decision.provider} 配额已用完，切换到 ${alternatives[0].providerId}`,
      };
    }
  }

  return decision;
}
