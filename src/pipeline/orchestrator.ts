/* ------------------------------------------------------------------ */
/*  CompilationOrchestrator – drives the 13-pass multimodal compiler  */
/*  Source (topic + reference video) → CIR transforms → codegen →    */
/*  linking (FFmpeg) → output binary (.mp4).                         */
/*  Delegates persistence to ProjectStore and uses RunLock for       */
/*  per-project concurrency safety.                                  */
/* ------------------------------------------------------------------ */

import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { ARTIFACT, ARTIFACT_CACHE_FIELDS } from '../constants.js';
import type {
  AIAdapter, PipelineProject, PipelineStage,
  StyleProfile, Scene, LogEntry, PipelineEvent, ModelOverrides, StoryboardReplicationSettings,
} from './types.js';
import { SSE_EVENT } from './types.js';
import { resolveProvider, selectAdapter } from './qualityRouter.js';
import type { PluginRegistry, PluginDeps } from './providers/index.js';
import { resolvePlugin } from './providers/index.js';
import { quotaBus } from '../quotaBus.js';
import { SessionManager } from './sessionManager.js';
import { ProviderCapabilityRegistry, type AccountSeed } from './providerRegistry.js';
import { generateResourcePlan, type ResourcePlan } from './resourcePlanner.js';
import { ObservabilityService } from './observability.js';
import { ProjectStore } from './projectStore.js';
import { RunLock } from './runLock.js';
import { getStageDefinitions, getStageOrder, type StageRunContext } from './stageRegistry.js';
import { applyRetryPolicies } from './stageRetryWrapper.js';
// Side-effect import: registers all stage definitions in execution order.
import './stages/defs/index.js';
// Direct import kept for regenerateSceneAssets (outside registry loop).
import { regenerateSceneImage, runRemainingReferenceImages } from './stages/referenceImage.js';
import { runKeyframeGen } from './stages/keyframeGen.js';
import { runVideoGen } from './stages/videoGen.js';
import { loadVideoIR, type CIRLoadContext } from '../cir/loader.js';
import { parseScriptCIR } from '../cir/parsers.js';
import { createLoggingAdapter } from './loggingAdapter.js';
import { CostTracker } from './costTracker.js';
import { VideoProviderHealthMonitor } from '../adapters/videoProviderHealth.js';
import { AIRequestAbortedError, createControlledAdapter, createSessionScopedAdapter } from './aiControl.js';
import { createLogger } from '../lib/logger.js';
import { TraceWriter, createRootContext, createChildContext, classifyError, makeTraceEvent, type TraceContext, type TraceWriterMeta } from './trace/index.js';
import { ensurePathWithinBase } from '../lib/pathSafety.js';
import { TempFileTracker } from '../lib/tempFiles.js';
import { transitionStage } from './stateMachine.js';
import { CIRValidationError, AIParseError } from '../cir/errors.js';

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

interface AdapterScope {
  projectId: string;
  projectDir: string;
  abortSignal?: AbortSignal;
}

interface ProjectRunState extends AdapterScope {
  abortController: AbortController;
  preCompletedStages: Set<PipelineStage>;
  tempFiles: TempFileTracker;
}



