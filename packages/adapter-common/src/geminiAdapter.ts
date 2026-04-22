/* ------------------------------------------------------------------ */
/*  GeminiAdapter – paid Gemini API backend for the compiler          */
/*  Direct Google GenAI SDK integration for premium compilation.     */
/* ------------------------------------------------------------------ */

import { GoogleGenAI, Modality } from '@google/genai';
import type { AIAdapter, AIRequestOptions, GenerationResult } from '@ai-video/pipeline-core/types/adapter.js';
import { runWithAICallControl, throwIfAborted, waitWithAbort } from '@ai-video/pipeline-core/aiControl.js';
import { withRetry as sharedWithRetry, tagIfQuota } from '@ai-video/lib/retry.js';
import { createLogger } from '@ai-video/lib/logger.js';

const log = createLogger('GeminiAdapter');

/**
 * Converts raw PCM data (Linear-16) to a WAV file (with header).
 * Ported from ai-suite/src/lib/audioUtils.ts for Node.js (uses Buffer).
 */
function pcmToWav(pcmBase64: string, sampleRate = 24000, numChannels = 1): string {
  const pcmBytes = Buffer.from(pcmBase64, 'base64');
  const len = pcmBytes.length;

  const header = Buffer.alloc(44);
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + len, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);               // Subchunk1Size
  header.writeUInt16LE(1, 20);                // AudioFormat (PCM)
  header.writeUInt16LE(numChannels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(sampleRate * numChannels * 2, 28); // ByteRate
  header.writeUInt16LE(numChannels * 2, 32);  // BlockAlign
  header.writeUInt16LE(16, 34);               // BitsPerSample
  header.write('data', 36);
  header.writeUInt32LE(len, 40);

  return Buffer.concat([header, pcmBytes]).toString('base64');
}

/** Gemini-scoped withRetry — thin wrapper over the shared helper. */
function withRetry<T>(fn: () => Promise<T>, options?: AIRequestOptions): Promise<T> {
  return sharedWithRetry(fn, { ...options, label: 'Gemini API request' });
}

