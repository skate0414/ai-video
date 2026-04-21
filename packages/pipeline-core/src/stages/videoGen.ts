// @ts-nocheck -- see tsconfig.json noUncheckedIndexedAccess migration (scripts/check-strict-progress.mjs)
/* ------------------------------------------------------------------ */
/*  Pass 11: Video Gen – codegen (keyframe → video clips)            */
/*  Generates per-scene video segments from keyframe images.         */
/* ------------------------------------------------------------------ */

import type { AIAdapter, Scene, LogEntry } from '../pipelineTypes.js';
import type { VideoIR } from '../cir/types.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '@ai-video/pipeline-core/libFacade.js';
import { ARTIFACT } from '../constants.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildVideoPromptFromVideoIRScene,
  getAspectRatioFromVideoIR,
  getVideoIRScene,
} from './videoIRPromptSemantics.js';
import { extractVisualDNA, buildStyleAnchor } from './visualConsistency.js';
import { pickBestCandidate } from './multiCandidate.js';
import { computeCVMetrics, type CVQualityMetrics } from './cvMetrics.js';
import { computeBackoffDelay, getRetryBudget } from './retryResilience.js';

const slog = createLogger('VideoGen');

/* ------------------------------------------------------------------ */
/*  WorkerDispatch — quota-aware concurrent work distribution         */
/*                                                                     */
/*  Manages a shared work queue consumed by N adapters in parallel.   */
/*  When an adapter exhausts its quota it marks itself depleted so    */
/*  the dispatch layer can re-route its remaining items to healthy    */
/*  adapters instead of dropping them.                                */
/* ------------------------------------------------------------------ */

interface WorkerDispatch<T> {
  /** Claim the next pending item. Returns undefined when the queue is empty. */
  claimNext(): T | undefined;
  /** Return an item to the queue (e.g. on quota depletion before processing). */
  returnItem(item: T): void;
  /** Mark a worker as quota-depleted; it will receive no more items. */
  markDepleted(workerId: number): void;
  /** True when this specific worker has been marked depleted. */
  isDepleted(workerId: number): boolean;
  /** Number of items still waiting to be claimed. */
  pendingCount(): number;
  /** True when every one of the `totalWorkers` workers is depleted. */
  allDepleted(totalWorkers: number): boolean;
  /** All items not yet claimed (snapshot, for exhaustion reporting). */
  unclaimed(): T[];
}

function createWorkerDispatch<T>(items: T[]): WorkerDispatch<T> {
  const queue = [...items];
  let head = 0;
  const depleted = new Set<number>();
  return {
    claimNext: () => (head >= queue.length ? undefined : queue[head++]),
    returnItem: (item: T) => { queue.push(item); },
    markDepleted: (id: number) => depleted.add(id),
    isDepleted: (id: number) => depleted.has(id),
    pendingCount: () => queue.length - head,
    allDepleted: (total: number) => depleted.size >= total,
    unclaimed: () => queue.slice(head),
  };
}

/* ------------------------------------------------------------------ */

export interface VideoGenInput {
  scenes: Scene[];
  videoIR: VideoIR;
  assetsDir: string;
  aivideomakerAdapters?: AIAdapter[];
  candidateCount?: number;
}

const log = createStageLog('VIDEO_GEN');
const VIDEO_MAX_RETRIES = getRetryBudget();