function bindDefaultModel(adapter: AIAdapter, defaultModel?: string): AIAdapter {
  if (!defaultModel) return adapter;

  const passthrough = adapter as AIAdapter & { config?: { sessionId?: string; continueChat?: boolean } };
  const resolveModel = (model: string) => model || defaultModel;

  return {
    provider: passthrough.provider,
    generateText(model, prompt, options) {
      return passthrough.generateText(resolveModel(model), prompt, options);
    },
    generateImage(model, prompt, aspectRatio, negativePrompt, options) {
      return passthrough.generateImage(resolveModel(model), prompt, aspectRatio, negativePrompt, options);
    },
    generateVideo(model, prompt, options) {
      return passthrough.generateVideo(resolveModel(model), prompt, options);
    },
    uploadFile: passthrough.uploadFile?.bind(passthrough),
    generateSpeech: passthrough.generateSpeech?.bind(passthrough),
  };
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
  /** Per-scene regeneration lock — prevents concurrent regeneration of the same scene. */
  private regeneratingScenes = new Set<string>();

  constructor(chatAdapter: AIAdapter, config: PipelineConfig) {
    this.chatAdapter = chatAdapter;
    this.config = config;
    this.store = new ProjectStore(config.dataDir);
    this.costTracker = new CostTracker(config.dataDir);

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
              stage: 'VIDEO_GEN' as any,
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
    const now = new Date();
    const nextMidnight = new Date(Date.UTC(
      now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0,
    ));
    const msUntilReset = nextMidnight.getTime() - now.getTime();

    this.quotaResetTimer = setTimeout(() => {
      log.info('daily_quota_reset');
      quotaBus.resetAll();
      this.providerRegistry.resetAllQuotas();
      this.scheduleQuotaReset();
    }, msUntilReset);

    this.quotaResetTimer.unref();
  }

  /**
   * Scan for projects stuck in 'processing' state (server crash recovery).
   * Resets them to 'pending' so they can be re-run.
   */
  private recoverStaleProjects(): void {
    try {
      const projects = this.store.list();
      for (const project of projects) {
        let recovered = false;
        for (const [stage, status] of Object.entries(project.stageStatus)) {
          if (status === 'processing') {
            // processing → error → pending (stale recovery)
            transitionStage(project.stageStatus, stage as PipelineStage, 'error');
            transitionStage(project.stageStatus, stage as PipelineStage, 'pending');
            recovered = true;
          }
        }
        if (recovered) {
          project.error = undefined;
          project.updatedAt = new Date().toISOString();
          this.store.save(project);
          log.info('recovered_stale_project', { projectId: project.id });
        }
      }
    } catch (err) {
      log.warn('stale_scan_failed', { error: String(err) });
    }
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
        (project as any)[fieldName] = undefined;
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
      (project as any).resumedAt = new Date().toISOString();
      project.isPaused = false;
      log.info('pipeline_resumed', { projectId, pausedAtStage: project.pausedAtStage, resumedAt: (project as any).resumedAt });
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
      };

      // Execute each registered stage in order (with automatic retry for eligible stages).
      // PREFLIGHT: Ensure stage registry is populated (fail-closed)
      const stages = applyRetryPolicies(getStageDefinitions(), undefined,
        { writer: traceWriter, parentTrace: traceCtx });
      if (stages.length === 0) {
        throw new Error(
          'Pipeline stage registry is empty — no stages registered. ' +
          'This indicates a broken build or missing stage definitions.',
        );
      }

      // PREFLIGHT B4: Verify at least one text-capable provider is available
      // for CAPABILITY_ASSESSMENT (the first AI-dependent stage).
      const textProviders = this.providerRegistry.findProviders({ text: true });
      if (textProviders.length === 0) {
        throw new Error(
          'No text-capable provider available. CAPABILITY_ASSESSMENT requires at least ' +
          'one provider with text: true. Configure an account (e.g. gemini) before running the pipeline.',
        );
      }

      // PREFLIGHT B5: Fail fast if VIDEO_GEN will run but no video provider is configured.
      if (!runState.preCompletedStages.has('VIDEO_GEN' as PipelineStage)) {
        const videoProviders = this.providerRegistry.findProviders({ videoGeneration: true });
        const hasVideoConfig = !!(this.config.aivideomakerAdapters?.length);
        const hasAivideomaker = !!(this.config.aivideomakerAdapters?.length);
        if (videoProviders.length === 0 && !hasVideoConfig && !hasAivideomaker) {
          throw new Error(
            '未配置视频生成服务。VIDEO_GEN 阶段需要 aivideomaker API Key。' +
            '请在设置中配置 aivideomaker API Key。',
          );
        }
      }

      // PREFLIGHT B5b: Check FFmpeg availability before running (needed by ASSEMBLY).
      if (!runState.preCompletedStages.has('ASSEMBLY' as PipelineStage)) {
        const { isFFmpegAvailable } = await import('../adapters/ffmpegAssembler.js');
        if (!(await isFFmpegAvailable())) {
          throw new Error(
            'FFmpeg 未安装。ASSEMBLY 阶段需要 FFmpeg 来拼接最终视频。' +
            '请运行: brew install ffmpeg (macOS) 或 apt-get install ffmpeg (Linux)。',
          );
        }
      }

      // PREFLIGHT B5c: Check edge-tts availability (needed by TTS).
      if (!runState.preCompletedStages.has('TTS' as PipelineStage)) {
        const { isEdgeTTSAvailable } = await import('../adapters/ttsProvider.js');
        if (!(await isEdgeTTSAvailable())) {
          addLog({
            id: `log_preflight_tts_${Date.now()}`,
            timestamp: new Date().toISOString(),
            message:
              '⚠️ edge-tts 未安装，TTS 阶段将跳过语音合成。安装: pip install edge-tts',
            type: 'warning',
            stage: 'TTS' as PipelineStage,
          });
        }
      }

      // PREFLIGHT B6: Resource plan feasibility gate.
      // Check that every required stage has a capable provider BEFORE running,
      // so we fail in seconds instead of wasting minutes on timeouts.
      {
        const plan = this.getResourcePlan(projectId, project.modelOverrides);
        const criticalBlockers = plan.stages.filter(
          s => !s.feasible && !runState.preCompletedStages.has(s.stage),
        );
        if (criticalBlockers.length > 0) {
          const details = criticalBlockers
            .map(b => `${b.stage} (需要 ${Object.entries(b.requirements).filter(([, v]) => v).map(([k]) => k).join('+')})`)
            .join(', ');
          throw new Error(
            `资源不满足：以下阶段无可用服务商 — ${details}。` +
            '请在设置中配置支持所需能力的服务商账号，并确保浏览器 Profile 目录存在。',
          );
        }
      }

      // PREFLIGHT B7: Warn if all providers lack browser profile directories.
      // Without profiles, no browser session can be established and all AI
      // calls will time out. Only check providers seeded from accounts
      // (profileExists is explicitly boolean, not undefined).
      {
        const allProviders = this.providerRegistry.getAll();
        const accountProviders = allProviders.filter(p => typeof p.profileExists === 'boolean');
        const noProfile = accountProviders.filter(p => !p.profileExists);
        if (noProfile.length === accountProviders.length && accountProviders.length > 0) {
          // Downgrade to warning if API-based adapters (aivideomaker, Gemini) are available —
          // they don't need browser profiles and can service remaining stages.
          const hasApiFallback = !!(this.config.aivideomakerAdapters?.length);
          if (hasApiFallback) {
            addLog({
              id: `log_preflight_noprofile_${Date.now()}`,
              timestamp: new Date().toISOString(),
              message:
                `⚠️ 所有已配置的服务商 (${noProfile.map(p => p.providerId).join(', ')}) 均缺少浏览器 Profile 目录，将使用 API 适配器。`,
              type: 'warning',
              stage: 'VIDEO_GEN' as PipelineStage,
            });
          } else {
            throw new Error(
              `所有已配置的服务商 (${noProfile.map(p => p.providerId).join(', ')}) 均缺少浏览器 Profile 目录。` +
              '请先在浏览器标签页中登录对应的 AI 服务商，系统会自动创建 Profile。',
            );
          }
        }
      }

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
   * Retry a specific stage.
   */
  async retryStage(projectId: string, stage: PipelineStage): Promise<PipelineProject> {
    const project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    // Reset this stage and all subsequent stages
    const stages = getStageOrder();
    const stageIdx = stages.indexOf(stage);
    for (let i = stageIdx; i < stages.length; i++) {
      if (project.stageStatus[stages[i]] !== 'pending') {
        transitionStage(project.stageStatus, stages[i], 'pending');
      }
    }
    // Clear stale error from previous failure
    project.error = undefined;

    // When retrying VIDEO_GEN, restore degraded scenes back to assetType='video'
    // so they will be re-processed instead of skipped.
    if (stage === 'VIDEO_GEN' && project.scenes) {
      let restored = 0;
      for (const scene of project.scenes) {
        if (scene.assetType === 'image' && scene.keyframeUrl) {
          scene.assetType = 'video';
          scene.assetUrl = undefined;
          scene.status = 'pending';
          restored++;
        }
      }
      if (restored > 0) {
        log.info('video_gen_retry_restored', { restored });
        this.saveArtifact(projectId, ARTIFACT.SCENES, project.scenes);
      }
    }

    // Clear session group for the retried stage (force new chat context)
    this.sessionManager.clearGroup(projectId, stage);

    this.saveProject(project);
    return this.run(projectId);
  }

  /**
   * Regenerate a single scene's assets.
   */
  async regenerateSceneAssets(projectId: string, sceneId: string): Promise<Scene> {
    const lockKey = `${projectId}:${sceneId}`;
    if (this.regeneratingScenes.has(lockKey)) {
      throw new Error(`Scene ${sceneId} is already being regenerated`);
    }
    this.regeneratingScenes.add(lockKey);
    try {
      return await this._regenerateSceneAssetsInner(projectId, sceneId);
    } finally {
      this.regeneratingScenes.delete(lockKey);
    }
  }

  private async _regenerateSceneAssetsInner(projectId: string, sceneId: string): Promise<Scene> {
    const project = this.loadProject(projectId);
    if (!project?.scenes) throw new Error('Project or scenes not found');

    const scene = project.scenes.find(s => s.id === sceneId);
    if (!scene) throw new Error(`Scene ${sceneId} not found`);

    const assetsDir = join(this.getProjectDir(projectId), 'assets');
    const scope: AdapterScope = {
      projectId,
      projectDir: this.getProjectDir(projectId),
    };
    const cirCtx: CIRLoadContext = { loadArtifact: <T>(f: string) => this.loadArtifact<T>(projectId, f) };
    const videoIR = loadVideoIR(cirCtx, 'REFERENCE_IMAGE');

    // Re-generate image
    const imageAdapter = this.getAdapter(scope, 'REFERENCE_IMAGE', 'image_generation', project.modelOverrides);
    let updated = await regenerateSceneImage(imageAdapter, scene, videoIR, assetsDir);

    // P0-2: For video scenes, also regenerate keyframe + video
    if (updated.assetType === 'video') {
      // Keyframe regeneration
      const kfAdapter = this.getAdapter(scope, 'KEYFRAME_GEN', 'image_generation', project.modelOverrides);
      const kfResults = await runKeyframeGen(kfAdapter, {
        scenes: [updated],
        videoIR,
        assetsDir,
      });
      if (kfResults[0]) updated = kfResults[0];

      // Video regeneration (only if keyframe succeeded)
      if (updated.keyframeUrl) {
        const vidAdapter = this.getAdapter(scope, 'VIDEO_GEN', 'video_generation', project.modelOverrides);
        const vidResults = await runVideoGen(vidAdapter, {
          scenes: [updated],
          videoIR,
          assetsDir,
          aivideomakerAdapters: this.config.aivideomakerAdapters,
        });
        if (vidResults[0]) updated = vidResults[0];
      }
    }

    const idx = project.scenes.findIndex(s => s.id === sceneId);
    if (idx !== -1) project.scenes[idx] = updated;
    this.saveArtifact(projectId, ARTIFACT.SCENES, project.scenes);
    this.saveProject(project);

    return updated;
  }

  /* ---- Internal helpers ---- */

  /**
   * Check if pipeline should pause after the given stage completes.
   * If yes, sets isPaused, saves, emits event, and returns true.
   */
  private shouldPause(project: PipelineProject, stage: PipelineStage, runState: ProjectRunState): boolean {
    // Never re-pause for stages that were already completed before this run
    if (runState.preCompletedStages.has(stage)) return false;

    // Check manual pause request (requestPause API)
    const manualPause = this.pauseRequested.has(project.id);
    if (manualPause) {
      this.pauseRequested.delete(project.id);
    }

    const scheduled = project.pauseAfterStages?.includes(stage) && project.stageStatus[stage] === 'completed';

    if (manualPause || scheduled) {
      project.isPaused = true;
      project.pausedAtStage = stage;
      (project as any).pausedAt = new Date().toISOString();
      this.saveProject(project);
      this.emit({ type: SSE_EVENT.PAUSED, payload: { projectId: project.id, stage } });

      // Trace: emit checkpoint.pause
      const traceState = this.traceWriters.get(project.id);
      if (traceState) {
        traceState.writer.append(makeTraceEvent('checkpoint.pause', traceState.ctx, project.id, { stage }));
        traceState.writer.save(traceState.meta);
        this.traceWriters.delete(project.id);
      }

      return true;
    }
    return false;
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
    // Safety gate: block pipeline if topic safety check failed
    if (stage === 'CAPABILITY_ASSESSMENT') {
      if (project.safetyCheck && !project.safetyCheck.safe) {
        const reason = project.safetyCheck.reason ?? 'unsafe topic';
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Safety block: ${reason}`, type: 'error', stage: 'CAPABILITY_ASSESSMENT' });
        throw new SafetyBlockError(reason);
      }
    }

    // Safety gate: enforce manual review flag after script generation (W9 fail-closed)
    if (stage === 'SCRIPT_GENERATION') {
      const meta = project.scriptOutput?.safetyMetadata;
      if (meta?.needsManualReview) {
        const cats = meta.riskCategories?.join(', ') ?? 'unknown';
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Safety block: script requires manual review (${cats})`, type: 'error', stage: 'SCRIPT_GENERATION' });
        throw new SafetyBlockError(`Script requires manual review before production stages (${cats})`);
      }
    }

    // Quality gate: keyframe freshness check before VIDEO_GEN
    if (stage === 'KEYFRAME_GEN') {
      const scenes: Scene[] = project.scenes ?? [];
      const videoScenes = scenes.filter(s => s.assetType === 'video');
      const freshKeyframes = videoScenes.filter(
        s => s.keyframeUrl && s.keyframeUrl !== s.referenceImageUrl,
      );
      const fallbackOnly = videoScenes.filter(
        s => s.keyframeUrl && s.keyframeUrl === s.referenceImageUrl,
      );
      const missing = videoScenes.filter(s => !s.keyframeUrl);
      const pct = videoScenes.length > 0 ? Math.round((freshKeyframes.length / videoScenes.length) * 100) : 100;
      addLog({
        id: `log_${Date.now()}`,
        stage: 'KEYFRAME_GEN',
        message: `🔍 Quality gate: ${freshKeyframes.length} fresh keyframes, ${fallbackOnly.length} using reference fallback, ${missing.length} missing (${pct}% fresh)`,
        type: pct >= 50 ? 'info' : 'warning',
        timestamp: new Date().toISOString(),
      });
      if (pct < 50 && videoScenes.length > 0) {
        addLog({
          id: `log_${Date.now() + 1}`,
          stage: 'KEYFRAME_GEN',
          message: `⚠️ Low keyframe quality (${pct}%) — video generation may produce lower-quality results`,
          type: 'warning',
          timestamp: new Date().toISOString(),
        });
      }
    }
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
      (scene as any).rejectionReason = reason.trim();
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

  /* ---- Stage runner ---- */

  private async runStage<T>(
    project: PipelineProject,
    stage: PipelineStage,
    fn: () => Promise<T>,
  ): Promise<PipelineProject> {
    log.info('stage_start', { stage, projectId: project.id });
    project.currentStage = stage;
    transitionStage(project.stageStatus, stage, 'processing');
    this.saveProject(project);
    this.emit({ type: SSE_EVENT.STAGE, payload: { projectId: project.id, stage, status: 'processing' } });
    this.observability.startStage(project.id, stage);

    // Trace: emit stage.start
    const traceState = this.traceWriters.get(project.id);
    const stageSpan = traceState ? createChildContext(traceState.ctx) : undefined;
    const stageStartMs = Date.now();
    if (traceState && stageSpan) {
      traceState.writer.append(makeTraceEvent('stage.start', stageSpan, project.id, { stage }));
    }

    try {
      await fn();

      transitionStage(project.stageStatus, stage, 'completed');
      project.updatedAt = new Date().toISOString();
      this.saveProject(project);
      this.sessionManager.saveTo(this.getProjectDir(project.id));
      this.observability.completeStage(project.id, stage);
      this.observability.saveTo(this.getProjectDir(project.id), project.id);
      log.info('stage_completed', { stage });
      this.emit({ type: SSE_EVENT.STAGE, payload: { projectId: project.id, stage, status: 'completed' } });
      this.emit({ type: SSE_EVENT.ARTIFACT, payload: { projectId: project.id, stage, artifactType: stage.toLowerCase() } });

      // Trace: emit stage.complete
      if (traceState && stageSpan) {
        traceState.writer.append(makeTraceEvent('stage.complete', stageSpan, project.id, {
          stage,
          durationMs: Date.now() - stageStartMs,
        }));
      }

      return project;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);

      // CIR-system errors: log enhanced diagnostics
      if (err instanceof CIRValidationError || err instanceof AIParseError) {
        log.error('cir_error', err, { stage, errorType: err.name });
      }

      if (err instanceof AIRequestAbortedError) {
        log.warn('stage_aborted', { stage, reason: message });
        transitionStage(project.stageStatus, stage, 'error');
        project.error = message;
        this.saveProject(project);
        this.emit({
          type: SSE_EVENT.LOG,
          payload: {
            projectId: project.id,
            entry: {
              id: `log_${Date.now()}`,
              timestamp: new Date().toISOString(),
              message: `Stage aborted: ${stage} — ${message}`,
              type: 'warning',
              stage,
            },
          },
        });
        throw err;
      }
      log.error('stage_failed', err, { stage, message });
      transitionStage(project.stageStatus, stage, 'error');
      project.error = message;
      this.saveProject(project);
      this.observability.errorStage(project.id, stage, message);
      this.emit({ type: SSE_EVENT.ERROR, payload: { projectId: project.id, stage, error: message } });

      // Trace: emit stage.error
      if (traceState && stageSpan) {
        traceState.writer.append(makeTraceEvent('stage.error', stageSpan, project.id, {
          stage,
          failure: classifyError(err),
          attempt: 1,
        }));
      }

      throw err;
    }
  }

  private getAdapter(scope: AdapterScope, stage: PipelineStage, taskType: string, overrides?: ModelOverrides): AIAdapter {
    // ---- Stage-level provider overrides take priority ----
    // Convert stage-level override to a ModelOverrides-compatible entry
    // so the routing system picks it up transparently.
    const project = this.loadProject(scope.projectId);
    const stageOverride = project?.stageProviderOverrides?.[stage];
    let effectiveOverrides = overrides;
    if (stageOverride) {
      effectiveOverrides = {
        ...overrides,
        [taskType]: {
          adapter: stageOverride.adapter,
          provider: stageOverride.provider,
          model: stageOverride.model,
        },
      };
    }

    // ---- Plugin-based routing (opt-in) ----
    if (this.config.pluginRegistry && this.config.pluginDeps) {
      return this.getAdapterViaPlugin(scope, stage, taskType, effectiveOverrides);
    }

    // ---- Legacy routing ----
    const decision = resolveProvider(stage, taskType, this.providerRegistry, effectiveOverrides);

    // Wrap adapters in timeout/abort control first, then logging so timeout/abort
    // outcomes are captured as failed AI calls instead of leaking to the raw adapter.
    let chatForStage: AIAdapter = createControlledAdapter(this.chatAdapter, {
      projectId: scope.projectId,
      stage,
      taskType,
      signal: scope.abortSignal,
    });

    // Build trace context for this adapter scope (if tracing is active)
    const traceState = this.traceWriters.get(scope.projectId);
    const adapterTraceCtx = traceState ? {
      writer: traceState.writer,
      parentTrace: traceState.ctx,
      projectId: scope.projectId,
    } : undefined;

    chatForStage = createLoggingAdapter(
      chatForStage, scope.projectDir, stage, taskType,
      { costTracker: this.costTracker, projectId: scope.projectId },
      adapterTraceCtx,
      (_method, estimatedTokens) => {
        this.observability.recordLlmCall(scope.projectId, stage as any, estimatedTokens);
      },
    );

    const adapter = selectAdapter(decision, chatForStage);

    const boundAdapter = bindDefaultModel(adapter, decision.model);
    log.info('adapter_resolved', { stage, taskType, adapter: decision.adapter, provider: adapter.provider, model: decision.model || undefined });
    return boundAdapter;
  }

  /**
   * Get a session-aware adapter that reuses chat context within a stage group.
   * Wraps the base adapter with session metadata for ChatAdapter.
   */
  private getSessionAwareAdapter(scope: AdapterScope, stage: PipelineStage, taskType: string, overrides?: ModelOverrides): AIAdapter {
    const adapter = this.getAdapter(scope, stage, taskType, overrides);
    const shouldContinue = this.sessionManager.shouldContinueChat(scope.projectId, stage);
    const session = this.sessionManager.getSession(scope.projectId, stage);

    return createSessionScopedAdapter(
      adapter,
      {
        sessionId: session.sessionId,
        continueChat: shouldContinue,
      },
      () => this.sessionManager.recordMessage(scope.projectId, stage),
    );
  }

  /**
   * Plugin-based adapter resolution.
   * Uses PluginRegistry scoring instead of hardcoded ROUTE_TABLE.
   */
  private getAdapterViaPlugin(scope: AdapterScope, stage: PipelineStage, taskType: string, overrides?: ModelOverrides): AIAdapter {
    const registry = this.config.pluginRegistry!;
    const deps = this.config.pluginDeps!;
    const decision = resolvePlugin(stage, taskType, registry, overrides);

    // Build trace context for this adapter scope (if tracing is active)
    const traceState = this.traceWriters.get(scope.projectId);
    const adapterTraceCtx = traceState ? {
      writer: traceState.writer,
      parentTrace: traceState.ctx,
      projectId: scope.projectId,
    } : undefined;

    const wrapAdapter = (raw: AIAdapter): AIAdapter => {
      let wrapped = createControlledAdapter(raw, {
        projectId: scope.projectId,
        stage,
        taskType,
        signal: scope.abortSignal,
      });
      wrapped = createLoggingAdapter(
        wrapped, scope.projectDir, stage, taskType,
        { costTracker: this.costTracker, projectId: scope.projectId },
        adapterTraceCtx,
        (_method, estimatedTokens) => {
          this.observability.recordLlmCall(scope.projectId, stage as any, estimatedTokens);
        },
      );
      return wrapped;
    };

    // Create primary adapter from plugin
    const primaryRaw = registry.createAdapter(decision.pluginId, deps);
    if (!primaryRaw) {
      // Plugin couldn't create adapter — fall back to legacy
      log.info('plugin_adapter_fallback', { pluginId: decision.pluginId, stage, taskType, reason: 'createAdapter returned undefined' });
      const legacyDecision = resolveProvider(stage, taskType, this.providerRegistry, overrides);
      let chatForStage: AIAdapter = createControlledAdapter(this.chatAdapter, { projectId: scope.projectId, stage, taskType, signal: scope.abortSignal });
      chatForStage = createLoggingAdapter(chatForStage, scope.projectDir, stage, taskType, { costTracker: this.costTracker, projectId: scope.projectId }, adapterTraceCtx, (_method, estimatedTokens) => { this.observability.recordLlmCall(scope.projectId, stage as any, estimatedTokens); });
      return bindDefaultModel(chatForStage, legacyDecision.model);
    }

    const primary = wrapAdapter(primaryRaw);

    const bound = bindDefaultModel(primary, decision.model);
    log.info('adapter_resolved_plugin', { stage, taskType, pluginId: decision.pluginId, model: decision.model || undefined });
    return bound;
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
