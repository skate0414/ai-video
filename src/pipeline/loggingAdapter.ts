/* ------------------------------------------------------------------ */
/*  LoggingAdapterWrapper – records every backend call I/O            */
/*  Full prompt→response pairs for compilation audit trail.          */
/* ------------------------------------------------------------------ */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AIAdapter, AIRequestOptions, GenerationResult } from './types.js';
import type { CostTracker, CostEntry } from './costTracker.js';
import { createLogger } from '../lib/logger.js';
import type { TraceWriter } from './trace/traceWriter.js';
import type { TraceContext } from './trace/traceEvents.js';
import { classifyError, makeTraceEvent, createChildContext } from './trace/traceContext.js';

const log = createLogger('LoggingAdapter');

let callSeq = 0;

function nextSeq(): string {
  return String(++callSeq).padStart(4, '0');
}

function safeFilename(s: string): string {
  return s.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 60);
}

function truncatePrompt(prompt: string | any[], maxLen = 2000): string | any[] {
  if (typeof prompt === 'string') {
    return prompt.length > maxLen ? prompt.slice(0, maxLen) + '...[truncated]' : prompt;
  }
  // For multimodal array prompts, truncate large text parts
  return (prompt as any[]).map(p => {
    if (typeof p === 'string') return p.length > maxLen ? p.slice(0, maxLen) + '...[truncated]' : p;
    if (p && typeof p === 'object' && typeof p.text === 'string' && p.text.length > maxLen) {
      return { ...p, text: p.text.slice(0, maxLen) + '...[truncated]' };
    }
    return p;
  });
}

export interface LoggingAdapterTraceContext {
  writer: TraceWriter;
  parentTrace: TraceContext;
  projectId: string;
}