export class GeminiAdapter implements AIAdapter {
  provider = 'gemini-api';
  private client: GoogleGenAI;
  private apiKey: string;
  keyFingerprint: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.keyFingerprint = `...${apiKey.slice(-4)}`;
    this.client = new GoogleGenAI({ apiKey });
  }

  /* ---- generateText ---- */

  async generateText(
    model: string,
    prompt: string | any[],
    options?: AIRequestOptions,
  ): Promise<GenerationResult> {
    return runWithAICallControl(() => withRetry(async () => {
      const contents = Array.isArray(prompt)
        ? { parts: prompt }
        : { parts: [{ text: prompt }] };

      const config: any = {};
      if (options?.temperature) config.temperature = options.temperature;
      if (options?.responseMimeType) config.responseMimeType = options.responseMimeType;
      if (options?.responseSchema) config.responseSchema = options.responseSchema;
      if (options?.thinkingConfig) config.thinkingConfig = options.thinkingConfig;
      if (options?.systemInstruction) config.systemInstruction = options.systemInstruction;
      if (options?.tools) config.tools = options.tools;
      if (options?.overrides) Object.assign(config, options.overrides);

      const response = await this.client.models.generateContent({
        model,
        contents,
        config,
      });

      const candidate = response.candidates?.[0] ?? {};
      const text = candidate.content?.parts?.map((p: any) => p.text).join('') ?? '';

      let parsedData: any;
      if (options?.responseSchema || options?.responseMimeType === 'application/json') {
        try {
          parsedData = JSON.parse(text.replace(/```json|```/g, '').trim());
        } catch {
          parsedData = undefined;
        }
      }

      // Extract actual token usage from Gemini response
      const usage = (response as any).usageMetadata;
      const tokenUsage = usage ? {
        promptTokens: usage.promptTokenCount as number | undefined,
        completionTokens: usage.candidatesTokenCount as number | undefined,
        totalTokens: usage.totalTokenCount as number | undefined,
      } : undefined;

      return {
        text: text || '',
        data: parsedData,
        groundingMetadata: (candidate as any)?.groundingMetadata,
        model,
        tokenUsage,
      };
    }, options), {
      label: `Gemini generateText(${model || 'default'})`,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    }).catch(err => {
      this.tagQuotaError(err);
      throw err;
    });
  }

  /* ---- generateImage ---- */

  async generateImage(
    model: string,
    prompt: string,
    aspectRatio = '16:9',
    _negativePrompt?: string,
    _options?: AIRequestOptions,
  ): Promise<GenerationResult> {
    return runWithAICallControl(() => withRetry(async () => {
      // Imagen family
      if (model.includes('imagen')) {
        return this.generateImagen(model, prompt, aspectRatio);
      }

      // Gemini native image gen
      const config: any = { imageConfig: { aspectRatio } };
      if (model.includes('gemini-3-pro')) {
        config.imageConfig.imageSize = '2K';
      }

      // Build content parts — include reference sheet as visual anchor if provided
      const parts: any[] = [];
      if (_options?.referenceImage) {
        const refUri = _options.referenceImage;
        const match = refUri.match(/^data:image\/(\w+);base64,(.+)$/);
        if (match) {
          parts.push({
            inlineData: { mimeType: `image/${match[1]}`, data: match[2] },
          });
          parts.push({ text: 'Using the above image as a strict Style Reference Sheet. Match its palette, lighting, and art style exactly.\n\n' });
        }
      }
      parts.push({ text: prompt });

      const response = await this.client.models.generateContent({
        model,
        contents: { parts },
        config,
      });

      const candidate = response.candidates?.[0];
      for (const part of candidate?.content?.parts ?? []) {
        if (part.inlineData?.data) {
          return { base64: `data:image/png;base64,${part.inlineData.data}`, model };
        }
      }
      throw new Error('No image returned from Gemini');
    }, _options), {
      label: `Gemini generateImage(${model || 'default'})`,
      signal: _options?.signal,
      timeoutMs: _options?.timeoutMs,
    }).catch(err => {
      this.tagQuotaError(err);
      throw err;
    });
  }

  private async generateImagen(model: string, prompt: string, aspectRatio: string): Promise<GenerationResult> {
    const response = await this.client.models.generateImages({
      model,
      prompt,
      config: { numberOfImages: 1, aspectRatio, outputMimeType: 'image/jpeg' },
    });
    const base64 = (response as any).generatedImages?.[0]?.image?.imageBytes;
    if (!base64) throw new Error('No image returned from Imagen');
    return { base64: `data:image/jpeg;base64,${base64}`, model };
  }

  /* ---- generateVideo (Veo) ---- */

  async generateVideo(
    model: string,
    prompt: string,
    options?: { aspectRatio?: string; image?: string; duration?: number; fps?: number; resolution?: '720p' | '1080p' } & AIRequestOptions,
  ): Promise<GenerationResult> {
    return runWithAICallControl(() => withRetry(async () => {
      let requestImage: any;
      if (options?.image) {
        const base64 = options.image.includes(',') ? options.image.split(',')[1] : options.image;
        requestImage = { imageBytes: base64, mimeType: 'image/png' };
      }

      let operation = await this.client.models.generateVideos({
        model,
        prompt,
        image: requestImage,
        config: {
          numberOfVideos: 1,
          resolution: options?.resolution ?? '720p',
          aspectRatio: options?.aspectRatio ?? '16:9',
          duration: options?.duration,
        } as any,
      });

      // Poll operation until done
      while (!operation.done) {
        throwIfAborted(options?.signal, `Gemini generateVideo(${model || 'default'})`);
        await waitWithAbort(5000, options?.signal, `Gemini generateVideo(${model || 'default'}) poll wait`);
        operation = await this.client.operations.getVideosOperation({ operation });
        log.debug('veo_poll', { metadata: (operation as any).metadata });
      }

      const downloadLink = (operation as any).response?.generatedVideos?.[0]?.video?.uri;
      if (!downloadLink) throw new Error('Video generation completed but no URI returned.');

      // Download video
      const resp = await fetch(downloadLink, {
        headers: { 'x-goog-api-key': this.apiKey },
        signal: options?.signal,
      });
      if (!resp.ok) throw new Error('Failed to download generated video.');

      const arrayBuf = await resp.arrayBuffer();
      const b64 = Buffer.from(arrayBuf).toString('base64');
      const dataUrl = `data:video/mp4;base64,${b64}`;

      const keyframeUrl = (operation as any).response?.generatedVideos?.[0]?.thumbnailUri;
      const durationMs = (operation as any).response?.generatedVideos?.[0]?.durationMs;

      return { videoUrl: dataUrl, keyframeUrl, durationMs, model };
    }, options), {
      label: `Gemini generateVideo(${model || 'default'})`,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs,
    }).catch(err => {
      this.tagQuotaError(err);
      throw err;
    });
  }

  /* ---- uploadFile ---- */

  async uploadFile(
    file: { name: string; path: string; mimeType: string },
    options?: AIRequestOptions,
  ): Promise<{ uri: string; mimeType: string }> {
    return withRetry(async () => {
      const { readFileSync } = await import('node:fs');
      const buffer = readFileSync(file.path);
      const blob = new Blob([buffer], { type: file.mimeType });
      const uploadFile = new File([blob], file.name, { type: file.mimeType });

      const uploadResponse = await this.client.files.upload({
        file: uploadFile,
        config: { displayName: file.name, mimeType: file.mimeType },
      });

      let fileInfo = uploadResponse as any;
      const pollStart = Date.now();
      const maxPollMs = 5 * 60_000; // 5 minutes max
      while (fileInfo.state === 'PROCESSING') {
        throwIfAborted(options?.signal, `Gemini uploadFile(${file.name})`);
        if (Date.now() - pollStart > maxPollMs) {
          throw new Error(`File processing timed out after ${Math.round(maxPollMs / 1000)}s (file: ${file.name})`);
        }
        await waitWithAbort(2000, options?.signal, `Gemini uploadFile(${file.name}) poll wait`);
        const status = await this.client.files.get({ name: fileInfo.name });
        if (status) fileInfo = status;
      }

      if (fileInfo.state === 'FAILED') {
        throw new Error(`File processing failed: ${fileInfo.error?.message}`);
      }

      return { uri: fileInfo.uri, mimeType: fileInfo.mimeType };
    }, options);
  }

  /* ---- generateSpeech (TTS) ---- */

  async generateSpeech(
    text: string,
    voice = 'Kore',
    _options?: AIRequestOptions,
  ): Promise<GenerationResult> {
    return runWithAICallControl(() => withRetry(async () => {
      const response = await this.client.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: { parts: [{ text }] },
        config: {
          responseModalities: [Modality.AUDIO],
          speechConfig: {
            voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } },
          },
        },
      });

      const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
      if (!base64Audio) throw new Error('No audio returned from Gemini TTS');

      const wavBase64 = pcmToWav(base64Audio, 24000);
      const url = `data:audio/wav;base64,${wavBase64}`;

      // Estimate duration
      const isChinese = /[\u4e00-\u9fa5]/.test(text);
      let duration = isChinese ? text.length * 0.3 : text.split(/\s+/).length / 2.5;
      duration = Math.max(2, duration);

      return { audioUrl: url, durationMs: duration * 1000, model: 'gemini-2.5-flash-preview-tts' };
    }, _options), {
      label: 'Gemini generateSpeech',
      signal: _options?.signal,
      timeoutMs: _options?.timeoutMs,
    }).catch(err => {
      this.tagQuotaError(err);
      throw err;
    });
  }

  /* ---- helpers ---- */

  private tagQuotaError(err: unknown): void {
    tagIfQuota(err);
  }
}