export async function runVideoGen(
  adapter: AIAdapter,
  input: VideoGenInput,
  onLog?: (entry: LogEntry) => void,
  onSceneUpdate?: (scene: Scene) => void,
): Promise<Scene[]> {
  const emit = onLog ?? (() => {});
  const { scenes, assetsDir, aivideomakerAdapters, videoIR } = input;
  const candidateCount = input.candidateCount ?? 1;
  const results = scenes.map(s => ({ ...s }));
  const aspectRatio = getAspectRatioFromVideoIR(videoIR);

  for (let i = 0; i < results.length && i < videoIR.scenes.length; i++) {
    results[i].assetType = videoIR.scenes[i].assetType;
  }

  const videoScenes: { index: number; scene: Scene }[] = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].assetType === 'video') {
      const existingPath = join(assetsDir, `video_scene_${results[i].number}.mp4`);
      if (results[i].assetUrl || existsSync(existingPath)) {
        if (!results[i].assetUrl) {
          results[i].assetUrl = existingPath;
          results[i].status = 'done';
          slog.info('skip_existing_video', { scene: results[i].number, path: existingPath });
        }
        continue;
      }
      videoScenes.push({ index: i, scene: results[i] });
    }
  }

  const adapters = aivideomakerAdapters ?? [];
  emit(log(`Generating videos for ${videoScenes.length} scenes via ${adapters.length} aivideomaker account(s) in parallel...`));

  let styleAnchor = '';
  let refDNA: import('./visualConsistency.js').VisualDNA | undefined;
  const refSheetPath = join(assetsDir, ARTIFACT.REFERENCE_SHEET);
  if (existsSync(refSheetPath)) {
    try {
      refDNA = await extractVisualDNA(adapter, refSheetPath, emit);
      styleAnchor = buildStyleAnchor(refDNA);
      slog.info('style_anchor', { anchor: styleAnchor });
      emit(log('Style anchor loaded from reference sheet'));
    } catch {
      emit(log('Could not extract style anchor from reference sheet', 'warning'));
    }
  }

  const dispatch = createWorkerDispatch(videoScenes);

  async function worker(workerAdapter: AIAdapter, workerId: number) {
    while (true) {
      if (dispatch.isDepleted(workerId)) break;
      const item = dispatch.claimNext();
      if (!item) break;
      const { index, scene } = item;
      let succeeded = false;
      let quotaDepleted = false;

      for (let attempt = 0; attempt <= VIDEO_MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          const delay = computeBackoffDelay(attempt - 1, { baseDelayMs: 3000, maxDelayMs: 30_000, jitterFactor: 0.3 });
          emit(log(`[W${workerId}] Scene ${scene.number} video retry ${attempt}/${VIDEO_MAX_RETRIES} after ${(delay / 1000).toFixed(1)}s...`, 'warning'));
          await new Promise(r => setTimeout(r, delay));
        }
        try {
          results[index] = { ...results[index], status: 'generating', progressMessage: `Generating video${attempt > 0 ? ` (retry ${attempt})` : ''}... [W${workerId}]` };
          onSceneUpdate?.(results[index]);

          const irScene = getVideoIRScene(videoIR, scene.number, index);
          const irDuration = irScene.apiDurationSec;

          if (candidateCount > 1 && attempt === 0) {
            const tempResults = Array.from({ length: candidateCount }, () => ({ ...results[index] }));
            const { result: bestResult, score: bestScore } = await pickBestCandidate(
              async (ci) => {
                await generateSceneVideo(adapter, scene, irScene, aspectRatio, assetsDir, tempResults, ci, styleAnchor, workerAdapter, irDuration);
                return { ...tempResults[ci] };
              },
              async candidate => {
                if (!candidate.assetUrl) return 0;
                try {
                  const src = candidate.keyframeUrl ?? candidate.referenceImageUrl;
                  if (!src || !refDNA) return 50;
                  const dna = await extractVisualDNA(adapter, src, emit);
                  const { scoreVisualAgainstRef } = await import('../sceneQuality.js');
                  return scoreVisualAgainstRef(dna, refDNA);
                } catch {
                  return 50;
                }
              },
              candidateCount,
            );
            Object.assign(results[index], bestResult);
            slog.info('multi_candidate_video', { scene: scene.number, bestScore, candidates: candidateCount });
          } else {
            await generateSceneVideo(adapter, scene, irScene, aspectRatio, assetsDir, results, index, styleAnchor, workerAdapter, irDuration);
          }

          if (results[index].assetType === 'video' && results[index].assetUrl) {
            let sceneDna;
            try {
              const dnaSource = results[index].keyframeUrl ?? results[index].referenceImageUrl;
              if (dnaSource) sceneDna = await extractVisualDNA(adapter, dnaSource, emit);
            } catch (err) {
              slog.warn('dna_extract_failed', { scene: scene.number, err: err instanceof Error ? err.message : String(err) });
            }

            if (refDNA && sceneDna) {
              const { scoreVisualAgainstRef, shouldRetryBasedOnVisual, DEFAULT_VISUAL_CONSISTENCY_THRESHOLD, buildSceneQualityScore, shouldDegradeBasedOnOverall, DEFAULT_OVERALL_THRESHOLD } = await import('../sceneQuality.js');
              const visualScore = scoreVisualAgainstRef(sceneDna, refDNA);

              let cvMetrics: CVQualityMetrics | undefined;
              const dnaSource = results[index].keyframeUrl ?? results[index].referenceImageUrl;
              if (dnaSource && existsSync(refSheetPath)) {
                try {
                  cvMetrics = await computeCVMetrics(dnaSource, refSheetPath);
                } catch {}
              }

              const quality = buildSceneQualityScore(results[index], visualScore, cvMetrics);
              slog.info('video_gen_quality', { scene: scene.number, visualScore, overall: quality.overall, cv: cvMetrics });
              results[index].logs = results[index].logs ?? [];
              results[index].logs.push(`quality:${JSON.stringify(quality)}`);

              if (shouldRetryBasedOnVisual(visualScore, DEFAULT_VISUAL_CONSISTENCY_THRESHOLD) && attempt < VIDEO_MAX_RETRIES) {
                emit(log(`[W${workerId}] Scene ${scene.number} visual score ${visualScore} < ${DEFAULT_VISUAL_CONSISTENCY_THRESHOLD} — will retry`, 'warning'));
                results[index].status = 'pending';
                results[index].assetUrl = undefined as any;
                results[index].progressMessage = undefined;
                continue;
              }

              if (shouldDegradeBasedOnOverall(quality.overall, DEFAULT_OVERALL_THRESHOLD)) {
                emit(log(`[W${workerId}] Scene ${scene.number} overall quality ${quality.overall} < ${DEFAULT_OVERALL_THRESHOLD} — degrading to image`, 'warning'));
                const fallbackImage = results[index].keyframeUrl || results[index].referenceImageUrl;
                if (fallbackImage) {
                  results[index].assetUrl = fallbackImage;
                  results[index].assetType = 'image';
                  results[index].status = 'done';
                  results[index].progressMessage = undefined;
                  emit(log(`[W${workerId}] Scene ${scene.number} degraded to image after quality check`, 'warning'));
                  succeeded = true;
                  break;
                }
              }
            }

            results[index].status = 'done';
            results[index].progressMessage = undefined;
            emit(log(`[W${workerId}] Scene ${scene.number} video generated`, 'success'));
            if (!styleAnchor) {
              styleAnchor = `Maintain visual consistency with this established style: ${irScene.visualPrompt.slice(0, 150)}`;
            }
            succeeded = true;
            break;
          } else {
            emit(log(`[W${workerId}] Scene ${scene.number} video attempt ${attempt + 1} produced no video`, 'warning'));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          if ((err as any)?.isQuotaError) {
            emit(log(`[W${workerId}] Quota depleted — returning scene ${scene.number} to queue`, 'warning'));
            dispatch.markDepleted(workerId);
            quotaDepleted = true;
            results[index].status = 'pending';
            results[index].progressMessage = undefined;
            results[index].assetUrl = undefined as any;
            results[index].assetType = 'video';
            dispatch.returnItem(item);
            break;
          }
          results[index].logs.push(`Video gen attempt ${attempt + 1} error: ${msg}`);
          if (attempt === VIDEO_MAX_RETRIES) {
            results[index].status = 'error';
            results[index].progressMessage = msg;
            emit(log(`[W${workerId}] Scene ${scene.number} video generation failed after ${VIDEO_MAX_RETRIES + 1} attempts: ${msg}`, 'error'));
          }
        } finally {
          onSceneUpdate?.(results[index]);
        }
      }

      if (quotaDepleted) break;
      if (!succeeded) {
        const fallbackImage = scene.keyframeUrl || scene.referenceImageUrl;
        if (fallbackImage) {
          results[index].assetUrl = fallbackImage;
          results[index].assetType = 'image';
          results[index].status = 'done';
          results[index].progressMessage = undefined;
          emit(log(`[W${workerId}] Scene ${scene.number} degraded to Ken Burns image: ${fallbackImage.slice(-40)}`, 'warning'));
        } else {
          emit(log(`[W${workerId}] Scene ${scene.number} video generation failed — no fallback image available`, 'error'));
        }
        onSceneUpdate?.(results[index]);
      }
    }
  }

  if (adapters.length > 0 && videoScenes.length > 0) {
    await Promise.all(adapters.map((a, i) => worker(a, i)));
    while (dispatch.pendingCount() > 0 && !dispatch.allDepleted(adapters.length)) {
      const healthyAdapters = adapters.map((a, i) => ({ adapter: a, id: i })).filter(w => !dispatch.isDepleted(w.id));
      emit(log(`Re-dispatching ${dispatch.pendingCount()} returned scene(s) to ${healthyAdapters.length} healthy worker(s)`, 'info'));
      await Promise.all(healthyAdapters.map(w => worker(w.adapter, w.id)));
    }

    if (dispatch.allDepleted(adapters.length) && dispatch.pendingCount() > 0) {
      for (const { index, scene } of dispatch.unclaimed()) {
        if (results[index].status !== 'done') {
          const msg = `All ${adapters.length} accounts depleted — no worker available`;
          emit(log(`Scene ${scene.number}: ${msg}`, 'warning'));
          results[index].status = 'error';
          results[index].progressMessage = msg;
          if (scene.keyframeUrl) {
            results[index].assetUrl = scene.keyframeUrl;
            results[index].assetType = 'image';
          }
          onSceneUpdate?.(results[index]);
        }
      }
    }
  } else if (videoScenes.length > 0) {
    emit(log('No aivideomaker adapters configured — all video scenes will be skipped', 'error'));
  }

  const totalVideoScenes = results.filter(s => s.assetType === 'video').length;
  const successCount = results.filter(s => s.assetType === 'video' && s.assetUrl && s.status === 'done').length;
  const skippedCount = totalVideoScenes - videoScenes.length;
  emit(log(`Video generation complete: ${successCount}/${totalVideoScenes} (${skippedCount} skipped, ${videoScenes.length} attempted)`, successCount < totalVideoScenes ? 'warning' : 'success'));

  if (videoScenes.length > 0 && successCount === skippedCount) {
    throw new Error(
      `视频生成完全失败：${videoScenes.length} 个场景均未能生成视频片段。` +
      '请检查 aivideomaker API key 是否有效。',
    );
  }

  return results;
}

