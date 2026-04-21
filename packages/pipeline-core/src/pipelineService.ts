/**
 * Phase 3D canonical implementation moved into pipeline-core.
 * Keep logic unchanged; only import paths are updated for package location.
 */

// @ts-nocheck -- see tsconfig.json noUncheckedIndexedAccess migration (scripts/check-strict-progress.mjs)
/* ------------------------------------------------------------------ */
/*  CompilerService – facade between HTTP routes and compiler core    */
/*  Routes use ONLY this service, never reaching into orchestrator    */
/*  internals (providerRegistry / sessionManager / observability).    */
/* ------------------------------------------------------------------ */

import { EXPORTABLE_ARTIFACTS } from './constants.js';
import { PipelineOrchestrator } from './orchestrator.js';
import type {
  PipelineProject, PipelineStage, PipelineEvent,
  ModelOverrides, Scene,
  StoryboardReplicationStrength,
} from './pipelineTypes.js';
import type { SceneQualityScore } from './sceneQuality.js';
import type { RefineOptions, StageProviderMap, StageProviderOverrides } from './sharedTypes.js';
import type { ResourcePlan } from './resourcePlanner.js';
import type { AIAdapter } from './pipelineTypes.js';
import { AIVideoMakerAdapter } from './aivideomakerAdapter.js';
import type { VideoProviderConfig } from './videoProvider.js';
import { ConfigStore } from './configStore.js';
import { StyleLibrary, type StyleTemplate } from './styleLibrary.js';
import type { AccountSeed } from './providerSeed.js';
import type { PluginRegistry } from './pluginRegistryTypes.js';
import type { TraceReplayBundle } from './traceStore.js';
import type { AiLogEntry } from './traceAnalyzer.js';
import type { QueueDetectionConfig } from './runtimeTypes.js';
import { createLogger } from '@ai-video/pipeline-core/libFacade.js';
import { buildOrchestratorRuntime, getConfigRuntimeDepsRuntime, getExecutionDepsRuntime } from './pipelineService.lifecycle.js';
import { ProjectQueue, type QueueSnapshot } from './projectQueue.js';
import {
  createProject as createProjectEntry,
  deleteProject as deleteProjectEntry,
  exportProjectBundle,
  importProjectBundle,
  invalidateArtifactCache as invalidateArtifactCacheEntry,
  listProjects as listProjectsEntry,
  loadProject as loadProjectEntry,
  readEventLog,
  readIterations,
  recordIteration as recordIterationEntry,
  saveProject as saveProjectEntry,
} from './pipelineService.projects.js';
import {
  getAiLogEntries,
  getLatestTraceBundle,
  getTraceBundleById,
  listTraceBundles,
} from './pipelineService.trace.js';
import {
  approveProjectScene,
  approveQaReviewForProject,
  approveReferenceImagesForProject,
  regenerateSceneAssets,
  rejectProjectScene,
  updateModelOverridesForProject,
  updateProjectScenes,
  updateSceneQualityScore,
  updateScriptText,
  updateStoryboardReplicationSettings,
} from './pipelineService.scenes.js';
import {
  getEta as getEtaEstimate,
  getProviderCapabilities as getProviderCapabilitiesEntry,
  getProviderSummary as getProviderSummaryEntry,
  getResourcePlan as getResourcePlanEntry,
  getRouteTable as getRouteTableEntry,
  getSessions as getSessionsEntry,
  getStageProviders as getStageProvidersEntry,
  updateProviderCapability as updateProviderCapabilityEntry,
  updateStageProviderOverrides as updateStageProviderOverridesEntry,
} from './pipelineService.providers.js';
import {
  enqueueProject as enqueueProjectEntry,
  getQueueSnapshot as getQueueSnapshotEntry,
  requestPause as requestPauseEntry,
  resumePipeline as resumePipelineEntry,
  retryStage as retryStageEntry,
  startPipeline as startPipelineEntry,
  startPipelineDirect as startPipelineDirectEntry,
  stopPipeline as stopPipelineEntry,
} from './pipelineService.execution.js';
import {
  completeSetup as completeSetupEntry,
  getApiResourceCount as getApiResourceCountEntry,
  getConfig as getConfigEntry,
  getProviderCount as getProviderCountEntry,
  getRefineOptions as getRefineOptionsEntry,
  getRefineProvenance as getRefineProvenanceEntry,
  getRefineReferenceDefaults as getRefineReferenceDefaultsEntry,
  getTtsConfig as getTtsConfigEntry,
  getVideoProviderConfig as getVideoProviderConfigEntry,
  hasApiKey as hasApiKeyEntry,
  readQueueDetectionPresets,
  removeQueueDetectionPreset,
  startReAssembly as startReAssemblyEntry,
  updateConfig as updateConfigEntry,
  updateRefineOptions as updateRefineOptionsEntry,
  updateTtsConfig as updateTtsConfigEntry,
  updateVideoProviderConfig as updateVideoProviderConfigEntry,
  writeQueueDetectionPresets,
} from './pipelineService.config.js';

