// @ts-nocheck -- see tsconfig.json noUncheckedIndexedAccess migration (scripts/check-strict-progress.mjs)
/* ------------------------------------------------------------------ */
/*  CompilationOrchestrator – drives the 13-pass multimodal compiler  */
/*  Source (topic + reference video) → CIR transforms → codegen →    */
/*  linking (FFmpeg) → output binary (.mp4).                         */
/*  Delegates persistence to ProjectStore and uses RunLock for       */
/*  per-project concurrency safety.                                  */
/* ------------------------------------------------------------------ */

import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACT, ARTIFACT_CACHE_FIELDS } from './constants.js';
import type {
  AIAdapter, PipelineProject, PipelineStage,
  StyleProfile, Scene, LogEntry, PipelineEvent, ModelOverrides, StoryboardReplicationSettings,
} from './pipelineTypes.js';
import { SSE_EVENT } from './pipelineTypes.js';
import type { PluginRegistry, PluginDeps } from './providers/index.js';
import { quotaBus } from './quotaBus.js';
import { SessionManager } from './sessionManager.js';
import { ProviderCapabilityRegistry, type AccountSeed } from './providerRegistry.js';
import { generateResourcePlan, type ResourcePlan } from './resourcePlanner.js';
import { ObservabilityService } from './observability.js';
import { ProjectStore } from './projectStore.js';
import { RunLock } from './runLock.js';
import { getStageDefinitions, getStageOrder, type StageRunContext } from './stageRegistry.js';
import { applyRetryPolicies } from './stageRetryWrapper.js';
import { runPreflight } from './preflight.js';
import { AdapterResolver, type AdapterScope } from './adapterResolver.js';
import { HumanInLoopService } from './humanInLoop.js';
import { StageRunner } from './stageRunner.js';
import { createDefaultPipelineServices } from './pipelineServices.js';
// Side-effect import: registers all stage definitions in execution order.
import './stages/defs/index.js';
// Direct import kept for post-approve reference-image completion.
import { runRemainingReferenceImages } from './stages/referenceImage.js';
import { loadVideoIR, type CIRLoadContext } from './cir/loader.js';
import { parseScriptCIR } from './cir/parsers.js';
import { CostTracker } from './costTracker.js';
import { VideoProviderHealthMonitor } from './videoProviderHealth.js';
import { AIRequestAbortedError } from './aiControl.js';
import { createLogger } from '@ai-video/pipeline-core/libFacade.js';
import { TraceWriter, createRootContext, classifyError, makeTraceEvent, type TraceContext, type TraceWriterMeta } from './traceStore.js';
import { ensurePathWithinBase } from '@ai-video/pipeline-core/libFacade.js';
import { TempFileTracker } from '@ai-video/pipeline-core/libFacade.js';
import { transitionStage } from './stateMachine.js';
import { recoverStaleProjectsForOrchestrator, scheduleQuotaResetForOrchestrator } from './orchestrator.preflight.js';
import { runPostStageHooksForPipeline, shouldPausePipeline } from './orchestrator.run.js';

const log = createLogger('Orchestrator');

/**
 * Thrown when safety checks determine the topic or content is unsafe.
 * The pipeline must halt — this error should NOT be retried.
 */
export class SafetyBlockError extends Error {
  constructor(reason: string) {
    super(`Safety block: ${reason}`);
    this.name = 'SafetyBlockError';
  }
}

export type PipelineEventListener = (event: PipelineEvent) => void;

export interface PipelineConfig {
  /** Base directory for project data */
  dataDir: string;
  /** aivideomaker.ai API adapters for parallel video generation (one per account). */
  aivideomakerAdapters?: AIAdapter[];
  /** Max concurrent scene generations */
  productionConcurrency?: number;
  /** TTS voice/rate/pitch settings */
  ttsConfig?: { voice?: string; rate?: string; pitch?: string };
  /** Account seeds for populating provider registry from real configured accounts */
  accounts?: AccountSeed[];
  /** Optional plugin registry for plugin-based provider routing. */
  pluginRegistry?: PluginRegistry;
  /** Dependencies bag for plugin adapter factories. */
  pluginDeps?: PluginDeps;
}

interface ProjectRunState extends AdapterScope {
  abortController: AbortController;
  preCompletedStages: Set<PipelineStage>;
  tempFiles: TempFileTracker;
}



