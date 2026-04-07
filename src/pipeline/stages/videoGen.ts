/* ------------------------------------------------------------------ */
/*  Stage 11: Video Gen – generate videos from keyframes              */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, Scene, LogEntry } from '../types.js';
import { generateVideoViaWeb, type VideoProviderConfig } from '../../adapters/videoProvider.js';
import { createStageLog } from './stageLog.js';

export interface VideoGenInput {
  scenes: Scene[];
  styleProfile: StyleProfile;
  assetsDir: string;
  videoProviderConfig?: VideoProviderConfig;
  concurrency?: number;
}

const log = createStageLog('VIDEO_GEN');

/**
 * Generate videos from keyframe images for scenes with assetType === 'video'.
 * Uses VideoProvider (Seedance web) or adapter's built-in video generation.
 */
export async function runVideoGen(
  adapter: AIAdapter,
  input: VideoGenInput,
  onLog?: (entry: LogEntry) => void,
  onSceneUpdate?: (scene: Scene) => void,
): Promise<Scene[]> {
  const emit = onLog ?? (() => {});
  const { scenes, styleProfile, assetsDir, videoProviderConfig } = input;
  const concurrency = input.concurrency ?? 2;
  const results = scenes.map(s => ({ ...s }));

  const videoScenes = results.filter(s => s.assetType === 'video');
  emit(log(`Generating videos for ${videoScenes.length} scenes (concurrency: ${concurrency})...`));

  let activeCount = 0;
  const promises: Promise<void>[] = [];

  for (let i = 0; i < results.length; i++) {
    const scene = results[i];
    if (scene.assetType !== 'video') continue;

    const idx = i;
    const p = (async () => {
      while (activeCount >= concurrency) {
        await new Promise(r => setTimeout(r, 500));
      }
      activeCount++;
      try {
        results[idx] = { ...results[idx], status: 'generating', progressMessage: 'Generating video...' };
        onSceneUpdate?.(results[idx]);

        await generateSceneVideo(adapter, scene, styleProfile, assetsDir, videoProviderConfig, results, idx);

        results[idx].status = 'done';
        results[idx].progressMessage = undefined;
        emit(log(`Scene ${scene.number} video generated`, 'success'));
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        results[idx].status = 'error';
        results[idx].progressMessage = msg;
        results[idx].logs.push(`Video gen error: ${msg}`);
        emit(log(`Scene ${scene.number} video generation failed: ${msg}`, 'error'));
      } finally {
        activeCount--;
        onSceneUpdate?.(results[idx]);
      }
    })();
    promises.push(p);
  }

  await Promise.all(promises);

  const successCount = results.filter(s => s.assetType === 'video' && s.assetUrl && s.status === 'done').length;
  emit(log(`Video generation complete: ${successCount}/${videoScenes.length}`, successCount < videoScenes.length ? 'warning' : 'success'));
  return results;
}

async function generateSceneVideo(
  adapter: AIAdapter,
  scene: Scene,
  styleProfile: StyleProfile,
  assetsDir: string,
  videoProviderConfig: VideoProviderConfig | undefined,
  results: Scene[],
  idx: number,
): Promise<void> {
  // Try VideoProvider (Seedance web) with keyframe image
  if (videoProviderConfig && scene.keyframeUrl) {
    const videoResult = await generateVideoViaWeb(
      videoProviderConfig,
      {
        prompt: scene.visualPrompt,
        imageUrl: scene.keyframeUrl,
        duration: scene.estimatedDuration,
      },
      assetsDir,
      `video_scene_${scene.number}.mp4`,
    );
    if (videoResult) {
      results[idx].assetUrl = videoResult.localPath;
      results[idx].assetType = 'video';
      return;
    }
  }

  // Fallback: adapter's built-in video generation
  try {
    const videoResult = await adapter.generateVideo('', scene.visualPrompt, {
      image: scene.keyframeUrl,
      duration: scene.estimatedDuration,
      aspectRatio: styleProfile.targetAspectRatio ?? '16:9',
    });
    if (videoResult.videoUrl) {
      results[idx].assetUrl = videoResult.videoUrl;
      results[idx].assetType = 'video';
      return;
    }
  } catch {
    // Fall through to keyframe-only fallback
  }

  // If video gen fails, keep keyframe image as the asset
  if (scene.keyframeUrl) {
    results[idx].assetUrl = scene.keyframeUrl;
    results[idx].assetType = 'image';
  }
}
