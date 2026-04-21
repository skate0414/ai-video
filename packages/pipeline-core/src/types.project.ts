import type {
  LogEntry,
  ModelOverrides,
  PipelineStage,
  ProcessStatus,
  StageProviderOverrides,
} from './sharedTypes.js';
import type { TemporalPlanCIR, VideoIR } from './cir/types.js';
import type { RefinementOutput } from './stages/refinement.js';
import type {
  CalibrationData,
  GenerationPlan,
  NarrativeMap,
  ResearchData,
  Scene,
  ScriptOutput,
  StoryboardReplicationSettings,
  StyleProfile,
} from './types.video.js';

/**
 * Core project metadata — fields that identify, track, and configure a project.
 *
 * This type contains only the lightweight state that must always be kept
 * in memory. The heavy compilation artefacts (scripts, scenes, IR, etc.)
 * are represented as optional fields on {@link PipelineProject} and should
 * be read/written through `StageRunContext.loadArtifact` / `saveArtifact`
 * rather than kept fully in-memory as the project grows.
 *
 * Future direction: once every stage persists its output via `saveArtifact`,
 * `PipelineProject` can be narrowed to extend only `ProjectMeta`, keeping
 * the serialised project record small regardless of pipeline length.
 */
export interface ProjectMeta {
  id: string;
  title: string;
  topic: string;
  referenceVideoPath?: string;
  createdAt: string;
  updatedAt: string;
  currentStage?: PipelineStage;
  stageStatus: Record<PipelineStage, ProcessStatus>;
  pauseAfterStages?: PipelineStage[];
  isPaused?: boolean;
  pausedAtStage?: PipelineStage;
  modelOverrides?: ModelOverrides;
  stageProviderOverrides?: StageProviderOverrides;
  promptOverrides?: Record<string, string>;
  retryDirective?: { stage: PipelineStage; directive: string; timestamp: string };
  storyboardReplication?: StoryboardReplicationSettings;
  finalVideoPath?: string;
  logs: LogEntry[];
  error?: string;
}

/**
 * Full in-flight project record including all compilation artefacts.
 *
 * The artefact fields below are populated incrementally as each pipeline stage
 * completes. They are persisted to disk via `ProjectStore.saveProject` and
 * loaded back on resume. Heavy artefacts (scenes with base64 images, video IR)
 * can make this object very large; prefer reading them through
 * `StageRunContext.loadArtifact` whenever possible.
 *
 * @see ProjectMeta for the lightweight metadata-only subset.
 */
export interface PipelineProject extends ProjectMeta {
  // ---- Compilation artefacts (written by pipeline stages) ----
  // TODO: migrate each field to use saveArtifact/loadArtifact so that
  //       PipelineProject can be narrowed to ProjectMeta in a future cut.

  styleProfile?: StyleProfile;
  generationPlan?: GenerationPlan;
  researchData?: ResearchData;
  narrativeMap?: NarrativeMap;
  calibrationData?: CalibrationData;
  scriptOutput?: ScriptOutput;
  scenes?: Scene[];
  safetyCheck?: { safe: boolean; reason?: string };
  temporalPlan?: TemporalPlanCIR;
  videoIR?: VideoIR;
  qaReviewResult?: { approved: boolean; feedback?: string };
  manualReviewRequired?: boolean;
  qaReport?: { score?: number; issues?: string[] };
  referenceImages?: string[];
  refinementHistory?: RefinementOutput[];
}
