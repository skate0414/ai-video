/* ------------------------------------------------------------------ */
/*  Stage 9: Reference Image – generate reference images per scene    */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, Scene, LogEntry } from '../types.js';
import { IMAGE_GEN_PROMPT, fillTemplate } from '../prompts.js';
import { createStageLog } from './stageLog.js';

export interface ReferenceImageInput {
  scenes: Scene[];
  styleProfile: StyleProfile;
  assetsDir: string;
}

const log = createStageLog('REFERENCE_IMAGE');

/**
 * Generate reference images for each scene.
 * These serve as visual anchors for human review before proceeding
 * to keyframe/video generation (more expensive stages).
 */
export async function runReferenceImage(
  adapter: AIAdapter,
  input: ReferenceImageInput,
  onLog?: (entry: LogEntry) => void,
): Promise<Scene[]> {
  const emit = onLog ?? (() => {});
  const { scenes, styleProfile, assetsDir } = input;
  const trackB = styleProfile.track_b_visual ?? {};
  const results = scenes.map(s => ({ ...s }));

  emit(log(`Generating reference images for ${scenes.length} scenes...`));

  for (let i = 0; i < results.length; i++) {
    const scene = results[i];
    try {
      emit(log(`Generating reference image for scene ${scene.number}...`));
      const updated = await generateSingleReferenceImage(adapter, scene, styleProfile, trackB);
      results[i] = updated;
      emit(log(`Scene ${scene.number} reference image generated`, 'success'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results[i].logs.push(`Reference image error: ${msg}`);
      emit(log(`Scene ${scene.number} reference image failed: ${msg}`, 'error'));
    }
  }

  emit(log(`Reference images complete: ${results.filter(s => s.assetUrl).length}/${scenes.length}`, 'success'));
  return results;
}

async function generateSingleReferenceImage(
  adapter: AIAdapter,
  scene: Scene,
  styleProfile: StyleProfile,
  trackB: any,
): Promise<Scene> {
  const updated = { ...scene };

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
    updated.assetUrl = result.imageUrl;
    updated.assetType = 'image';
    updated.status = 'pending_review';
    updated.reviewStatus = 'pending_review';
  }

  return updated;
}

/**
 * Re-generate a single scene's reference image.
 */
export async function regenerateSceneImage(
  adapter: AIAdapter,
  scene: Scene,
  styleProfile: StyleProfile,
  assetsDir: string,
): Promise<Scene> {
  const trackB = styleProfile.track_b_visual ?? {};
  return generateSingleReferenceImage(adapter, scene, styleProfile, trackB);
}
