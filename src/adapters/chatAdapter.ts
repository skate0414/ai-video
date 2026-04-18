/* ------------------------------------------------------------------ */
/*  ChatAdapter – free-tier compiler backend via chat automation       */
/*  Bridges AIAdapter interface to Playwright-driven chat sessions.  */
/*  This is the primary codegen backend for zero-cost compilation.   */
/* ------------------------------------------------------------------ */

import type { Page } from 'playwright';
import type { AIAdapter, AIRequestOptions, GenerationResult } from '../pipeline/types.js';
import type { Workbench } from '../workbench.js';
import type { ProviderId } from '../types.js';
import { copyFileSync, existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { extractJSON, isTruncated, mergeContinuation } from './responseParser.js';
import { extractLatestImage } from './imageExtractor.js';
import { generateSpeech as ttsGenerateSpeech, isEdgeTTSAvailable, type TTSConfig } from './ttsProvider.js';
import { quotaBus } from '../quotaBus.js';
import { capabilityQuota, hasQuotaSignal } from '../quotaRotation.js';
import {
  CHAT_RESPONSE_TIMEOUT_MS,
  MAX_CONTINUATIONS,
  POLLINATIONS_MAX_ATTEMPTS,
  POLLINATIONS_FETCH_TIMEOUT_MS,
  DEFAULT_TEXT_PROVIDER,
  DEFAULT_IMAGE_PROVIDER,
  HTTP_PROXY,
  TEMP_DIR,
} from '../constants.js';

export interface ChatAdapterConfig {
  /** Where to save generated assets */
  assetsDir: string;
  /** Default provider for text generation */
  defaultTextProvider?: ProviderId;
  /** Provider that supports image generation (e.g. 'gemini') */
  imageProvider?: ProviderId;
  /** Default model for text tasks */
  defaultModel?: string;
  /** Max time to wait for a single chat response (ms) */
  responseTimeoutMs?: number;
  /** Max continuation attempts for truncated responses */
  maxContinuations?: number;
  /** Session ID for grouping related requests in the same chat thread */
  sessionId?: string;
  /** Whether to continue in the same chat thread (set by SessionManager) */
  continueChat?: boolean;
}

const DEFAULT_CONFIG: Required<ChatAdapterConfig> = {
  assetsDir: 'data/projects/assets',
  defaultTextProvider: DEFAULT_TEXT_PROVIDER as ProviderId,
  imageProvider: DEFAULT_IMAGE_PROVIDER as ProviderId,
  defaultModel: '',
  responseTimeoutMs: CHAT_RESPONSE_TIMEOUT_MS,
  maxContinuations: MAX_CONTINUATIONS,
  sessionId: '',
  continueChat: false,
};

function resolveRequestContext(config: Required<ChatAdapterConfig>, options?: AIRequestOptions): {
  timeoutMs: number;
  signal?: AbortSignal;
  sessionId?: string;
  continueChat?: boolean;
} {
  return {
    timeoutMs: options?.timeoutMs ?? config.responseTimeoutMs,
    signal: options?.signal,
    sessionId: (options?.sessionId ?? config.sessionId) || undefined,
    continueChat: (options?.continueChat ?? config.continueChat) || undefined,
  };
}

/**
 * ChatAdapter implements the AIAdapter interface by routing
 * generation requests through the Workbench's chat automation.
 *
 * Key mechanism: creates a TaskItem, submits it via the Workbench's
 * submitAndWait() method, then parses the response.
 */
export class ChatAdapter implements AIAdapter {
  readonly provider = 'CHAT';

  private workbench: Workbench;
  private config: Required<ChatAdapterConfig>;
  private pollinationsUnavailable = false;
  private pollinationsFailureCount = 0;

  constructor(workbench: Workbench, config?: Partial<ChatAdapterConfig>) {
    this.workbench = workbench;
    this.config = { ...DEFAULT_CONFIG, ...config };

    // Listen for cross-system quota events and record per-account exhaustion
    quotaBus.on((event) => {
      if (event.exhausted && event.capability === 'image' && event.accountId) {
        capabilityQuota.markExhausted(event.accountId, 'image', event.provider);
      }
    });
  }

  /* ---- generateText ---- */

  async generateText(
    model: string,
    prompt: string | any[],
    options?: AIRequestOptions,
  ): Promise<GenerationResult> {
    const requestContext = resolveRequestContext(this.config, options);
    // Build the full prompt text
    let fullPrompt = '';

    if (options?.systemInstruction) {
      fullPrompt += `[System Instruction]\n${options.systemInstruction}\n\n`;
    }

    if (typeof prompt === 'string') {
      fullPrompt += prompt;
    } else if (Array.isArray(prompt)) {
      // Multimodal prompt array — extract text parts, note file parts
      const textParts: string[] = [];
      const fileParts: string[] = [];
      for (const part of prompt) {
        if (typeof part === 'string') {
          textParts.push(part);
        } else if (part?.text) {
          textParts.push(part.text);
        } else if (part?.fileData?.fileUri) {
          fileParts.push(part.fileData.fileUri);
        } else if (part?.inlineData) {
          // base64 inline data — save to temp file for upload
          textParts.push('[Attached file]');
        }
      }
      fullPrompt += textParts.join('\n');
      // File attachments handled separately via task.attachments
    }

    // If JSON output requested, append format instruction
    if (options?.responseMimeType === 'application/json') {
      fullPrompt += '\n\nIMPORTANT: Respond with valid JSON only. No markdown code blocks, no extra text. The first character must be { and the last must be }.';
    }

    console.log(`[ChatAdapter] generateText \u25b6 provider=${this.config.defaultTextProvider} model=${model || this.config.defaultModel || '(default)'} prompt(${fullPrompt.length} chars): ${fullPrompt.slice(0, 200)}${fullPrompt.length > 200 ? '...' : ''}`);

    // Extract file attachments from multimodal prompt
    let attachments: string[] | undefined;
    if (Array.isArray(prompt)) {
      attachments = prompt
        .filter(p => p?.fileData?.fileUri)
        .map(p => p.fileData.fileUri);
    }

    // Submit to workbench and wait for response
    const genStart = Date.now();
    const answer = await this.workbench.submitAndWait({
      question: fullPrompt,
      preferredProvider: this.config.defaultTextProvider,
      preferredModel: model || this.config.defaultModel || undefined,
      attachments,
      timeoutMs: requestContext.timeoutMs,
      signal: requestContext.signal,
      sessionId: requestContext.sessionId,
      useSameChat: requestContext.continueChat,
    });
    console.log(`[ChatAdapter] generateText \u25c0 (${Date.now() - genStart}ms, ${answer.length} chars): ${answer.slice(0, 200)}${answer.length > 200 ? '...' : ''}`);

    // Handle truncated responses with continuation
    let fullAnswer = answer;
    let continuations = 0;
    while (isTruncated(fullAnswer) && continuations < this.config.maxContinuations) {
      console.log(`[ChatAdapter] Response appears truncated, sending continuation ${continuations + 1}/${this.config.maxContinuations}...`);
      const cont = await this.workbench.submitAndWait({
        question: '继续 (continue)',
        preferredProvider: this.config.defaultTextProvider,
        preferredModel: model || this.config.defaultModel || undefined,
        timeoutMs: requestContext.timeoutMs,
        signal: requestContext.signal,
        sessionId: requestContext.sessionId,
        useSameChat: true,
      });
      fullAnswer = mergeContinuation(fullAnswer, cont);
      continuations++;
      console.log(`[ChatAdapter] After continuation ${continuations}: ${fullAnswer.length} chars total`);
    }

    // Parse JSON if expected
    let data: any;
    if (options?.responseMimeType === 'application/json' || options?.responseSchema) {
      data = extractJSON(fullAnswer);
      if (data) {
        console.log(`[ChatAdapter] JSON parsed successfully: ${JSON.stringify(data).slice(0, 200)}`);
      } else {
        console.warn(`[ChatAdapter] \u26a0 JSON parsing FAILED from response: ${fullAnswer.slice(0, 300)}`);
      }
    }

    return {
      text: fullAnswer,
      data,
      model: model || 'chat',
    };
  }

  /* ---- generateImage ---- */

  async generateImage(
    model: string,
    prompt: string,
    aspectRatio?: string,
    negativePrompt?: string,
    options?: AIRequestOptions,
  ): Promise<GenerationResult> {
    const requestContext = resolveRequestContext(this.config, options);
    console.log(`[ChatAdapter] generateImage ▶ provider=${this.config.imageProvider} prompt: ${prompt.slice(0, 150)}`);

    // Check per-account exhaustion: only skip if ALL accounts for this
    // provider are exhausted (not just the last one that failed).
    const imageResources = this.workbench.resources.byCapability('image');
    const providerResources = this.config.imageProvider
      ? imageResources.filter((r) => r.provider === this.config.imageProvider)
      : imageResources;
    if (capabilityQuota.allExhausted(providerResources, 'image')) {
      console.log(`[ChatAdapter] generateImage: all ${providerResources.length} accounts exhausted for image, using fallback`);
      return this.generateFallbackImageResult(model, prompt, aspectRatio, negativePrompt, '[chat-skipped] all accounts exhausted');
    }

    // Use a direct instruction that reliably triggers image generation.
    let imagePrompt = `Generate an image based on the following description (generate the image directly, do not describe it in text):\n\n${prompt}`;
    if (aspectRatio) {
      imagePrompt += `\n\nAspect ratio: ${aspectRatio}`;
    }
    if (negativePrompt) {
      imagePrompt += `\n\nAvoid: ${negativePrompt}`;
    }

    // Use configured provider for image generation
    const answer = await this.workbench.submitAndWait({
      question: imagePrompt,
      preferredProvider: this.config.imageProvider,
      preferredModel: model || undefined,
      timeoutMs: requestContext.timeoutMs,
      signal: requestContext.signal,
      sessionId: requestContext.sessionId,
      useSameChat: requestContext.continueChat,
    });
    console.log(`[ChatAdapter] generateImage: text response (${answer.length} chars): ${answer.slice(0, 200)}`);

    if (!answer.trim() || hasQuotaSignal(answer)) {
      // Mark THIS specific account, not a global flag
      const accountId = this.workbench.getActiveAccountId();
      if (accountId) {
        capabilityQuota.markExhausted(accountId, 'image', String(this.config.imageProvider));
      }
      quotaBus.emit({
        provider: String(this.config.imageProvider),
        accountId: accountId ?? undefined,
        capability: 'image',
        exhausted: true,
        reason: 'Chat response indicates image quota exhaustion',
      });
      return this.generateFallbackImageResult(model, prompt, aspectRatio, negativePrompt, answer);
    }

    // Try to extract the generated image from the chat page.
    // Pass a generous timeout since image generation/rendering is slow.
    const page = this.workbench.getActivePage();
    if (page) {
      const selectors = this.workbench.getActiveSelectors();
      if (selectors) {
        const filename = `img_${Date.now()}.png`;
        const responseBlockChain = this.workbench.getActiveSelectorChain('responseBlock');
        const extracted = await extractLatestImage(
          page,
          selectors.responseBlock,
          this.config.assetsDir,
          filename,
          60_000, // 60s polling — images can take a while to load fully
          responseBlockChain,
        );
        if (extracted) {
          console.log(`[ChatAdapter] generateImage ◀ Image extracted: ${extracted.localPath}`);
          return {
            imageUrl: extracted.localPath,
            text: answer,
            model: model || 'chat-image',
          };
        }
      }
    }

    // If image extraction failed, the AI might have described the image instead
    console.warn(`[ChatAdapter] generateImage ⚠ No image extracted from response`);

    return this.generateFallbackImageResult(model, prompt, aspectRatio, negativePrompt, answer);
  }

  private async generateFallbackImageResult(
    model: string,
    prompt: string,
    aspectRatio?: string,
    negativePrompt?: string,
    text = '',
  ): Promise<GenerationResult> {

    // Last fallback: generate with free Pollinations endpoint.
    const fallbackPath = await this.generatePollinationsImage(prompt, aspectRatio, negativePrompt);
    if (fallbackPath) {
      return {
        imageUrl: fallbackPath,
        text,
        model: model || 'pollinations-fallback',
      };
    }

    const localFallbackPath = this.copyExistingImageFallback();
    if (localFallbackPath) {
      console.warn(`[ChatAdapter] ⚠️ WARNING: Using LOCAL FALLBACK image (not AI-generated). Quality will be poor.`);
      return {
        imageUrl: localFallbackPath,
        text: text + ' [LOCAL_FALLBACK: not AI-generated]',
        model: model || 'local-image-fallback',
      };
    }

    return {
      text,
      model: model || 'chat-image',
    };
  }

  private async generatePollinationsImage(
    prompt: string,
    aspectRatio?: string,
    negativePrompt?: string,
  ): Promise<string | null> {
    if (this.pollinationsUnavailable) {
      return null;
    }

    const { width, height } = this.resolveImageSize(aspectRatio);
    const finalPrompt = [prompt.trim(), negativePrompt ? `Avoid: ${negativePrompt.trim()}` : '']
      .filter(Boolean)
      .join('. ')
      .slice(0, 700);
    const encodedPrompt = encodeURIComponent(finalPrompt);
    const url = `https://image.pollinations.ai/prompt/${encodedPrompt}?width=${width}&height=${height}&nologo=true`;

    const tryFetch = async (proxyUrl?: string): Promise<Response> => {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), POLLINATIONS_FETCH_TIMEOUT_MS);
      try {
        if (!proxyUrl) {
          return await fetch(url, { redirect: 'follow', signal: controller.signal });
        }
        const { ProxyAgent } = await import('undici');
        const requestInit: any = {
          redirect: 'follow',
          signal: controller.signal,
          dispatcher: new ProxyAgent(proxyUrl),
        };
        return await fetch(url, requestInit);
      } finally {
        clearTimeout(timer);
      }
    };

    try {
      let resp: Response | null = null;
      const maxAttempts = POLLINATIONS_MAX_ATTEMPTS;
      for (let attempt = 1; attempt <= maxAttempts && !resp; attempt++) {
        let sawRateLimit = false;
        const proxyTargets: Array<string | undefined> = HTTP_PROXY
          ? [undefined, HTTP_PROXY]
          : [undefined];
        for (const proxyUrl of proxyTargets) {
          try {
            const label = proxyUrl ? 'proxy' : 'direct';
            const candidate = await tryFetch(proxyUrl);
            if (candidate.status === 429) {
              sawRateLimit = true;
              console.warn(`[ChatAdapter] Pollinations ${label} rate-limited (attempt ${attempt}/${maxAttempts})`);
              continue;
            }
            if (!candidate.ok) {
              console.warn(`[ChatAdapter] Pollinations ${label} request failed: ${candidate.status}`);
              continue;
            }
            resp = candidate;
            break;
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const label = proxyUrl ? 'proxy' : 'direct';
            console.warn(`[ChatAdapter] Pollinations ${label} request error: ${message}`);
          }
        }

        if (!resp && sawRateLimit && attempt < maxAttempts) {
          const waitMs = 8_000 * attempt;
          await new Promise(resolve => setTimeout(resolve, waitMs));
        }
      }

      if (!resp) {
        return null;
      }

      if (!resp.ok) {
        const errorText = await resp.text();
        console.warn(`[ChatAdapter] Pollinations fallback failed: ${resp.status} ${errorText.slice(0, 200)}`);
        return null;
      }

      const contentType = resp.headers.get('content-type') || '';
      if (!contentType.startsWith('image/')) {
        const body = await resp.text();
        console.warn(`[ChatAdapter] Pollinations returned non-image payload: ${body.slice(0, 200)}`);
        return null;
      }

      const imageBuffer = Buffer.from(await resp.arrayBuffer());
      if (!imageBuffer.length) {
        console.warn('[ChatAdapter] Pollinations returned empty image payload');
        return null;
      }

      mkdirSync(this.config.assetsDir, { recursive: true });
      const ext = contentType.includes('png') ? 'png' : contentType.includes('webp') ? 'webp' : 'jpg';
      const localPath = join(this.config.assetsDir, `img_${Date.now()}_pollinations.${ext}`);
      writeFileSync(localPath, imageBuffer);
      this.pollinationsFailureCount = 0;
      console.log(`[ChatAdapter] Pollinations fallback image saved: ${localPath}`);
      return localPath;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.pollinationsFailureCount += 1;
      if (this.pollinationsFailureCount >= 2) {
        this.pollinationsUnavailable = true;
        quotaBus.emit({
          provider: 'pollinations',
          capability: 'image',
          exhausted: true,
          reason: `Pollinations failed ${this.pollinationsFailureCount} times consecutively`,
        });
      }
      console.warn(`[ChatAdapter] Pollinations fallback error: ${message}`);
      return null;
    }
  }

  private copyExistingImageFallback(): string | null {
    try {
      const candidates: string[] = [];
      const assetsDir = this.config.assetsDir;

      if (existsSync('/tmp/test-pollinations.png')) {
        candidates.push('/tmp/test-pollinations.png');
      }

      if (existsSync(assetsDir)) {
        const files = readdirSync(assetsDir)
          .filter(name => /\.(png|jpg|jpeg|webp)$/i.test(name))
          .map(name => join(assetsDir, name))
          .sort();
        candidates.push(...files.reverse());
      }

      const source = candidates[0];
      if (!source) return null;

      mkdirSync(assetsDir, { recursive: true });
      const ext = source.split('.').pop() || 'png';
      const target = join(assetsDir, `img_${Date.now()}_localfallback.${ext}`);
      copyFileSync(source, target);
      console.warn(`[ChatAdapter] Using local image fallback: ${source} -> ${target}`);
      return target;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(`[ChatAdapter] Local image fallback failed: ${message}`);
      return null;
    }
  }

  private resolveImageSize(aspectRatio?: string): { width: number; height: number } {
    const ratio = (aspectRatio || '16:9').trim();
    switch (ratio) {
      case '9:16':
        return { width: 720, height: 1280 };
      case '1:1':
        return { width: 1024, height: 1024 };
      case '4:3':
        return { width: 1024, height: 768 };
      case '3:4':
        return { width: 768, height: 1024 };
      case '16:9':
      default:
        return { width: 1280, height: 720 };
    }
  }

  /* ---- generateVideo ---- */

  async generateVideo(
    model: string,
    prompt: string,
    options?: { aspectRatio?: string; image?: string; duration?: number; fps?: number; resolution?: '720p' | '1080p' } & AIRequestOptions,
  ): Promise<GenerationResult> {
    // ChatAdapter does not support video generation directly.
    // Throwing allows FallbackAdapter to trigger chat→API fallback.
    throw new ChatVideoUnsupportedError(
      'ChatAdapter does not support video generation. Use VideoProvider or fallback to API adapter.',
    );
  }

  /* ---- generateSpeech ---- */

  async generateSpeech(
    text: string,
    voice?: string,
    options?: AIRequestOptions,
  ): Promise<GenerationResult> {
    console.log(`[ChatAdapter] generateSpeech \u25b6 voice=${voice || '(default)'} text(${text.length} chars): ${text.slice(0, 80)}...`);
    const ttsConfig: TTSConfig = {
      assetsDir: this.config.assetsDir,
      voice: voice ?? undefined,
      preferLocal: true,
    };

    try {
      return await ttsGenerateSpeech(text, ttsConfig);
    } catch (err) {
      // TTS failure is non-fatal — return a marker
      const message = err instanceof Error ? err.message : String(err);
      console.warn('[ChatAdapter] TTS failed:', message);
      return {
        text: `[TTS failed: ${message}] ${text.slice(0, 100)}...`,
        model: 'tts-failed',
      };
    }
  }

  /* ---- uploadFile ---- */

  async uploadFile(file: { name: string; path: string; mimeType: string }): Promise<{ uri: string; mimeType: string }> {
    // Files are uploaded directly via Playwright file chooser
    // Just return the local path as URI
    return {
      uri: file.path,
      mimeType: file.mimeType,
    };
  }
}

/**
 * Thrown when ChatAdapter.generateVideo() is called.
 * Treated as a quota-like error so FallbackAdapter can trigger API fallback.
 */
export class ChatVideoUnsupportedError extends Error {
  readonly isQuotaError = true;
  constructor(message: string) {
    super(message);
    this.name = 'ChatVideoUnsupportedError';
  }
}