export function createLoggingAdapter(
  inner: AIAdapter,
  projectDir: string,
  stage: string,
  taskType: string,
  costTracking?: { costTracker: CostTracker; projectId: string },
  traceCtx?: LoggingAdapterTraceContext,
  onLlmCall?: (method: string, estimatedTokens?: number) => void,
): AIAdapter {
  const logDir = join(projectDir, 'ai-logs');

  /** Emit ai_call.start trace event, returning the span for complete/error. */
  function traceStart(method: string, model?: string): TraceContext | undefined {
    if (!traceCtx) return undefined;
    const span = createChildContext(traceCtx.parentTrace);
    traceCtx.writer.append(makeTraceEvent('ai_call.start', span, traceCtx.projectId, {
      stage: stage as any,
      method,
      provider: inner.provider,
      model,
    }));
    return span;
  }

  /** Emit ai_call.complete trace event. */
  function traceComplete(span: TraceContext | undefined, method: string, model: string | undefined, durationMs: number, result: GenerationResult | null): void {
    if (!traceCtx || !span) return;
    traceCtx.writer.append(makeTraceEvent('ai_call.complete', span, traceCtx.projectId, {
      stage: stage as any,
      method,
      provider: inner.provider,
      model,
      durationMs,
      estimatedTokens: result?.tokenUsage?.totalTokens,
    }));
  }

  /** Emit ai_call.error trace event. */
  function traceError(span: TraceContext | undefined, method: string, model: string | undefined, durationMs: number, err: unknown): void {
    if (!traceCtx || !span) return;
    traceCtx.writer.append(makeTraceEvent('ai_call.error', span, traceCtx.projectId, {
      stage: stage as any,
      method,
      provider: inner.provider,
      model,
      durationMs,
      failure: classifyError(err),
    }));
  }
  if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });

  function writeLog(method: string, input: Record<string, unknown>, result: GenerationResult | null, error: string | null, durationMs: number) {
    const seq = nextSeq();
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    const filename = `${seq}_${safeFilename(stage)}_${safeFilename(taskType)}_${method}_${ts}.json`;
    const entry = {
      seq: Number(seq),
      timestamp: new Date().toISOString(),
      stage,
      taskType,
      method,
      provider: inner.provider,
      keyFingerprint: inner.keyFingerprint ?? undefined,
      durationMs,
      input,
      output: result ?? undefined,
      error: error ?? undefined,
    };
    try {
      writeFileSync(join(logDir, filename), JSON.stringify(entry, null, 2));
    } catch (e) {
      log.error('write_failed', e, { filename });
    }

    // Record cost for successful calls (P0-1: activate CostTracker)
    if (!error && costTracking) {
      const adapterType = inner.provider === 'CHAT' ? 'chat' as const : 'api' as const;
      const tu = result?.tokenUsage;
      try {
        costTracking.costTracker.record({
          projectId: costTracking.projectId,
          stage,
          taskType,
          adapter: adapterType,
          provider: inner.provider,
          method: method as CostEntry['method'],
          model: typeof input.model === 'string' ? input.model : undefined,
          isFallback: false,
          durationMs,
          actualTokens: tu ? { prompt: tu.promptTokens, completion: tu.completionTokens, total: tu.totalTokens } : undefined,
        });

        // Trace: emit cost.recorded
        if (traceCtx) {
          const costSpan = createChildContext(traceCtx.parentTrace);
          traceCtx.writer.append(makeTraceEvent('cost.recorded', costSpan, traceCtx.projectId, {
            stage,
            method,
            provider: inner.provider,
            adapter: adapterType,
            estimatedCostUsd: 0,  // actual cost tracked by CostTracker; trace is correlation only
            durationMs,
          }));
        }
      } catch (e) {
        log.error('cost_record_failed', e, { stage, method });
      }
    }
  }

  return {
    provider: inner.provider,

    async generateText(model: string, prompt: string | any[], options?: AIRequestOptions): Promise<GenerationResult> {
      const t0 = Date.now();
      const span = traceStart('generateText', model);
      try {
        const result = await inner.generateText(model, prompt, options);
        writeLog('generateText', { model, prompt: truncatePrompt(prompt), options }, result, null, Date.now() - t0);
        traceComplete(span, 'generateText', model, Date.now() - t0, result);
        onLlmCall?.('generateText', result?.tokenUsage?.totalTokens);
        return result;
      } catch (err: any) {
        writeLog('generateText', { model, prompt: truncatePrompt(prompt), options }, null, err?.message ?? String(err), Date.now() - t0);
        traceError(span, 'generateText', model, Date.now() - t0, err);
        throw err;
      }
    },

    async generateImage(model: string, prompt: string, aspectRatio?: string, negativePrompt?: string, options?: AIRequestOptions): Promise<GenerationResult> {
      const t0 = Date.now();
      const span = traceStart('generateImage', model);
      try {
        const result = await inner.generateImage(model, prompt, aspectRatio, negativePrompt, options);
        writeLog('generateImage', { model, prompt, aspectRatio, negativePrompt, options }, result, null, Date.now() - t0);
        traceComplete(span, 'generateImage', model, Date.now() - t0, result);
        onLlmCall?.('generateImage', result?.tokenUsage?.totalTokens);
        return result;
      } catch (err: any) {
        writeLog('generateImage', { model, prompt, aspectRatio, negativePrompt, options }, null, err?.message ?? String(err), Date.now() - t0);
        traceError(span, 'generateImage', model, Date.now() - t0, err);
        throw err;
      }
    },

    async generateVideo(model: string, prompt: string, options?: { aspectRatio?: string; image?: string; duration?: number; fps?: number; resolution?: '720p' | '1080p' } & AIRequestOptions): Promise<GenerationResult> {
      const t0 = Date.now();
      const span = traceStart('generateVideo', model);
      try {
        const result = await inner.generateVideo(model, prompt, options);
        writeLog('generateVideo', { model, prompt, options }, result, null, Date.now() - t0);
        traceComplete(span, 'generateVideo', model, Date.now() - t0, result);
        onLlmCall?.('generateVideo', result?.tokenUsage?.totalTokens);
        return result;
      } catch (err: any) {
        writeLog('generateVideo', { model, prompt, options }, null, err?.message ?? String(err), Date.now() - t0);
        traceError(span, 'generateVideo', model, Date.now() - t0, err);
        throw err;
      }
    },

    uploadFile: inner.uploadFile ? async (file: { name: string; path: string; mimeType: string }) => {
      const t0 = Date.now();
      const span = traceStart('uploadFile');
      try {
        const result = await inner.uploadFile!(file);
        writeLog('uploadFile', { file: { name: file.name, mimeType: file.mimeType } }, null, null, Date.now() - t0);
        traceComplete(span, 'uploadFile', undefined, Date.now() - t0, null);
        return result;
      } catch (err: any) {
        writeLog('uploadFile', { file: { name: file.name, mimeType: file.mimeType } }, null, err?.message ?? String(err), Date.now() - t0);
        traceError(span, 'uploadFile', undefined, Date.now() - t0, err);
        throw err;
      }
    } : undefined,

    generateSpeech: inner.generateSpeech ? async (text: string, voice?: string, options?: AIRequestOptions) => {
      const t0 = Date.now();
      const span = traceStart('generateSpeech');
      try {
        const result = await inner.generateSpeech!(text, voice, options);
        writeLog('generateSpeech', { text: text.slice(0, 500), voice, options }, result, null, Date.now() - t0);
        traceComplete(span, 'generateSpeech', undefined, Date.now() - t0, result);
        onLlmCall?.('generateSpeech', result?.tokenUsage?.totalTokens);
        return result;
      } catch (err: any) {
        writeLog('generateSpeech', { text: text.slice(0, 500), voice, options }, null, err?.message ?? String(err), Date.now() - t0);
        traceError(span, 'generateSpeech', undefined, Date.now() - t0, err);
        throw err;
      }
    } : undefined,
  };
}
