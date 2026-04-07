/* ------------------------------------------------------------------ */
/*  ObservabilityService – per-stage telemetry and quality metrics     */
/*  Inspired by ai-suite's ObservabilityService                       */
/* ------------------------------------------------------------------ */

import type { PipelineStage, LogEntry } from './types.js';

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
}
