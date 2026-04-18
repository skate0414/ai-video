/* ------------------------------------------------------------------ */
/*  CompilerService – facade between HTTP routes and compiler core    */
/*  Routes use ONLY this service, never reaching into orchestrator    */
/*  internals (providerRegistry / sessionManager / observability).    */
/* ------------------------------------------------------------------ */

import { existsSync, readFileSync, writeFileSync, appendFileSync, mkdirSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACT, EXPORTABLE_ARTIFACTS } from '../constants.js';
import { PipelineOrchestrator, type PipelineConfig, SafetyBlockError } from './orchestrator.js';
import type {
  PipelineProject, PipelineStage, PipelineEvent,
  ModelOverrides, StyleProfile, Scene, LogEntry,
  StoryboardReplicationSettings, StoryboardReplicationStrength,
} from './types.js';
import type { SceneQualityScore } from './sceneQuality.js';
import type { StageProviderMap, StageProviderOption, StageProviderOverrides } from '../../shared/types.js';
import type { ResourcePlan } from './resourcePlanner.js';
import type { AIAdapter } from './types.js';
import type { ChatAdapter } from '../adapters/chatAdapter.js';
import { AIVideoMakerAdapter } from '../adapters/aivideomakerAdapter.js';
import { ConfigStore, type AppConfig } from '../configStore.js';
import type { VideoProviderConfig } from '../adapters/videoProvider.js';
import { getStageOrder } from './stageRegistry.js';
import { StyleLibrary, type StyleTemplate } from './styleLibrary.js';
import { routeTask } from './qualityRouter.js';
import type { AccountSeed } from './providerRegistry.js';
import type { PluginRegistry } from './providers/index.js';
import { TraceWriter, type TraceReplayBundle } from './trace/index.js';
import type { AiLogEntry } from './trace/analyzer.js';
import type { QueueDetectionConfig } from '../types.js';
import { getQueueDetectionPresets, saveQueueDetectionOverrides, deleteQueueDetectionOverride } from '../providerPresets.js';
import { createLogger } from '../lib/logger.js';
import { ProjectQueue, type QueueSnapshot } from './projectQueue.js';

const log = createLogger('PipelineService');

export type EventBroadcaster = (event: unknown) => void;

export interface PipelineServiceConfig {
  dataDir: string;
  chatAdapter: ChatAdapter;
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
  private chatAdapter: ChatAdapter;
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

  /* ---- Project CRUD ---- */

  listProjects(): PipelineProject[] {
    return this.orchestrator.listProjects();
  }

  createProject(topic: string, title?: string, modelOverrides?: ModelOverrides): PipelineProject {
    return this.orchestrator.createProject(topic, title, modelOverrides);
  }

  loadProject(projectId: string): PipelineProject | null {
    return this.orchestrator.loadProject(projectId);
  }

  saveProject(project: PipelineProject): void {
    this.orchestrator.saveProject(project);
  }

  invalidateArtifactCache(projectId: string, artifacts?: Iterable<string>): void {
    this.orchestrator.invalidateArtifactCache(projectId, artifacts);
  }

  deleteProject(projectId: string): boolean {
    return this.orchestrator.deleteProject(projectId);
  }

  /* ---- Pipeline execution ---- */

  /**
   * Start a pipeline directly, bypassing the project queue.
   * Used by single-project start and as the queue's internal start callback.
   */
  private startPipelineDirect(projectId: string, videoFilePath?: string): { ok: true } | { error: string; status: number } {
    const project = this.orchestrator.loadProject(projectId);
    if (!project) return { error: 'Project not found', status: 404 };
    if (this.orchestrator.runLock.isRunning(projectId)) return { error: 'Pipeline already running', status: 409 };

    // Re-seed provider registry with live accounts before each run so that
    // accounts added after server startup are visible to pre-flight checks.
    const liveAccounts = this.getAccounts ? this.getAccounts() : this.accounts;
    this.orchestrator.providerRegistry.seedFromAccounts(liveAccounts);

    this.orchestrator.run(projectId, videoFilePath).catch((err) => {
      log.error('run_failed', err, { projectId });
    });
    return { ok: true };
  }