const log = createLogger('PipelineService');

export type EventBroadcaster = (event: unknown) => void;

export interface PipelineServiceConfig {
  dataDir: string;
  chatAdapter: AIAdapter;
  aivideomakerApiKeys?: string[];
  configStore: ConfigStore;
  broadcastEvent: EventBroadcaster;
  /** Real configured accounts for provider registry seeding (static, used only as initial snapshot) */
  accounts?: AccountSeed[];
  /** Callback to fetch live accounts from ResourceManager (preferred over static accounts) */
  getAccounts?: () => AccountSeed[];
  /** Callback to fetch live video provider config from ResourceManager */
  getVideoConfig?: () => Record<string, any> | null;
  /** Optional plugin registry for plugin-based provider routing. */
  pluginRegistry?: PluginRegistry;
  /** Callback invoked when API keys change so the caller can sync AiResource entries. */
  onApiKeysChanged?: (keys: { aivideomakerApiKeys?: string[] }) => void;
}

export interface StoryboardReplicationUpdate {
  enabled?: boolean;
  strength?: StoryboardReplicationStrength;
  sourceProjectId?: string;
  notes?: string;
}

/**
 * PipelineService encapsulates all pipeline operations behind a single API.
 * - Routes call this service instead of directly touching orchestrator internals.
 * - Manages orchestrator lifecycle (rebuild on config change).
 * - Exposes only the operations the HTTP layer needs.
 */
export class PipelineService {
  private orchestrator: PipelineOrchestrator;
  private chatAdapter: AIAdapter;
  private aivideomakerAdapters: AIVideoMakerAdapter[];
  private readonly dataDir: string;
  private readonly configStore: ConfigStore;
  private readonly broadcastEvent: EventBroadcaster;
  private readonly accounts: AccountSeed[];
  private readonly getAccounts: (() => AccountSeed[]) | undefined;
  private readonly getVideoConfig: (() => Record<string, any> | null) | undefined;
  private readonly pluginRegistry?: PluginRegistry;
  private readonly onApiKeysChanged?: (keys: { aivideomakerApiKeys?: string[] }) => void;
  readonly styleLibrary: StyleLibrary;
  readonly projectQueue: ProjectQueue;

  constructor(cfg: PipelineServiceConfig) {
    this.chatAdapter = cfg.chatAdapter;
    this.aivideomakerAdapters = (cfg.aivideomakerApiKeys ?? []).map(k => new AIVideoMakerAdapter(k));
    this.dataDir = cfg.dataDir;
    this.configStore = cfg.configStore;
    this.broadcastEvent = cfg.broadcastEvent;
    this.accounts = cfg.accounts ?? [];
    this.getAccounts = cfg.getAccounts;
    this.getVideoConfig = cfg.getVideoConfig;
    this.pluginRegistry = cfg.pluginRegistry;
    this.onApiKeysChanged = cfg.onApiKeysChanged;
    this.styleLibrary = new StyleLibrary(cfg.dataDir);

    const saved = this.configStore.get();
    this.projectQueue = new ProjectQueue(
      saved.maxConcurrentProjects ?? 3,
      (id) => this.startPipelineDirect(id),
    );

    this.orchestrator = this.buildOrchestrator();
  }

