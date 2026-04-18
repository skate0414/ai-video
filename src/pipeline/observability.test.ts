import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { ObservabilityService } from './observability.js';
import { mkdtempSync, existsSync, readFileSync, writeFileSync, rmSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { PipelineStage } from './types.js';
import { ARTIFACT } from '../constants.js';

describe('ObservabilityService', () => {
  let svc: ObservabilityService;
  const PID = 'test-project-1';

  beforeEach(() => {
    svc = new ObservabilityService();
  });

  /* ---- Core in-memory behaviour ---- */

  describe('in-memory tracking', () => {
    it('startPipeline creates empty metrics', () => {
      svc.startPipeline(PID);
      const m = svc.getMetrics(PID);
      expect(m).toBeDefined();
      expect(m!.projectId).toBe(PID);
      expect(m!.totalLlmCalls).toBe(0);
      expect(Object.keys(m!.stages)).toHaveLength(0);
    });

    it('startStage + completeStage tracks duration', () => {
      svc.startPipeline(PID);
      svc.startStage(PID, 'SCRIPT_GENERATION');
      svc.completeStage(PID, 'SCRIPT_GENERATION', 0.85);

      const stage = svc.getMetrics(PID)!.stages['SCRIPT_GENERATION'];
      expect(stage.status).toBe('completed');
      expect(stage.durationMs).toBeGreaterThanOrEqual(0);
      expect(stage.qualityScore).toBe(0.85);
    });

    it('errorStage records error', () => {
      svc.startPipeline(PID);
      svc.startStage(PID, 'TTS');
      svc.errorStage(PID, 'TTS', 'voice not found');

      const stage = svc.getMetrics(PID)!.stages['TTS'];
      expect(stage.status).toBe('error');
      expect(stage.error).toBe('voice not found');
      expect(stage.durationMs).toBeGreaterThanOrEqual(0);
    });

    it('recordLlmCall increments counters', () => {
      svc.startPipeline(PID);
      svc.startStage(PID, 'STORYBOARD');
      svc.recordLlmCall(PID, 'STORYBOARD', 500);
      svc.recordLlmCall(PID, 'STORYBOARD', 300);

      const m = svc.getMetrics(PID)!;
      expect(m.stages['STORYBOARD'].llmCallCount).toBe(2);
      expect(m.stages['STORYBOARD'].estimatedTokens).toBe(800);
      expect(m.totalLlmCalls).toBe(2);
    });

    it('completePipeline calculates duration and quality average', () => {
      svc.startPipeline(PID);
      svc.startStage(PID, 'SCRIPT_GENERATION');
      svc.completeStage(PID, 'SCRIPT_GENERATION', 0.8);
      svc.startStage(PID, 'QA_REVIEW');
      svc.completeStage(PID, 'QA_REVIEW', 0.9);

      const m = svc.completePipeline(PID);
      expect(m).toBeDefined();
      expect(m!.completedAt).toBeDefined();
      expect(m!.totalDurationMs).toBeGreaterThanOrEqual(0);
      expect(m!.overallQualityScore).toBeCloseTo(0.85, 5);
    });

    it('getSummary returns human-readable text', () => {
      svc.startPipeline(PID);
      svc.startStage(PID, 'TTS');
      svc.completeStage(PID, 'TTS');
      svc.completePipeline(PID);

      const text = svc.getSummary(PID);
      expect(text).toContain(PID);
      expect(text).toContain('TTS');
    });

    it('operations on unknown project are no-ops', () => {
      expect(svc.getMetrics('nope')).toBeUndefined();
      // These should not throw
      svc.startStage('nope', 'TTS');
      svc.completeStage('nope', 'TTS');
      svc.errorStage('nope', 'TTS', 'err');
      svc.recordLlmCall('nope', 'TTS');
      expect(svc.completePipeline('nope')).toBeUndefined();
      expect(svc.getSummary('nope')).toBe('No metrics available');
    });
  });

  /* ---- ETA estimation ---- */

  describe('estimateTimeRemaining', () => {
    const stages: PipelineStage[] = ['SCRIPT_GENERATION', 'STORYBOARD', 'TTS'];

    it('returns null when no completed stages', () => {
      svc.startPipeline(PID);
      const result = svc.estimateTimeRemaining(PID, stages, {
        SCRIPT_GENERATION: 'running',
        STORYBOARD: 'pending',
        TTS: 'pending',
      });
      expect(result).toBeNull();
    });

    it('estimates based on completed stage average', () => {
      svc.startPipeline(PID);

      // Simulate a completed stage with known duration
      svc.startStage(PID, 'SCRIPT_GENERATION');
      svc.completeStage(PID, 'SCRIPT_GENERATION');
      // Force a known duration for deterministic test
      svc.getMetrics(PID)!.stages['SCRIPT_GENERATION'].durationMs = 3000;

      const result = svc.estimateTimeRemaining(PID, stages, {
        SCRIPT_GENERATION: 'completed',
        STORYBOARD: 'pending',
        TTS: 'pending',
      });
      expect(result).not.toBeNull();
      // 2 pending × 3000 avg = 6000
      expect(result!.etaMs).toBe(6000);
      expect(result!.completedMs).toBe(3000);
      expect(result!.confidence).toBe('low'); // <3 completed
    });
  });

  /* ---- Persistence ---- */

  describe('persistence', () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = mkdtempSync(join(tmpdir(), 'obs-test-'));
    });

    afterEach(() => {
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('saveTo writes observability.json atomically', () => {
      svc.startPipeline(PID);
      svc.startStage(PID, 'TTS');
      svc.completeStage(PID, 'TTS');

      svc.saveTo(tmpDir, PID);

      const filePath = join(tmpDir, ARTIFACT.OBSERVABILITY);
      expect(existsSync(filePath)).toBe(true);

      const data = JSON.parse(readFileSync(filePath, 'utf-8'));
      expect(data.projectId).toBe(PID);
      expect(data.stages.TTS.status).toBe('completed');
    });

    it('saveTo is a no-op for unknown project', () => {
      svc.saveTo(tmpDir, 'nonexistent');
      expect(existsSync(join(tmpDir, ARTIFACT.OBSERVABILITY))).toBe(false);
    });

    it('saveTo creates parent dirs if needed', () => {
      const nested = join(tmpDir, 'a', 'b');
      svc.startPipeline(PID);
      svc.saveTo(nested, PID);
      expect(existsSync(join(nested, ARTIFACT.OBSERVABILITY))).toBe(true);
    });

    it('loadFrom merges completed stages into current metrics', () => {
      // Simulate a previous run that completed 2 stages
      svc.startPipeline(PID);
      svc.startStage(PID, 'SCRIPT_GENERATION');
      svc.completeStage(PID, 'SCRIPT_GENERATION');
      svc.startStage(PID, 'STORYBOARD');
      svc.completeStage(PID, 'STORYBOARD');
      svc.recordLlmCall(PID, 'STORYBOARD', 100);

      // Force known durations
      svc.getMetrics(PID)!.stages['SCRIPT_GENERATION'].durationMs = 2000;
      svc.getMetrics(PID)!.stages['STORYBOARD'].durationMs = 3000;

      svc.saveTo(tmpDir, PID);

      // New instance simulating a restart
      const svc2 = new ObservabilityService();
      svc2.startPipeline(PID); // fresh metrics
      svc2.loadFrom(tmpDir, PID); // restore completed stages

      const m = svc2.getMetrics(PID)!;
      expect(m.stages['SCRIPT_GENERATION']).toBeDefined();
      expect(m.stages['SCRIPT_GENERATION'].status).toBe('completed');
      expect(m.stages['SCRIPT_GENERATION'].durationMs).toBe(2000);
      expect(m.stages['STORYBOARD'].status).toBe('completed');
      expect(m.totalLlmCalls).toBe(1); // recalculated from merged stages
    });

    it('loadFrom does not overwrite in-memory running stages', () => {
      // Save an old "completed" STORYBOARD
      svc.startPipeline(PID);
      svc.startStage(PID, 'STORYBOARD');
      svc.completeStage(PID, 'STORYBOARD');
      svc.saveTo(tmpDir, PID);

      // New instance where STORYBOARD is currently running (retry)
      const svc2 = new ObservabilityService();
      svc2.startPipeline(PID);
      svc2.startStage(PID, 'STORYBOARD'); // currently running
      svc2.loadFrom(tmpDir, PID);

      // The running stage should NOT be replaced
      expect(svc2.getMetrics(PID)!.stages['STORYBOARD'].status).toBe('running');
    });

    it('loadFrom skips error stages from saved state', () => {
      svc.startPipeline(PID);
      svc.startStage(PID, 'VIDEO_GEN');
      svc.errorStage(PID, 'VIDEO_GEN', 'timeout');
      svc.saveTo(tmpDir, PID);

      const svc2 = new ObservabilityService();
      svc2.startPipeline(PID);
      svc2.loadFrom(tmpDir, PID);

      // Error stages should not be merged (they need to be retried)
      expect(svc2.getMetrics(PID)!.stages['VIDEO_GEN']).toBeUndefined();
    });

    it('loadFrom ignores missing file', () => {
      svc.startPipeline(PID);
      svc.loadFrom(tmpDir, PID); // no file exists
      // Should not throw; metrics should be untouched
      expect(svc.getMetrics(PID)!.stages).toEqual({});
    });

    it('loadFrom ignores corrupt file', () => {
      writeFileSync(join(tmpDir, ARTIFACT.OBSERVABILITY), '{{not json');

      svc.startPipeline(PID);
      svc.loadFrom(tmpDir, PID);
      expect(svc.getMetrics(PID)!.stages).toEqual({});
    });

    it('loadFrom is a no-op if startPipeline not called', () => {
      // Save valid data
      svc.startPipeline(PID);
      svc.startStage(PID, 'TTS');
      svc.completeStage(PID, 'TTS');
      svc.saveTo(tmpDir, PID);

      const svc2 = new ObservabilityService();
      // loadFrom without startPipeline — should not throw
      svc2.loadFrom(tmpDir, PID);
      expect(svc2.getMetrics(PID)).toBeUndefined();
    });
  });
});
