/* ------------------------------------------------------------------ */
/*  PassRegistry – declarative compilation pass definitions          */
/*  Each pass is a self-contained compilation unit: given a           */
/*  RunContext, it executes one transform and returns a result.       */
/* ------------------------------------------------------------------ */

import type {
  AIAdapter, PipelineProject, PipelineStage, PipelineEvent, LogEntry, ModelOverrides,
  StyleProfile, Scene,
} from './types.js';
import type { ProjectStore } from './projectStore.js';
import type { ProviderCapabilityRegistry } from './providerRegistry.js';

/* ---- Run context passed to every stage ---- */

export interface StageRunContext {
  /** Current project (mutable snapshot — stages update fields on it). */
  project: PipelineProject;
  /** Project ID shortcut. */
  projectId: string;
  /** Absolute path to the project assets directory. */
  assetsDir: string;
  /** Resolve an adapter for a given stage + taskType (quality-routing aware). */
  getAdapter: (stage: PipelineStage, taskType: string, overrides?: ModelOverrides) => AIAdapter;
  /** Resolve a session-aware adapter (chat context reuse). */
  getSessionAwareAdapter: (stage: PipelineStage, taskType: string, overrides?: ModelOverrides) => AIAdapter;
  /** Append a log entry to the project and broadcast it. */
  addLog: (entry: LogEntry) => void;
  /** Persist an intermediate artifact. */
  saveArtifact: (filename: string, data: unknown) => void;
  /** Load an artifact. */
  loadArtifact: <T>(filename: string) => T | undefined;
  /** Check if the run has been aborted. */
  isAborted: () => boolean;
  /** Abort signal for cancelling in-flight waits (e.g. retry backoff). */
  abortSignal?: AbortSignal;
  /** Pipeline config values. */
  config: StageRunConfig;
  /** Emit a pipeline event (for progress broadcasting). */
  emitEvent: (event: PipelineEvent) => void;
  /** Provider capability registry (for capability assessment). */
  providerRegistry: ProviderCapabilityRegistry;
  /** Regenerate a single scene's assets (for refinement auto-retry). */
  regenerateScene: (projectId: string, sceneId: string) => Promise<Scene>;
}

export interface StageRunConfig {
  videoProviderConfig?: any;
  videoModel?: string;
  videoResolution?: '720p' | '1080p';
  productionConcurrency: number;
  ttsConfig?: { voice?: string; rate?: string; pitch?: string };
  aivideomakerAdapters?: AIAdapter[];
}

/* ---- Stage definition ---- */

export interface StageDefinition {
  /** Which pipeline stage this handles. */
  stage: PipelineStage;
  /** Execute the stage. Returns void — mutates project via context. */
  execute: (ctx: StageRunContext) => Promise<void>;
}

/* ---- The registry ---- */

const registry: StageDefinition[] = [];

/**
 * Register a stage definition. Call order determines execution order.
 */
export function registerStage(def: StageDefinition): void {
  registry.push(def);
}

/**
 * Get all registered stages in execution order.
 */
export function getStageDefinitions(): readonly StageDefinition[] {
  return registry;
}

/**
 * Get the ordered list of stage names.
 */
export function getStageOrder(): PipelineStage[] {
  return registry.map(d => d.stage);
}