  private buildOrchestrator(): PipelineOrchestrator {
    const saved = this.configStore.get();
    const orch = new PipelineOrchestrator(this.chatAdapter as unknown as AIAdapter, {
      dataDir: this.dataDir,
      aivideomakerAdapters: this.aivideomakerAdapters,
      productionConcurrency: saved.productionConcurrency,
      ttsConfig: saved.ttsConfig,
      accounts: this.getAccounts ? this.getAccounts() : this.accounts,
      pluginRegistry: this.pluginRegistry,
      pluginDeps: this.pluginRegistry ? {
        chatAdapter: this.chatAdapter as unknown as AIAdapter,
        aivideomakerAdapters: this.aivideomakerAdapters,
      } : undefined,
    });
    orch.onEvent((event: PipelineEvent) => {
      this.broadcastEvent(event);
      // When a project finishes (success or error), release its queue slot
      // so the next queued project can start.
      if (event.type === 'pipeline_complete' || event.type === 'pipeline_error') {
        const pid = (event.payload as { projectId: string }).projectId;
        this.projectQueue.markDone(pid);
      }
    });
    // Persistent JSONL event log per project
    orch.onEvent((event: PipelineEvent) => {
      const pid = (event.payload as { projectId?: string })?.projectId;
      if (!pid) return;
      try {
        const dir = join(this.dataDir, 'projects', pid);
        mkdirSync(dir, { recursive: true });
        appendFileSync(join(dir, 'events.jsonl'), JSON.stringify({ ...event, _ts: Date.now() }) + '\n');
      } catch { /* best-effort — never block pipeline */ }
    });
    return orch;
  }

  private rebuildOrchestrator(): void {
    this.orchestrator = this.buildOrchestrator();
  }

  /* ---- Facade wiring helpers ---- */

  /**
   * Centralize dependency wiring for execution helpers so public methods
   * stay as thin delegators.
   */
  private getExecutionDeps() {
    return getExecutionDepsRuntime(this, log);
  }

  /**
   * Centralize dependency wiring for config/setup helpers.
   */
  private getConfigRuntimeDeps() {
    return getConfigRuntimeDepsRuntime(this);
  }

  /* ---- Project CRUD ---- */

  listProjects(): PipelineProject[] {
    return listProjectsEntry(this.orchestrator);
  }

  createProject(topic: string, title?: string, modelOverrides?: ModelOverrides): PipelineProject {
    return createProjectEntry(this.orchestrator, topic, title, modelOverrides);
  }

  loadProject(projectId: string): PipelineProject | null {
    return loadProjectEntry(this.orchestrator, projectId);
  }

  saveProject(project: PipelineProject): void {
    saveProjectEntry(this.orchestrator, project);
  }

  invalidateArtifactCache(projectId: string, artifacts?: Iterable<string>): void {
    invalidateArtifactCacheEntry(this.orchestrator, projectId, artifacts);
  }

  deleteProject(projectId: string): boolean {
    return deleteProjectEntry(this.orchestrator, projectId);
  }

  /* ---- Pipeline execution ---- */

  /**
   * Start a pipeline directly, bypassing the project queue.
   * Used by single-project start and as the queue's internal start callback.
   */
  private startPipelineDirect(projectId: string, videoFilePath?: string): { ok: true } | { error: string; status: number } {
    return startPipelineDirectEntry(this.getExecutionDeps(), projectId, videoFilePath);
  }

  /** Start a single project immediately (no queue). */
  startPipeline(projectId: string, videoFilePath?: string): { ok: true } | { error: string; status: number } {
    return startPipelineEntry(this.getExecutionDeps(), projectId, videoFilePath);
  }

