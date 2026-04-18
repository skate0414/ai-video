/* ------------------------------------------------------------------ */
/*  FallbackAdapter – backend failover with cost-safety controls      */
/*  On quota / rate-limit errors the compilation task is retried      */
/*  against the fallback backend (free → paid).                      */
/*                                                                    */
/*  fallbackPolicy controls cost safety:                              */
/*    'auto'    – silent failover (legacy behaviour)                  */
/*    'confirm' – emit event & wait for user approval before billing  */
/*    'block'   – never fall back to paid backend                     */
/* ------------------------------------------------------------------ */

import type { AIAdapter, AIRequestOptions, GenerationResult } from '../pipeline/types.js';
import { quotaBus, type QuotaCapability } from '../quotaBus.js';
import type { BudgetCheckResult } from '../pipeline/costTracker.js';

export type FallbackPolicy = 'auto' | 'confirm' | 'block';

export interface FallbackEvent {
  type: 'fallback_triggered';
  primaryProvider: string;
  fallbackProvider: string;
  method: string;
  estimatedCostUsd: number;
  reason: string;
}

export type FallbackEventListener = (event: FallbackEvent) => void;

/** Callback invoked when policy='confirm'. Must resolve true to proceed. */
export type FallbackConfirmFn = (event: FallbackEvent) => Promise<boolean>;

/**
 * Optional budget checker function. When provided, the adapter calls it
 * before executing a fallback. If `withinBudget` is false, the fallback
 * is blocked with a FallbackBlockedError.
 */
export type BudgetCheckerFn = () => BudgetCheckResult;

function isQuotaError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as any;
    if (e.isQuotaError) return true;
    if (e.status === 429 || e.status === 503) return true;
    const msg = (e.message ?? '').toLowerCase();
    if (/quota|rate limit|resource_exhausted|usage cap|free plan limit|too many requests|you've reached|请求过于频繁|已达到.*使用上限/.test(msg)) {
      return true;
    }
  }
  return false;
}

/** Map adapter method names to QuotaBus capability types. */
function methodToCapability(method: string): QuotaCapability {
  if (method === 'generateImage') return 'image';
  if (method === 'generateVideo') return 'video';
  return 'text';
}

/** Rough per-method cost estimates for the paid API fallback. */
const FALLBACK_COST: Record<string, number> = {
  generateText: 0.002,
  generateImage: 0.02,
  generateVideo: 0.10,
  generateSpeech: 0.005,
  uploadFile: 0,
};

export interface ProviderAttempt {
  provider: string;
  method: string;
  status: 'success' | 'quota_error' | 'error';
  error?: string;
  timestamp: string;
}

export class FallbackAdapter implements AIAdapter {
  provider: string;
  /** Tracks how many times this adapter fell back to paid API. */
  fallbackCount = 0;
  /** Tracks cumulative estimated cost of fallback calls. */
  fallbackCostUsd = 0;
  /** Ordered log of provider attempts for auditability. */
  readonly attemptedProviders: ProviderAttempt[] = [];

  private policy: FallbackPolicy;
  private onFallback?: FallbackEventListener;
  private confirmFn?: FallbackConfirmFn;
  private budgetChecker?: BudgetCheckerFn;

  constructor(
    private primary: AIAdapter,
    private fallback: AIAdapter,
    options?: {
      policy?: FallbackPolicy;
      onFallback?: FallbackEventListener;
      confirmFn?: FallbackConfirmFn;
      budgetChecker?: BudgetCheckerFn;
    },
  ) {
    this.provider = `fallback(${primary.provider}→${fallback.provider})`;
    this.policy = options?.policy ?? 'auto';
    this.onFallback = options?.onFallback;
    this.confirmFn = options?.confirmFn;
    this.budgetChecker = options?.budgetChecker;
  }

