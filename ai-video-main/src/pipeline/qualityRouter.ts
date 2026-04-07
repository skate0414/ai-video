/* ------------------------------------------------------------------ */
/*  QualityRouter – dynamically routes tasks to free chat or paid API  */
/*  Supports per-task-type model overrides (Method C) and smart        */
/*  priority: video > image > tts > text (by quota scarcity).         */
/* ------------------------------------------------------------------ */

import type { PipelineStage, QualityTier, AIAdapter, ModelOverrides } from '../pipeline/types.js';
import { FallbackAdapter } from '../adapters/fallbackAdapter.js';
import type { ProviderCapabilityRegistry } from './providerRegistry.js';

export type AdapterType = 'chat' | 'api';

export interface QualityDecision {
  adapter: AdapterType;
  provider?: string;
  model?: string;
  reason: string;
}

interface RouteRule {
  stage: PipelineStage;
  taskType: string;
  free: QualityDecision;
  balanced: QualityDecision;
  premium: QualityDecision;
}

/**
 * Routing rules — defines which adapter to use for each task type.
 *
 * Balanced priority (by quota scarcity):
 *   video_generation → API first (free quota is minimal)
 *   image_generation → chat first + FallbackAdapter auto-fallback
 *   tts              → chat first (edge-tts is free & unlimited)
 *   text tasks       → chat first (generous free tier)
 */
const ROUTE_TABLE: RouteRule[] = [
  // 1. Capability Assessment (safety check)
  {
    stage: 'CAPABILITY_ASSESSMENT',
    taskType: 'safety_check',
    free:     { adapter: 'chat', reason: 'Safety check is simple classification' },
    balanced: { adapter: 'chat', reason: 'Safety check is simple classification' },
    premium:  { adapter: 'api', model: 'gemini-3.1-pro-preview', reason: 'Premium uses API for reliable safety classification' },
  },
  // 2. Style Extraction (video analysis)
  {
    stage: 'STYLE_EXTRACTION',
    taskType: 'video_analysis',
    free:     { adapter: 'chat', provider: 'gemini', reason: 'Gemini free chat supports video upload' },
    balanced: { adapter: 'chat', provider: 'gemini', reason: 'Gemini free chat supports video upload' },
    premium:  { adapter: 'api',  model: 'gemini-3.1-pro-preview', reason: 'API for reliable structured output' },
  },
  // 3. Research
  {
    stage: 'RESEARCH',
    taskType: 'fact_research',
    free:     { adapter: 'chat', provider: 'gemini', reason: 'Gemini has integrated Google Search' },
    balanced: { adapter: 'chat', provider: 'gemini', reason: 'Gemini has integrated Google Search' },
    premium:  { adapter: 'api',  model: 'gemini-3.1-pro-preview', reason: 'API with grounding for reliability' },
  },
  {
    stage: 'RESEARCH',
    taskType: 'claim_verification',
    free:     { adapter: 'chat', reason: 'Cross-verify with different provider account' },
    balanced: { adapter: 'chat', reason: 'Cross-verify with different provider account' },
    premium:  { adapter: 'api',  model: 'gemini-3.1-pro-preview', reason: 'API for structured verification' },
  },
  // 4. Narrative Map (includes calibration)
  {
    stage: 'NARRATIVE_MAP',
    taskType: 'calibration',
    free:     { adapter: 'chat', reason: 'Simple calculation task' },
    balanced: { adapter: 'chat', reason: 'Simple calculation task' },
    premium:  { adapter: 'api', model: 'gemini-3.1-pro-preview', reason: 'Premium uses API for deterministic calibration output' },
  },
  // 5. Narrative Map (narrative structure)
  {
    stage: 'NARRATIVE_MAP',
    taskType: 'narrative_map',
    free:     { adapter: 'chat', reason: 'Narrative structure is text-based' },
    balanced: { adapter: 'chat', reason: 'Narrative structure is text-based' },
    premium:  { adapter: 'api',  model: 'gemini-3.1-pro-preview', reason: 'API for reliable narrative structure' },
  },
  // 6. Script Generation
  {
    stage: 'SCRIPT_GENERATION',
    taskType: 'script_generation',
    free:     { adapter: 'chat', reason: 'Creative writing works well in chat' },
    balanced: { adapter: 'chat', reason: 'Creative writing works well in chat' },
    premium:  { adapter: 'api',  model: 'gemini-3.1-pro-preview', reason: 'API for reliable JSON output' },
  },
  // 7. QA Review
  {
    stage: 'QA_REVIEW',
    taskType: 'quality_review',
    free:     { adapter: 'chat', reason: 'QA review is text analysis' },
    balanced: { adapter: 'chat', reason: 'QA review is text analysis' },
    premium:  { adapter: 'api',  model: 'gemini-3.1-pro-preview', reason: 'API for structured review output' },
  },
  // 8. Storyboard
  {
    stage: 'STORYBOARD',
    taskType: 'visual_prompts',
    free:     { adapter: 'chat', reason: 'Visual prompt generation is text-based' },
    balanced: { adapter: 'chat', reason: 'Visual prompt generation is text-based' },
    premium:  { adapter: 'api',  model: 'gemini-3.1-pro-preview', reason: 'API for structured JSON storyboard' },
  },
  // 9. Reference Image
  {
    stage: 'REFERENCE_IMAGE',
    taskType: 'image_generation',
    free:     { adapter: 'chat', provider: 'chatgpt', reason: 'ChatGPT free chat can generate images' },
    balanced: { adapter: 'chat', provider: 'chatgpt', reason: 'Free first, FallbackAdapter auto-fallback to API' },
    premium:  { adapter: 'api',  model: 'imagen-3-pro', reason: 'Paid API for high quality' },
  },
  // 10. Keyframe Gen — ChatGPT (DALL-E) for free tier; Gemini API for balanced/premium
  {
    stage: 'KEYFRAME_GEN',
    taskType: 'image_generation',
    free:     { adapter: 'chat', provider: 'chatgpt', reason: 'ChatGPT DALL-E for keyframes (Gemini free image quota exhausted)' },
    balanced: { adapter: 'api',  model: 'gemini-2.5-flash-image', reason: 'API direct for keyframe quality' },
    premium:  { adapter: 'api',  model: 'imagen-4.0-generate-001', reason: 'Paid API for high quality' },
  },
  // 11. Video Gen — smart priority: most expensive resource
  {
    stage: 'VIDEO_GEN',
    taskType: 'video_generation',
    free:     { adapter: 'chat', provider: 'kling', reason: 'Use 可灵 web for video gen' },
    balanced: { adapter: 'api',  model: 'veo-3.1', reason: 'Video is scarcest resource — prefer paid API' },
    premium:  { adapter: 'api',  model: 'veo-3.1', reason: 'Paid Veo API for quality' },
  },
  // 12. TTS — edge-tts is free
  {
    stage: 'TTS',
    taskType: 'tts',
    free:     { adapter: 'chat', reason: 'Use free TTS service (edge-tts)' },
    balanced: { adapter: 'chat', reason: 'edge-tts is free & unlimited, FallbackAdapter auto-fallback' },
    premium:  { adapter: 'api',  model: 'gemini-2.5-flash-preview-tts', reason: 'Paid TTS for quality' },
  },
  // 13. Assembly — FFmpeg only, no AI adapter needed
  {
    stage: 'ASSEMBLY',
    taskType: 'assembly',
    free:     { adapter: 'chat', reason: 'Assembly uses FFmpeg, not AI' },
    balanced: { adapter: 'chat', reason: 'Assembly uses FFmpeg, not AI' },
    premium:  { adapter: 'chat', reason: 'Assembly uses FFmpeg, not AI' },
  },
];

