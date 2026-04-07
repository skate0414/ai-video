/* ------------------------------------------------------------------ */
/*  ResourcePlanner – pre-flight resource planning for the pipeline   */
/*  Generates a resource allocation plan before pipeline execution,   */
/*  estimating costs and assigning providers to each stage.           */
/* ------------------------------------------------------------------ */

import type { PipelineStage, QualityTier, ModelOverrides } from './types.js';
import type { ProviderCapabilityRegistry, ProviderCapability } from './providerRegistry.js';
import type { SessionGroup, SessionManager } from './sessionManager.js';
import { routeTask, type QualityDecision } from './qualityRouter.js';

/** Resource plan for a single pipeline stage. */
export interface StageResourcePlan {
  stage: PipelineStage;
  taskType: string;
  /** Resolved provider that will be used. */
  provider: string;
  /** Whether using chat (free) or API (paid). */
  adapter: 'chat' | 'api';
  /** Session group this stage belongs to. */
  sessionGroup: SessionGroup;
  /** Whether this stage reuses the chat from a previous stage in the group. */
  reusesChatContext: boolean;
  /** Provider capability requirements for this stage. */
  requirements: StageRequirement;
  /** Whether the requirement can be satisfied by available providers. */
  feasible: boolean;
  /** Reason if not feasible, or info about the assignment. */
  reason: string;
  /** Estimated cost category. */
  costCategory: 'free' | 'low' | 'medium' | 'high';
}

/** What a stage requires from a provider. */
export interface StageRequirement {
  text?: boolean;
  imageGeneration?: boolean;
  videoGeneration?: boolean;
  fileUpload?: boolean;
  webSearch?: boolean;
}

/** Complete resource plan for a pipeline run. */
export interface ResourcePlan {
  qualityTier: QualityTier;
  stages: StageResourcePlan[];
  /** Total number of stages that are feasible. */
  feasibleCount: number;
  /** Total number of stages. */
  totalCount: number;
  /** Whether all stages are feasible. */
  allFeasible: boolean;
  /** Stages that cannot be satisfied by any available provider. */
  blockers: string[];
  /** Session groups with their provider assignments. */
  sessionSummary: Record<SessionGroup, { provider: string; stageCount: number; reuseChat: boolean }>;
  /** Estimated total cost category for the full pipeline. */
  overallCost: 'free' | 'low' | 'medium' | 'high';
  /** Human-readable summary. */
  summary: string;
  /** ISO timestamp. */
  createdAt: string;
}

/** Stage-to-taskType mapping for the standard pipeline. */
const STAGE_TASK_MAP: Record<PipelineStage, string> = {
  CAPABILITY_ASSESSMENT: 'safety_check',
  STYLE_EXTRACTION: 'video_analysis',
  RESEARCH: 'fact_research',
  NARRATIVE_MAP: 'narrative_map',
  SCRIPT_GENERATION: 'script_generation',
  QA_REVIEW: 'quality_review',
  STORYBOARD: 'visual_prompts',
  REFERENCE_IMAGE: 'image_generation',
  KEYFRAME_GEN: 'image_generation',
  VIDEO_GEN: 'video_generation',
  TTS: 'tts',
  ASSEMBLY: 'assembly',
  REFINEMENT: 'assembly',
};

/** Stage requirements — what AI capability each stage needs. */
const STAGE_REQUIREMENTS: Record<PipelineStage, StageRequirement> = {
  CAPABILITY_ASSESSMENT: { text: true },
  STYLE_EXTRACTION: { text: true, fileUpload: true },
  RESEARCH: { text: true, webSearch: true },
  NARRATIVE_MAP: { text: true },
  SCRIPT_GENERATION: { text: true },
  QA_REVIEW: { text: true },
  STORYBOARD: { text: true },
  REFERENCE_IMAGE: { imageGeneration: true },
  KEYFRAME_GEN: { imageGeneration: true },
  VIDEO_GEN: { videoGeneration: true },
  TTS: {}, // edge-tts doesn't need AI provider
  ASSEMBLY: {}, // FFmpeg only
  REFINEMENT: { text: true },
};

const COST_MAP: Record<string, 'free' | 'low' | 'medium' | 'high'> = {
  'chat:safety_check': 'free',
  'chat:video_analysis': 'free',
  'chat:fact_research': 'free',
  'chat:narrative_map': 'free',
  'chat:calibration': 'free',
  'chat:script_generation': 'free',
  'chat:quality_review': 'free',
  'chat:visual_prompts': 'free',
  'chat:image_generation': 'free',
  'chat:video_generation': 'low',
  'chat:tts': 'free',
  'chat:assembly': 'free',
  'api:safety_check': 'low',
  'api:video_analysis': 'low',
  'api:fact_research': 'low',
  'api:narrative_map': 'low',
  'api:script_generation': 'medium',
  'api:quality_review': 'low',
  'api:visual_prompts': 'low',
  'api:image_generation': 'medium',
  'api:video_generation': 'high',
  'api:tts': 'low',
  'api:assembly': 'free',
};

/**
 * Generate a resource plan for the full pipeline.
 */