  /** Enqueue a project for bounded-concurrency batch execution. */
  enqueueProject(projectId: string): { ok: true; position: 'started' | 'queued' } | { error: string; status: number } {
    return enqueueProjectEntry(this.getExecutionDeps(), projectId);
  }

  /** Return a snapshot of the project queue state. */
  getQueueSnapshot(): QueueSnapshot {
    return getQueueSnapshotEntry(this.projectQueue);
  }

  stopPipeline(projectId: string): void {
    stopPipelineEntry(this.orchestrator, projectId);
  }

  requestPause(projectId: string): { ok: true } | { error: string; status: number } {
    return requestPauseEntry(this.orchestrator, projectId);
  }

  retryStage(projectId: string, stage: PipelineStage, directive?: string): { ok: true } | { error: string; status: number } {
    return retryStageEntry(this.getExecutionDeps(), projectId, stage, directive);
  }

  resumePipeline(projectId: string): { ok: true } | { error: string; status: number } {
    return resumePipelineEntry(this.getExecutionDeps(), projectId);
  }

  async regenerateScene(projectId: string, sceneId: string, feedback?: string): Promise<Scene> {
    return regenerateSceneAssets(this.orchestrator, projectId, sceneId, feedback);
  }

  /* ---- Content editing ---- */

  updateScript(projectId: string, scriptText: string): PipelineProject {
    return updateScriptText(this.orchestrator, projectId, scriptText);
  }

  updateScenes(projectId: string, scenes: Scene[]): PipelineProject {
    return updateProjectScenes(this.orchestrator, projectId, scenes);
  }

  /**
   * Persist a scene quality report onto the project's scenes and save.
   */
  updateSceneQuality(projectId: string, sceneId: string, quality: SceneQualityScore): PipelineProject {
    return updateSceneQualityScore(this.orchestrator, projectId, sceneId, quality);
  }

  updateModelOverrides(projectId: string, overrides: ModelOverrides): PipelineProject {
    return updateModelOverridesForProject(this.orchestrator, projectId, overrides);
  }

  approveScene(projectId: string, sceneId: string): PipelineProject {
    return approveProjectScene(this.orchestrator, projectId, sceneId);
  }

  rejectScene(projectId: string, sceneId: string, reason?: string): PipelineProject {
    return rejectProjectScene(
      this.orchestrator,
      projectId,
      sceneId,
      reason,
      (id, data) => this.recordIteration(id, data),
    );
  }

  approveQaReview(projectId: string, override?: { feedback?: string }): PipelineProject {
    return approveQaReviewForProject(this.orchestrator, projectId, override);
  }

  approveReferenceImages(projectId: string): PipelineProject {
    return approveReferenceImagesForProject(this.orchestrator, projectId);
  }

  async setStyleProfile(projectId: string, pastedText?: string, styleProfile?: any, topic?: string, formatSignature?: any): Promise<PipelineProject> {
    if (styleProfile) {
      return this.orchestrator.setStyleProfile(projectId, styleProfile, formatSignature);
    }
    if (pastedText) {
      const { runStyleExtractionManual } = await import('./styleExtraction.js');
      const result = runStyleExtractionManual(pastedText, topic ?? '');
      return this.orchestrator.setStyleProfile(projectId, result.styleProfile);
    }
    throw new Error('pastedText or styleProfile is required');
  }

  /* ---- Provider & session info (encapsulated) ---- */

  getProviderCapabilities(): unknown {
    return getProviderCapabilitiesEntry(this.orchestrator);
  }

  updateProviderCapability(providerId: string, capability: Record<string, any>): unknown {
    return updateProviderCapabilityEntry(this.orchestrator, providerId, capability);
  }

  getSessions(): unknown {
    return getSessionsEntry(this.orchestrator);
  }

  getProviderSummary(): { providers: unknown; sessions: unknown; hasApiKey: boolean } {
    return getProviderSummaryEntry(this.orchestrator);
  }

  getRouteTable(overrides?: ModelOverrides): Array<{ stage: string; taskType: string; adapter: string; provider?: string; model?: string; reason: string }> {
    return getRouteTableEntry(overrides);
  }

