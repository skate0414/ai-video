/* ------------------------------------------------------------------ */
/*  LoggingAdapterWrapper – saves every AI call's input & output       */
/* ------------------------------------------------------------------ */

import { mkdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { AIAdapter, AIRequestOptions, GenerationResult } from './types.js';

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

export function createLoggingAdapter(
  inner: AIAdapter,
  projectDir: string,
  stage: string,
  taskType: string,
): AIAdapter {
  const logDir = join(projectDir, 'ai-logs');
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
      durationMs,
      input,
      output: result ?? undefined,
      error: error ?? undefined,
    };
    try {
      writeFileSync(join(logDir, filename), JSON.stringify(entry, null, 2));
    } catch (e) {
      console.error(`[loggingAdapter] Failed to write log ${filename}:`, e);
    }
  }

  return {
    provider: inner.provider,

    async generateText(model: string, prompt: string | any[], options?: AIRequestOptions): Promise<GenerationResult> {
      const t0 = Date.now();
      try {
        const result = await inner.generateText(model, prompt, options);
        writeLog('generateText', { model, prompt: truncatePrompt(prompt), options }, result, null, Date.now() - t0);
        return result;
      } catch (err: any) {
        writeLog('generateText', { model, prompt: truncatePrompt(prompt), options }, null, err?.message ?? String(err), Date.now() - t0);
        throw err;
      }
    },

    async generateImage(model: string, prompt: string, aspectRatio?: string, negativePrompt?: string, options?: AIRequestOptions): Promise<GenerationResult> {
      const t0 = Date.now();
      try {
        const result = await inner.generateImage(model, prompt, aspectRatio, negativePrompt, options);
        writeLog('generateImage', { model, prompt, aspectRatio, negativePrompt, options }, result, null, Date.now() - t0);
        return result;
      } catch (err: any) {
        writeLog('generateImage', { model, prompt, aspectRatio, negativePrompt, options }, null, err?.message ?? String(err), Date.now() - t0);
        throw err;
      }
    },

    async generateVideo(model: string, prompt: string, options?: { aspectRatio?: string; image?: string; duration?: number; fps?: number } & AIRequestOptions): Promise<GenerationResult> {
      const t0 = Date.now();
      try {
        const result = await inner.generateVideo(model, prompt, options);
        writeLog('generateVideo', { model, prompt, options }, result, null, Date.now() - t0);
        return result;
      } catch (err: any) {
        writeLog('generateVideo', { model, prompt, options }, null, err?.message ?? String(err), Date.now() - t0);
        throw err;
      }
    },

    uploadFile: inner.uploadFile ? async (file: { name: string; path: string; mimeType: string }) => {
      const t0 = Date.now();
      try {
        const result = await inner.uploadFile!(file);
        writeLog('uploadFile', { file: { name: file.name, mimeType: file.mimeType } }, null, null, Date.now() - t0);
        return result;
      } catch (err: any) {
        writeLog('uploadFile', { file: { name: file.name, mimeType: file.mimeType } }, null, err?.message ?? String(err), Date.now() - t0);
        throw err;
      }
    } : undefined,

    generateSpeech: inner.generateSpeech ? async (text: string, voice?: string, options?: AIRequestOptions) => {
      const t0 = Date.now();
      try {
        const result = await inner.generateSpeech!(text, voice, options);
        writeLog('generateSpeech', { text: text.slice(0, 500), voice, options }, result, null, Date.now() - t0);
        return result;
      } catch (err: any) {
        writeLog('generateSpeech', { text: text.slice(0, 500), voice, options }, null, err?.message ?? String(err), Date.now() - t0);
        throw err;
      }
    } : undefined,
  };
}