export function generateResourcePlan(
  qualityTier: QualityTier,
  registry: ProviderCapabilityRegistry,
  sessionManager: SessionManager,
  projectId: string,
  overrides?: ModelOverrides,
): ResourcePlan {
  const stages: StageResourcePlan[] = [];
  const blockers: string[] = [];
  const sessionProviders: Partial<Record<SessionGroup, string>> = {};

  const ALL_STAGES: PipelineStage[] = [
    'CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH',
    'NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW',
    'STORYBOARD', 'REFERENCE_IMAGE', 'KEYFRAME_GEN',
    'VIDEO_GEN', 'TTS', 'ASSEMBLY', 'REFINEMENT',
  ];

  for (const stage of ALL_STAGES) {
    const taskType = STAGE_TASK_MAP[stage];
    const requirements = STAGE_REQUIREMENTS[stage];
    const session = sessionManager.getSession(projectId, stage);
    const group = session.group;

    // Get quality router decision
    const decision = routeTask(stage, taskType, qualityTier, overrides);

    // Check if the decision's provider/requirement can be met
    let provider = decision.provider ?? 'any';
    let feasible = true;
    let reason = decision.reason;

    // Stages that don't need AI (TTS = edge-tts, ASSEMBLY = FFmpeg)
    const noAiNeeded = stage === 'TTS' || stage === 'ASSEMBLY';

    if (!noAiNeeded && decision.adapter === 'chat') {
      // Find a provider that meets the requirements
      const candidates = registry.findProviders(requirements);

      if (decision.provider) {
        // Router specified a specific provider — check if it's available
        const specific = candidates.find(c => c.providerId === decision.provider);
        if (specific && !specific.quotaExhausted) {
          provider = specific.providerId;
        } else if (candidates.length > 0) {
          // Fall back to any available provider that meets requirements
          provider = candidates[0].providerId;
          reason = `${decision.provider} 不可用，回退到 ${provider}`;
        } else {
          feasible = false;
          reason = `没有可用的服务商满足 ${stage} 的需求`;
          blockers.push(stage);
        }
      } else {
        // Router didn't specify a provider — pick the best available
        if (candidates.length > 0) {
          // Prefer to reuse the same provider as the session group
          const groupProvider = sessionProviders[group];
          const sameGroupCandidate = groupProvider
            ? candidates.find(c => c.providerId === groupProvider)
            : null;
          provider = sameGroupCandidate?.providerId ?? candidates[0].providerId;
        } else if (Object.keys(requirements).length > 0) {
          feasible = false;
          reason = `没有可用的服务商满足 ${stage} 的需求`;
          blockers.push(stage);
        }
      }
    }

    // Track provider assignment per session group
    if (feasible && !noAiNeeded) {
      sessionProviders[group] ??= provider;
    }

    // Determine if this stage reuses chat context from earlier stage in same group
    const reusesChatContext = session.messageCount > 0 || (
      sessionProviders[group] !== undefined &&
      stages.some(s => s.sessionGroup === group && s.provider === provider)
    );

    const costKey = `${decision.adapter}:${taskType}`;
    const costCategory = noAiNeeded ? 'free' : (COST_MAP[costKey] ?? 'low');

    stages.push({
      stage,
      taskType,
      provider: noAiNeeded ? 'local' : provider,
      adapter: decision.adapter,
      sessionGroup: group,
      reusesChatContext,
      requirements,
      feasible,
      reason,
      costCategory,
    });
  }

  // Build session summary
  const sessionSummary = {} as Record<SessionGroup, { provider: string; stageCount: number; reuseChat: boolean }>;
  for (const group of ['analysis', 'creation', 'visual', 'production'] as SessionGroup[]) {
    const groupStages = stages.filter(s => s.sessionGroup === group);
    sessionSummary[group] = {
      provider: sessionProviders[group] ?? 'local',
      stageCount: groupStages.length,
      reuseChat: groupStages.some(s => s.reusesChatContext),
    };
  }

  // Overall cost
  const costOrder = ['free', 'low', 'medium', 'high'] as const;
  const maxCostIdx = Math.max(...stages.map(s => costOrder.indexOf(s.costCategory)));
  const overallCost = costOrder[maxCostIdx] ?? 'free';

  const feasibleCount = stages.filter(s => s.feasible).length;
  const allFeasible = feasibleCount === stages.length;

  // Generate summary
  const chatStages = stages.filter(s => s.adapter === 'chat' && s.provider !== 'local').length;
  const apiStages = stages.filter(s => s.adapter === 'api').length;
  const localStages = stages.filter(s => s.provider === 'local').length;
  const summary = allFeasible
    ? `资源规划就绪：${chatStages} 步使用免费聊天，${apiStages} 步使用付费 API，${localStages} 步本地处理`
    : `资源规划有 ${blockers.length} 个阻塞项：${blockers.join(', ')}`;

  return {
    qualityTier,
    stages,
    feasibleCount,
    totalCount: stages.length,
    allFeasible,
    blockers,
    sessionSummary,
    overallCost,
    summary,
    createdAt: new Date().toISOString(),
  };
}
