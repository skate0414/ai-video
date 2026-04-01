/* ------------------------------------------------------------------ */
/*  PipelineOrchestrator – coordinates the 5-stage video pipeline      */
/* ------------------------------------------------------------------ */

import { mkdirSync, existsSync, readFileSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import type {
  AIAdapter, PipelineProject, PipelineStage, ProcessStatus,
  StyleProfile, ResearchData, NarrativeMap, ScriptOutput, GenerationPlan,
  CalibrationData, Scene, LogEntry, PipelineEvent, QualityTier, ModelOverrides,
} from './types.js';
import { routeTask, selectAdapter } from './qualityRouter.js';
import { SessionManager } from './sessionManager.js';
import { ProviderCapabilityRegistry } from './providerRegistry.js';
import { generateResourcePlan, type ResourcePlan } from './resourcePlanner.js';
import { ObservabilityService } from './observability.js';
import { runCapabilityAssessment } from './stages/capabilityAssessment.js';
import { runCvPreprocess, type CvPreprocessOutput } from './stages/cvPreprocess.js';
import { runStyleExtraction } from './stages/styleExtraction.js';
import { runResearch } from './stages/research.js';
import { runCalibration } from './stages/calibration.js';
import { runNarrativeMap } from './stages/narrativeMap.js';
import { runScriptGeneration } from './stages/scriptGeneration.js';
import { runScriptAudit } from './stages/scriptAudit.js';
import { runQaReview } from './stages/qaReview.js';
import { runStoryboard } from './stages/storyboard.js';
import { runSubjectIsolation, applySubjectIsolationFixes } from './stages/subjectIsolation.js';
import { runReferenceImage } from './stages/referenceImage.js';
import { runKeyframeGen } from './stages/keyframeGen.js';
import { runVideoGen } from './stages/videoGen.js';
import { runTts } from './stages/tts.js';
import { runFinalRiskGate } from './stages/finalRiskGate.js';
import type { VideoProviderConfig } from '../adapters/videoProvider.js';
import type { TTSConfig } from '../adapters/ttsProvider.js';

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

const STAGES: PipelineStage[] = [
  'CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', 'RESEARCH',
  'NARRATIVE_MAP', 'SCRIPT_GENERATION', 'QA_REVIEW',
  'STORYBOARD', 'REFERENCE_IMAGE', 'KEYFRAME_GEN', 'VIDEO_GEN', 'TTS',
  'ASSEMBLY', 'REFINEMENT',
];

function defaultStageStatus(): Record<PipelineStage, ProcessStatus> {
  return {
    CAPABILITY_ASSESSMENT: 'pending',
    STYLE_EXTRACTION: 'pending',
    RESEARCH: 'pending',
    NARRATIVE_MAP: 'pending',
    SCRIPT_GENERATION: 'pending',
    QA_REVIEW: 'pending',
    STORYBOARD: 'pending',
    REFERENCE_IMAGE: 'pending',
    KEYFRAME_GEN: 'pending',
    VIDEO_GEN: 'pending',
    TTS: 'pending',
    ASSEMBLY: 'pending',
    REFINEMENT: 'pending',
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

  /** Session manager for chat context reuse across stage groups. */
  readonly sessionManager = new SessionManager();
  /** Provider capability registry for dynamic provider selection. */
  readonly providerRegistry = new ProviderCapabilityRegistry();
  /** Observability service for per-stage telemetry. */
  readonly observability = new ObservabilityService();

  constructor(chatAdapter: AIAdapter, config: PipelineConfig) {
    this.chatAdapter = chatAdapter;
    this.config = config;
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
    const id = `proj_${Date.now()}`;
    const project: PipelineProject = {
      id,
      title: title ?? topic.slice(0, 50),
      topic,
      qualityTier: this.config.qualityTier,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      stageStatus: defaultStageStatus(),
      pauseAfterStages: ['QA_REVIEW', 'STORYBOARD', 'REFERENCE_IMAGE'],
      modelOverrides,
      logs: [],
    };

    this.saveProject(project);
    this.emit({ type: 'pipeline_created', payload: { projectId: id } });
    return project;
  }

  getProjectDir(projectId: string): string {
    return join(this.config.dataDir, 'projects', projectId);
  }

  private saveProject(project: PipelineProject): void {
    const dir = this.getProjectDir(project.id);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, 'project.json'), JSON.stringify(project, null, 2));
  }

  loadProject(projectId: string): PipelineProject | null {
    const filePath = join(this.getProjectDir(projectId), 'project.json');
    if (!existsSync(filePath)) return null;
    return JSON.parse(readFileSync(filePath, 'utf-8'));
  }

  private saveArtifact(projectId: string, filename: string, data: unknown): void {
    const dir = this.getProjectDir(projectId);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, filename), JSON.stringify(data, null, 2));
  }

  private loadArtifact<T>(projectId: string, filename: string): T | undefined {
    const filePath = join(this.getProjectDir(projectId), filename);
    if (!existsSync(filePath)) return undefined;
    try {
      return JSON.parse(readFileSync(filePath, 'utf-8'));
    } catch {
      return undefined;
    }
  }

  deleteProject(projectId: string): boolean {
    const dir = this.getProjectDir(projectId);
    if (!existsSync(dir)) return false;
    this.sessionManager.clearProject(projectId);
    rmSync(dir, { recursive: true, force: true });
    return true;
  }

  listProjects(): PipelineProject[] {
    const projectsDir = join(this.config.dataDir, 'projects');
    if (!existsSync(projectsDir)) return [];
    const entries = readdirSync(projectsDir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory())
      .map((e) => this.loadProject(e.name))
      .filter((p): p is PipelineProject => p !== null)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  /* ---- Pipeline execution ---- */

  /**
   * Run the full pipeline from start (or resume from last completed stage).
   */
  async run(projectId: string, videoFilePath?: string): Promise<PipelineProject> {
    this.aborted = false;
    let project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    if (videoFilePath) {
      project.referenceVideoPath = videoFilePath;
      this.saveProject(project);
    }

    const assetsDir = join(this.getProjectDir(projectId), 'assets');
    if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });

    const addLog = (entry: LogEntry) => {
      project!.logs.push(entry);
      this.emit({ type: 'pipeline_log', payload: { projectId, entry } });
    };

    this.observability.startPipeline(projectId);

    try {
      // ---- 1. CAPABILITY_ASSESSMENT ----
      if (project.stageStatus.CAPABILITY_ASSESSMENT !== 'completed') {
        project = await this.runStage(project, 'CAPABILITY_ASSESSMENT', async () => {
          const adapter = this.getAdapter('CAPABILITY_ASSESSMENT', 'safety_check', project!.modelOverrides);
          const result = await runCapabilityAssessment(adapter, {
            topic: project!.topic,
            providerRegistry: this.providerRegistry,
            providerIds: this.providerRegistry.getAll().map(p => p.providerId),
          }, addLog);
          project!.safetyCheck = result.safetyCheck;
          this.saveArtifact(projectId, 'capability-assessment.json', result);
          return result;
        });
      }
      if (this.aborted) return project;
      // Safety gate: block pipeline if topic is unsafe
      if (project.safetyCheck && !project.safetyCheck.safe) {
        const reason = project.safetyCheck.reason ?? 'Topic flagged as unsafe';
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Safety block: ${reason}`, type: 'error', stage: 'CAPABILITY_ASSESSMENT' });
        throw new SafetyBlockError(reason);
      }
      if (this.shouldPause(project, 'CAPABILITY_ASSESSMENT')) return project;

      // ---- 2. STYLE_EXTRACTION (with CV pre-processing) ----
      if (project.stageStatus.STYLE_EXTRACTION !== 'completed') {
        project = await this.runStage(project, 'STYLE_EXTRACTION', async () => {
          // CV pre-processing: extract ground-truth visual features
          let cvData: CvPreprocessOutput | undefined;
          if (project!.referenceVideoPath) {
            try {
              const cvAdapter = this.getAdapter('STYLE_EXTRACTION', 'video_analysis', project!.modelOverrides);
              cvData = await runCvPreprocess(cvAdapter, {
                videoFilePath: project!.referenceVideoPath,
                assetsDir,
              }, addLog);
              this.saveArtifact(projectId, 'cv-preprocess.json', cvData);
            } catch {
              addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: 'CV pre-processing failed (non-blocking), continuing with style extraction', type: 'warning', stage: 'STYLE_EXTRACTION' });
            }
          }

          // Style extraction via LLM
          const adapter = this.getAdapter('STYLE_EXTRACTION', 'video_analysis', project!.modelOverrides);
          const result = await runStyleExtraction(adapter, {
            videoFilePath: project!.referenceVideoPath!,
            topic: project!.topic,
          }, addLog);

          // Override LLM color palette with CV ground-truth if available
          if (cvData?.dominantColors?.length) {
            result.styleProfile.colorPalette = cvData.dominantColors;
            addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Color palette overridden by CV: ${cvData.dominantColors.join(', ')}`, type: 'info', stage: 'STYLE_EXTRACTION' });
          }

          project!.styleProfile = result.styleProfile;
          this.saveArtifact(projectId, 'style-profile.json', result.styleProfile);
          return result;
        });
      }
      if (this.aborted) return project;
      if (this.shouldPause(project, 'STYLE_EXTRACTION')) return project;

      // ---- 3. RESEARCH ----
      if (project.stageStatus.RESEARCH !== 'completed') {
        project.styleProfile ??= this.loadArtifact(projectId, 'style-profile.json');

        project = await this.runStage(project, 'RESEARCH', async () => {
          const adapter = this.getAdapter('RESEARCH', 'fact_research', project!.modelOverrides);
          const result = await runResearch(adapter, {
            topic: project!.topic,
            styleProfile: project!.styleProfile!,
            suspiciousNumericClaims: project!.styleProfile?.suspiciousNumericClaims,
          }, addLog);
          project!.researchData = result;
          this.saveArtifact(projectId, 'research.json', result);
          return result;
        });
      }
      if (this.aborted) return project;
      if (this.shouldPause(project, 'RESEARCH')) return project;

      // ---- 4. NARRATIVE_MAP (includes calibration) ----
      if (project.stageStatus.NARRATIVE_MAP !== 'completed') {
        project.styleProfile ??= this.loadArtifact(projectId, 'style-profile.json');
        project.researchData ??= this.loadArtifact(projectId, 'research.json');

        project = await this.runStage(project, 'NARRATIVE_MAP', async () => {
          // Step A: Calibration (speech rate + fact verification)
          const calAdapter = this.getAdapter('NARRATIVE_MAP', 'calibration', project!.modelOverrides);
          const calResult = await runCalibration(calAdapter, {
            topic: project!.topic,
            styleProfile: project!.styleProfile!,
            researchData: project!.researchData!,
          }, addLog);
          project!.calibrationData = calResult;
          this.saveArtifact(projectId, 'calibration.json', calResult);

          // Step B: Narrative map generation
          const nmAdapter = this.getAdapter('NARRATIVE_MAP', 'calibration', project!.modelOverrides);
          const nmResult = await runNarrativeMap(nmAdapter, {
            topic: project!.topic,
            styleProfile: project!.styleProfile!,
            calibrationData: calResult,
          }, addLog);
          project!.narrativeMap = nmResult.narrativeMap;
          project!.generationPlan = nmResult.generationPlan;
          this.saveArtifact(projectId, 'narrative-map.json', nmResult);
          return nmResult;
        });
      }
      if (this.aborted) return project;
      if (this.shouldPause(project, 'NARRATIVE_MAP')) return project;

      // ---- 6. SCRIPT_GENERATION ----
      if (project.stageStatus.SCRIPT_GENERATION !== 'completed') {
        project.styleProfile ??= this.loadArtifact(projectId, 'style-profile.json');
        project.researchData ??= this.loadArtifact(projectId, 'research.json');
        project.calibrationData ??= this.loadArtifact(projectId, 'calibration.json');
        project.narrativeMap ??= this.loadArtifact<any>(projectId, 'narrative-map.json')?.narrativeMap;

        project = await this.runStage(project, 'SCRIPT_GENERATION', async () => {
          const adapter = this.getAdapter('SCRIPT_GENERATION', 'script_generation', project!.modelOverrides);
          const result = await runScriptGeneration(adapter, {
            topic: project!.topic,
            styleProfile: project!.styleProfile!,
            researchData: project!.researchData!,
            calibrationData: project!.calibrationData!,
            narrativeMap: project!.narrativeMap!,
          }, addLog);
          project!.scriptOutput = result;
          this.saveArtifact(projectId, 'script.json', result);

          // Self-correction audit (ai-suite Step 3)
          const auditAdapter = this.getAdapter('SCRIPT_GENERATION', 'script_generation', project!.modelOverrides);
          const auditResult = await runScriptAudit(auditAdapter, {
            scriptOutput: result,
            styleProfile: project!.styleProfile!,
            topic: project!.topic,
          }, addLog);
          this.saveArtifact(projectId, 'script-audit.json', auditResult);

          // Apply corrections if the audit found issues
          if (auditResult.corrections.length > 0 && auditResult.correctedScript !== result.scriptText) {
            project!.scriptOutput!.scriptText = auditResult.correctedScript;
            this.saveArtifact(projectId, 'script.json', project!.scriptOutput);
          }

          // Store quality scores on the script output
          project!.scriptOutput!.styleConsistency = {
            score: auditResult.styleConsistencyScore,
            isDeviation: auditResult.styleConsistencyScore < 0.78,
            feedback: auditResult.corrections.map(c => c.reason).join('; ') || 'No issues',
            status: auditResult.styleConsistencyScore >= 0.78 ? 'pass' : 'warn',
          };

          return result;
        });
      }
      if (this.aborted) return project;
      if (this.shouldPause(project, 'SCRIPT_GENERATION')) return project;

      // ---- 7. QA_REVIEW ----
      if (project.stageStatus.QA_REVIEW !== 'completed') {
        project.scriptOutput ??= this.loadArtifact(projectId, 'script.json');

        project = await this.runStage(project, 'QA_REVIEW', async () => {
          const adapter = this.getAdapter('QA_REVIEW', 'quality_review', project!.modelOverrides);
          const result = await runQaReview(adapter, {
            scriptOutput: project!.scriptOutput!,
            topic: project!.topic,
            styleProfile: project!.styleProfile!,
          }, addLog);
          project!.qaReviewResult = result;
          this.saveArtifact(projectId, 'qa-review.json', result);
          return result;
        });
      }
      if (this.aborted) return project;
      if (this.shouldPause(project, 'QA_REVIEW')) return project;

      // ---- 8. STORYBOARD ----
      if (project.stageStatus.STORYBOARD !== 'completed') {
        project.styleProfile ??= this.loadArtifact(projectId, 'style-profile.json');
        project.scriptOutput ??= this.loadArtifact(projectId, 'script.json');

        project = await this.runStage(project, 'STORYBOARD', async () => {
          const adapter = this.getAdapter('STORYBOARD', 'visual_prompts', project!.modelOverrides);
          const scenes = await runStoryboard(adapter, {
            topic: project!.topic,
            styleProfile: project!.styleProfile!,
            scriptOutput: project!.scriptOutput!,
          }, addLog);

          // Subject isolation check — validate visual prompts have clear subjects
          const isolationResult = await runSubjectIsolation(adapter, {
            scenes,
            styleProfile: project!.styleProfile!,
          }, addLog);
          this.saveArtifact(projectId, 'subject-isolation.json', isolationResult);

          // Auto-fix scenes that failed isolation check
          const finalScenes = isolationResult.failedCount > 0
            ? applySubjectIsolationFixes(scenes, isolationResult)
            : scenes;

          project!.scenes = finalScenes;
          this.saveArtifact(projectId, 'scenes.json', finalScenes);
          return finalScenes;
        });
      }
      if (this.aborted) return project;
      if (this.shouldPause(project, 'STORYBOARD')) return project;

      // ---- 9. REFERENCE_IMAGE ----
      if (project.stageStatus.REFERENCE_IMAGE !== 'completed') {
        project.styleProfile ??= this.loadArtifact(projectId, 'style-profile.json');
        project.scenes ??= this.loadArtifact(projectId, 'scenes.json') ?? [];

        project = await this.runStage(project, 'REFERENCE_IMAGE', async () => {
          const adapter = this.getAdapter('REFERENCE_IMAGE', 'image_generation', project!.modelOverrides);
          const updatedScenes = await runReferenceImage(adapter, {
            scenes: project!.scenes!,
            styleProfile: project!.styleProfile!,
            assetsDir,
          }, addLog);
          project!.scenes = updatedScenes;
          this.saveArtifact(projectId, 'scenes.json', updatedScenes);
          return updatedScenes;
        });
      }
      if (this.aborted) return project;
      if (this.shouldPause(project, 'REFERENCE_IMAGE')) return project;

      // ---- 10. KEYFRAME_GEN ----
      if (project.stageStatus.KEYFRAME_GEN !== 'completed') {
        project.styleProfile ??= this.loadArtifact(projectId, 'style-profile.json');
        project.scenes ??= this.loadArtifact(projectId, 'scenes.json') ?? [];

        project = await this.runStage(project, 'KEYFRAME_GEN', async () => {
          const adapter = this.getAdapter('KEYFRAME_GEN', 'image_generation', project!.modelOverrides);
          const updatedScenes = await runKeyframeGen(adapter, {
            scenes: project!.scenes!,
            styleProfile: project!.styleProfile!,
            assetsDir,
          }, addLog);
          project!.scenes = updatedScenes;
          this.saveArtifact(projectId, 'scenes.json', updatedScenes);
          return updatedScenes;
        });
      }
      if (this.aborted) return project;
      if (this.shouldPause(project, 'KEYFRAME_GEN')) return project;

      // ---- 11. VIDEO_GEN ----
      if (project.stageStatus.VIDEO_GEN !== 'completed') {
        project.styleProfile ??= this.loadArtifact(projectId, 'style-profile.json');
        project.scenes ??= this.loadArtifact(projectId, 'scenes.json') ?? [];

        project = await this.runStage(project, 'VIDEO_GEN', async () => {
          const adapter = this.getAdapter('VIDEO_GEN', 'video_generation', project!.modelOverrides);
          const updatedScenes = await runVideoGen(adapter, {
            scenes: project!.scenes!,
            styleProfile: project!.styleProfile!,
            assetsDir,
            videoProviderConfig: this.config.videoProviderConfig,
            concurrency: this.config.productionConcurrency ?? 2,
          }, addLog, (scene) => {
            const idx = project!.scenes!.findIndex(s => s.id === scene.id);
            if (idx !== -1) project!.scenes![idx] = scene;
          });
          project!.scenes = updatedScenes;
          this.saveArtifact(projectId, 'scenes.json', updatedScenes);
          return updatedScenes;
        });
      }
      if (this.aborted) return project;
      if (this.shouldPause(project, 'VIDEO_GEN')) return project;

      // ---- 12. TTS ----
      if (project.stageStatus.TTS !== 'completed') {
        project.scenes ??= this.loadArtifact(projectId, 'scenes.json') ?? [];

        project = await this.runStage(project, 'TTS', async () => {
          const ttsConfig: TTSConfig = {
            assetsDir,
            voice: this.config.ttsConfig?.voice,
            rate: this.config.ttsConfig?.rate,
            pitch: this.config.ttsConfig?.pitch,
          };
          const updatedScenes = await runTts({
            scenes: project!.scenes!,
            ttsConfig,
            concurrency: this.config.productionConcurrency ?? 2,
          }, addLog);
          project!.scenes = updatedScenes;
          this.saveArtifact(projectId, 'scenes.json', updatedScenes);
          return updatedScenes;
        });
      }
      if (this.aborted) return project;
      if (this.shouldPause(project, 'TTS')) return project;

      // ---- 13. ASSEMBLY (FFmpeg video composition) ----
      if (project.stageStatus.ASSEMBLY !== 'completed') {
        project.scenes ??= this.loadArtifact(projectId, 'scenes.json') ?? [];

        project = await this.runStage(project, 'ASSEMBLY', async () => {
          const { assembleVideo, isFFmpegAvailable } = await import('../adapters/ffmpegAssembler.js');

          if (!(await isFFmpegAvailable())) {
            throw new Error('FFmpeg is not installed. Please install FFmpeg to enable video assembly.');
          }

          addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: 'Starting video assembly with FFmpeg...', type: 'info', stage: 'ASSEMBLY' });

          const finalPath = await assembleVideo(project!.scenes!, {
            assetsDir,
            outputDir: assetsDir,
            projectTitle: project!.title,
            onProgress: (percent, message) => {
              this.emit({ type: 'pipeline_assembly_progress', payload: { projectId, percent, message } });
            },
          });

          project!.finalVideoPath = finalPath;
          addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Video assembly complete: ${finalPath}`, type: 'success', stage: 'ASSEMBLY' });
          return finalPath;
        });
      }

      // ---- Final Risk Gate (safety + completeness check before refinement) ----
      {
        project.scenes ??= this.loadArtifact(projectId, 'scenes.json') ?? [];
        project.scriptOutput ??= this.loadArtifact(projectId, 'script.json');
        const gateResult = runFinalRiskGate({
          scenes: project.scenes!,
          scriptText: project.scriptOutput?.scriptText ?? '',
        }, addLog);
        this.saveArtifact(projectId, 'final-risk-gate.json', gateResult);
      }
      if (this.aborted) return project;

      // ---- 13. REFINEMENT (check completeness + auto-retry) ----
      if (project.stageStatus.REFINEMENT !== 'completed') {
        project.scenes ??= this.loadArtifact(projectId, 'scenes.json') ?? [];

        project = await this.runStage(project, 'REFINEMENT', async () => {
          const { runRefinement } = await import('./stages/refinement.js');
          const result = await runRefinement({
            scenes: project!.scenes!,
            maxRetries: 2,
          }, addLog);

          if (!result.allComplete && result.failedScenes.length > 0) {
            // Auto-retry failed scenes (up to 2 attempts per scene)
            const retried: string[] = [];
            for (const sceneId of result.failedScenes) {
              try {
                addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Auto-retrying scene ${sceneId}...`, type: 'info', stage: 'REFINEMENT' });
                await this.regenerateSceneAssets(projectId, sceneId);
                retried.push(sceneId);
              } catch {
                addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Scene ${sceneId} retry failed`, type: 'warning', stage: 'REFINEMENT' });
              }
            }
            result.retriedScenes = retried;
            result.retryCount = 1;
          }

          project!.refinementHistory = [result];
          this.saveArtifact(projectId, 'refinement.json', result);
          return result;
        });
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
    return project;
  }

  /**
   * Retry a specific stage.
   */
  async retryStage(projectId: string, stage: PipelineStage): Promise<PipelineProject> {
    const project = this.loadProject(projectId);
    if (!project) throw new Error(`Project ${projectId} not found`);

    // Reset this stage and all subsequent stages
    const stageIdx = STAGES.indexOf(stage);
    for (let i = stageIdx; i < STAGES.length; i++) {
      project.stageStatus[STAGES[i]] = 'pending';
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
    const { regenerateSceneImage } = await import('./stages/referenceImage.js');
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
    if (project.pauseAfterStages?.includes(stage) && project.stageStatus[stage] === 'completed') {
      project.isPaused = true;
      project.pausedAtStage = stage;
      this.saveProject(project);
      this.emit({ type: 'pipeline_paused', payload: { projectId: project.id, stage } });
      return true;
    }
    return false;
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
    project.currentStage = stage;
    project.stageStatus[stage] = 'processing';
    this.saveProject(project);
    this.emit({ type: 'pipeline_stage', payload: { projectId: project.id, stage, status: 'processing' } });
    this.observability.startStage(project.id, stage);

    try {
      await fn();
      project.stageStatus[stage] = 'completed';
      project.updatedAt = new Date().toISOString();
      this.saveProject(project);
      this.observability.completeStage(project.id, stage);
      this.emit({ type: 'pipeline_stage', payload: { projectId: project.id, stage, status: 'completed' } });
      this.emit({ type: 'pipeline_artifact', payload: { projectId: project.id, stage, artifactType: stage.toLowerCase() } });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      project.stageStatus[stage] = 'error';
      project.error = message;
      this.saveProject(project);
      this.observability.errorStage(project.id, stage, message);
      this.emit({ type: 'pipeline_error', payload: { projectId: project.id, stage, error: message } });
      throw err;
    }

    return project;
  }

  private getAdapter(stage: PipelineStage, taskType: string, overrides?: ModelOverrides): AIAdapter {
    const decision = routeTask(stage, taskType, this.config.qualityTier, overrides);
    return selectAdapter(decision, this.chatAdapter, this.config.apiAdapter, this.config.qualityTier);
  }

  /**
   * Get a session-aware adapter that reuses chat context within a stage group.
   * Wraps the base adapter with session metadata for ChatAdapter.
   */
  getSessionAwareAdapter(projectId: string, stage: PipelineStage, taskType: string, overrides?: ModelOverrides): AIAdapter {
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