async function generateSceneVideo(
  adapter: AIAdapter,
  scene: Scene,
  irScene: VideoIR['scenes'][number],
  aspectRatio: string,
  assetsDir: string,
  results: Scene[],
  idx: number,
  styleAnchor?: string,
  aivideomakerAdapter?: AIAdapter,
  duration?: number,
): Promise<void> {
  const enrichedPrompt = buildVideoPromptFromVideoIRScene(
    irScene,
    aspectRatio,
    duration ?? irScene.apiDurationSec,
    styleAnchor,
  );
  void adapter;

  if (aivideomakerAdapter) {
    try {
      slog.info('aivideomaker_attempt', { scene: scene.number, keyframe: scene.keyframeUrl ?? 'NONE' });
      const videoResult = await aivideomakerAdapter.generateVideo('i2v', enrichedPrompt, {
        image: scene.keyframeUrl,
        duration: duration ?? irScene.apiDurationSec,
        aspectRatio,
      });
      if (videoResult.videoUrl) {
        const outPath = join(assetsDir, `video_scene_${scene.number}.mp4`);
        const { writeFileSync } = await import('node:fs');
        if (videoResult.videoUrl.startsWith('data:')) {
          const b64 = videoResult.videoUrl.split(',')[1];
          writeFileSync(outPath, Buffer.from(b64, 'base64'));
        } else {
          const resp = await fetch(videoResult.videoUrl);
          if (resp.ok) writeFileSync(outPath, Buffer.from(await resp.arrayBuffer()));
        }
        slog.info('aivideomaker_success', { scene: scene.number, model: videoResult.model, path: outPath });
        results[idx].assetUrl = outPath;
        results[idx].assetType = 'video';
        return;
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err);
      slog.warn('aivideomaker_error', { scene: scene.number, error: errMsg });
      if ((err as any)?.isQuotaError) throw err;
    }
  }

  const warnMsg = `⚠️ scene ${scene.number} video generation FAILED — downgrading to static image.`;
  slog.warn('video_gen_failed', { scene: scene.number, detail: warnMsg });
  results[idx].logs.push(warnMsg);
  results[idx].status = 'error';
  results[idx].progressMessage = warnMsg;
  if (scene.keyframeUrl) {
    results[idx].assetUrl = scene.keyframeUrl;
    results[idx].assetType = 'image';
  }
}
