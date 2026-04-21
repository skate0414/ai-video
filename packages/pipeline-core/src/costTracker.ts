/* ------------------------------------------------------------------ */
/*  CostTracker – compilation resource accounting                     */
/*  Records per-pass and per-backend cost for each compilation run.   */
/*  Persists to data/cost-audit.json for billing transparency.        */
/* ------------------------------------------------------------------ */

import { existsSync, readFileSync, appendFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { ARTIFACT } from './constants.js';

/* ---- Cost entry for a single API call ---- */

export interface CostEntry {
  id: string;
  timestamp: string;
  projectId: string;
  stage: string;
  taskType: string;
  /** Which adapter actually served the request */
  adapter: 'chat' | 'api';
  provider: string;
  method: 'generateText' | 'generateImage' | 'generateVideo' | 'generateSpeech' | 'uploadFile';
  model?: string;
  /** Whether this was a fallback from free → paid */
  isFallback: boolean;
  /** Estimated cost in USD (0 for free-tier calls) */
  estimatedCostUsd: number;
  /** Duration of the call in ms */
  durationMs: number;
  /** Estimated input + output tokens (text calls) */
  estimatedTokens?: number;
  /** Actual token counts from API response (when available) */
  actualTokens?: { prompt?: number; completion?: number; total?: number };
}

/* ---- Per-project cost summary ---- */

export interface ProjectCostSummary {
  projectId: string;
  totalCostUsd: number;
  totalCalls: number;
  totalFallbackCalls: number;
  byStage: Record<string, { costUsd: number; calls: number }>;
  byMethod: Record<string, { costUsd: number; calls: number }>;
  entries: CostEntry[];
}

/* ---- Global cost summary ---- */

export interface GlobalCostSummary {
  totalCostUsd: number;
  totalCalls: number;
  totalFallbackCalls: number;
  byProject: Record<string, { costUsd: number; calls: number }>;
  dailyTotals: Record<string, { costUsd: number; calls: number }>;
}

/* ---- Rough cost estimates per model/method ---- */

const COST_TABLE: Record<string, number> = {
  // Gemini API text (per call estimate, rough)
  'api:generateText': 0.002,
  // Gemini API image generation
  'api:generateImage': 0.02,
  // Veo video generation
  'api:generateVideo': 0.10,
  // Gemini TTS
  'api:generateSpeech': 0.005,
  // Free tier calls
  'chat:generateText': 0,
  'chat:generateImage': 0,
  'chat:generateVideo': 0,
  'chat:generateSpeech': 0,
  'chat:uploadFile': 0,
  'api:uploadFile': 0,
};

function estimateCost(adapter: 'chat' | 'api', method: string): number {
  return COST_TABLE[`${adapter}:${method}`] ?? 0;
}

/** Append a single JSONL line to a file. */
function appendEntryJSONL(filePath: string, entry: CostEntry): void {
  const dir = dirname(filePath);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  appendFileSync(filePath, JSON.stringify(entry) + '\n');
}

/**
 * Parse a cost-audit file. Supports both legacy JSON array format
 * and new JSONL format (one JSON object per line) for backward compat.
 */
function loadEntries(filePath: string): CostEntry[] {
  if (!existsSync(filePath)) return [];
  try {
    const raw = readFileSync(filePath, 'utf-8').trim();
    if (!raw) return [];
    // Legacy format: JSON array
    if (raw.startsWith('[')) {
      return JSON.parse(raw);
    }
    // JSONL format: one JSON object per line
    return raw.split('\n')
      .filter(line => line.trim())
      .map(line => JSON.parse(line));
  } catch {
    return [];
  }
}

/**
 * Error thrown when a project or global budget cap is exceeded.
 */
export class BudgetExceededError extends Error {
  constructor(
    public readonly projectId: string,
    public readonly currentCostUsd: number,
    public readonly maxBudgetUsd: number,
  ) {
    super(
      `Budget exceeded for project ${projectId}: ` +
      `$${currentCostUsd.toFixed(4)} spent of $${maxBudgetUsd.toFixed(2)} limit`,
    );
    this.name = 'BudgetExceededError';
  }
}

export interface BudgetCheckResult {
  withinBudget: boolean;
  currentCostUsd: number;
  maxBudgetUsd: number;
  remainingUsd: number;
}

/**
 * CostTracker maintains an append-only audit log of all AI API calls
 * with cost estimates. Persists per-project and globally.
 *
 * When `maxBudgetUsd` is set, `checkBudget()` can be called before
 * expensive operations to prevent cost overruns.
 */
export class CostTracker {
  private readonly auditDir: string;
  private entries: CostEntry[] = [];
  private maxBudgetUsd: number | null = null;
  private projectBudgets = new Map<string, number>();

  constructor(dataDir: string) {
    this.auditDir = join(dataDir, 'cost-audit');
    if (!existsSync(this.auditDir)) mkdirSync(this.auditDir, { recursive: true });
    this.loadGlobal();
  }

  /**
   * Set the global budget cap (USD). Applies to all projects combined.
   * Pass null to disable the global budget cap.
   */
  setGlobalBudget(maxUsd: number | null): void {
    this.maxBudgetUsd = maxUsd;
  }

  /**
   * Set a per-project budget cap (USD).
   * Pass null to remove the per-project cap.
   */
  setProjectBudget(projectId: string, maxUsd: number | null): void {
    if (maxUsd === null) {
      this.projectBudgets.delete(projectId);
    } else {
      this.projectBudgets.set(projectId, maxUsd);
    }
  }

  /**
   * Check whether a project is within budget. Returns remaining budget info.
   * If no budget is configured, always returns withinBudget=true with Infinity remaining.
   */
  checkBudget(projectId: string): BudgetCheckResult {
    const projectCost = this.entries
      .filter(e => e.projectId === projectId)
      .reduce((s, e) => s + e.estimatedCostUsd, 0);

    // Check per-project budget first
    const projectBudget = this.projectBudgets.get(projectId);
    if (projectBudget !== undefined) {
      return {
        withinBudget: projectCost < projectBudget,
        currentCostUsd: projectCost,
        maxBudgetUsd: projectBudget,
        remainingUsd: Math.max(0, projectBudget - projectCost),
      };
    }

    // Fall back to global budget
    if (this.maxBudgetUsd !== null) {
      const totalCost = this.entries.reduce((s, e) => s + e.estimatedCostUsd, 0);
      return {
        withinBudget: totalCost < this.maxBudgetUsd,
        currentCostUsd: totalCost,
        maxBudgetUsd: this.maxBudgetUsd,
        remainingUsd: Math.max(0, this.maxBudgetUsd - totalCost),
      };
    }

    // No budget configured
    return {
      withinBudget: true,
      currentCostUsd: projectCost,
      maxBudgetUsd: Infinity,
      remainingUsd: Infinity,
    };
  }

  /**
   * Assert that the project is within budget. Throws BudgetExceededError if not.
   */
  assertBudget(projectId: string): void {
    const result = this.checkBudget(projectId);
    if (!result.withinBudget) {
      throw new BudgetExceededError(projectId, result.currentCostUsd, result.maxBudgetUsd);
    }
  }

  private globalPath(): string {
    return join(this.auditDir, ARTIFACT.GLOBAL_AUDIT);
  }

  private projectPath(projectId: string): string {
    return join(this.auditDir, `${projectId}.json`);
  }

  private loadGlobal(): void {
    this.entries = loadEntries(this.globalPath());
  }

  private appendEntry(entry: CostEntry): void {
    appendEntryJSONL(this.globalPath(), entry);
    appendEntryJSONL(this.projectPath(entry.projectId), entry);
  }

  /**
   * Record an API call cost entry.
   */
  record(params: {
    projectId: string;
    stage: string;
    taskType: string;
    adapter: 'chat' | 'api';
    provider: string;
    method: CostEntry['method'];
    model?: string;
    isFallback: boolean;
    durationMs: number;
    estimatedTokens?: number;
    actualTokens?: { prompt?: number; completion?: number; total?: number };
  }): CostEntry {
    const entry: CostEntry = {
      id: `cost_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString(),
      projectId: params.projectId,
      stage: params.stage,
      taskType: params.taskType,
      adapter: params.adapter,
      provider: params.provider,
      method: params.method,
      model: params.model,
      isFallback: params.isFallback,
      estimatedCostUsd: estimateCost(params.adapter, params.method),
      durationMs: params.durationMs,
      estimatedTokens: params.estimatedTokens,
      actualTokens: params.actualTokens,
    };

    this.entries.push(entry);
    this.appendEntry(entry);

    if (entry.estimatedCostUsd > 0) {
      const tokenInfo = entry.actualTokens?.total
        ? ` [${entry.actualTokens.total} tokens]`
        : '';
      console.log(
        `[CostTracker] 💰 ${entry.method} via ${entry.adapter}/${entry.provider}` +
        ` — $${entry.estimatedCostUsd.toFixed(4)}${tokenInfo}` +
        (entry.isFallback ? ' (FALLBACK from free)' : '') +
        ` [${entry.stage}/${entry.taskType}]`
      );
    }

    return entry;
  }

  /**
   * Get cost summary for a specific project.
   */
  getProjectSummary(projectId: string): ProjectCostSummary {
    const projectEntries = this.entries.filter(e => e.projectId === projectId);

    const byStage: Record<string, { costUsd: number; calls: number }> = {};
    const byMethod: Record<string, { costUsd: number; calls: number }> = {};

    for (const e of projectEntries) {
      const stageBucket = (byStage[e.stage] ??= { costUsd: 0, calls: 0 });
      stageBucket.costUsd += e.estimatedCostUsd;
      stageBucket.calls++;

      const methodBucket = (byMethod[e.method] ??= { costUsd: 0, calls: 0 });
      methodBucket.costUsd += e.estimatedCostUsd;
      methodBucket.calls++;
    }

    return {
      projectId,
      totalCostUsd: projectEntries.reduce((s, e) => s + e.estimatedCostUsd, 0),
      totalCalls: projectEntries.length,
      totalFallbackCalls: projectEntries.filter(e => e.isFallback).length,
      byStage,
      byMethod,
      entries: projectEntries,
    };
  }

  /**
   * Get global cost summary across all projects.
   */
  getGlobalSummary(): GlobalCostSummary {
    const byProject: Record<string, { costUsd: number; calls: number }> = {};
    const dailyTotals: Record<string, { costUsd: number; calls: number }> = {};

    for (const e of this.entries) {
      const projectBucket = (byProject[e.projectId] ??= { costUsd: 0, calls: 0 });
      projectBucket.costUsd += e.estimatedCostUsd;
      projectBucket.calls++;

      const day = e.timestamp.slice(0, 10); // YYYY-MM-DD
      const dayBucket = (dailyTotals[day] ??= { costUsd: 0, calls: 0 });
      dayBucket.costUsd += e.estimatedCostUsd;
      dayBucket.calls++;
    }

    return {
      totalCostUsd: this.entries.reduce((s, e) => s + e.estimatedCostUsd, 0),
      totalCalls: this.entries.length,
      totalFallbackCalls: this.entries.filter(e => e.isFallback).length,
      byProject,
      dailyTotals,
    };
  }

  /**
   * Get the cost estimate for a potential fallback operation.
   */
  estimateFallbackCost(method: CostEntry['method']): number {
    return estimateCost('api', method);
  }
}
