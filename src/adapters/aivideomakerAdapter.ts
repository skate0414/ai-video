/* ------------------------------------------------------------------ */
/*  AIVideoMakerAdapter – aivideomaker.ai API backend                 */
/*  REST API integration for text-to-video and image-to-video.       */
/* ------------------------------------------------------------------ */

import { readFileSync, existsSync } from 'node:fs';
import type { AIAdapter, AIRequestOptions, GenerationResult } from '../pipeline/types.js';
import { API_MAX_RETRIES } from '../constants.js';
import { runWithAICallControl, throwIfAborted, waitWithAbort } from '../pipeline/aiControl.js';
import { createLogger } from '../lib/logger.js';

const log = createLogger('AIVideoMaker');

const BASE_URL = 'https://aivideomaker.ai';

const DEFAULT_HEADERS = {
  'content-type': 'application/json',
  'user-agent': 'Mozilla/5.0',
};

type TaskStatus = 'SUBMITTED' | 'PROGRESS' | 'COMPLETED' | 'FAILED' | 'CANCEL';

interface CreateTaskResponse {
  taskId: string;
  statusUrl: string;
  responseUrl: string;
}

interface TaskStatusResponse {
  status: TaskStatus;
}

interface TaskDetailsResponse {
  taskId: string;
  status: TaskStatus;
  output?: string;
  [key: string]: unknown;
}

/** Retry helper with exponential backoff. */
async function withRetry<T>(fn: () => Promise<T>, options?: AIRequestOptions, maxRetries = API_MAX_RETRIES): Promise<T> {
  let lastErr: unknown;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    throwIfAborted(options?.signal, 'AIVideoMaker API request');
    try {
      return await fn();
    } catch (err: unknown) {
      lastErr = err;
      if (attempt === maxRetries) break;

      const errMsg = err instanceof Error ? err.message : '';
      const is429 = errMsg.includes('429') || errMsg.includes('rate limit');
      const isTransient = is429 || errMsg.includes('500') || errMsg.includes('503');
      if (!isTransient) break;

      const baseDelay = is429 ? 30_000 : 1000 * Math.pow(2, attempt);
      const jitter = Math.random() * 500;
      log.info('retry', { attempt: attempt + 1, maxRetries, delayMs: Math.round(baseDelay) });
      await waitWithAbort(baseDelay + jitter, options?.signal, 'AIVideoMaker retry wait');
    }
  }
  throw lastErr;
}

export class AIVideoMakerAdapter implements AIAdapter {
  provider = 'aivideomaker';
  private apiKey: string;
  keyFingerprint: string;

  constructor(apiKey: string) {
    this.apiKey = apiKey;
    this.keyFingerprint = `...${apiKey.slice(-4)}`;
  }

  private headers(): Record<string, string> {
    return { ...DEFAULT_HEADERS, key: this.apiKey };
  }

  /* ---- generateText (not supported — stub) ---- */

  async generateText(
    _model: string,
    _prompt: string | any[],
    _options?: AIRequestOptions,
  ): Promise<GenerationResult> {
    throw new Error('AIVideoMakerAdapter does not support text generation.');
  }

  /* ---- generateImage (not supported — stub) ---- */

  async generateImage(
    _model: string,
    _prompt: string,
    _aspectRatio?: string,
    _negativePrompt?: string,
    _options?: AIRequestOptions,
  ): Promise<GenerationResult> {
    throw new Error('AIVideoMakerAdapter does not support image generation.');
  }

  /* ---- generateVideo ---- */

