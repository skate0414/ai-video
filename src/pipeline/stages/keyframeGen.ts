/* ------------------------------------------------------------------ */
/*  Pass 10: Keyframe Gen – codegen (scene → keyframe images)        */
/*  Produces keyframe images that serve as input for video codegen.  */
/* ------------------------------------------------------------------ */

import type { AIAdapter, Scene, LogEntry } from '../types.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';
import type { VideoIR } from '../../cir/types.js';
import { ARTIFACT } from '../../constants.js';

const slog = createLogger('KeyframeGen');
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildImagePromptFromVideoIRScene,
  getAspectRatioFromVideoIR,
  getVideoIRScene,
} from './videoIRPromptSemantics.js';

export interface KeyframeGenInput {
  scenes: Scene[];
  videoIR: VideoIR;
  assetsDir: string;
}

const log = createStageLog('KEYFRAME_GEN');

const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 5_000;

/**
 * Generate keyframe images for scenes that need video generation.
 * Keyframes serve as the first frame for img2video generation.
 * Only processes scenes with assetType === 'video'.
 * Failed scenes are retried up to MAX_RETRIES times with back-off.
 */
export async function runKeyframeGen(
  adapter: AIAdapter,
  input: KeyframeGenInput,
  onLog?: (entry: LogEntry) => void,
): Promise<Scene[]> {
  const emit = onLog ?? (() => {});
  const { scenes, videoIR, assetsDir } = input;
  const results = scenes.map(s => ({ ...s }));
  const aspectRatio = getAspectRatioFromVideoIR(videoIR);

  // Sync asset types from VideoIR — compile pass is the source of truth.
  for (let i = 0; i < results.length; i++) {
    const irScene = getVideoIRScene(videoIR, results[i].number, i);
    results[i].assetType = irScene.assetType;
  }

  const videoScenes = results.filter(s => s.assetType === 'video');
  emit(log(`Generating keyframes for ${videoScenes.length} video scenes...`));

  // Load reference sheet for visual anchoring (if previously generated)
  let refSheetBase64: string | undefined;
  const sheetPath = join(assetsDir, ARTIFACT.REFERENCE_SHEET);
  if (existsSync(sheetPath)) {
    refSheetBase64 = `data:image/png;base64,${readFileSync(sheetPath).toString('base64')}`;
    emit(log('Using reference sheet as visual anchor for keyframes'));
  }

  for (let i = 0; i < results.length; i++) {
    const scene = results[i];
    if (scene.assetType !== 'video') continue;

    // If scene already has a reference image, use it as keyframe fallback
    if (!scene.keyframeUrl && (scene.referenceImageUrl || scene.assetUrl)) {
      results[i].keyframeUrl = scene.referenceImageUrl ?? scene.assetUrl;
    }

    const irScene = getVideoIRScene(videoIR, scene.number, i);
    const imagePrompt = buildImagePromptFromVideoIRScene(irScene, aspectRatio);

    let generated = false;
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      if (attempt > 0) {
        const delay = RETRY_DELAY_MS * attempt;
        emit(log(`Scene ${scene.number} keyframe retry ${attempt}/${MAX_RETRIES} after ${delay / 1000}s...`, 'warning'));
        await new Promise(r => setTimeout(r, delay));
      }

      try {
        emit(log(`Generating keyframe for scene ${scene.number}${attempt > 0 ? ` (attempt ${attempt + 1})` : ''}...`));
        slog.debug('scene_prompt', { scene: scene.number, prompt: imagePrompt.slice(0, 300) });

        const result = await adapter.generateImage(
          '',
          imagePrompt,
          aspectRatio,
          undefined,
          refSheetBase64 ? { referenceImage: refSheetBase64 } : undefined,
        );
        slog.debug('scene_result', { scene: scene.number, type: result.imageUrl ? 'imageUrl' : result.base64 ? 'base64' : 'no image' });

        if (result.imageUrl) {
          results[i].keyframeUrl = result.imageUrl;
          emit(log(`Scene ${scene.number} keyframe generated`, 'success'));
          generated = true;
          break;
        } else if (result.base64) {
          if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });
          const match = result.base64.match(/^data:image\/(\w+);base64,(.+)$/);
          const ext = match?.[1] ?? 'png';
          const b64data = match?.[2] ?? result.base64;
          const filePath = join(assetsDir, `keyframe_scene_${scene.number}.${ext}`);
          writeFileSync(filePath, Buffer.from(b64data, 'base64'));
          results[i].keyframeUrl = filePath;
          emit(log(`Scene ${scene.number} keyframe generated (Gemini API)`, 'success'));
          generated = true;
          break;
        } else {
          slog.warn('no_image_data', { scene: scene.number, attempt: attempt + 1 });
        }
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        slog.error('scene_failed', { scene: scene.number, attempt: attempt + 1, error: msg });
        results[i].logs.push(`Keyframe attempt ${attempt + 1} error: ${msg}`);
        if (attempt === MAX_RETRIES) {
          emit(log(`Scene ${scene.number} keyframe failed after ${MAX_RETRIES + 1} attempts: ${msg} — using reference image as fallback`, 'error'));
        }
      }
    }

    if (!generated) {
      emit(log(`Scene ${scene.number} keyframe: all attempts failed, using reference image`, 'warning'));
    }
  }

  const successCount = results.filter(s => s.assetType === 'video' && s.keyframeUrl).length;
  const freshKeyframes = results.filter(
    s => s.assetType === 'video' && s.keyframeUrl && s.keyframeUrl !== s.referenceImageUrl,
  ).length;
  emit(log(`Keyframes complete: ${freshKeyframes} fresh + ${successCount - freshKeyframes} fallback / ${videoScenes.length} total`, 'success'));
  return results;
}
