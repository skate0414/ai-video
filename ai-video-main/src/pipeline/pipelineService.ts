/* ------------------------------------------------------------------ */
/*  PipelineService – clean facade between HTTP routes and internals  */
/*  Routes should use ONLY this service, never reaching into          */
/*  orchestrator.providerRegistry / sessionManager / observability.   */
/* ------------------------------------------------------------------ */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { PipelineOrchestrator, type PipelineConfig, SafetyBlockError } from './orchestrator.js';
import type {
  PipelineProject, PipelineStage, PipelineEvent, QualityTier,
  ModelOverrides, StyleProfile, Scene, LogEntry,
} from './types.js';
import type { ResourcePlan } from './resourcePlanner.js';
import type { AIAdapter } from './types.js';
import type { ChatAdapter } from '../adapters/chatAdapter.js';
import { GeminiAdapter } from '../adapters/geminiAdapter.js';
import { ConfigStore, type AppConfig } from '../configStore.js';
import type { VideoProviderConfig } from '../adapters/videoProvider.js';

export type EventBroadcaster = (event: unknown) => void;

export interface PipelineServiceConfig {
  dataDir: string;
  chatAdapter: ChatAdapter;
  apiAdapter: GeminiAdapter | undefined;
  geminiApiKey: string;
  defaultQualityTier: QualityTier;
  configStore: ConfigStore;
  broadcastEvent: EventBroadcaster;
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
  private apiAdapter: GeminiAdapter | undefined;
  private geminiApiKey: string;
  private readonly dataDir: string;
  private defaultQualityTier: QualityTier;
  private readonly configStore: ConfigStore;
  private readonly broadcastEvent: EventBroadcaster;

  constructor(cfg: PipelineServiceConfig) {
    this.chatAdapter = cfg.chatAdapter;
    this.apiAdapter = cfg.apiAdapter;
    this.geminiApiKey = cfg.geminiApiKey;
    this.dataDir = cfg.dataDir;
    this.defaultQualityTier = cfg.defaultQualityTier;
    this.configStore = cfg.configStore;
    this.broadcastEvent = cfg.broadcastEvent;

    this.orchestrator = this.buildOrchestrator(cfg.defaultQualityTier);
  }

  private buildOrchestrator(tier: QualityTier): PipelineOrchestrator {
    const saved = this.configStore.get();
    const orch = new PipelineOrchestrator(this.chatAdapter as unknown as AIAdapter, {
      dataDir: this.dataDir,
      qualityTier: tier,
      apiAdapter: this.apiAdapter,
      videoProviderConfig: saved.videoProviderConfig,
      productionConcurrency: saved.productionConcurrency,
      ttsConfig: saved.ttsConfig,
    });
    orch.onEvent((event: PipelineEvent) => {
      this.broadcastEvent(event);
    });
    return orch;
  }

  private rebuildOrchestrator(tier: QualityTier): void {
    this.orchestrator = this.buildOrchestrator(tier);
  }

  /* ---- Project CRUD ---- */

  listProjects(): PipelineProject[] {
    return this.orchestrator.listProjects();
  }

  createProject(topic: string, title?: string, qualityTier?: QualityTier, modelOverrides?: ModelOverrides): PipelineProject {
    const tier = qualityTier ?? this.defaultQualityTier;
    if (tier !== this.orchestrator.getQualityTier()) {
      this.rebuildOrchestrator(tier);
    }
    return this.orchestrator.createProject(topic, title, modelOverrides);
  }

  loadProject(projectId: string): PipelineProject | null {
    return this.orchestrator.loadProject(projectId);
  }

  deleteProject(projectId: string): boolean {
    return this.orchestrator.deleteProject(projectId);
  }

  /* ---- Pipeline execution ---- */

  startPipeline(projectId: string, videoFilePath?: string): void {
    this.orchestrator.run(projectId, videoFilePath).catch((err) => {
      console.error('[pipeline] run error:', err);
    });
  }

  stopPipeline(projectId: string): void {
    // Use RunLock's per-project abort if available, otherwise global abort
    if (!this.orchestrator.runLock.abort(projectId)) {
      this.orchestrator.abort();
    }
  }

  retryStage(projectId: string, stage: PipelineStage): void {
    this.orchestrator.retryStage(projectId, stage).catch((err) => {
      console.error('[pipeline] retry error:', err);
    });
  }

  resumePipeline(projectId: string): void {
    this.orchestrator.resumePipeline(projectId).catch((err) => {
      console.error('[pipeline] resume error:', err);
    });
  }

  async regenerateScene(projectId: string, sceneId: string): Promise<Scene> {
    return this.orchestrator.regenerateSceneAssets(projectId, sceneId);
  }

  /* ---- Content editing ---- */

  updateScript(projectId: string, scriptText: string): PipelineProject {
    return this.orchestrator.updateScript(projectId, scriptText);
  }