  /** Start a single project immediately (no queue). */
  startPipeline(projectId: string, videoFilePath?: string): { ok: true } | { error: string; status: number } {
    return this.startPipelineDirect(projectId, videoFilePath);
  }

  /** Enqueue a project for bounded-concurrency batch execution. */
  enqueueProject(projectId: string): { ok: true; position: 'started' | 'queued' } | { error: string; status: number } {
    const project = this.orchestrator.loadProject(projectId);
    if (!project) return { error: 'Project not found', status: 404 };
    const position = this.projectQueue.enqueue(projectId);
    return { ok: true, position };
  }

  /** Return a snapshot of the project queue state. */
  getQueueSnapshot(): QueueSnapshot {
    return this.projectQueue.snapshot();
  }

  stopPipeline(projectId: string): void {
    this.orchestrator.runLock.abort(projectId);
  }

  requestPause(projectId: string): { ok: true } | { error: string; status: number } {
    const project = this.orchestrator.loadProject(projectId);
    if (!project) return { error: 'Project not found', status: 404 };
    this.orchestrator.requestPause(projectId);
    return { ok: true };
  }

  retryStage(projectId: string, stage: PipelineStage, directive?: string): { ok: true } | { error: string; status: number } {
    const validStages = getStageOrder();
    if (!validStages.includes(stage)) return { error: `Invalid stage: ${stage}`, status: 400 };
    const project = this.orchestrator.loadProject(projectId);
    if (!project) return { error: 'Project not found', status: 404 };
    if (this.orchestrator.runLock.isRunning(projectId)) return { error: 'Pipeline already running', status: 409 };

    // Store user directive on project (consumed by stage execution)
    if (directive?.trim()) {
      project.retryDirective = { stage, directive: directive.trim(), timestamp: new Date().toISOString() };
      this.orchestrator.saveProject(project);
      this.recordIteration(projectId, { type: 'retry', stage, directive: directive.trim() });
    }

    // Re-seed provider registry with live accounts (same as startPipeline)
    const liveAccounts = this.getAccounts ? this.getAccounts() : this.accounts;
    this.orchestrator.providerRegistry.seedFromAccounts(liveAccounts);

    this.orchestrator.retryStage(projectId, stage).catch((err) => {
      log.error('retry_failed', err, { projectId, stage });
    });
    return { ok: true };
  }

  resumePipeline(projectId: string): { ok: true } | { error: string; status: number } {
    const project = this.orchestrator.loadProject(projectId);
    if (!project) return { error: 'Project not found', status: 404 };
    if (!project.isPaused) return { error: 'Pipeline is not paused', status: 409 };
    if (this.orchestrator.runLock.isRunning(projectId)) return { error: 'Pipeline already running', status: 409 };

    // Re-seed provider registry with live accounts (same as startPipeline)
    const liveAccounts = this.getAccounts ? this.getAccounts() : this.accounts;
    this.orchestrator.providerRegistry.seedFromAccounts(liveAccounts);

    this.orchestrator.resumePipeline(projectId).catch((err) => {
      log.error('resume_failed', err, { projectId });
    });
    return { ok: true };
  }

