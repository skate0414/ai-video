/* ------------------------------------------------------------------ */
/*  ChatAdapter – bridges AIAdapter interface to chat automation       */
/*  This is the CORE integration layer between ai-suite pipeline      */
/*  and demo's free-chat Playwright automation.                       */
/* ------------------------------------------------------------------ */

import type { Page } from 'playwright';
import type { AIAdapter, AIRequestOptions, GenerationResult } from '../pipeline/types.js';
import type { Workbench } from '../workbench.js';
import type { ProviderId } from '../types.js';
import { extractJSON, isTruncated, mergeContinuation } from './responseParser.js';
import { extractLatestImage } from './imageExtractor.js';
import { generateSpeech as ttsGenerateSpeech, isEdgeTTSAvailable, type TTSConfig } from './ttsProvider.js';

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
  defaultTextProvider: 'gemini',
  imageProvider: 'gemini',
  defaultModel: '',
  responseTimeoutMs: 180_000,
  maxContinuations: 3,
  sessionId: '',
  continueChat: false,
};

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

  constructor(workbench: Workbench, config?: Partial<ChatAdapterConfig>) {
    this.workbench = workbench;
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /* ---- generateText ---- */

  async generateText(
    model: string,
    prompt: string | any[],
    options?: AIRequestOptions,
  ): Promise<GenerationResult> {
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

    // Extract file attachments from multimodal prompt
    let attachments: string[] | undefined;
    if (Array.isArray(prompt)) {
      attachments = prompt
        .filter(p => p?.fileData?.fileUri)
        .map(p => p.fileData.fileUri);
    }

    // Submit to workbench and wait for response
    const answer = await this.workbench.submitAndWait({
      question: fullPrompt,
      preferredProvider: this.config.defaultTextProvider,
      preferredModel: model || this.config.defaultModel || undefined,
      attachments,
      timeoutMs: this.config.responseTimeoutMs,
      sessionId: this.config.sessionId || undefined,
      useSameChat: this.config.continueChat || undefined,
    });

    // Handle truncated responses with continuation
    let fullAnswer = answer;
    let continuations = 0;
    while (isTruncated(fullAnswer) && continuations < this.config.maxContinuations) {
      const cont = await this.workbench.submitAndWait({
        question: '继续 (continue)',
        preferredProvider: this.config.defaultTextProvider,
        preferredModel: model || this.config.defaultModel || undefined,
        timeoutMs: this.config.responseTimeoutMs,
        sessionId: this.config.sessionId || undefined,
        useSameChat: true,
      });
      fullAnswer = mergeContinuation(fullAnswer, cont);
      continuations++;
    }

    // Parse JSON if expected
    let data: any;
    if (options?.responseMimeType === 'application/json' || options?.responseSchema) {
      data = extractJSON(fullAnswer);
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
    let imagePrompt = `Please generate an image based on this description:\n\n${prompt}`;
    if (aspectRatio) {
      imagePrompt += `\n\nAspect ratio: ${aspectRatio}`;
    }
    if (negativePrompt) {
      imagePrompt += `\n\nAvoid: ${negativePrompt}`;
    }

    // Use Gemini for image generation (it supports this in free tier)
    const answer = await this.workbench.submitAndWait({
      question: imagePrompt,
      preferredProvider: this.config.imageProvider,
      preferredModel: model || undefined,
      timeoutMs: this.config.responseTimeoutMs,
    });

    // Try to extract the generated image from the chat page
    const page = this.workbench.getActivePage();
    if (page) {
      const selectors = this.workbench.getActiveSelectors();
      if (selectors) {
        const filename = `img_${Date.now()}.png`;
        const extracted = await extractLatestImage(
          page,
          selectors.responseBlock,
          this.config.assetsDir,
          filename,
        );
        if (extracted) {
          return {
            imageUrl: extracted.localPath,
            text: answer,
            model: model || 'chat-image',
          };
        }
      }
    }

    // If image extraction failed, the AI might have described the image instead
    return {
      text: answer,
      model: model || 'chat-image',
    };
  }

  /* ---- generateVideo ---- */

  async generateVideo(
    model: string,
    prompt: string,
    options?: { aspectRatio?: string; image?: string; duration?: number; fps?: number } & AIRequestOptions,
  ): Promise<GenerationResult> {
    // Video generation requires external tools (Seedance, etc.)
    // For now, return a placeholder indicating manual intervention needed
    // The PipelineOrchestrator can use VideoProvider directly for browser automation

    return {
      text: `[Video generation pending] Prompt: ${prompt}`,
      model: model || 'video-pending',
    };
  }

  /* ---- generateSpeech ---- */

  async generateSpeech(
    text: string,
    voice?: string,
    options?: AIRequestOptions,
  ): Promise<GenerationResult> {
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
