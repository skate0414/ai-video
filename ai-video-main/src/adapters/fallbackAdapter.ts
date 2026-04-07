/* ------------------------------------------------------------------ */
/*  FallbackAdapter – wraps primary (chat) with fallback (paid API)   */
/*  On quota / rate-limit errors the call is automatically retried    */
/*  against the fallback adapter.                                     */
/* ------------------------------------------------------------------ */

import type { AIAdapter, AIRequestOptions, GenerationResult } from '../pipeline/types.js';

function isQuotaError(err: unknown): boolean {
  if (err && typeof err === 'object') {
    const e = err as any;
    if (e.isQuotaError) return true;
    if (e.status === 429) return true;
    const msg = (e.message ?? '').toLowerCase();
    if (msg.includes('quota') || msg.includes('rate limit') || msg.includes('resource_exhausted')) {
      return true;
    }
  }
  return false;
}

export class FallbackAdapter implements AIAdapter {
  provider: string;

  constructor(
    private primary: AIAdapter,
    private fallback: AIAdapter,
  ) {
    this.provider = `fallback(${primary.provider}→${fallback.provider})`;
  }

  async generateText(
    model: string,
    prompt: string | any[],
    options?: AIRequestOptions,
  ): Promise<GenerationResult> {
    try {
      return await this.primary.generateText(model, prompt, options);
    } catch (err) {
      if (isQuotaError(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[FallbackAdapter] generateText quota error on ${this.primary.provider} (${msg}), falling back to ${this.fallback.provider}`);
        const result = await this.fallback.generateText(model, prompt, options);
        console.log(`[FallbackAdapter] generateText fallback succeeded (${result.text?.length ?? 0} chars)`);
        return result;
      }
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
      return await this.primary.generateImage(model, prompt, aspectRatio, negativePrompt, options);
    } catch (err) {
      if (isQuotaError(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[FallbackAdapter] generateImage quota error on ${this.primary.provider} (${msg}), falling back to ${this.fallback.provider}`);
        return this.fallback.generateImage(model, prompt, aspectRatio, negativePrompt, options);
      }
      throw err;
    }
  }

  async generateVideo(
    model: string,
    prompt: string,
    options?: { aspectRatio?: string; image?: string; duration?: number; fps?: number } & AIRequestOptions,
  ): Promise<GenerationResult> {
    try {
      return await this.primary.generateVideo(model, prompt, options);
    } catch (err) {
      if (isQuotaError(err)) {
        const msg = err instanceof Error ? err.message : String(err);
        console.log(`[FallbackAdapter] generateVideo quota error on ${this.primary.provider} (${msg}), falling back to ${this.fallback.provider}`);
        return this.fallback.generateVideo(model, prompt, options);
      }
      throw err;
    }
  }

  async uploadFile(file: { name: string; path: string; mimeType: string }): Promise<{ uri: string; mimeType: string }> {
    if (this.primary.uploadFile) {
      try {
        return await this.primary.uploadFile(file);
      } catch (err) {
        if (isQuotaError(err) && this.fallback.uploadFile) {
          console.log(`[FallbackAdapter] uploadFile quota error, falling back`);
          return this.fallback.uploadFile(file);
        }
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
        return await this.primary.generateSpeech(text, voice, options);
      } catch (err) {
        if (isQuotaError(err) && this.fallback.generateSpeech) {
          console.log(`[FallbackAdapter] generateSpeech quota error, falling back`);
          return this.fallback.generateSpeech(text, voice, options);
        }
        throw err;
      }
    }
    if (this.fallback.generateSpeech) return this.fallback.generateSpeech(text, voice, options);
    throw new Error('Neither primary nor fallback adapter supports generateSpeech');
  }
}