  async regenerateScene(projectId: string, sceneId: string, feedback?: string): Promise<Scene> {
    if (feedback?.trim()) {
      const project = this.orchestrator.loadProject(projectId);
      if (project?.scenes) {
        const scene = project.scenes.find(s => s.id === sceneId);
        if (scene) {
          // Strip previous feedback prefix before prepending new one
          const stripped = scene.visualPrompt.replace(/^\[用户反馈:[^\]]*\]\n/g, '');
          scene.visualPrompt = `[用户反馈: ${feedback.trim()}]\n${stripped}`;
          this.orchestrator.updateScenes(projectId, project.scenes);
        }
      }
    }
    return this.orchestrator.regenerateSceneAssets(projectId, sceneId);
  }

  /* ---- Content editing ---- */

  updateScript(projectId: string, scriptText: string): PipelineProject {
    return this.orchestrator.updateScript(projectId, scriptText);
  }

  updateScenes(projectId: string, scenes: Scene[]): PipelineProject {
    return this.orchestrator.updateScenes(projectId, scenes);
  }

  /**
   * Persist a scene quality report onto the project's scenes and save.
   */
  updateSceneQuality(projectId: string, sceneId: string, quality: SceneQualityScore): PipelineProject {
    const project = this.orchestrator.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    if (!project.scenes) project.scenes = [];
    const idx = project.scenes.findIndex(s => s.id === sceneId || String(s.number) === sceneId);
    if (idx === -1) throw new Error(`Scene ${sceneId} not found`);
    project.scenes[idx].quality = quality;
    project.updatedAt = new Date().toISOString();
    this.orchestrator.updateScenes(projectId, project.scenes);
    return this.orchestrator.loadProject(projectId)!;
  }

  updateModelOverrides(projectId: string, overrides: ModelOverrides): PipelineProject {
    return this.orchestrator.updateModelOverrides(projectId, overrides);
  }

  approveScene(projectId: string, sceneId: string): PipelineProject {
    return this.orchestrator.approveScene(projectId, sceneId);
  }

  rejectScene(projectId: string, sceneId: string, reason?: string): PipelineProject {
    if (reason?.trim()) {
      this.recordIteration(projectId, { type: 'reject_scene', sceneId, reason: reason.trim() });
    }
    return this.orchestrator.rejectScene(projectId, sceneId, reason);
  }

  approveQaReview(projectId: string, override?: { feedback?: string }): PipelineProject {
    return this.orchestrator.approveQaReview(projectId, override);
  }

  approveReferenceImages(projectId: string): PipelineProject {
    return this.orchestrator.approveReferenceImages(projectId);
  }

  async setStyleProfile(projectId: string, pastedText?: string, styleProfile?: any, topic?: string, formatSignature?: any): Promise<PipelineProject> {
    if (styleProfile) {
      return this.orchestrator.setStyleProfile(projectId, styleProfile, formatSignature);
    }
    if (pastedText) {
      const { runStyleExtractionManual } = await import('./stages/styleExtraction.js');
      const result = runStyleExtractionManual(pastedText, topic ?? '');
      return this.orchestrator.setStyleProfile(projectId, result.styleProfile);
    }
    throw new Error('pastedText or styleProfile is required');
  }

  /* ---- Provider & session info (encapsulated) ---- */

  getProviderCapabilities(): unknown {
    return this.orchestrator.providerRegistry.toJSON();
  }

  updateProviderCapability(providerId: string, capability: Record<string, any>): unknown {
    this.orchestrator.providerRegistry.register(providerId, capability);
    return this.orchestrator.providerRegistry.get(providerId);
  }

  getSessions(): unknown {
    return this.orchestrator.sessionManager.getAllSessions();
  }

  getProviderSummary(): { providers: unknown; sessions: unknown; hasApiKey: boolean } {
    return {
      providers: this.orchestrator.providerRegistry.toJSON(),
      sessions: this.orchestrator.sessionManager.getAllSessions(),
      hasApiKey: false,
    };
  }

  getRouteTable(overrides?: ModelOverrides): Array<{ stage: string; taskType: string; adapter: string; provider?: string; model?: string; reason: string }> {
    const stages = getStageOrder();
    const taskTypes: Record<string, string> = {
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
      REFINEMENT: 'quality_review',
    };
    return stages.map((stage) => {
      const taskType = taskTypes[stage] ?? 'text';
      const decision = routeTask(stage as PipelineStage, taskType, overrides);
      return { stage, taskType, ...decision };
    });
  }

  getResourcePlan(projectId: string, overrides?: ModelOverrides): ResourcePlan {
    return this.orchestrator.getResourcePlan(projectId, overrides);
  }

  /**
   * Get per-stage provider availability map.
   * For each pipeline stage, returns the current default provider
   * and all available provider options (with quota/resource info).
   */
  getStageProviders(): StageProviderMap {
    const stages = getStageOrder();
    const registry = this.orchestrator.providerRegistry;
    const allProviders = registry.getAll();
    const taskTypes: Record<string, string> = {
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
      REFINEMENT: 'quality_review',
    };

    const result: StageProviderMap = {};

    for (const stage of stages) {
      const taskType = taskTypes[stage] ?? 'text';
      // Skip non-AI stages
      if (taskType === 'assembly') continue;

      const decision = routeTask(stage as PipelineStage, taskType);
      const available: StageProviderOption[] = [];

      // Build options from registered providers
      for (const cap of allProviders) {
        // Determine if provider can handle this task type
        const canHandle = this.canProviderHandleTask(cap, taskType);
        if (!canHandle) continue;

        const accounts = this.getAccounts
          ? this.getAccounts().filter(a => a.provider === cap.providerId)
          : [];
        const totalCount = Math.max(accounts.length, 1);
        const availCount = accounts.filter(a => !a.quotaExhausted).length || (cap.quotaExhausted ? 0 : 1);

        available.push({
          provider: cap.providerId,
          label: cap.providerId.charAt(0).toUpperCase() + cap.providerId.slice(1) + ' 网页端',
          adapter: 'chat',
          resourceCount: totalCount,
          availableCount: availCount,
          hasQuotaIssues: cap.quotaExhausted,
          models: cap.models,
          capabilities: {
            text: cap.text,
            image: cap.imageGeneration,
            video: cap.videoGeneration,
            webSearch: cap.webSearch,
          },
          recommended: decision.adapter === 'chat' && decision.provider === cap.providerId,
        });
      }

      // Add video API option for video generation stages
      if (taskType === 'video_generation' && this.aivideomakerAdapters.length > 0) {
        available.push({
          provider: 'aivideomaker',
          label: 'AI Video Maker API',
          adapter: 'api',
          resourceCount: this.aivideomakerAdapters.length,
          availableCount: this.aivideomakerAdapters.length,
          hasQuotaIssues: false,
          capabilities: { text: false, image: false, video: true },
          recommended: decision.adapter === 'api' && taskType === 'video_generation',
        });
      }

      // Build current default option
      const currentProvider = available.find(a => a.recommended) ?? available[0];
      if (currentProvider) {
        result[stage] = {
          taskType,
          current: currentProvider,
          available: available.sort((a, b) => {
            // Recommended first, then by available count descending
            if (a.recommended && !b.recommended) return -1;
            if (!a.recommended && b.recommended) return 1;
            return b.availableCount - a.availableCount;
          }),
        };
      }
    }

    return result;
  }

  /**
   * Update per-stage provider overrides for a project.
   */
  updateStageProviderOverrides(projectId: string, overrides: StageProviderOverrides): PipelineProject {
    return this.orchestrator.updateStageProviderOverrides(projectId, overrides);
  }

  /**
   * Update per-project storyboard replication settings.
   * When sourceProjectId is provided, snapshot source scenes as a replication blueprint.
   */
  updateStoryboardReplication(projectId: string, update: StoryboardReplicationUpdate): PipelineProject {
    const project = this.orchestrator.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const existing = project.storyboardReplication;

    const strength = (update.strength ?? existing?.strength ?? 'medium') as StoryboardReplicationStrength;
    if (!['low', 'medium', 'high'].includes(strength)) {
      throw new Error(`Invalid storyboard replication strength: ${String(update.strength)}`);
    }

    const enabled = update.enabled ?? existing?.enabled ?? true;
    let sourceProjectId = existing?.sourceProjectId;
    let referenceScenes = existing?.referenceScenes ?? [];

    if (update.sourceProjectId !== undefined) {
      const rawSourceId = update.sourceProjectId.trim();
      if (!rawSourceId) {
        sourceProjectId = undefined;
        referenceScenes = [];
      } else {
        if (rawSourceId === projectId) {
          throw new Error('sourceProjectId cannot be the same as target project');
        }
        const sourceProject = this.orchestrator.loadProject(rawSourceId);
        if (!sourceProject) throw new Error(`Source project ${rawSourceId} not found`);
        if (!sourceProject.scenes?.length) throw new Error(`Source project ${rawSourceId} has no storyboard scenes`);

        sourceProjectId = rawSourceId;
        referenceScenes = sourceProject.scenes
          .map((scene) => ({
            number: scene.number,
            narrative: scene.narrative,
            visualPrompt: scene.visualPrompt,
            camera: scene.productionSpecs?.camera,
            lighting: scene.productionSpecs?.lighting,
            estimatedDuration: scene.estimatedDuration,
          }))
          .slice(0, 24);
      }
    }

    const nextSettings: StoryboardReplicationSettings = {
      enabled,
      strength,
      sourceProjectId,
      notes: update.notes !== undefined ? (update.notes.trim() || undefined) : existing?.notes,
      referenceScenes,
    };

    return this.orchestrator.updateStoryboardReplication(projectId, nextSettings);
  }

  private canProviderHandleTask(cap: { text: boolean; imageGeneration: boolean; videoGeneration: boolean; webSearch: boolean; fileUpload: boolean; tts: boolean }, taskType: string): boolean {
    switch (taskType) {
      case 'video_analysis': return cap.text && cap.fileUpload;
      case 'fact_research': return cap.text && cap.webSearch;
      case 'image_generation': return cap.imageGeneration;
      case 'video_generation': return cap.videoGeneration;
      case 'tts': return cap.tts;
      default: return cap.text; // text tasks: safety_check, narrative_map, script_generation, etc.
    }
  }

  getEta(projectId: string): { etaMs: number; completedMs: number; confidence: 'high' | 'low' } | null {
    const project = this.orchestrator.loadProject(projectId);
    if (!project) return null;
    return this.orchestrator.observability.estimateTimeRemaining(
      projectId,
      getStageOrder(),
      project.stageStatus as Record<string, string>,
    );
  }

  /* ---- Setup / first-run ---- */

  getProviderCount(): number {
    return this.orchestrator.providerRegistry.getAll().length;
  }

  /** Count of API-type resources (Gemini + AIVideoMaker keys). */
  getApiResourceCount(): number {
    const accounts = this.getAccounts ? this.getAccounts() : this.accounts;
    // API resources have empty profileDir by convention
    return accounts.filter(a => !a.profileDir).length;
  }

  hasApiKey(): boolean {
    return false;
  }

  completeSetup(body: { aivideomakerApiKey?: string }): { ok: true } {
    if (body.aivideomakerApiKey) {
      // Add to the adapters list (avoid duplicates)
      const existing = this.aivideomakerAdapters.some(a => (a as any).apiKey === body.aivideomakerApiKey);
      if (!existing) {
        this.aivideomakerAdapters.push(new AIVideoMakerAdapter(body.aivideomakerApiKey));
      }
      this.configStore.update({ aivideomakerApiKey: body.aivideomakerApiKey });
    }
    this.notifyApiKeysChanged();
    return { ok: true };
  }

  /* ---- Config management ---- */

  getConfig(): { productionConcurrency: number; videoProviderConfig?: any } {
    const saved = this.configStore.get();
    const vpConfig = saved.videoProviderConfig;
    const profileDirs = (vpConfig as any)?.profileDirs?.length
      ? (vpConfig as any).profileDirs
      : (vpConfig as any)?.profileDir
        ? [(vpConfig as any).profileDir]
        : [];
    return {
      productionConcurrency: saved.productionConcurrency ?? 2,
      videoProviderConfig: profileDirs.length > 0 ? { profileDirs } : undefined,
    };
  }

  updateConfig(body: { aivideomakerApiKey?: string; productionConcurrency?: number }): { ok: true } {
    if (body.aivideomakerApiKey) {
      const existing = this.aivideomakerAdapters.some(a => (a as any).apiKey === body.aivideomakerApiKey);
      if (!existing) {
        this.aivideomakerAdapters.push(new AIVideoMakerAdapter(body.aivideomakerApiKey));
      }
    }
    this.configStore.update({
      aivideomakerApiKey: body.aivideomakerApiKey || undefined,
      ...(body.productionConcurrency !== undefined ? { productionConcurrency: body.productionConcurrency } : {}),
    });
    this.rebuildOrchestrator();
    this.notifyApiKeysChanged();
    return { ok: true };
  }

  /** Notify the resource manager that API keys may have changed. */
  private notifyApiKeysChanged(): void {
    if (!this.onApiKeysChanged) return;
    this.onApiKeysChanged({
      aivideomakerApiKeys: this.aivideomakerAdapters.map(a => (a as any).apiKey as string).filter(Boolean),
    });
  }

  getVideoProviderConfig(): unknown {
    return this.getVideoConfig?.() ?? this.configStore.get().videoProviderConfig ?? null;
  }

  updateVideoProviderConfig(config: VideoProviderConfig | null): void {
    this.configStore.update({ videoProviderConfig: config ?? undefined });
    this.rebuildOrchestrator();
  }

  getTtsConfig(): unknown {
    return this.configStore.get().ttsConfig ?? {};
  }

  updateTtsConfig(config: any): void {
    this.configStore.update({ ttsConfig: config });
  }

  /* ---- Queue Detection ---- */

  getQueueDetectionPresets(): Record<string, QueueDetectionConfig> {
    return getQueueDetectionPresets();
  }

  updateQueueDetectionPresets(overrides: Record<string, QueueDetectionConfig>): void {
    saveQueueDetectionOverrides(overrides);
  }

  deleteQueueDetectionPreset(providerId: string): boolean {
    return deleteQueueDetectionOverride(providerId);
  }

  /* ---- Export / Import ---- */

  exportProject(projectId: string): Record<string, any> | null {
    const project = this.orchestrator.loadProject(projectId);
    if (!project) return null;

    const projectDir = this.orchestrator.getProjectDir(projectId);
    const bundle: Record<string, any> = { project };

    for (const name of EXPORTABLE_ARTIFACTS) {
      const filePath = join(projectDir, name);
      if (existsSync(filePath)) {
        try { bundle[name] = JSON.parse(readFileSync(filePath, 'utf-8')); } catch { /* skip */ }
      }
    }

    bundle._exportedAt = new Date().toISOString();
    bundle._version = '1.0';
    return bundle;
  }

  importProject(bundle: Record<string, any>): PipelineProject {
    const projectId = `proj_${Date.now()}`;
    const imported = { ...bundle.project, id: projectId, updatedAt: new Date().toISOString() };

    const projectDir = this.orchestrator.getProjectDir(projectId);
    if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });
    writeFileSync(join(projectDir, 'project.json'), JSON.stringify(imported, null, 2));

    for (const name of EXPORTABLE_ARTIFACTS) {
      if (bundle[name]) {
        writeFileSync(join(projectDir, name), JSON.stringify(bundle[name], null, 2));
      }
    }

    return imported;
  }

  /* ---- Accessors for things routes still need directly ---- */

  getDataDir(): string {
    return this.dataDir;
  }

  getProjectDir(projectId: string): string {
    return this.orchestrator.getProjectDir(projectId);
  }

  getEventLog(projectId: string): unknown[] {
    const logPath = join(this.dataDir, 'projects', projectId, 'events.jsonl');
    if (!existsSync(logPath)) return [];
    return readFileSync(logPath, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l));
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
    const projectDir = this.getProjectDir(projectId);
    const traceDir = join(projectDir, 'trace');
    if (!existsSync(traceDir)) return null;

    try {
      const files = readdirSync(traceDir)
        .filter(f => f.startsWith('trace-') && f.endsWith('.json'))
        .sort()
        .reverse();

      if (files.length === 0) return null;
      return TraceWriter.load(join(traceDir, files[0]));
    } catch {
      return null;
    }
  }

  getTrace(projectId: string, traceId: string): TraceReplayBundle | null {
    const projectDir = this.getProjectDir(projectId);
    const bundlePath = join(projectDir, 'trace', `trace-${traceId}.json`);
    if (!existsSync(bundlePath)) return null;

    try {
      return TraceWriter.load(bundlePath);
    } catch {
      return null;
    }
  }

  listTraces(projectId: string): Array<{ traceId: string; startedAt: string; outcome: string; durationMs?: number }> {
    const projectDir = this.getProjectDir(projectId);
    const traceDir = join(projectDir, 'trace');
    if (!existsSync(traceDir)) return [];

    const results: Array<{ traceId: string; startedAt: string; outcome: string; durationMs?: number }> = [];
    try {
      const files = readdirSync(traceDir)
        .filter(f => f.startsWith('trace-') && f.endsWith('.json'));

      for (const f of files) {
        try {
          const bundle = TraceWriter.load(join(traceDir, f));
          results.push({
            traceId: bundle.traceId,
            startedAt: bundle.startedAt,
            outcome: bundle.outcome,
            durationMs: bundle.durationMs,
          });
        } catch {
          // Skip corrupt bundles
        }
      }
    } catch {
      // Ignore read errors
    }

    return results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
  }

  /* ---- AI Logs (input/output diff) ---- */

  getAiLogs(projectId: string): AiLogEntry[] {
    const projectDir = this.getProjectDir(projectId);
    const logDir = join(projectDir, 'ai-logs');
    if (!existsSync(logDir)) return [];

    const entries: AiLogEntry[] = [];
    try {
      const files = readdirSync(logDir)
        .filter(f => f.endsWith('.json'))
        .sort();

      for (const f of files) {
        try {
          const raw = readFileSync(join(logDir, f), 'utf-8');
          const parsed = JSON.parse(raw) as Partial<AiLogEntry>;
          if (!parsed || typeof parsed !== 'object') continue;
          if (!parsed.timestamp || !parsed.stage || !parsed.method || !parsed.provider || !parsed.input) continue;
          entries.push({
            seq: parsed.seq ?? '',
            timestamp: String(parsed.timestamp),
            stage: String(parsed.stage),
            taskType: String(parsed.taskType ?? ''),
            method: String(parsed.method),
            provider: String(parsed.provider),
            durationMs: Number(parsed.durationMs ?? 0),
            input: parsed.input as AiLogEntry['input'],
            output: (parsed.output ?? undefined) as AiLogEntry['output'],
            error: (parsed.error ?? undefined) as AiLogEntry['error'],
          });
        } catch {
          // Skip corrupt log files
        }
      }
    } catch {
      // Ignore directory read errors
    }

    return entries;
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
    try {
      const projectDir = this.orchestrator.getProjectDir(projectId);
      const iterPath = join(projectDir, 'iterations.jsonl');
      const entry = { ...data, timestamp: new Date().toISOString() };
      appendFileSync(iterPath, JSON.stringify(entry) + '\n');
    } catch {
      // Best-effort — don't break the main operation
    }
  }

  getIterations(projectId: string): unknown[] {
    const projectDir = this.orchestrator.getProjectDir(projectId);
    const iterPath = join(projectDir, 'iterations.jsonl');
    if (!existsSync(iterPath)) return [];
    return readFileSync(iterPath, 'utf-8').split('\n').filter(Boolean).map(l => {
      try { return JSON.parse(l); } catch { return null; }
    }).filter(Boolean);
  }

  /* ---- Refinement Options ---- */

  /**
   * Get the current refinement options for a project.
   * Returns stored options merged with defaults.
   */
  getRefineOptions(projectId: string): import('../../shared/types.js').RefineOptions {
    const { DEFAULT_REFINE_OPTIONS, packagingStyleToRefineOptions } = require('../../shared/types.js') as typeof import('../../shared/types.js');
    const projectDir = this.orchestrator.getProjectDir(projectId);
    const optionsPath = join(projectDir, 'refine-options.json');

    // Load smart defaults from StyleAnalysisCIR packagingTrack (if available)
    let smartDefaults: Partial<import('../../shared/types.js').RefineOptions> = {};
    try {
      const cirPath = join(projectDir, 'style-analysis.cir.json');
      if (existsSync(cirPath)) {
        const styleCIR = JSON.parse(readFileSync(cirPath, 'utf-8'));
        const { options } = packagingStyleToRefineOptions(
          styleCIR.packagingTrack,
          styleCIR.confidence,
          styleCIR.audioTrack?.bgmRelativeVolume,
        );
        smartDefaults = options;
      }
    } catch {
      // Graceful fallback — packaging data may not exist for older projects
    }

    const base = { ...DEFAULT_REFINE_OPTIONS, ...smartDefaults };

    if (!existsSync(optionsPath)) {
      return base;
    }

    try {
      const saved = JSON.parse(readFileSync(optionsPath, 'utf-8'));
      return { ...base, ...saved };
    } catch {
      return base;
    }
  }

  /**
   * Get provenance info: which RefineOptions fields were inferred from the reference video.
   * Returns an array of field names (e.g. ['subtitlePreset', 'bgmVolume', 'fadeInDuration']).
   */
  getRefineProvenance(projectId: string): string[] {
    const { packagingStyleToRefineOptions } = require('../../shared/types.js') as typeof import('../../shared/types.js');
    const projectDir = this.orchestrator.getProjectDir(projectId);
    try {
      const cirPath = join(projectDir, 'style-analysis.cir.json');
      if (!existsSync(cirPath)) return [];
      const styleCIR = JSON.parse(readFileSync(cirPath, 'utf-8'));
      const { provenance } = packagingStyleToRefineOptions(
        styleCIR.packagingTrack,
        styleCIR.confidence,
        styleCIR.audioTrack?.bgmRelativeVolume,
      );
      return [...provenance];
    } catch {
      return [];
    }
  }

  /**
   * Get reference-video defaults (base + packaging-inferred smart defaults) without user overrides.
   * Used by the UI "复刻值" button to reset to the AI-inferred values.
   */
  getRefineReferenceDefaults(projectId: string): import('../../shared/types.js').RefineOptions {
    const { DEFAULT_REFINE_OPTIONS, packagingStyleToRefineOptions } = require('../../shared/types.js') as typeof import('../../shared/types.js');
    const projectDir = this.orchestrator.getProjectDir(projectId);
    let smartDefaults: Partial<import('../../shared/types.js').RefineOptions> = {};
    try {
      const cirPath = join(projectDir, 'style-analysis.cir.json');
      if (existsSync(cirPath)) {
        const styleCIR = JSON.parse(readFileSync(cirPath, 'utf-8'));
        const { options } = packagingStyleToRefineOptions(
          styleCIR.packagingTrack,
          styleCIR.confidence,
          styleCIR.audioTrack?.bgmRelativeVolume,
        );
        smartDefaults = options;
      }
    } catch {
      // Graceful fallback
    }
    return { ...DEFAULT_REFINE_OPTIONS, ...smartDefaults };
  }

  /**
   * Update refinement options for a project.
   */
  updateRefineOptions(projectId: string, options: Partial<import('../../shared/types.js').RefineOptions>): import('../../shared/types.js').RefineOptions {
    const projectDir = this.orchestrator.getProjectDir(projectId);
    const optionsPath = join(projectDir, 'refine-options.json');

    const current = this.getRefineOptions(projectId);
    const updated = { ...current, ...options };

    writeFileSync(optionsPath, JSON.stringify(updated, null, 2), 'utf-8');
    return updated;
  }

  /**
   * Start re-assembly with current refinement options.
   * Runs ASSEMBLY stage again with the configured options.
   */
  startReAssembly(projectId: string): void {
    const project = this.orchestrator.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const refineOptions = this.getRefineOptions(projectId);

    // Check for BGM file
    const projectDir = this.orchestrator.getProjectDir(projectId);
    const bgmDir = join(projectDir, 'bgm');
    let bgmPath: string | undefined;
    if (existsSync(bgmDir)) {
      const files = readdirSync(bgmDir);
      const bgmFile = files.find(f => f.startsWith('bgm.'));
      if (bgmFile) {
        bgmPath = join(bgmDir, bgmFile);
      }
    }

    // Store refine options in project for orchestrator to use
    (project as any).refineOptions = refineOptions;
    if (bgmPath) {
      (project as any).bgmPath = bgmPath;
    }
    this.orchestrator.saveProject(project);

    // Trigger ASSEMBLY retry
    this.orchestrator.retryStage(projectId, 'ASSEMBLY').catch((err) => {
      log.error('re_assembly_failed', err, { projectId });
    });
  }
}
