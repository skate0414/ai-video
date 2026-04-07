/* ------------------------------------------------------------------ */
/*  Stage 11: Video Gen – generate videos from keyframes              */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, Scene, LogEntry } from '../types.js';
import { generateVideoViaWeb, type VideoProviderConfig } from '../../adapters/videoProvider.js';
import { IMAGE_GEN_PROMPT, VIDEO_GEN_PROMPT, fillTemplate } from '../prompts.js';
import { createStageLog } from './stageLog.js';

export interface VideoGenInput {
  scenes: Scene[];
  styleProfile: StyleProfile;
  assetsDir: string;
  videoProviderConfig?: VideoProviderConfig;
  concurrency?: number;
}

const log = createStageLog('VIDEO_GEN');

const VIDEO_MAX_RETRIES = 1; // one retry per scene (total 2 attempts)
const VIDEO_RETRY_DELAY_MS = 10_000;

/**
 * Generate videos from keyframe images for scenes with assetType === 'video'.
 * Uses VideoProvider (即梦/可灵 web) or adapter's built-in video generation.
 *
 * Multi-account rotation: if videoProviderConfig.profileDirs has multiple entries,
 * scenes are distributed across accounts and processed concurrently (one scene per account).
 */
export async function runVideoGen(
  adapter: AIAdapter,
  input: VideoGenInput,
  onLog?: (entry: LogEntry) => void,
  onSceneUpdate?: (scene: Scene) => void,
): Promise<Scene[]> {
  const emit = onLog ?? (() => {});
  const { scenes, styleProfile, assetsDir, videoProviderConfig } = input;
  const results = scenes.map(s => ({ ...s }));

  const videoScenes: { index: number; scene: Scene }[] = [];
  for (let i = 0; i < results.length; i++) {
    if (results[i].assetType === 'video') {
      videoScenes.push({ index: i, scene: results[i] });
    }
  }

  // Determine available profile directories for multi-account rotation
  const profileDirs = videoProviderConfig?.profileDirs?.length
    ? videoProviderConfig.profileDirs
    : videoProviderConfig?.profileDir
      ? [videoProviderConfig.profileDir]
      : [];
  const concurrency = Math.min(profileDirs.length || 1, (input.concurrency ?? profileDirs.length) || 1);

  emit(log(`Generating videos for ${videoScenes.length} scenes using ${profileDirs.length} account(s), concurrency=${concurrency}...`));

  // Style anchor: first scene's visual prompt serves as consistency reference
  let styleAnchor = '';

  if (profileDirs.length <= 1) {
    // Single account: process serially to avoid profile lock conflicts
    for (const { index, scene } of videoScenes) {
      let succeeded = false;
      for (let attempt = 0; attempt <= VIDEO_MAX_RETRIES; attempt++) {
        if (attempt > 0) {
          emit(log(`Scene ${scene.number} video retry ${attempt}/${VIDEO_MAX_RETRIES} after ${VIDEO_RETRY_DELAY_MS / 1000}s...`, 'warning'));
          await new Promise(r => setTimeout(r, VIDEO_RETRY_DELAY_MS));
        }
        try {
          results[index] = { ...results[index], status: 'generating', progressMessage: `Generating video${attempt > 0 ? ` (retry ${attempt})` : ''}...` };
          onSceneUpdate?.(results[index]);

          await generateSceneVideo(adapter, scene, styleProfile, assetsDir, videoProviderConfig, results, index, styleAnchor);

          if (results[index].assetType === 'video' && results[index].assetUrl) {
            results[index].status = 'done';
            results[index].progressMessage = undefined;
            emit(log(`Scene ${scene.number} video generated`, 'success'));
            // Set style anchor from first successful scene
            if (!styleAnchor) {
              styleAnchor = `Maintain visual consistency with this established style: ${scene.visualPrompt.slice(0, 150)}`;
            }
            succeeded = true;
            break;
          } else {
            emit(log(`Scene ${scene.number} video attempt ${attempt + 1} produced no video`, 'warning'));
          }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          results[index].logs.push(`Video gen attempt ${attempt + 1} error: ${msg}`);
          if (attempt === VIDEO_MAX_RETRIES) {
            results[index].status = 'error';
            results[index].progressMessage = msg;
            emit(log(`Scene ${scene.number} video generation failed after ${VIDEO_MAX_RETRIES + 1} attempts: ${msg}`, 'error'));
          }
        } finally {
          onSceneUpdate?.(results[index]);
        }
      }
      if (!succeeded) {
        emit(log(`Scene ${scene.number} video generation failed — degraded to static image`, 'warning'));
      }
    }
  } else {
    // Multi-account: run up to `concurrency` scenes in parallel, each with its own profile.
    // Use a worker pool pattern — each worker claims the next unprocessed scene.
    let nextScene = 0;

    const worker = async (profileDir: string, workerIdx: number) => {
      while (nextScene < videoScenes.length) {
        const sceneIdx = nextScene++;
        const { index, scene } = videoScenes[sceneIdx];

        // Create a per-scene config with this worker's profileDir
        const sceneConfig: VideoProviderConfig = { ...videoProviderConfig!, profileDir };

        emit(log(`Scene ${scene.number} → account ${workerIdx + 1} (${profileDir.split('/').pop()})`));

        let succeeded = false;
        for (let attempt = 0; attempt <= VIDEO_MAX_RETRIES; attempt++) {
          if (attempt > 0) {
            // On retry, try next profile if available for account rotation
            const altIdx = (workerIdx + attempt) % profileDirs.length;
            sceneConfig.profileDir = profileDirs[altIdx];
            emit(log(`Scene ${scene.number} video retry ${attempt} using account ${altIdx + 1}`, 'warning'));
            await new Promise(r => setTimeout(r, VIDEO_RETRY_DELAY_MS));
          }
          try {
            results[index] = { ...results[index], status: 'generating', progressMessage: `Generating video (account ${workerIdx + 1})${attempt > 0 ? ` retry ${attempt}` : ''}...` };
            onSceneUpdate?.(results[index]);

            await generateSceneVideo(adapter, scene, styleProfile, assetsDir, sceneConfig, results, index, styleAnchor);

            if (results[index].assetType === 'video' && results[index].assetUrl) {
              results[index].status = 'done';
              results[index].progressMessage = undefined;
              emit(log(`Scene ${scene.number} video generated (account ${workerIdx + 1})`, 'success'));
              if (!styleAnchor) {
                styleAnchor = `Maintain visual consistency with this established style: ${scene.visualPrompt.slice(0, 150)}`;
              }
              succeeded = true;
              break;
            } else {
              emit(log(`Scene ${scene.number} video attempt ${attempt + 1} produced no video (account ${workerIdx + 1})`, 'warning'));
            }
          } catch (err) {
            const msg = err instanceof Error ? err.message : String(err);
            results[index].logs.push(`Video gen attempt ${attempt + 1} error: ${msg}`);
            if (attempt === VIDEO_MAX_RETRIES) {
              results[index].status = 'error';
              results[index].progressMessage = msg;
              emit(log(`Scene ${scene.number} video failed after ${VIDEO_MAX_RETRIES + 1} attempts (account ${workerIdx + 1}): ${msg}`, 'error'));
            }
          } finally {
            onSceneUpdate?.(results[index]);
          }
        }
        if (!succeeded) {
          emit(log(`Scene ${scene.number} video generation failed — degraded to static image`, 'warning'));
        }
      }
    };

    // Launch one worker per profile (up to concurrency limit)
    const workers = profileDirs.slice(0, concurrency).map((dir, i) => worker(dir, i));
    await Promise.all(workers);
  }

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
  styleAnchor?: string,
): Promise<void> {
  // Build a video-specific prompt for the video provider (即梦/可灵)
  const trackB = styleProfile.track_b_visual ?? {};
  const enrichedPrompt = fillTemplate(VIDEO_GEN_PROMPT, {
    visual_prompt: scene.visualPrompt,
    color_palette: (styleProfile.colorPalette ?? []).join(', '),
    lighting_style: trackB.lighting_style ?? 'cinematic',
    visual_style: styleProfile.visualStyle ?? '3D animation',
    aspect_ratio: styleProfile.targetAspectRatio ?? '16:9',
    duration: String(scene.estimatedDuration ?? 5),
    style_anchor: styleAnchor ?? '',
  });

  // Try VideoProvider (即梦/可灵 web) — with keyframe image if available, prompt-only otherwise
  if (videoProviderConfig) {
    const providerName = videoProviderConfig.provider === 'kling' || videoProviderConfig.url?.includes('klingai.com') ? '可灵' : '即梦';
    console.log(`[VIDEO_GEN] scene ${scene.number} using VideoProvider (${providerName}), keyframe:`, scene.keyframeUrl ?? 'NONE (prompt-only)');
    const videoResult = await generateVideoViaWeb(
      videoProviderConfig,
      {
        prompt: enrichedPrompt,
        imageUrl: scene.keyframeUrl || undefined,
        duration: scene.estimatedDuration,
      },
      assetsDir,
      `video_scene_${scene.number}.mp4`,
    );
    if (videoResult) {
      console.log(`[VIDEO_GEN] scene ${scene.number} VideoProvider success:`, videoResult.localPath);
      results[idx].assetUrl = videoResult.localPath;
      results[idx].assetType = 'video';
      return;
    }
  }

  // Fallback: adapter's built-in video generation
  try {
    console.log(`[VIDEO_GEN] scene ${scene.number} trying adapter built-in video gen, prompt:`, enrichedPrompt.slice(0, 200));
    const videoResult = await adapter.generateVideo('', enrichedPrompt, {
      image: scene.keyframeUrl,
      duration: scene.estimatedDuration,
      aspectRatio: styleProfile.targetAspectRatio ?? '16:9',
    });
    if (videoResult.videoUrl) {
      console.log(`[VIDEO_GEN] scene ${scene.number} adapter video gen success:`, videoResult.videoUrl);
      results[idx].assetUrl = videoResult.videoUrl;
      results[idx].assetType = 'video';
      return;
    }
  } catch {
    // Fall through to keyframe-only fallback
  }

  // If video gen fails, keep keyframe image as the asset
  const warnMsg = `⚠️ scene ${scene.number} video generation FAILED — downgrading to static image. Check video provider login status.`;
  console.warn(`[VIDEO_GEN] ${warnMsg}`);
  results[idx].logs.push(warnMsg);
  results[idx].status = 'error';
  results[idx].progressMessage = warnMsg;
  if (scene.keyframeUrl) {
    results[idx].assetUrl = scene.keyframeUrl;
    results[idx].assetType = 'image';
  }
}
