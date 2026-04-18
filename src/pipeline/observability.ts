/* ------------------------------------------------------------------ */
/*  ObservabilityService – per-pass telemetry and compilation metrics  */
/*  Records timing, quality scores, and diagnostics for every         */
/*  compilation pass.                                                 */
/* ------------------------------------------------------------------ */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { PipelineStage, LogEntry } from './types.js';
import { ARTIFACT } from '../constants.js';

export interface StageMetrics {
  stage: PipelineStage;
  startedAt: number;
  completedAt?: number;
  durationMs?: number;
  status: 'running' | 'completed' | 'error';
  error?: string;
  /** LLM call count within this stage */
  llmCallCount: number;
  /** Estimated token cost (rough) */
  estimatedTokens?: number;
  /** Quality score from audit/review (0-1) */
  qualityScore?: number;
}

export interface PipelineMetrics {
  projectId: string;
  startedAt: number;
  completedAt?: number;
  totalDurationMs?: number;
  stages: Record<string, StageMetrics>;
  totalLlmCalls: number;
  overallQualityScore?: number;
}

/**
 * ObservabilityService tracks per-stage telemetry for a pipeline run.
 * Non-blocking — failures here never halt the pipeline.
 */
export class ObservabilityService {
  private metrics: Map<string, PipelineMetrics> = new Map();

  /**
   * Start tracking a new pipeline execution.
   */
  startPipeline(projectId: string): void {
    this.metrics.set(projectId, {
      projectId,
      startedAt: Date.now(),
      stages: {},
      totalLlmCalls: 0,
    });
  }

  /**
   * Record the beginning of a stage.
   */
  startStage(projectId: string, stage: PipelineStage): void {
    const pipeline = this.metrics.get(projectId);
    if (!pipeline) return;

    pipeline.stages[stage] = {
      stage,
      startedAt: Date.now(),
      status: 'running',
      llmCallCount: 0,
    };
  }

  /**
   * Record the completion of a stage.
   */
  completeStage(projectId: string, stage: PipelineStage, qualityScore?: number): void {
    const pipeline = this.metrics.get(projectId);
    const stageMetrics = pipeline?.stages[stage];
    if (!stageMetrics) return;

    stageMetrics.completedAt = Date.now();
    stageMetrics.durationMs = stageMetrics.completedAt - stageMetrics.startedAt;
    stageMetrics.status = 'completed';
    if (qualityScore !== undefined) {
      stageMetrics.qualityScore = qualityScore;
    }
  }

  /**
   * Record a stage error.
   */
  errorStage(projectId: string, stage: PipelineStage, error: string): void {
    const pipeline = this.metrics.get(projectId);
    const stageMetrics = pipeline?.stages[stage];
    if (!stageMetrics) return;

    stageMetrics.completedAt = Date.now();
    stageMetrics.durationMs = stageMetrics.completedAt - stageMetrics.startedAt;
    stageMetrics.status = 'error';
    stageMetrics.error = error;
  }

  /**
   * Increment LLM call count for a stage.
   */
  recordLlmCall(projectId: string, stage: PipelineStage, estimatedTokens?: number): void {
    const pipeline = this.metrics.get(projectId);
    const stageMetrics = pipeline?.stages[stage];
    if (!stageMetrics) return;

    stageMetrics.llmCallCount++;
    if (estimatedTokens) {
      stageMetrics.estimatedTokens = (stageMetrics.estimatedTokens ?? 0) + estimatedTokens;
    }
    pipeline!.totalLlmCalls++;
  }

  /**
   * Finalize pipeline metrics.
   */
  completePipeline(projectId: string): PipelineMetrics | undefined {
    const pipeline = this.metrics.get(projectId);
    if (!pipeline) return undefined;

    pipeline.completedAt = Date.now();
    pipeline.totalDurationMs = pipeline.completedAt - pipeline.startedAt;

    // Calculate overall quality score (average of stage quality scores)
    const qualityScores = Object.values(pipeline.stages)
      .map(s => s.qualityScore)
      .filter((q): q is number => q !== undefined);
    if (qualityScores.length > 0) {
      pipeline.overallQualityScore = qualityScores.reduce((a, b) => a + b, 0) / qualityScores.length;
    }

    return pipeline;
  }