  getResourcePlan(projectId: string, overrides?: ModelOverrides): ResourcePlan {
    return getResourcePlanEntry(this.orchestrator, projectId, overrides);
  }

  /**
   * Get per-stage provider availability map.
   * For each pipeline stage, returns the current default provider
   * and all available provider options (with quota/resource info).
   */
  getStageProviders(): StageProviderMap {
    return getStageProvidersEntry(
      this.orchestrator,
      this.getAccounts ? () => this.getAccounts!() : undefined,
      this.aivideomakerAdapters.length,
    );
  }

  /**
   * Update per-stage provider overrides for a project.
   */
  updateStageProviderOverrides(projectId: string, overrides: StageProviderOverrides): PipelineProject {
    return updateStageProviderOverridesEntry(this.orchestrator, projectId, overrides);
  }

  /**
   * Update per-project storyboard replication settings.
   * When sourceProjectId is provided, snapshot source scenes as a replication blueprint.
   */
  updateStoryboardReplication(projectId: string, update: StoryboardReplicationUpdate): PipelineProject {
    return updateStoryboardReplicationSettings(this.orchestrator, projectId, update);
  }

  getEta(projectId: string): { etaMs: number; completedMs: number; confidence: 'high' | 'low' } | null {
    return getEtaEstimate(this.orchestrator, projectId);
  }

  /* ---- Setup / first-run ---- */

  getProviderCount(): number {
    return getProviderCountEntry(this.orchestrator);
  }

  /** Count of API-type resources (Gemini + AIVideoMaker keys). */
  getApiResourceCount(): number {
    const accounts = this.getAccounts ? this.getAccounts() : this.accounts;
    return getApiResourceCountEntry(accounts);
  }

  hasApiKey(): boolean {
    return hasApiKeyEntry();
  }

  completeSetup(body: { aivideomakerApiKey?: string }): { ok: true } {
    return completeSetupEntry(this.getConfigRuntimeDeps(), body);
  }

  /* ---- Config management ---- */

  getConfig(): { productionConcurrency: number; videoProviderConfig?: VideoProviderConfig } {
    return getConfigEntry(this.configStore);
  }

  updateConfig(body: { aivideomakerApiKey?: string; productionConcurrency?: number }): { ok: true } {
    return updateConfigEntry(this.getConfigRuntimeDeps(), body);
  }

  getVideoProviderConfig(): unknown {
    return getVideoProviderConfigEntry(this.configStore, this.getVideoConfig);
  }

  updateVideoProviderConfig(config: VideoProviderConfig | null): void {
    updateVideoProviderConfigEntry(this.configStore, () => this.rebuildOrchestrator(), config);
  }

  getTtsConfig(): unknown {
    return getTtsConfigEntry(this.configStore);
  }

  updateTtsConfig(config: any): void {
    updateTtsConfigEntry(this.configStore, config);
  }

  /* ---- Queue Detection ---- */

  getQueueDetectionPresets(): Record<string, QueueDetectionConfig> {
    return readQueueDetectionPresets();
  }

  updateQueueDetectionPresets(overrides: Record<string, QueueDetectionConfig>): void {
    writeQueueDetectionPresets(overrides);
  }

  deleteQueueDetectionPreset(providerId: string): boolean {
    return removeQueueDetectionPreset(providerId);
  }

  /* ---- Export / Import ---- */

  exportProject(projectId: string): Record<string, any> | null {
    return exportProjectBundle(this.orchestrator, projectId, EXPORTABLE_ARTIFACTS);
  }

  importProject(bundle: Record<string, any>): PipelineProject {
    return importProjectBundle(this.orchestrator, bundle, EXPORTABLE_ARTIFACTS);
  }

  /* ---- Accessors for things routes still need directly ---- */

  getDataDir(): string {
    return this.dataDir;
  }

  getProjectDir(projectId: string): string {
    return this.orchestrator.getProjectDir(projectId);
  }

  getEventLog(projectId: string): unknown[] {
    return readEventLog(this.dataDir, projectId);
  }

