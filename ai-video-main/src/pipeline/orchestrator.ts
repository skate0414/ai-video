/* ------------------------------------------------------------------ */
/*  PipelineOrchestrator – coordinates the 13-stage video pipeline     */
/*  Delegates persistence to ProjectStore (atomic writes) and uses    */
/*  RunLock for per-project concurrency safety.                       */
/* ------------------------------------------------------------------ */

import { mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AIAdapter, PipelineProject, PipelineStage,
  StyleProfile, Scene, LogEntry, PipelineEvent, QualityTier, ModelOverrides,
} from './types.js';
import { routeTask, selectAdapter } from './qualityRouter.js';
import { SessionManager } from './sessionManager.js';
import { ProviderCapabilityRegistry } from './providerRegistry.js';
import { generateResourcePlan, type ResourcePlan } from './resourcePlanner.js';
import { ObservabilityService } from './observability.js';
import { ProjectStore } from './projectStore.js';
import { RunLock } from './runLock.js';
import { getStageDefinitions, getStageOrder, type StageRunContext } from './stageRegistry.js';
// Side-effect import: registers all stage definitions in execution order.
import './stages/defs/index.js';
// Direct import kept for regenerateSceneAssets (outside registry loop).
import { regenerateSceneImage } from './stages/referenceImage.js';
import type { VideoProviderConfig } from '../adapters/videoProvider.js';
import { createLoggingAdapter } from './loggingAdapter.js';

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
  /** Quality tier determines free-chat vs paid-API routing */
  qualityTier: QualityTier;
  /** Optional paid API adapter (for balanced/premium modes) */
  apiAdapter?: AIAdapter;
  /** Optional video provider config for browser-based video gen */
  videoProviderConfig?: VideoProviderConfig;
  /** Max concurrent scene generations */
  productionConcurrency?: number;
  /** TTS voice/rate/pitch settings */
  ttsConfig?: { voice?: string; rate?: string; pitch?: string };
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
  private aborted = false;
  /** Stages that were already completed when run() started — skip pausing for these. */
  private preCompletedStages = new Set<PipelineStage>();
  /** Current project directory — set at the start of run() for AI call logging. */
  private currentProjectDir: string | null = null;

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

  constructor(chatAdapter: AIAdapter, config: PipelineConfig) {
    this.chatAdapter = chatAdapter;
    this.config = config;
    this.store = new ProjectStore(config.dataDir);
  }

  getQualityTier(): QualityTier {
    return this.config.qualityTier;
  }

  onEvent(fn: PipelineEventListener): () => void {
    this.listeners.push(fn);
    return () => { this.listeners = this.listeners.filter(l => l !== fn); };
  }

  private emit(event: PipelineEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  abort(): void {
    this.aborted = true;
  }

  /* ---- Project management ---- */

  createProject(topic: string, title?: string, modelOverrides?: ModelOverrides): PipelineProject {
    const project = this.store.create(topic, this.config.qualityTier, title, modelOverrides);
    this.emit({ type: 'pipeline_created', payload: { projectId: project.id } });
    return project;
  }

  getProjectDir(projectId: string): string {
    return this.store.getProjectDir(projectId);
  }

  private saveProject(project: PipelineProject): void {
    this.store.save(project);
  }

  loadProject(projectId: string): PipelineProject | null {
    return this.store.load(projectId);
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
    // Per-project concurrency guard
    if (!this.runLock.acquire(projectId, () => { this.aborted = true; })) {
      throw new Error(`Project ${projectId} is already running`);
    }

    this.aborted = false;
    const loaded = this.loadProject(projectId);
    if (!loaded) {
      this.runLock.release(projectId);
      throw new Error(`Project ${projectId} not found`);
    }
    let project: PipelineProject = loaded;

    // Record which stages were already completed — shouldPause() will skip these
    this.preCompletedStages = new Set(
      getStageOrder().filter(s => project.stageStatus[s] === 'completed'),
    );

    if (videoFilePath) {
      // Resolve relative filenames against the uploads directory
      let resolved = videoFilePath;
      if (!videoFilePath.startsWith('/')) {
        const candidate = join(this.config.dataDir, 'uploads', videoFilePath);
        if (existsSync(candidate)) {
          resolved = candidate;
        }
      }
      project.referenceVideoPath = resolved;
      this.saveProject(project);
    }

    this.currentProjectDir = this.getProjectDir(projectId);

    const assetsDir = join(this.currentProjectDir, 'assets');
    if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });

    const addLog = (entry: LogEntry) => {
      project!.logs.push(entry);
      this.emit({ type: 'pipeline_log', payload: { projectId, entry } });
    };

    this.observability.startPipeline(projectId);

    try {
      // Build the shared context that every stage definition receives.
      const ctx: StageRunContext = {
        project,
        projectId,
        assetsDir,
        getAdapter: (stage, taskType, overrides) => this.getAdapter(stage, taskType, overrides),
        getSessionAwareAdapter: (stage, taskType, overrides) =>
          this.getSessionAwareAdapter(projectId, stage, taskType, overrides),
        addLog,
        saveArtifact: (filename, data) => this.saveArtifact(projectId, filename, data),
        loadArtifact: <T>(filename: string) => this.loadArtifact<T>(projectId, filename),
        isAborted: () => this.aborted,
        config: {
          videoProviderConfig: this.config.videoProviderConfig,
          productionConcurrency: this.config.productionConcurrency ?? 2,
          ttsConfig: this.config.ttsConfig,
        },
        emitEvent: (event) => this.emit(event),
        providerRegistry: this.providerRegistry,
        regenerateScene: (pid, sid) => this.regenerateSceneAssets(pid, sid),
      };

      // Execute each registered stage in order.
      for (const def of getStageDefinitions()) {
        const { stage } = def;

        if (project.stageStatus[stage] !== 'completed') {
          project = await this.runStage(project, stage, async () => {
            // Keep context.project in sync after runStage reloads.
            ctx.project = project;
            await def.execute(ctx);
          });
        }

        // Abort check
        if (this.aborted) return project;

        // Post-stage hooks
        this.runPostStageHooks(project, stage, addLog);

        // Pause checkpoint
        if (this.shouldPause(project, stage)) return project;
      }

      this.emit({ type: 'pipeline_complete', payload: { projectId } });

    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      project.error = message;
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Pipeline error: ${message}`, type: 'error' });
    }

    // Finalize observability metrics
    const metrics = this.observability.completePipeline(projectId);
    if (metrics) {
      this.saveArtifact(projectId, 'pipeline-metrics.json', metrics);
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: this.observability.getSummary(projectId), type: 'info' });
    }

    this.saveProject(project);
    this.runLock.release(projectId);
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
      project.stageStatus[stages[i]] = 'pending';
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
        console.log(`[orchestrator] VIDEO_GEN retry: restored ${restored} degraded scenes to assetType=video`);
        this.saveArtifact(projectId, 'scenes.json', project.scenes);
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
    const project = this.loadProject(projectId);
    if (!project?.scenes) throw new Error('Project or scenes not found');

    const scene = project.scenes.find(s => s.id === sceneId);
    if (!scene) throw new Error(`Scene ${sceneId} not found`);

    const assetsDir = join(this.getProjectDir(projectId), 'assets');

    // Re-generate image
    const imageAdapter = this.getAdapter('REFERENCE_IMAGE', 'image_generation', project.modelOverrides);
    const updated = await regenerateSceneImage(imageAdapter, scene, project.styleProfile!, assetsDir);

    const idx = project.scenes.findIndex(s => s.id === sceneId);
    if (idx !== -1) project.scenes[idx] = updated;
    this.saveArtifact(projectId, 'scenes.json', project.scenes);
    this.saveProject(project);

    return updated;
  }

  /* ---- Internal helpers ---- */

  /**
   * Check if pipeline should pause after the given stage completes.
   * If yes, sets isPaused, saves, emits event, and returns true.
   */
  private shouldPause(project: PipelineProject, stage: PipelineStage): boolean {
    // Never re-pause for stages that were already completed before this run
    if (this.preCompletedStages.has(stage)) return false;
    if (project.pauseAfterStages?.includes(stage) && project.stageStatus[stage] === 'completed') {
      project.isPaused = true;
      project.pausedAtStage = stage;
      this.saveProject(project);
      this.emit({ type: 'pipeline_paused', payload: { projectId: project.id, stage } });
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
    // Safety gate: block pipeline if topic is unsafe
    if (stage === 'CAPABILITY_ASSESSMENT' && project.safetyCheck && !project.safetyCheck.safe) {
      const reason = project.safetyCheck.reason ?? 'Topic flagged as unsafe';
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Safety block: ${reason}`, type: 'error', stage: 'CAPABILITY_ASSESSMENT' });
      throw new SafetyBlockError(reason);
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
    this.emit({ type: 'pipeline_resumed', payload: { projectId, stage: resumedStage } });

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
      const history = this.loadArtifact<any[]>(projectId, 'script-history.json') ?? [];
      history.push({
        version: history.length + 1,
        scriptText: project.scriptOutput.scriptText,
        timestamp: new Date().toISOString(),
        source: history.length === 0 ? 'ai_generated' : 'user_edit',
      });
      this.saveArtifact(projectId, 'script-history.json', history);
    }

    if (!project.scriptOutput) {
      project.scriptOutput = { scriptText, usedFactIDs: [], factUsage: [] };
    } else {
      project.scriptOutput.scriptText = scriptText;
    }
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);

    // Also update the artifact file
    const existing = this.loadArtifact<any>(projectId, 'script.json') ?? {};
    existing.scriptOutput = project.scriptOutput;
    this.saveArtifact(projectId, 'script.json', existing);

    return project;
  }

  /**
   * Get script version history for a project.
   */
  getScriptHistory(projectId: string): Array<{ version: number; scriptText: string; timestamp: string; source: string }> {
    return this.loadArtifact<any[]>(projectId, 'script-history.json') ?? [];
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
    this.saveArtifact(projectId, 'scenes.json', scenes);

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
    this.saveArtifact(projectId, 'scenes.json', project.scenes);

    this.emit({ type: 'pipeline_scene_review', payload: { projectId, sceneId, status: 'approved' } });

    // Check if all scenes are now approved → mark REFERENCE_IMAGE complete
    const allApproved = project.scenes.every(s => s.reviewStatus === 'approved' || s.status === 'done');
    if (allApproved) {
      project.stageStatus.REFERENCE_IMAGE = 'completed';
      this.saveProject(project);
      this.emit({ type: 'pipeline_stage', payload: { projectId, stage: 'REFERENCE_IMAGE', status: 'completed' } });
      this.emit({ type: 'pipeline_complete', payload: { projectId } });
    }

    return project;
  }

  /**
   * Reject a scene — marks it for regeneration.
   */
  rejectScene(projectId: string, sceneId: string): PipelineProject {
    const project = this.loadProject(projectId);
    if (!project?.scenes) throw new Error('Project or scenes not found');

    const scene = project.scenes.find(s => s.id === sceneId);
    if (!scene) throw new Error(`Scene ${sceneId} not found`);

    scene.reviewStatus = 'rejected';
    scene.status = 'pending';
    scene.assetUrl = undefined;
    scene.audioUrl = undefined;
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);
    this.saveArtifact(projectId, 'scenes.json', project.scenes);

    this.emit({ type: 'pipeline_scene_review', payload: { projectId, sceneId, status: 'rejected' } });

    return project;
  }

  /**
   * Override QA review result (approve even if AI rejected, or provide manual feedback).
   */
  approveQaReview(projectId: string, override?: { feedback?: string }): PipelineProject {
    const project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    project.qaReviewResult = {
      approved: true,
      feedback: override?.feedback ?? 'Manually approved by user',
    };
    project.stageStatus.QA_REVIEW = 'completed';
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);
    this.saveArtifact(projectId, 'qa-review.json', project.qaReviewResult);

    this.emit({ type: 'pipeline_stage', payload: { projectId, stage: 'QA_REVIEW', status: 'completed' } });
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
      this.saveArtifact(projectId, 'scenes.json', project.scenes);
    }

    project.stageStatus.REFERENCE_IMAGE = 'completed';
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);

    this.emit({ type: 'pipeline_stage', payload: { projectId, stage: 'REFERENCE_IMAGE', status: 'completed' } });
    return project;
  }

  /**
   * Manually set a style profile (for manual analysis / Gemini paste flow).
   */
  setStyleProfile(projectId: string, styleProfile: StyleProfile): PipelineProject {
    const project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    project.styleProfile = styleProfile;
    project.stageStatus.STYLE_EXTRACTION = 'completed';
    project.updatedAt = new Date().toISOString();
    this.saveProject(project);
    this.saveArtifact(projectId, 'style-profile.json', styleProfile);

    this.emit({ type: 'pipeline_stage', payload: { projectId, stage: 'STYLE_EXTRACTION', status: 'completed' } });
    this.emit({ type: 'pipeline_artifact', payload: { projectId, stage: 'STYLE_EXTRACTION', artifactType: 'analysis' } });

    return project;
  }

  /* ---- Stage runner ---- */

  private async runStage<T>(
    project: PipelineProject,
    stage: PipelineStage,
    fn: () => Promise<T>,
  ): Promise<PipelineProject> {
    console.log(`[orchestrator] ▶ Starting stage: ${stage} (project: ${project.id})`);
    project.currentStage = stage;
    project.stageStatus[stage] = 'processing';
    this.saveProject(project);
    this.emit({ type: 'pipeline_stage', payload: { projectId: project.id, stage, status: 'processing' } });
    this.observability.startStage(project.id, stage);

    // Retry once on transient browser errors (context/page closed between stages)
    const browserErrorPatterns = ['has been closed', 'Target closed', 'Session closed', 'Protocol error'];
    let lastError: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        await fn();
        project.stageStatus[stage] = 'completed';
        project.updatedAt = new Date().toISOString();
        this.saveProject(project);
        this.observability.completeStage(project.id, stage);
        console.log(`[orchestrator] ✓ Stage completed: ${stage}`);
        this.emit({ type: 'pipeline_stage', payload: { projectId: project.id, stage, status: 'completed' } });
        this.emit({ type: 'pipeline_artifact', payload: { projectId: project.id, stage, artifactType: stage.toLowerCase() } });
        return project;
      } catch (err) {
        lastError = err;
        const message = err instanceof Error ? err.message : String(err);
        const isBrowserError = browserErrorPatterns.some(p => message.includes(p));
        if (attempt === 0 && isBrowserError) {
          console.warn(`[orchestrator] ⟳ Stage ${stage} hit browser error, retrying once: ${message}`);
          continue;
        }
        console.error(`[orchestrator] ✗ Stage failed: ${stage} — ${message}`);
        project.stageStatus[stage] = 'error';
        project.error = message;
        this.saveProject(project);
        this.observability.errorStage(project.id, stage, message);
        this.emit({ type: 'pipeline_error', payload: { projectId: project.id, stage, error: message } });
        throw err;
      }
    }

    // Should never reach here, but just in case
    throw lastError;
  }

  private getAdapter(stage: PipelineStage, taskType: string, overrides?: ModelOverrides): AIAdapter {
    const decision = routeTask(stage, taskType, this.config.qualityTier, overrides);
    const adapter = selectAdapter(decision, this.chatAdapter, this.config.apiAdapter, this.config.qualityTier);
    const boundAdapter = bindDefaultModel(adapter, decision.model);
    console.log(`[orchestrator] adapter for ${stage}/${taskType}: adapter=${decision.adapter}, provider=${adapter.provider}, model=${decision.model || '(none)'}`);
    if (this.currentProjectDir) {
      return createLoggingAdapter(boundAdapter, this.currentProjectDir, stage, taskType);
    }
    return boundAdapter;
  }

  /**
   * Get a session-aware adapter that reuses chat context within a stage group.
   * Wraps the base adapter with session metadata for ChatAdapter.
   */
  private getSessionAwareAdapter(projectId: string, stage: PipelineStage, taskType: string, overrides?: ModelOverrides): AIAdapter {
    const adapter = this.getAdapter(stage, taskType, overrides);

    // Record the message in session manager
    const shouldContinue = this.sessionManager.shouldContinueChat(projectId, stage);
    const session = this.sessionManager.getSession(projectId, stage);

    // If the adapter is a ChatAdapter instance, update its session config
    if ('provider' in adapter && adapter.provider === 'CHAT') {
      const chatAdapter = adapter as AIAdapter & { config?: { sessionId?: string; continueChat?: boolean } };
      if (chatAdapter.config) {
        chatAdapter.config.sessionId = session.sessionId;
        chatAdapter.config.continueChat = shouldContinue;
      }
    }

    // Mark that this session has been used
    this.sessionManager.recordMessage(projectId, stage);
    return adapter;
  }

  /**
   * Generate a resource plan for a project before execution.
   */
  getResourcePlan(projectId: string, overrides?: ModelOverrides): ResourcePlan {
    return generateResourcePlan(
      this.config.qualityTier,
      this.providerRegistry,
      this.sessionManager,
      projectId,
      overrides,
    );
  }
}