/**
 * PipelineOrchestrator manages the complete video generation pipeline.
 *
 * Key features:
 * - Accepts an AIAdapter (ChatAdapter for free, GeminiAdapter for paid)
 * - Persists intermediate artifacts to disk for resume capability
 * - Emits events for real-time UI progress
 * - Supports per-stage retry
 */
export class PipelineOrchestrator {
  private chatAdapter: AIAdapter;
  private config: PipelineConfig;
  private listeners: PipelineEventListener[] = [];
  /** Per-project abort flags (replaces single global `aborted` boolean). */
  private abortedProjects = new Set<string>();
  /** Per-project pause requests — "pause after current stage finishes". */
  private pauseRequested = new Set<string>();
  /** Per-project runtime state — replaces singleton currentProject/preCompleted fields. */
  private activeRuns = new Map<string, ProjectRunState>();
  /** Timer for daily quota auto-reset. */
  private quotaResetTimer?: ReturnType<typeof setTimeout>;

  /** Session manager for chat context reuse across stage groups. */
  readonly sessionManager = new SessionManager();
  /** Provider capability registry for dynamic provider selection. */
  readonly providerRegistry = new ProviderCapabilityRegistry();
  /** Observability service for per-stage telemetry. */
  readonly observability = new ObservabilityService();
  /** Centralised project persistence with atomic writes. */
  readonly store: ProjectStore;
  /** Per-project run lock — prevents concurrent runs on the same project. */
  readonly runLock = new RunLock();
  /** Cost tracking and audit logging. */
  readonly costTracker: CostTracker;
  /** Video provider health monitoring. */
  readonly videoHealthMonitor = new VideoProviderHealthMonitor();
  /** Per-project trace writers for pipeline telemetry. */
  private traceWriters = new Map<string, { writer: TraceWriter; ctx: TraceContext; meta: TraceWriterMeta; startMs: number }>();
  /** Adapter resolver — encapsulates adapter wrapping & plugin vs legacy routing. */
  private readonly adapterResolver: AdapterResolver;
  /** Operator-facing retry / single-scene regeneration API. */
  private readonly humanInLoop: HumanInLoopService;
  /** Per-stage execution engine (state-machine + SSE + trace + observability). */
  private readonly stageRunner: StageRunner;

  constructor(chatAdapter: AIAdapter, config: PipelineConfig) {
    this.chatAdapter = chatAdapter;
    this.config = config;
    this.store = new ProjectStore(config.dataDir);
    this.costTracker = new CostTracker(config.dataDir);

    this.adapterResolver = new AdapterResolver({
      chatAdapter,
      providerRegistry: this.providerRegistry,
      sessionManager: this.sessionManager,
      observability: this.observability,
      costTracker: this.costTracker,
      pluginRegistry: config.pluginRegistry,
      pluginDeps: config.pluginDeps,
      loadProject: id => this.loadProject(id),
      getTraceState: id => {
        const s = this.traceWriters.get(id);
        return s ? { writer: s.writer, ctx: s.ctx } : undefined;
      },
    });

    this.stageRunner = new StageRunner({
      saveProject: p => this.saveProject(p),
      emit: event => this.emit(event),
      observability: this.observability,
      sessionManager: this.sessionManager,
      getProjectDir: pid => this.getProjectDir(pid),
      getTraceState: pid => this.traceWriters.get(pid),
      runInTx: (pid, fn) => this.store.tx(pid, fn),
    });

    this.humanInLoop = new HumanInLoopService({
      loadProject: id => this.loadProject(id),
      saveProject: p => this.saveProject(p),
      saveArtifact: (pid, file, data) => this.saveArtifact(pid, file, data),
      loadArtifact: <T>(pid: string, file: string) => this.loadArtifact<T>(pid, file),
      getProjectDir: pid => this.getProjectDir(pid),
      getAdapter: (scope, stage, taskType, overrides) =>
        this.getAdapter(scope, stage, taskType, overrides),
      sessionManager: this.sessionManager,
      getAivideomakerAdapters: () => this.config.aivideomakerAdapters,
      runPipeline: pid => this.run(pid),
    });

    // Seed provider registry from real accounts
    if (config.accounts?.length) {
      this.providerRegistry.seedFromAccounts(config.accounts);
    }

    // Wire health monitor events to pipeline event bus
    this.videoHealthMonitor.onEvent((event) => {
      if (event.type === 'provider_degraded' || event.type === 'provider_down') {
        const msg = event.type === 'provider_degraded'
          ? `⚠️ 视频提供者降级: ${event.payload.recommendation}`
          : `🔴 视频提供者不可用: ${event.payload.recommendation}`;
        this.emit({
          type: SSE_EVENT.LOG,
          payload: {
            projectId: this.resolveSystemProjectId(),
            entry: {
              id: `log_${Date.now()}`,
              timestamp: new Date().toISOString(),
              message: msg,
              type: event.type === 'provider_down' ? 'error' : 'warning',
              stage: 'VIDEO_GEN',
            },
          },
        });
      }
    });

    // Bridge QuotaBus events to ProviderCapabilityRegistry for unified quota awareness (P0-3)
    quotaBus.on((event) => {
      if (event.exhausted) {
        if (this.providerRegistry.get(event.provider)) {
          this.providerRegistry.markQuotaExhausted(event.provider);
          log.info('quota_exhausted', { provider: event.provider });
        }
      } else {
        this.providerRegistry.resetQuota(event.provider);
      }
    });

    // Schedule daily quota auto-reset at UTC midnight (P1-2)
    this.scheduleQuotaReset();

    // Crash recovery: reset stale 'processing' stages left by previous crash
    this.recoverStaleProjects();
  }