  private async handleFallback<T>(
    method: string,
    fallbackCall: () => Promise<T>,
    errMsg: string,
  ): Promise<T> {
    const event: FallbackEvent = {
      type: 'fallback_triggered',
      primaryProvider: this.primary.provider,
      fallbackProvider: this.fallback.provider,
      method,
      estimatedCostUsd: FALLBACK_COST[method] ?? 0,
      reason: errMsg,
    };

    // Notify listeners regardless of policy
    this.onFallback?.(event);

    if (this.policy === 'block') {
      throw new FallbackBlockedError(
        `Fallback to paid API (${this.fallback.provider}) blocked by policy. ` +
        `Free provider ${this.primary.provider} error: ${errMsg}`
      );
    }

    if (this.policy === 'confirm' && this.confirmFn) {
      const approved = await this.confirmFn(event);
      if (!approved) {
        throw new FallbackBlockedError(
          `User declined fallback to paid API (${this.fallback.provider}). ` +
          `Estimated cost: $${event.estimatedCostUsd.toFixed(4)}`
        );
      }
    }

    // Budget gate: block fallback if remaining budget is insufficient
    if (this.budgetChecker) {
      const budget = this.budgetChecker();
      if (!budget.withinBudget || budget.remainingUsd < event.estimatedCostUsd) {
        throw new FallbackBlockedError(
          `Budget exhausted — cannot fall back to paid API (${this.fallback.provider}). ` +
          `Remaining: $${budget.remainingUsd.toFixed(4)}, needed: $${event.estimatedCostUsd.toFixed(4)}`
        );
      }
    }

    console.log(
      `[FallbackAdapter] ${method} quota error on ${this.primary.provider} (${errMsg}), ` +
      `falling back to ${this.fallback.provider} (policy=${this.policy}, est. $${event.estimatedCostUsd.toFixed(4)})`
    );

    const result = await fallbackCall();
    this.fallbackCount++;
    this.fallbackCostUsd += event.estimatedCostUsd;

    // Notify QuotaBus so other subsystems know about the exhaustion
    quotaBus.emit({
      provider: this.primary.provider,
      capability: methodToCapability(method),
      exhausted: true,
      reason: `Fallback triggered: ${errMsg}`,
    });

    return result;
  }

