/* ------------------------------------------------------------------ */
/*  Pipeline types – migrated from ai-suite with adaptations          */
/* ------------------------------------------------------------------ */

/* ---- Re-export shared types (single source of truth) ---- */

export type {
  PipelineStage,
  ProcessStatus,
  ModelOverride,
  ModelOverrides,
  LogEntry,
  PipelineScene,
  PipelineEvent,
} from './sharedTypes.js';

export { SSE_EVENT } from './sharedTypes.js';

/* Re-export shared PipelineProject as the base, but backend uses FullPipelineProject below */
export type { PipelineProject as PipelineProjectView } from './sharedTypes.js';
export type {
  JsonSchemaLike,
  ToolDescriptor,
  PromptPart,
  AIRequestOptions,
  TokenUsage,
  GenerationResult,
  AIAdapter,
} from './types/adapter.js';

export type {
  SceneQualityScore,
  ProductionSpecs,
  Scene,
  StoryboardReplicationStrength,
  StoryboardReferenceScene,
  StoryboardReplicationSettings,
  KeyMoment,
  AudioStyle,
  StyleProfile,
  FactSource,
  Fact,
  ClaimVerification,
  ResearchData,
  NarrativeBeat,
  NarrativeMap,
  FactUsage,
  StyleConsistency,
  SafetyMetadata,
  SkeletonSentence,
  ScriptSkeleton,
  ScriptSceneHint,
  ScriptOutput,
  GenerationPlan,
  CalibrationData,
} from './types.video.js';

export type { PipelineProject, ProjectMeta } from './types.project.js';