  /** Schedule daily quota reset at next UTC midnight (P1-2). */
  private scheduleQuotaReset(): void {
    scheduleQuotaResetForOrchestrator(this, log);
  }

  /**
   * Scan for projects stuck in 'processing' state (server crash recovery).
   * Resets them to 'pending' so they can be re-run.
   */
  private recoverStaleProjects(): void {
    recoverStaleProjectsForOrchestrator(this, log);
  }

  onEvent(fn: PipelineEventListener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private emit(event: PipelineEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  private resolveSystemProjectId(): string {
    const activeIds = [...this.activeRuns.keys()];
    return activeIds.length === 1 ? activeIds[0] : 'system';
  }

  private abortProject(projectId: string): void {
    this.abortedProjects.add(projectId);
    const runState = this.activeRuns.get(projectId);
    if (runState && !runState.abortController.signal.aborted) {
      runState.abortController.abort();
    }
  }

  abort(): void {
    const activeIds = [...this.activeRuns.keys()];
    const fallbackProjectId = activeIds[activeIds.length - 1];
    if (fallbackProjectId) {
      this.abortProject(fallbackProjectId);
    }
  }

  /**
   * Request the pipeline to pause after the current stage completes.
   * Unlike abort(), this sets isPaused=true for clean resume.
   */
  requestPause(projectId: string): void {
    this.pauseRequested.add(projectId);
    log.info('pause_requested', { projectId });
  }

  /* ---- Project management ---- */

  createProject(topic: string, title?: string, modelOverrides?: ModelOverrides): PipelineProject {
    const project = this.store.create(topic, title, modelOverrides);
    this.emit({ type: SSE_EVENT.CREATED, payload: { projectId: project.id } });
    return project;
  }

  getProjectDir(projectId: string): string {
    return this.store.getProjectDir(projectId);
  }

  saveProject(project: PipelineProject): void {
    this.store.save(project);
  }

  loadProject(projectId: string): PipelineProject | null {
    return this.store.load(projectId);
  }

  /**
   * Clear ??=-cached artifact fields on a project so next stage re-reads from disk.
   * @param projectId  Project to invalidate
   * @param artifacts  Artifact filenames to clear (default: all cacheable)
   */
  invalidateArtifactCache(projectId: string, artifacts?: Iterable<string>): void {
    const project = this.loadProject(projectId);
    if (!project) return;
    const targets = artifacts ? new Set(artifacts) : undefined;
    for (const [artifact, fieldName] of ARTIFACT_CACHE_FIELDS) {
      if (!targets || targets.has(artifact)) {
        (project as Record<string, unknown>)[fieldName] = undefined;
      }
    }
    this.saveProject(project);
  }

  private saveArtifact(projectId: string, filename: string, data: unknown): void {
    this.store.saveArtifact(projectId, filename, data);
  }

  private loadArtifact<T>(projectId: string, filename: string): T | undefined {
    return this.store.loadArtifact<T>(projectId, filename);
  }

  deleteProject(projectId: string): boolean {
    this.sessionManager.clearProject(projectId);
    return this.store.delete(projectId);
  }

  listProjects(): PipelineProject[] {
    return this.store.list();
  }

  /* ---- Pipeline execution ---- */

  /**
   * Run the full pipeline from start (or resume from last completed stage).
   */
  async run(projectId: string, videoFilePath?: string): Promise<PipelineProject> {
    const runState: ProjectRunState = {
      projectId,
      projectDir: this.getProjectDir(projectId),
      abortSignal: undefined,
      abortController: new AbortController(),
      preCompletedStages: new Set<PipelineStage>(),
      tempFiles: new TempFileTracker(),
    };
    runState.abortSignal = runState.abortController.signal;

    // Per-project concurrency guard
    if (!this.runLock.acquire(projectId, () => { this.abortProject(projectId); })) {
      throw new Error(`Project ${projectId} is already running`);
    }

    this.activeRuns.set(projectId, runState);
    this.abortedProjects.delete(projectId);
    this.pauseRequested.delete(projectId);
    const loaded = this.loadProject(projectId);
    if (!loaded) {
      this.activeRuns.delete(projectId);
      this.runLock.release(projectId);
      throw new Error(`Project ${projectId} not found`);
    }
    let project: PipelineProject = loaded;

    // Track resume timestamp if project was previously paused
    if (project.isPaused) {
      project.resumedAt = new Date().toISOString();
      project.isPaused = false;
      log.info('pipeline_resumed', { projectId, pausedAtStage: project.pausedAtStage, resumedAt: project.resumedAt });
    }

    // Restore persisted session state for this project
    this.sessionManager.loadFrom(runState.projectDir);

    // Record which stages were already completed — shouldPause() will skip these
    runState.preCompletedStages = new Set(
      getStageOrder().filter(s => project.stageStatus[s] === 'completed'),
    );

    if (videoFilePath) {
      // Resolve relative filenames against the uploads directory
      const uploadsDir = join(this.config.dataDir, 'uploads');
      let resolved = videoFilePath;
      if (!videoFilePath.startsWith('/')) {
        const candidate = join(uploadsDir, videoFilePath);
        if (existsSync(candidate)) {
          resolved = candidate;
        }
      }
      // W17: Path traversal guard — ensure resolved path stays within uploads directory
      ensurePathWithinBase(uploadsDir, resolved, 'videoFilePath');
      project.referenceVideoPath = resolved;
      this.saveProject(project);
    }

    const assetsDir = join(runState.projectDir, 'assets');
    if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });

    const addLog = (entry: LogEntry) => {
      project!.logs.push(entry);
      this.emit({ type: SSE_EVENT.LOG, payload: { projectId, entry } });
    };

    this.observability.startPipeline(projectId);
    this.observability.loadFrom(runState.projectDir, projectId);

    // Trace: initialise trace context and writer for this run
    const traceCtx = createRootContext();
    const traceMeta: TraceWriterMeta = {
      topic: project.topic ?? '',
      qualityTier: 'free',
      startedAt: new Date().toISOString(),
    };
    const traceWriter = new TraceWriter(traceCtx.traceId, projectId, runState.projectDir);
    this.traceWriters.set(projectId, { writer: traceWriter, ctx: traceCtx, meta: traceMeta, startMs: Date.now() });
    traceWriter.append(makeTraceEvent('pipeline.start', traceCtx, projectId, {
      topic: project.topic ?? '',
      qualityTier: 'free',
      totalStages: getStageOrder().length,
    }));

    try {
      // Build the shared context that every stage definition receives.
      const ctx: StageRunContext = {
        project,
        projectId,
        assetsDir,
        getAdapter: (stage, taskType, overrides) => this.getAdapter(runState, stage, taskType, overrides),
        getSessionAwareAdapter: (stage, taskType, overrides) =>
          this.getSessionAwareAdapter(runState, stage, taskType, overrides),
        addLog,
        saveArtifact: (filename, data) => this.saveArtifact(projectId, filename, data),
        loadArtifact: <T>(filename: string) => this.loadArtifact<T>(projectId, filename),
        isAborted: () => this.abortedProjects.has(projectId) || runState.abortController.signal.aborted,
        abortSignal: runState.abortController.signal,
        config: {
          productionConcurrency: this.config.productionConcurrency ?? 2,
          ttsConfig: this.config.ttsConfig,
          aivideomakerAdapters: this.config.aivideomakerAdapters,
        },
        emitEvent: (event) => this.emit(event),
        providerRegistry: this.providerRegistry,
        regenerateScene: (pid, sid) => this.regenerateSceneAssets(pid, sid),
        services: createDefaultPipelineServices({
          assetsDir,
          saveArtifact: (filename, data) => this.saveArtifact(projectId, filename, data),
          loadArtifact: <T>(filename: string) => this.loadArtifact<T>(projectId, filename),
          loggerName: `pipeline.${projectId}`,
        }),
      };

      // Execute each registered stage in order (with automatic retry for eligible stages).
      const stages = applyRetryPolicies(getStageDefinitions(), undefined,
        { writer: traceWriter, parentTrace: traceCtx });

      // Pre-run validation (fails fast on missing providers / binaries / profiles).
      await runPreflight(project, stages.length, {
        providerRegistry: this.providerRegistry,
        aivideomakerAdapters: this.config.aivideomakerAdapters,
        preCompletedStages: runState.preCompletedStages,
        addLog,
        getResourcePlan: p => this.getResourcePlan(p.id, p.modelOverrides),
      });

      for (const def of stages) {
        const { stage } = def;

        if (project.stageStatus[stage] !== 'completed') {
          // Reset error stages to pending before running (error→processing is not a valid transition)
          if (project.stageStatus[stage] === 'error') {
            transitionStage(project.stageStatus, stage, 'pending');
            project.error = undefined;
            this.saveProject(project);
          }
          project = await this.runStage(project, stage, async () => {
            // Keep context.project in sync after runStage reloads.
            ctx.project = project;
            await def.execute(ctx);
          });
        } else {
          // B4: Log skipped stages for auditability (resume scenario)
          log.info('stage_skipped', { stage, projectId, reason: 'already_completed' });
        }

        // Abort check
        if (this.abortedProjects.has(projectId)) return project;

        // Post-stage hooks
        this.runPostStageHooks(project, stage, addLog);

        // Pause checkpoint
        if (this.shouldPause(project, stage, runState)) return project;
      }

      this.emit({ type: SSE_EVENT.COMPLETE, payload: { projectId } });

      // Trace: record pipeline completion
      const traceState = this.traceWriters.get(projectId);
      if (traceState) {
        traceState.writer.append(makeTraceEvent('pipeline.complete', traceState.ctx, projectId, {
          durationMs: Date.now() - traceState.startMs,
          stagesCompleted: getStageOrder().filter(s => project.stageStatus[s] === 'completed').length,
        }));
        traceState.writer.save(traceState.meta);
        this.traceWriters.delete(projectId);
      }

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      project.error = message;
      addLog({
        id: `log_${Date.now()}`,
        timestamp: new Date().toISOString(),
        message: err instanceof AIRequestAbortedError ? `Pipeline aborted: ${message}` : `Pipeline error: ${message}`,
        type: err instanceof AIRequestAbortedError ? 'warning' : 'error',
      });

      // Notify UI clients of the pipeline-level failure via SSE so they
      // don't silently hang.  Use the last attempted stage (or the first
      // stage if the error occurred during preflight, before any stage ran).
      const errorStage: PipelineStage = project.currentStage ?? getStageOrder()[0];
      this.emit({
        type: SSE_EVENT.ERROR,
        payload: { projectId, stage: errorStage, error: message },
      });

      // Trace: record pipeline error
      const traceState = this.traceWriters.get(projectId);
      if (traceState) {
        traceState.writer.append(makeTraceEvent('pipeline.error', traceState.ctx, projectId, {
          failure: classifyError(err),
          durationMs: Date.now() - traceState.startMs,
          lastStage: project.currentStage,
        }));
        traceState.writer.save(traceState.meta);
        this.traceWriters.delete(projectId);
      }
    } finally {
      // Always release the run lock when exiting run(), whether due to
      // completion, pause, abort, or error. This allows resume/retry
      // to re-acquire the lock.
      runState.tempFiles.cleanup();
      this.activeRuns.delete(projectId);
      this.runLock.release(projectId);
    }

    // Finalize observability metrics
    const metrics = this.observability.completePipeline(projectId);
    if (metrics) {
      this.saveArtifact(projectId, ARTIFACT.PIPELINE_METRICS, metrics);
      // Persist finalized metrics (with totalDurationMs) to observability.json
      this.observability.saveTo(this.getProjectDir(projectId), projectId);
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: this.observability.getSummary(projectId), type: 'info' });
    }

    this.saveProject(project);
    return project;
  }

  /**
   * Retry a specific stage — delegates to HumanInLoopService.
   */
  async retryStage(projectId: string, stage: PipelineStage): Promise<PipelineProject> {
    return this.humanInLoop.retryStage(projectId, stage);
  }

  /**
   * Regenerate a single scene's assets — delegates to HumanInLoopService.
   */
  async regenerateSceneAssets(projectId: string, sceneId: string): Promise<Scene> {
    return this.humanInLoop.regenerateSceneAssets(projectId, sceneId);
  }

  /* ---- Internal helpers ---- */

  /**
   * Check if pipeline should pause after the given stage completes.
   * If yes, sets isPaused, saves, emits event, and returns true.
   */
  private shouldPause(project: PipelineProject, stage: PipelineStage, runState: ProjectRunState): boolean {
    return shouldPausePipeline(this, project, stage, runState);
  }

  /**
   * Post-stage hooks that run between stages in the registry loop.
   * Keeps cross-cutting concerns (safety gate, quality gate) centralised
   * while stage definitions remain pure execution units.
   */
  private runPostStageHooks(
    project: PipelineProject,
    stage: PipelineStage,
    addLog: (entry: LogEntry) => void,
  ): void {
    runPostStageHooksForPipeline(project, stage, addLog);
  }

  /* ---- Resume / edit / approve / reject ---- */

  /**
   * Resume a paused pipeline from where it stopped.
   */
  async resumePipeline(projectId: string): Promise<PipelineProject> {
    const project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);
    if (!project.isPaused) throw new Error('Project is not paused');

    const resumedStage = project.pausedAtStage!;
    project.isPaused = false;
    project.pausedAtStage = undefined;
    this.saveProject(project);
    this.emit({ type: SSE_EVENT.RESUMED, payload: { projectId, stage: resumedStage } });

    // Continue pipeline from current state (run() auto-skips completed stages)
    return this.run(projectId);
  }

  /**
   * Update script text while pipeline is paused after SCRIPTING.
   * Saves previous version to script version history for rollback.
   */
  updateScript(projectId: string, scriptText: string): PipelineProject {
    const project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    // Save previous version to history
    if (project.scriptOutput?.scriptText) {
      const history = this.loadArtifact<any[]>(projectId, ARTIFACT.SCRIPT_HISTORY) ?? [];
      history.push({
        version: history.length + 1,
        scriptText: project.scriptOutput.scriptText,
        timestamp: new Date().toISOString(),
        source: history.length === 0 ? 'ai_generated' : 'user_edit',
      });
      this.saveArtifact(projectId, ARTIFACT.SCRIPT_HISTORY, history);
    }

    if (!project.scriptOutput) {
      project.scriptOutput = { scriptText, usedFactIDs: [], factUsage: [] };
    } else {
      project.scriptOutput.scriptText = scriptText;
    }
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);

    // Also update the artifact file
    const existing = this.loadArtifact<any>(projectId, ARTIFACT.SCRIPT) ?? {};
    existing.scriptOutput = project.scriptOutput;
    this.saveArtifact(projectId, ARTIFACT.SCRIPT, existing);

    // D1-1: Rebuild ScriptCIR so downstream stages (TEMPORAL_PLANNING, STORYBOARD)
    // see the edited script instead of the stale pre-edit CIR.
    try {
      const language = project.styleProfile?.meta?.video_language ?? 'Chinese';
      const updatedCIR = parseScriptCIR(project.scriptOutput, project.calibrationData, language);
      this.saveArtifact(projectId, ARTIFACT.SCRIPT_CIR, updatedCIR);
      log.info('script_cir_rebuilt', { projectId });
    } catch (err) {
      // CIR rebuild is best-effort — log but don't block the edit.
      // The next stage run will re-generate if needed.
      log.warn('script_cir_rebuild_failed', { projectId, error: (err as Error).message });
    }

    return project;
  }

  /**
   * Get script version history for a project.
   */
  getScriptHistory(projectId: string): Array<{ version: number; scriptText: string; timestamp: string; source: string }> {
    return this.loadArtifact<any[]>(projectId, ARTIFACT.SCRIPT_HISTORY) ?? [];
  }

  /**
   * Restore a previous script version.
   */
  restoreScriptVersion(projectId: string, version: number): PipelineProject {
    const history = this.getScriptHistory(projectId);
    const entry = history.find(h => h.version === version);
    if (!entry) throw new Error(`Script version ${version} not found`);
    return this.updateScript(projectId, entry.scriptText);
  }

  /**
   * Update scenes (visualPrompt, narrative, etc.) while paused after STORYBOARD.
   */
  updateScenes(projectId: string, scenes: Scene[]): PipelineProject {
    const project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    project.scenes = scenes;
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);
    this.saveArtifact(projectId, ARTIFACT.SCENES, scenes);

    return project;
  }

  /**
   * Update per-task-type model overrides (Method C).
   */
  updateModelOverrides(projectId: string, overrides: ModelOverrides): PipelineProject {
    const project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    project.modelOverrides = overrides;
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);

    return project;
  }

  /**
   * Update per-stage provider overrides.
   * Stage-level overrides take priority over per-task-type ModelOverrides.
   */
  updateStageProviderOverrides(projectId: string, overrides: import('../../shared/types.js').StageProviderOverrides): PipelineProject {
    const project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    project.stageProviderOverrides = overrides;
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);

    return project;
  }

  /**
   * Update storyboard replication settings for a project.
   */
  updateStoryboardReplication(projectId: string, settings: StoryboardReplicationSettings): PipelineProject {
    const project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    project.storyboardReplication = settings;
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);

    return project;
  }

  /**
   * Approve a scene in review mode.
   */
  approveScene(projectId: string, sceneId: string): PipelineProject {
    const project = this.loadProject(projectId);
    if (!project?.scenes) throw new Error('Project or scenes not found');

    const scene = project.scenes.find(s => s.id === sceneId);
    if (!scene) throw new Error(`Scene ${sceneId} not found`);

    scene.reviewStatus = 'approved';
    scene.status = 'done';
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);
    this.saveArtifact(projectId, ARTIFACT.SCENES, project.scenes);

    this.emit({ type: SSE_EVENT.SCENE_REVIEW, payload: { projectId, sceneId, status: 'approved' } });

    // Check if all scenes are now approved → mark REFERENCE_IMAGE complete
    const allApproved = project.scenes.every(s => s.reviewStatus === 'approved' || s.status === 'done');
    if (allApproved) {
      project.stageStatus.REFERENCE_IMAGE = 'completed';
      this.saveProject(project);
      this.emit({ type: SSE_EVENT.STAGE, payload: { projectId, stage: 'REFERENCE_IMAGE', status: 'completed' } });
      this.emit({ type: SSE_EVENT.COMPLETE, payload: { projectId } });
    }

    return project;
  }

  /**
   * Reject a scene — marks it for regeneration.
   */
  rejectScene(projectId: string, sceneId: string, reason?: string): PipelineProject {
    const project = this.loadProject(projectId);
    if (!project?.scenes) throw new Error('Project or scenes not found');

    const scene = project.scenes.find(s => s.id === sceneId);
    if (!scene) throw new Error(`Scene ${sceneId} not found`);

    scene.reviewStatus = 'rejected';
    scene.status = 'pending';
    scene.assetUrl = undefined;
    scene.audioUrl = undefined;
    if (reason?.trim()) {
      scene.rejectionReason = reason.trim();
    }
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);
    this.saveArtifact(projectId, ARTIFACT.SCENES, project.scenes);

    this.emit({ type: SSE_EVENT.SCENE_REVIEW, payload: { projectId, sceneId, status: 'rejected', reason: reason?.trim() } });

    return project;
  }

  /**
   * Override QA review result (approve even if AI rejected, or provide manual feedback).
   */
  approveQaReview(projectId: string, override?: { feedback?: string }): PipelineProject {
    const project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    const source = override?.feedback?.includes('auto-approved') ? 'auto' : 'human';

    project.qaReviewResult = {
      approved: true,
      feedback: override?.feedback ?? 'Manually approved by user',
    };
    project.stageStatus.QA_REVIEW = 'completed';
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);
    this.saveArtifact(projectId, ARTIFACT.QA_REVIEW, { ...project.qaReviewResult, source });

    this.emit({ type: SSE_EVENT.STAGE, payload: { projectId, stage: 'QA_REVIEW', status: 'completed' } });
    return project;
  }

  /**
   * Approve all reference images and mark REFERENCE_IMAGE stage complete.
   */
  approveReferenceImages(projectId: string): PipelineProject {
    const project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    // Mark all scenes as approved
    if (project.scenes) {
      for (const scene of project.scenes) {
        if (!scene.reviewStatus || scene.reviewStatus === 'pending') {
          scene.reviewStatus = 'approved';
        }
      }
      this.saveArtifact(projectId, ARTIFACT.SCENES, project.scenes);
    }

    project.stageStatus.REFERENCE_IMAGE = 'completed';
    // Clear the pause so resumePipeline can continue
    project.isPaused = false;
    project.pausedAtStage = undefined;
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);

    this.emit({ type: SSE_EVENT.STAGE, payload: { projectId, stage: 'REFERENCE_IMAGE', status: 'completed' } });
    this.emit({ type: SSE_EVENT.RESUMED, payload: { projectId, stage: 'REFERENCE_IMAGE' } });

    // Generate remaining reference images (sample-only was used for review),
    // then continue pipeline to KEYFRAME_GEN (fire-and-forget).
    this.completeRemainingReferenceImages(projectId).then(() => {
      return this.run(projectId);
    }).catch(err => {
      log.error('post_approve_ref_images_failed', err);
    });

    return project;
  }

  /**
   * Generate reference images for scenes that were skipped during
   * the sample-only review pass.
   */
  private async completeRemainingReferenceImages(projectId: string): Promise<void> {
    const project = this.loadProject(projectId);
    if (!project?.scenes) return;

    const missing = project.scenes.filter(s => !s.referenceImageUrl).length;
    if (missing === 0) return;

    const assetsDir = join(this.getProjectDir(projectId), 'assets');
    const scope: AdapterScope = {
      projectId,
      projectDir: this.getProjectDir(projectId),
    };
    const adapter = this.getAdapter(scope, 'REFERENCE_IMAGE', 'image_generation', project.modelOverrides);
    const cirCtx: CIRLoadContext = { loadArtifact: <T>(f: string) => this.loadArtifact<T>(projectId, f) };
    const videoIR = loadVideoIR(cirCtx, 'REFERENCE_IMAGE');
    const addLog = (entry: any) => {
      this.emit({ type: SSE_EVENT.LOG, payload: { projectId, ...entry } });
    };

    const updatedScenes = await runRemainingReferenceImages(adapter, {
      scenes: project.scenes,
      videoIR,
      assetsDir,
    }, addLog);

    project.scenes = updatedScenes;
    this.saveArtifact(projectId, ARTIFACT.SCENES, updatedScenes);
    this.saveProject(project);
  }

  /**
   * Manually set a style profile (for manual analysis / Gemini paste flow).
   */
  setStyleProfile(projectId: string, styleProfile: StyleProfile, formatSignature?: unknown): PipelineProject {
    const project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    project.styleProfile = styleProfile;
    project.stageStatus.STYLE_EXTRACTION = 'completed';
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);
    this.saveArtifact(projectId, ARTIFACT.STYLE_PROFILE, styleProfile);
    if (formatSignature) {
      this.saveArtifact(projectId, ARTIFACT.FORMAT_SIGNATURE, formatSignature);
    }

    this.emit({ type: SSE_EVENT.STAGE, payload: { projectId, stage: 'STYLE_EXTRACTION', status: 'completed' } });
    this.emit({ type: SSE_EVENT.ARTIFACT, payload: { projectId, stage: 'STYLE_EXTRACTION', artifactType: 'analysis' } });

    return project;
  }

  /* ---- Stage runner delegate ---- */

  private runStage<T>(
    project: PipelineProject,
    stage: PipelineStage,
    fn: () => Promise<T>,
  ): Promise<PipelineProject> {
    return this.stageRunner.run(project, stage, fn);
  }

  private getAdapter(scope: AdapterScope, stage: PipelineStage, taskType: string, overrides?: ModelOverrides): AIAdapter {
    return this.adapterResolver.resolve(scope, stage, taskType, overrides);
  }

  /**
   * Get a session-aware adapter that reuses chat context within a stage group.
   * Wraps the base adapter with session metadata for ChatAdapter.
   */
  private getSessionAwareAdapter(scope: AdapterScope, stage: PipelineStage, taskType: string, overrides?: ModelOverrides): AIAdapter {
    return this.adapterResolver.resolveSessionAware(scope, stage, taskType, overrides);
  }

  /**
   * Generate a resource plan for a project before execution.
   */
  getResourcePlan(projectId: string, overrides?: ModelOverrides): ResourcePlan {
    return generateResourcePlan(
      this.providerRegistry,
      this.sessionManager,
      projectId,
      overrides,
    );
  }
}