  async generateText(
    model: string,
    prompt: string | any[],
    options?: AIRequestOptions,
  ): Promise<GenerationResult> {
    try {
      const result = await this.primary.generateText(model, prompt, options);
      this.attemptedProviders.push({ provider: this.primary.provider, method: 'generateText', status: 'success', timestamp: new Date().toISOString() });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isQuotaError(err)) {
        this.attemptedProviders.push({ provider: this.primary.provider, method: 'generateText', status: 'quota_error', error: msg, timestamp: new Date().toISOString() });
        const result = await this.handleFallback(
          'generateText',
          () => this.fallback.generateText(model, prompt, options),
          msg,
        );
        this.attemptedProviders.push({ provider: this.fallback.provider, method: 'generateText', status: 'success', timestamp: new Date().toISOString() });
        return result;
      }
      this.attemptedProviders.push({ provider: this.primary.provider, method: 'generateText', status: 'error', error: msg, timestamp: new Date().toISOString() });
      throw err;
    }
  }

  async generateImage(
    model: string,
    prompt: string,
    aspectRatio?: string,
    negativePrompt?: string,
    options?: AIRequestOptions,
  ): Promise<GenerationResult> {
    try {
      const result = await this.primary.generateImage(model, prompt, aspectRatio, negativePrompt, options);
      this.attemptedProviders.push({ provider: this.primary.provider, method: 'generateImage', status: 'success', timestamp: new Date().toISOString() });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isQuotaError(err)) {
        this.attemptedProviders.push({ provider: this.primary.provider, method: 'generateImage', status: 'quota_error', error: msg, timestamp: new Date().toISOString() });
        const result = await this.handleFallback(
          'generateImage',
          () => this.fallback.generateImage(model, prompt, aspectRatio, negativePrompt, options),
          msg,
        );
        this.attemptedProviders.push({ provider: this.fallback.provider, method: 'generateImage', status: 'success', timestamp: new Date().toISOString() });
        return result;
      }
      this.attemptedProviders.push({ provider: this.primary.provider, method: 'generateImage', status: 'error', error: msg, timestamp: new Date().toISOString() });
      throw err;
    }
  }

  async generateVideo(
    model: string,
    prompt: string,
    options?: { aspectRatio?: string; image?: string; duration?: number; fps?: number; resolution?: '720p' | '1080p' } & AIRequestOptions,
  ): Promise<GenerationResult> {
    try {
      const result = await this.primary.generateVideo(model, prompt, options);
      this.attemptedProviders.push({ provider: this.primary.provider, method: 'generateVideo', status: 'success', timestamp: new Date().toISOString() });
      return result;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (isQuotaError(err)) {
        this.attemptedProviders.push({ provider: this.primary.provider, method: 'generateVideo', status: 'quota_error', error: msg, timestamp: new Date().toISOString() });
        const result = await this.handleFallback(
          'generateVideo',
          () => this.fallback.generateVideo(model, prompt, options),
          msg,
        );
        this.attemptedProviders.push({ provider: this.fallback.provider, method: 'generateVideo', status: 'success', timestamp: new Date().toISOString() });
        return result;
      }
      this.attemptedProviders.push({ provider: this.primary.provider, method: 'generateVideo', status: 'error', error: msg, timestamp: new Date().toISOString() });
      throw err;
    }
  }

  async uploadFile(file: { name: string; path: string; mimeType: string }): Promise<{ uri: string; mimeType: string }> {
    if (this.primary.uploadFile) {
      try {
        const result = await this.primary.uploadFile(file);
        this.attemptedProviders.push({ provider: this.primary.provider, method: 'uploadFile', status: 'success', timestamp: new Date().toISOString() });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isQuotaError(err) && this.fallback.uploadFile) {
          this.attemptedProviders.push({ provider: this.primary.provider, method: 'uploadFile', status: 'quota_error', error: msg, timestamp: new Date().toISOString() });
          const result = await this.handleFallback(
            'uploadFile',
            () => this.fallback.uploadFile!(file),
            msg,
          );
          this.attemptedProviders.push({ provider: this.fallback.provider, method: 'uploadFile', status: 'success', timestamp: new Date().toISOString() });
          return result;
        }
        this.attemptedProviders.push({ provider: this.primary.provider, method: 'uploadFile', status: 'error', error: msg, timestamp: new Date().toISOString() });
        throw err;
      }
    }
    if (this.fallback.uploadFile) return this.fallback.uploadFile(file);
    throw new Error('Neither primary nor fallback adapter supports uploadFile');
  }

  async generateSpeech(
    text: string,
    voice?: string,
    options?: AIRequestOptions,
  ): Promise<GenerationResult> {
    if (this.primary.generateSpeech) {
      try {
        const result = await this.primary.generateSpeech(text, voice, options);
        this.attemptedProviders.push({ provider: this.primary.provider, method: 'generateSpeech', status: 'success', timestamp: new Date().toISOString() });
        return result;
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        if (isQuotaError(err) && this.fallback.generateSpeech) {
          this.attemptedProviders.push({ provider: this.primary.provider, method: 'generateSpeech', status: 'quota_error', error: msg, timestamp: new Date().toISOString() });
          const result = await this.handleFallback(
            'generateSpeech',
            () => this.fallback.generateSpeech!(text, voice, options),
            msg,
          );
          this.attemptedProviders.push({ provider: this.fallback.provider, method: 'generateSpeech', status: 'success', timestamp: new Date().toISOString() });
          return result;
        }
        this.attemptedProviders.push({ provider: this.primary.provider, method: 'generateSpeech', status: 'error', error: msg, timestamp: new Date().toISOString() });
        throw err;
      }
    }
    if (this.fallback.generateSpeech) return this.fallback.generateSpeech(text, voice, options);
    throw new Error('Neither primary nor fallback adapter supports generateSpeech');
  }
}

/**
 * Error thrown when fallback to paid API is blocked by policy or user denial.
 */
export class FallbackBlockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'FallbackBlockedError';
  }
}