  async generateVideo(
    model: string,
    prompt: string,
    options?: { aspectRatio?: string; image?: string; duration?: number; fps?: number; resolution?: '720p' | '1080p' } & AIRequestOptions,
  ): Promise<GenerationResult> {
    return runWithAICallControl(() => withRetry(async () => {
      // Choose model: use i2v when a keyframe image is provided, t2v otherwise
      const hasImage = !!options?.image;
      const rawDuration = options?.duration ?? 5;
      // Use v3 models for durations > 8s (v3 supports 5/10/15/20s)
      const useV3 = rawDuration > 8;
      // Snap to valid API durations: v1/v2 accept '5'|'8', v3 accepts '5'|'10'|'15'|'20'
      const validDurations = useV3 ? [5, 10, 15, 20] : [5, 8];
      const duration = validDurations.reduce((best, d) =>
        Math.abs(d - rawDuration) < Math.abs(best - rawDuration) ? d : best,
      );
      const effectiveModel = model || (
        hasImage
          ? (useV3 ? 'i2v_v3' : 'i2v')
          : (useV3 ? 't2v_v3' : 't2v')
      );

      // Build request body
      const body: Record<string, unknown> = {
        prompt,
        duration: String(duration),
      };

      if (options?.aspectRatio) {
        body.aspect_ratio = options.aspectRatio;
      }

      if (hasImage) {
        let imageData = options!.image!;
        // If it's a local file path, read and convert to base64 data URI
        if (!imageData.startsWith('data:') && !imageData.startsWith('http') && existsSync(imageData)) {
          const buffer = readFileSync(imageData);
          const ext = imageData.split('.').pop()?.toLowerCase() || 'png';
          const mime = ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : `image/${ext}`;
          imageData = `data:${mime};base64,${buffer.toString('base64')}`;
          log.info('read_local_image', { path: imageData.slice(0, 80), sizeKB: Math.round(buffer.length / 1024) });
        }
        // Send full data URI or public URL as-is (API accepts both formats)
        body.image = imageData;
      }

      log.info('create_task', { model: effectiveModel, hasImage, duration, prompt: prompt.slice(0, 120) });

      // Step 1: Create video generation task
      const createResp = await fetch(`${BASE_URL}/api/v1/generate/${effectiveModel}`, {
        method: 'POST',
        headers: this.headers(),
        body: JSON.stringify(body),
        signal: options?.signal,
      });

      if (!createResp.ok) {
        const errText = await createResp.text().catch(() => '');
        if (errText.includes('Insufficient credits') || errText.includes('insufficient')) {
          const err = new Error(`AIVideoMaker API: Insufficient credits (${createResp.status})`);
          (err as any).isQuotaError = true;
          throw err;
        }
        throw new Error(`AIVideoMaker create task failed: ${createResp.status} ${errText}`);
      }

      const taskData = await createResp.json() as CreateTaskResponse;
      const { taskId } = taskData;
      log.info('task_created', { taskId, model: effectiveModel });

      // Step 2: Poll task status until completion
      const pollInterval = 5_000;
      const maxPollTime = 10 * 60_000; // 10 min max
      const pollStart = Date.now();

      while (true) {
        throwIfAborted(options?.signal, `AIVideoMaker poll(${taskId})`);
        await waitWithAbort(pollInterval, options?.signal, `AIVideoMaker poll wait(${taskId})`);

        if (Date.now() - pollStart > maxPollTime) {
          throw new Error(`AIVideoMaker task ${taskId} timed out after ${maxPollTime / 1000}s`);
        }

        const statusResp = await fetch(`${BASE_URL}/api/v1/tasks/${taskId}/status`, {
          headers: this.headers(),
          signal: options?.signal,
        });

        if (!statusResp.ok) {
          log.warn('status_poll_error', { taskId, status: statusResp.status });
          continue; // Transient error — retry poll
        }

        const statusData = await statusResp.json() as TaskStatusResponse;
        log.info('poll_status', { taskId, status: statusData.status });

        if (statusData.status === 'COMPLETED') break;
        if (statusData.status === 'FAILED') {
          throw new Error(`AIVideoMaker task ${taskId} failed`);
        }
        if (statusData.status === 'CANCEL') {
          throw new Error(`AIVideoMaker task ${taskId} was cancelled`);
        }
        // SUBMITTED or PROGRESS — continue polling
      }

      // Step 3: Fetch task details to get the output URL
      const detailsResp = await fetch(`${BASE_URL}/api/v1/tasks/${taskId}`, {
        headers: this.headers(),
        signal: options?.signal,
      });

      if (!detailsResp.ok) {
        throw new Error(`AIVideoMaker task details fetch failed: ${detailsResp.status}`);
      }

      const details = await detailsResp.json() as TaskDetailsResponse;
      log.info('task_details_raw', { taskId, outputType: typeof details.output, keys: Object.keys(details) });

      // output may be a string URL, an object with url/video_url, or an array of outputs
      let videoUrl: string | undefined;
      const rawOutput = details.output as unknown;
      if (typeof rawOutput === 'string') {
        videoUrl = rawOutput;
      } else if (rawOutput && typeof rawOutput === 'object') {
        const obj = rawOutput as Record<string, unknown>;
        videoUrl = (obj.url ?? obj.video_url ?? obj.videoUrl ?? obj.video) as string | undefined;
        // If it's an array, take the first element
        if (Array.isArray(rawOutput) && rawOutput.length > 0) {
          const first = rawOutput[0];
          videoUrl = typeof first === 'string' ? first : (first as Record<string, unknown>)?.url as string | undefined;
        }
      }
      if (!videoUrl || typeof videoUrl !== 'string') {
        throw new Error(`AIVideoMaker task ${taskId} completed but no output URL returned. Raw output: ${(JSON.stringify(rawOutput) ?? 'undefined').slice(0, 300)}`);
      }

      log.info('task_completed', { taskId, videoUrl: videoUrl.slice(0, 100) });

      // Step 4: Download video and return as base64 data-URI
      const downloadResp = await fetch(videoUrl, { signal: options?.signal });
      if (!downloadResp.ok) {
        throw new Error(`Failed to download AIVideoMaker video: ${downloadResp.status}`);
      }

      const arrayBuf = await downloadResp.arrayBuffer();
      const b64 = Buffer.from(arrayBuf).toString('base64');
      const dataUrl = `data:video/mp4;base64,${b64}`;

      return {
        videoUrl: dataUrl,
        durationMs: duration * 1000,
        model: effectiveModel,
      };
    }, options), {
      label: `AIVideoMaker generateVideo(${model || 'auto'})`,
      signal: options?.signal,
      timeoutMs: options?.timeoutMs ?? 12 * 60_000,
    }).catch(err => {
      // Tag quota errors so FallbackAdapter can recognise them
      if (err instanceof Error && /insufficient|credits|quota|limit/i.test(err.message)) {
        (err as any).isQuotaError = true;
      }
      throw err;
    });
  }
}