/**
 * Route a pipeline task to the appropriate adapter.
 * If the project has a per-task-type override, that takes priority over the route table.
 */
export function routeTask(
  stage: PipelineStage,
  taskType: string,
  qualityTier: QualityTier,
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

  const rule = ROUTE_TABLE.find(r => r.stage === stage && r.taskType === taskType);

  if (!rule) {
    // Default: use chat for free/balanced, API for premium
    if (qualityTier === 'premium') {
      return { adapter: 'api', model: 'gemini-3.1-pro-preview', reason: 'Default premium route' };
    }
    return { adapter: 'chat', reason: 'Default free/balanced route' };
  }

  return rule[qualityTier];
}

/**
 * Select the appropriate adapter instance based on the quality decision.
 *
 * In balanced mode with an available apiAdapter:
 *   - If the route says 'api' → use apiAdapter directly (e.g. video_generation)
 *   - If the route says 'chat' → wrap with FallbackAdapter(chat, api) for auto-fallback
 * In premium mode: always prefer apiAdapter when available.
 * In free mode: always chatAdapter.
 */
export function selectAdapter(
  decision: QualityDecision,
  chatAdapter: AIAdapter,
  apiAdapter?: AIAdapter,
  qualityTier: QualityTier = 'free',
): AIAdapter {
  // No api adapter available — always chat
  if (!apiAdapter) return chatAdapter;

  if (qualityTier === 'premium') {
    // Premium always uses paid API
    return apiAdapter;
  }

  if (qualityTier === 'balanced') {
    if (decision.adapter === 'api') {
      // Route explicitly wants API (e.g. video_generation) → use it
      return apiAdapter;
    }
    // Route says chat → wrap with auto-fallback to API on quota errors
    return new FallbackAdapter(chatAdapter, apiAdapter);
  }

  // free tier — use chat by default, but respect explicit API routing when apiAdapter exists
  if (decision.adapter === 'api') {
    return apiAdapter;
  }
  return chatAdapter;
}

/**
 * Resolve the best provider for a stage using the capability registry.
 * Falls back to the route table's hardcoded provider if registry has no match.
 */
export function resolveProvider(
  stage: PipelineStage,
  taskType: string,
  qualityTier: QualityTier,
  registry: ProviderCapabilityRegistry,
  overrides?: ModelOverrides,
): QualityDecision {
  // Get base decision from route table
  const decision = routeTask(stage, taskType, qualityTier, overrides);

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
