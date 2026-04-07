/* ------------------------------------------------------------------ */
/*  Stage 10: Keyframe Gen – generate keyframe images for video scenes */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, Scene, LogEntry } from '../types.js';
import { IMAGE_GEN_PROMPT, fillTemplate } from '../prompts.js';
import { createStageLog } from './stageLog.js';

export interface KeyframeGenInput {
  scenes: Scene[];
  styleProfile: StyleProfile;
  assetsDir: string;
}

const log = createStageLog('KEYFRAME_GEN');

/**
 * Generate keyframe images for scenes that need video generation.
 * Keyframes serve as the first frame for img2video generation.
 * Only processes scenes with assetType === 'video'.
 */
export async function runKeyframeGen(
  adapter: AIAdapter,
  input: KeyframeGenInput,
  onLog?: (entry: LogEntry) => void,
): Promise<Scene[]> {
  const emit = onLog ?? (() => {});
  const { scenes, styleProfile, assetsDir } = input;
  const trackB = styleProfile.track_b_visual ?? {};
  const results = scenes.map(s => ({ ...s }));

  const videoScenes = results.filter(s => s.assetType === 'video');
  emit(log(`Generating keyframes for ${videoScenes.length} video scenes...`));

  for (let i = 0; i < results.length; i++) {
    const scene = results[i];
    if (scene.assetType !== 'video') continue;

    try {
      emit(log(`Generating keyframe for scene ${scene.number}...`));

      const imagePrompt = fillTemplate(IMAGE_GEN_PROMPT, {
        visual_prompt: scene.visualPrompt,
        color_palette: (styleProfile.colorPalette ?? []).join(', '),
        lighting_style: trackB.lighting_style ?? 'cinematic',
        visual_style: styleProfile.visualStyle ?? '3D animation',
        aspect_ratio: styleProfile.targetAspectRatio ?? '16:9',
      });

      const result = await adapter.generateImage(
        '',
        imagePrompt,
        styleProfile.targetAspectRatio ?? '16:9',
      );

      if (result.imageUrl) {
        results[i].keyframeUrl = result.imageUrl;
        emit(log(`Scene ${scene.number} keyframe generated`, 'success'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results[i].logs.push(`Keyframe error: ${msg}`);
      emit(log(`Scene ${scene.number} keyframe failed: ${msg}`, 'error'));
    }
  }

  const successCount = results.filter(s => s.assetType === 'video' && s.keyframeUrl).length;
  emit(log(`Keyframes complete: ${successCount}/${videoScenes.length}`, 'success'));
  return results;
}
