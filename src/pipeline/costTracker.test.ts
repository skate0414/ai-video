import { describe, it, expect, beforeEach } from 'vitest';
import { CostTracker, BudgetExceededError } from './costTracker.js';
import { mkdtempSync, rmSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ARTIFACT } from '../constants.js';

describe('CostTracker', () => {
  let dataDir: string;
  let tracker: CostTracker;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'cost-tracker-test-'));
    tracker = new CostTracker(dataDir);
  });

  it('creates audit directory on init', () => {
    expect(existsSync(join(dataDir, 'cost-audit'))).toBe(true);
  });

  it('records a cost entry and persists it', () => {
    const entry = tracker.record({
      projectId: 'proj_1',
      stage: 'SCRIPT_GENERATION',
      taskType: 'script_generation',
      adapter: 'api',
      provider: 'gemini',
      method: 'generateText',
      model: 'gemini-pro',
      isFallback: false,
      durationMs: 1500,
      estimatedTokens: 1000,
    });

    expect(entry.id).toBeTruthy();
    expect(entry.estimatedCostUsd).toBeGreaterThan(0);
    expect(entry.adapter).toBe('api');
    expect(entry.isFallback).toBe(false);

    // Verify persistence (JSONL format: one JSON per line)
    const globalPath = join(dataDir, 'cost-audit', ARTIFACT.GLOBAL_AUDIT);
    expect(existsSync(globalPath)).toBe(true);
    const lines = readFileSync(globalPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    const persisted = JSON.parse(lines[0]);
    expect(persisted.id).toBe(entry.id);
  });

  it('records free-tier calls with zero cost', () => {
    const entry = tracker.record({
      projectId: 'proj_1',
      stage: 'RESEARCH',
      taskType: 'fact_research',
      adapter: 'chat',
      provider: 'gemini',
      method: 'generateText',
      isFallback: false,
      durationMs: 5000,
    });

    expect(entry.estimatedCostUsd).toBe(0);
  });

  it('records fallback calls with cost', () => {
    const entry = tracker.record({
      projectId: 'proj_1',
      stage: 'KEYFRAME_GEN',
      taskType: 'image_generation',
      adapter: 'api',
      provider: 'gemini',
      method: 'generateImage',
      isFallback: true,
      durationMs: 3000,
    });

    expect(entry.isFallback).toBe(true);
    expect(entry.estimatedCostUsd).toBeGreaterThan(0);
  });

  it('getProjectSummary aggregates correctly', () => {
    tracker.record({
      projectId: 'proj_1',
      stage: 'SCRIPT_GENERATION',
      taskType: 'script_generation',
      adapter: 'api',
      provider: 'gemini',
      method: 'generateText',
      isFallback: false,
      durationMs: 1000,
    });
    tracker.record({
      projectId: 'proj_1',
      stage: 'VIDEO_GEN',
      taskType: 'video_generation',
      adapter: 'api',
      provider: 'gemini',
      method: 'generateVideo',
      isFallback: true,
      durationMs: 5000,
    });
    tracker.record({
      projectId: 'proj_2',
      stage: 'RESEARCH',
      taskType: 'fact_research',
      adapter: 'chat',
      provider: 'gemini',
      method: 'generateText',
      isFallback: false,
      durationMs: 2000,
    });

    const summary = tracker.getProjectSummary('proj_1');
    expect(summary.totalCalls).toBe(2);
    expect(summary.totalFallbackCalls).toBe(1);
    expect(summary.totalCostUsd).toBeGreaterThan(0);
    expect(summary.byStage['SCRIPT_GENERATION']).toBeDefined();
    expect(summary.byStage['VIDEO_GEN']).toBeDefined();
    expect(summary.byMethod['generateText']).toBeDefined();
    expect(summary.byMethod['generateVideo']).toBeDefined();
    expect(summary.entries).toHaveLength(2);
  });

  it('getGlobalSummary covers all projects', () => {
    tracker.record({
      projectId: 'proj_1',
      stage: 'SCRIPT_GENERATION',
      taskType: 'script_generation',
      adapter: 'api',
      provider: 'gemini',
      method: 'generateText',
      isFallback: false,
      durationMs: 1000,
    });
    tracker.record({
      projectId: 'proj_2',
      stage: 'VIDEO_GEN',
      taskType: 'video_generation',
      adapter: 'api',
      provider: 'gemini',
      method: 'generateVideo',
      isFallback: true,
      durationMs: 5000,
    });

    const global = tracker.getGlobalSummary();
    expect(global.totalCalls).toBe(2);
    expect(global.totalFallbackCalls).toBe(1);
    expect(Object.keys(global.byProject)).toHaveLength(2);
    expect(Object.keys(global.dailyTotals)).toHaveLength(1); // same day
  });

  it('estimateFallbackCost returns cost for API methods', () => {
    expect(tracker.estimateFallbackCost('generateVideo')).toBeGreaterThan(0);
    expect(tracker.estimateFallbackCost('generateText')).toBeGreaterThan(0);
    expect(tracker.estimateFallbackCost('uploadFile')).toBe(0);
  });

  it('persists per-project audit file', () => {
    tracker.record({
      projectId: 'proj_42',
      stage: 'TTS',
      taskType: 'tts',
      adapter: 'chat',
      provider: 'edge-tts',
      method: 'generateSpeech',
      isFallback: false,
      durationMs: 800,
    });

    const projectPath = join(dataDir, 'cost-audit', 'proj_42.json');
    expect(existsSync(projectPath)).toBe(true);
    const lines = readFileSync(projectPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(1);
    expect(JSON.parse(lines[0]).projectId).toBe('proj_42');
  });

  it('survives reload from persisted data', () => {
    tracker.record({
      projectId: 'proj_1',
      stage: 'RESEARCH',
      taskType: 'fact_research',
      adapter: 'api',
      provider: 'gemini',
      method: 'generateText',
      isFallback: false,
      durationMs: 1000,
    });

    // Create a new tracker from the same data dir
    const tracker2 = new CostTracker(dataDir);
    const summary = tracker2.getGlobalSummary();
    expect(summary.totalCalls).toBe(1);
  });

  it('records actualTokens from API response', () => {
    const entry = tracker.record({
      projectId: 'proj_1',
      stage: 'SCRIPT_GENERATION',
      taskType: 'script_generation',
      adapter: 'api',
      provider: 'gemini',
      method: 'generateText',
      isFallback: false,
      durationMs: 1500,
      actualTokens: { prompt: 120, completion: 450, total: 570 },
    });

    expect(entry.actualTokens).toEqual({ prompt: 120, completion: 450, total: 570 });

    // Verify persisted to JSONL
    const globalPath = join(dataDir, 'cost-audit', ARTIFACT.GLOBAL_AUDIT);
    const persisted = JSON.parse(readFileSync(globalPath, 'utf-8').trim());
    expect(persisted.actualTokens.total).toBe(570);
  });

  it('appends multiple entries (JSONL: one line per record)', () => {
    tracker.record({
      projectId: 'proj_1',
      stage: 'RESEARCH',
      taskType: 'research',
      adapter: 'api',
      provider: 'gemini',
      method: 'generateText',
      isFallback: false,
      durationMs: 500,
    });
    tracker.record({
      projectId: 'proj_1',
      stage: 'STORYBOARD',
      taskType: 'storyboard',
      adapter: 'api',
      provider: 'gemini',
      method: 'generateText',
      isFallback: false,
      durationMs: 800,
    });

    const globalPath = join(dataDir, 'cost-audit', ARTIFACT.GLOBAL_AUDIT);
    const lines = readFileSync(globalPath, 'utf-8').trim().split('\n');
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).stage).toBe('RESEARCH');
    expect(JSON.parse(lines[1]).stage).toBe('STORYBOARD');
  });

  it('loads legacy JSON array format on startup', () => {
    const { mkdirSync } = require('node:fs');
    // Write a legacy JSON array file
    const legacyDir = mkdtempSync(join(tmpdir(), 'cost-legacy-'));
    const auditDir = join(legacyDir, 'cost-audit');
    mkdirSync(auditDir, { recursive: true });

    const legacyEntry = {
      id: 'cost_legacy_1',
      timestamp: '2026-01-01T00:00:00.000Z',
      projectId: 'proj_old',
      stage: 'TTS',
      taskType: 'tts',
      adapter: 'api',
      provider: 'gemini',
      method: 'generateSpeech',
      isFallback: false,
      estimatedCostUsd: 0.005,
      durationMs: 1000,
    };
    writeFileSync(
      join(auditDir, ARTIFACT.GLOBAL_AUDIT),
      JSON.stringify([legacyEntry], null, 2),
    );

    const legacyTracker = new CostTracker(legacyDir);
    const summary = legacyTracker.getGlobalSummary();
    expect(summary.totalCalls).toBe(1);
    expect(summary.totalCostUsd).toBe(0.005);

    rmSync(legacyDir, { recursive: true, force: true });
  });

  describe('budget gate', () => {
    it('checkBudget returns withinBudget=true when no budget set', () => {
      const result = tracker.checkBudget('proj_1');
      expect(result.withinBudget).toBe(true);
      expect(result.remainingUsd).toBe(Infinity);
    });

    it('checkBudget enforces global budget', () => {
      tracker.setGlobalBudget(0.05);
      tracker.record({
        projectId: 'proj_1',
        stage: 'VIDEO_GEN',
        taskType: 'video',
        adapter: 'api',
        provider: 'gemini',
        method: 'generateVideo',
        isFallback: true,
        durationMs: 5000,
      });
      // generateVideo costs $0.10, exceeds $0.05 budget
      const result = tracker.checkBudget('proj_1');
      expect(result.withinBudget).toBe(false);
      expect(result.remainingUsd).toBe(0);
    });

    it('checkBudget enforces per-project budget', () => {
      tracker.setProjectBudget('proj_1', 0.01);
      tracker.record({
        projectId: 'proj_1',
        stage: 'KEYFRAME_GEN',
        taskType: 'image',
        adapter: 'api',
        provider: 'gemini',
        method: 'generateImage',
        isFallback: true,
        durationMs: 3000,
      });
      // generateImage costs $0.02, exceeds $0.01 budget
      const result = tracker.checkBudget('proj_1');
      expect(result.withinBudget).toBe(false);
    });

    it('per-project budget takes priority over global budget', () => {
      tracker.setGlobalBudget(10);
      tracker.setProjectBudget('proj_1', 0.001);
      tracker.record({
        projectId: 'proj_1',
        stage: 'SCRIPT_GENERATION',
        taskType: 'script',
        adapter: 'api',
        provider: 'gemini',
        method: 'generateText',
        isFallback: false,
        durationMs: 1000,
      });
      // generateText costs $0.002, exceeds $0.001 project budget
      const result = tracker.checkBudget('proj_1');
      expect(result.withinBudget).toBe(false);
    });

    it('assertBudget throws BudgetExceededError when over budget', () => {
      tracker.setGlobalBudget(0.001);
      tracker.record({
        projectId: 'proj_1',
        stage: 'SCRIPT_GENERATION',
        taskType: 'script',
        adapter: 'api',
        provider: 'gemini',
        method: 'generateText',
        isFallback: false,
        durationMs: 1000,
      });
      expect(() => tracker.assertBudget('proj_1')).toThrow(BudgetExceededError);
    });

    it('assertBudget does not throw when within budget', () => {
      tracker.setGlobalBudget(100);
      tracker.record({
        projectId: 'proj_1',
        stage: 'SCRIPT_GENERATION',
        taskType: 'script',
        adapter: 'api',
        provider: 'gemini',
        method: 'generateText',
        isFallback: false,
        durationMs: 1000,
      });
      expect(() => tracker.assertBudget('proj_1')).not.toThrow();
    });

    it('setProjectBudget(null) removes per-project cap', () => {
      tracker.setProjectBudget('proj_1', 0.001);
      tracker.setProjectBudget('proj_1', null);
      tracker.record({
        projectId: 'proj_1',
        stage: 'VIDEO_GEN',
        taskType: 'video',
        adapter: 'api',
        provider: 'gemini',
        method: 'generateVideo',
        isFallback: true,
        durationMs: 5000,
      });
      // No budget → always within
      const result = tracker.checkBudget('proj_1');
      expect(result.withinBudget).toBe(true);
    });

    it('setGlobalBudget(null) disables global cap', () => {
      tracker.setGlobalBudget(0.001);
      tracker.setGlobalBudget(null);
      tracker.record({
        projectId: 'proj_1',
        stage: 'VIDEO_GEN',
        taskType: 'video',
        adapter: 'api',
        provider: 'gemini',
        method: 'generateVideo',
        isFallback: true,
        durationMs: 5000,
      });
      const result = tracker.checkBudget('proj_1');
      expect(result.withinBudget).toBe(true);
    });
  });
});