  updateScenes(projectId: string, scenes: Scene[]): PipelineProject {
    return this.orchestrator.updateScenes(projectId, scenes);
  }

  updateModelOverrides(projectId: string, overrides: ModelOverrides): PipelineProject {
    return this.orchestrator.updateModelOverrides(projectId, overrides);
  }

  approveScene(projectId: string, sceneId: string): PipelineProject {
    return this.orchestrator.approveScene(projectId, sceneId);
  }

  rejectScene(projectId: string, sceneId: string): PipelineProject {
    return this.orchestrator.rejectScene(projectId, sceneId);
  }

  approveQaReview(projectId: string, override?: { feedback?: string }): PipelineProject {
    return this.orchestrator.approveQaReview(projectId, override);
  }

  approveReferenceImages(projectId: string): PipelineProject {
    return this.orchestrator.approveReferenceImages(projectId);
  }

  async setStyleProfile(projectId: string, pastedText?: string, styleProfile?: any, topic?: string): Promise<PipelineProject> {
    if (styleProfile) {
      return this.orchestrator.setStyleProfile(projectId, styleProfile);
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

  getResourcePlan(projectId: string, overrides?: ModelOverrides): ResourcePlan {
    return this.orchestrator.getResourcePlan(projectId, overrides);
  }

  /* ---- Setup / first-run ---- */

  getProviderCount(): number {
    return this.orchestrator.providerRegistry.getAll().length;
  }

  hasApiKey(): boolean {
    return !!this.geminiApiKey;
  }

  completeSetup(body: { geminiApiKey?: string }): { ok: true; hasApiKey: boolean } {
    if (body.geminiApiKey) {
      this.geminiApiKey = body.geminiApiKey;
      this.apiAdapter = new GeminiAdapter(this.geminiApiKey);
      this.configStore.update({ geminiApiKey: body.geminiApiKey });
    }
    return { ok: true, hasApiKey: !!this.geminiApiKey };
  }

  /* ---- Config management ---- */

  getConfig(): { qualityTier: QualityTier; hasApiKey: boolean; productionConcurrency: number; videoProviderConfig?: any } {
    const saved = this.configStore.get();
    const vpConfig = saved.videoProviderConfig;
    const profileDirs = (vpConfig as any)?.profileDirs?.length
      ? (vpConfig as any).profileDirs
      : (vpConfig as any)?.profileDir
        ? [(vpConfig as any).profileDir]
        : [];
    return {
      qualityTier: this.orchestrator.getQualityTier(),
      hasApiKey: !!this.geminiApiKey,
      productionConcurrency: saved.productionConcurrency ?? 2,
      videoProviderConfig: profileDirs.length > 0 ? { profileDirs } : undefined,
    };
  }

  updateConfig(body: { geminiApiKey?: string; qualityTier?: QualityTier; productionConcurrency?: number }): { ok: true; qualityTier: QualityTier; hasApiKey: boolean } {
    if (body.geminiApiKey) {
      this.geminiApiKey = body.geminiApiKey;
      this.apiAdapter = new GeminiAdapter(this.geminiApiKey);
    }
    const tier = body.qualityTier ?? (this.apiAdapter ? 'balanced' : 'free');
    this.configStore.update({
      geminiApiKey: this.geminiApiKey || undefined,
      qualityTier: tier,
      ...(body.productionConcurrency !== undefined ? { productionConcurrency: body.productionConcurrency } : {}),
    });
    this.rebuildOrchestrator(tier);
    return { ok: true, qualityTier: tier, hasApiKey: !!this.geminiApiKey };
  }

  getVideoProviderConfig(): unknown {
    return this.configStore.get().videoProviderConfig ?? null;
  }

  updateVideoProviderConfig(config: VideoProviderConfig | null): void {
    this.configStore.update({ videoProviderConfig: config ?? undefined });
    this.rebuildOrchestrator(this.orchestrator.getQualityTier());
  }

  getTtsConfig(): unknown {
    return this.configStore.get().ttsConfig ?? {};
  }

  updateTtsConfig(config: any): void {
    this.configStore.update({ ttsConfig: config });
  }

  /* ---- Export / Import ---- */

  exportProject(projectId: string): Record<string, any> | null {
    const project = this.orchestrator.loadProject(projectId);
    if (!project) return null;

    const projectDir = this.orchestrator.getProjectDir(projectId);
    const bundle: Record<string, any> = { project };

    const artifactNames = ['capability-assessment.json', 'style-profile.json', 'research.json',
      'calibration.json', 'narrative-map.json', 'script.json', 'qa-review.json',
      'scenes.json', 'refinement.json'];
    for (const name of artifactNames) {
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

    const artifactNames = ['capability-assessment.json', 'style-profile.json', 'research.json',
      'calibration.json', 'narrative-map.json', 'script.json', 'qa-review.json',
      'scenes.json', 'refinement.json'];
    for (const name of artifactNames) {
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
}