  /**
   * Get current metrics for a project.
   */
  getMetrics(projectId: string): PipelineMetrics | undefined {
    return this.metrics.get(projectId);
  }

  /**
   * Generate a summary suitable for logging.
   */
  getSummary(projectId: string): string {
    const m = this.metrics.get(projectId);
    if (!m) return 'No metrics available';

    const lines: string[] = [
      `Pipeline ${m.projectId}:`,
      `  Total duration: ${m.totalDurationMs ? `${(m.totalDurationMs / 1000).toFixed(1)}s` : 'in progress'}`,
      `  LLM calls: ${m.totalLlmCalls}`,
    ];

    for (const [name, stage] of Object.entries(m.stages)) {
      const dur = stage.durationMs ? `${(stage.durationMs / 1000).toFixed(1)}s` : '...';
      const quality = stage.qualityScore !== undefined ? ` (quality: ${stage.qualityScore.toFixed(2)})` : '';
      lines.push(`  ${name}: ${stage.status} [${dur}] ${stage.llmCallCount} calls${quality}`);
    }

    if (m.overallQualityScore !== undefined) {
      lines.push(`  Overall quality: ${m.overallQualityScore.toFixed(2)}`);
    }

    return lines.join('\n');
  }

  /**
   * Estimate time remaining for a pipeline based on completed stage durations
   * and historical averages from previous runs.
   */
  estimateTimeRemaining(
    projectId: string,
    stageOrder: string[],
    stageStatus: Record<string, string>,
  ): { etaMs: number; completedMs: number; confidence: 'high' | 'low' } | null {
    const pipeline = this.metrics.get(projectId);
    if (!pipeline) return null;

    // Calculate average duration per stage from THIS run's completed stages
    const completedDurations: number[] = [];
    const pendingStages: string[] = [];

    for (const stage of stageOrder) {
      const sm = pipeline.stages[stage];
      if (sm?.durationMs && sm.status === 'completed') {
        completedDurations.push(sm.durationMs);
      } else if (stageStatus[stage] !== 'completed') {
        pendingStages.push(stage);
      }
    }

    if (completedDurations.length === 0 || pendingStages.length === 0) return null;

    const completedMs = completedDurations.reduce((a, b) => a + b, 0);
    const avgStageMs = completedMs / completedDurations.length;

    // Estimate remaining = pendingStages × average stage duration
    const etaMs = Math.round(pendingStages.length * avgStageMs);
    const confidence = completedDurations.length >= 3 ? 'high' : 'low';

    return { etaMs, completedMs, confidence };
  }

  /* ---- Persistence ---- */

  private static readonly METRICS_FILE = ARTIFACT.OBSERVABILITY;

  /**
   * Persist current metrics for a project to `{projectDir}/observability.json`.
   * Uses atomic write (write to tmp, then rename) to avoid corruption.
   */
  saveTo(projectDir: string, projectId: string): void {
    const pipeline = this.metrics.get(projectId);
    if (!pipeline) return;

    const filePath = join(projectDir, ObservabilityService.METRICS_FILE);
    const dir = dirname(filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });

    const tmpPath = `${filePath}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(pipeline, null, 2));
    renameSync(tmpPath, filePath);
  }

  /**
   * Load previously-persisted metrics for a project from `{projectDir}/observability.json`.
   * Call **after** `startPipeline()` — only completed stages are merged into
   * the fresh in-memory PipelineMetrics so that ETA estimation works on resume.
   */
  loadFrom(projectDir: string, projectId: string): void {
    const filePath = join(projectDir, ObservabilityService.METRICS_FILE);
    if (!existsSync(filePath)) return;

    try {
      const saved = JSON.parse(readFileSync(filePath, 'utf-8')) as PipelineMetrics;
      const current = this.metrics.get(projectId);
      if (!current) return; // startPipeline hasn't been called yet

      // Merge completed stages from the persisted snapshot
      for (const [name, stage] of Object.entries(saved.stages)) {
        if (stage.status === 'completed' && !current.stages[name]) {
          current.stages[name] = stage;
        }
      }

      // Recalculate aggregates from merged stages
      current.totalLlmCalls = Object.values(current.stages)
        .reduce((sum, s) => sum + s.llmCallCount, 0);
    } catch {
      // Corrupt file — ignore and start fresh
    }
  }
}