  /* ---- Cost tracking ---- */

  getProjectCostSummary(projectId: string) {
    return this.orchestrator.costTracker.getProjectSummary(projectId);
  }

  getGlobalCostSummary() {
    return this.orchestrator.costTracker.getGlobalSummary();
  }

  /* ---- Video provider health monitoring ---- */

  getVideoProviderHealth() {
    return this.orchestrator.videoHealthMonitor.toJSON();
  }

  getVideoProviderRecommendation(providerId: string) {
    return this.orchestrator.videoHealthMonitor.getRecommendation(providerId);
  }

  /* ---- Trace replay ---- */

  getLatestTrace(projectId: string): TraceReplayBundle | null {
    return getLatestTraceBundle(projectId, (id) => this.getProjectDir(id));
  }

  getTrace(projectId: string, traceId: string): TraceReplayBundle | null {
    return getTraceBundleById(projectId, traceId, (id) => this.getProjectDir(id));
  }

  listTraces(projectId: string): Array<{ traceId: string; startedAt: string; outcome: string; durationMs?: number }> {
    return listTraceBundles(projectId, (id) => this.getProjectDir(id));
  }

  /* ---- AI Logs (input/output diff) ---- */

  getAiLogs(projectId: string): AiLogEntry[] {
    return getAiLogEntries(projectId, (id) => this.getProjectDir(id));
  }

  /* ---- Prompt overrides ---- */

  setPromptOverride(projectId: string, promptName: string, text: string): PipelineProject {
    const project = this.orchestrator.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    if (!project.promptOverrides) project.promptOverrides = {};
    project.promptOverrides[promptName] = text;
    project.updatedAt = new Date().toISOString();
    this.orchestrator.saveProject(project);
    this.recordIteration(projectId, { type: 'prompt_override', promptName, textLength: text.length });
    return project;
  }

  deletePromptOverride(projectId: string, promptName: string): PipelineProject {
    const project = this.orchestrator.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    if (project.promptOverrides) {
      delete project.promptOverrides[promptName];
      if (Object.keys(project.promptOverrides).length === 0) {
        project.promptOverrides = undefined;
      }
    }
    project.updatedAt = new Date().toISOString();
    this.orchestrator.saveProject(project);
    return project;
  }

  /* ---- Iteration records ---- */

  private recordIteration(projectId: string, data: Record<string, unknown>): void {
    recordIterationEntry(this.orchestrator, projectId, data);
  }

  getIterations(projectId: string): unknown[] {
    return readIterations(this.orchestrator, projectId);
  }

  /* ---- Refinement Options ---- */

  /**
   * Get the current refinement options for a project.
   * Returns stored options merged with defaults.
   */
  getRefineOptions(projectId: string): RefineOptions {
    return getRefineOptionsEntry(this.orchestrator, projectId);
  }

  /**
   * Get provenance info: which RefineOptions fields were inferred from the reference video.
   * Returns an array of field names (e.g. ['subtitlePreset', 'bgmVolume', 'fadeInDuration']).
   */
  getRefineProvenance(projectId: string): string[] {
    return getRefineProvenanceEntry(this.orchestrator, projectId);
  }

  /**
   * Get reference-video defaults (base + packaging-inferred smart defaults) without user overrides.
   * Used by the UI "复刻值" button to reset to the AI-inferred values.
   */
  getRefineReferenceDefaults(projectId: string): RefineOptions {
    return getRefineReferenceDefaultsEntry(this.orchestrator, projectId);
  }

  /**
   * Update refinement options for a project.
   */
  updateRefineOptions(projectId: string, options: Partial<RefineOptions>): RefineOptions {
    return updateRefineOptionsEntry(this.orchestrator, projectId, options);
  }

  /**
   * Start re-assembly with current refinement options.
   * Runs ASSEMBLY stage again with the configured options.
   */
  startReAssembly(projectId: string): void {
    startReAssemblyEntry(this.orchestrator, projectId, log);
  }
}
