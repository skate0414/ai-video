/* ------------------------------------------------------------------ */
/*  Stage 9: Reference Image – generate reference images per scene    */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, Scene, LogEntry } from '../types.js';
import { IMAGE_GEN_PROMPT, fillTemplate } from '../prompts.js';
import { createStageLog } from './stageLog.js';
import { generateReferenceSheet } from './referenceSheet.js';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ReferenceImageInput {
  scenes: Scene[];
  styleProfile: StyleProfile;
  assetsDir: string;
  topic?: string;
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
  const { scenes, styleProfile, assetsDir, topic } = input;
  const trackB = styleProfile.track_b_visual ?? {};
  const results = scenes.map(s => ({ ...s }));

  // ---- Generate or load the style reference sheet ----
  let refSheetBase64: string | undefined;
  const savedSheet = join(assetsDir, 'reference_sheet.png');
  if (existsSync(savedSheet)) {
    refSheetBase64 = `data:image/png;base64,${readFileSync(savedSheet).toString('base64')}`;
    emit(log('Loaded existing reference sheet from disk'));
  } else if (topic) {
    refSheetBase64 = await generateReferenceSheet(adapter, topic, styleProfile, assetsDir, emit);
  }

  emit(log(`Generating reference images for ${scenes.length} scenes${refSheetBase64 ? ' (with visual anchor)' : ''}...`));

  for (let i = 0; i < results.length; i++) {
    const scene = results[i];
    try {
      emit(log(`Generating reference image for scene ${scene.number}...`));
      const updated = await generateSingleReferenceImage(adapter, scene, styleProfile, trackB, refSheetBase64);
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
  refSheetBase64?: string,
): Promise<Scene> {
  const updated = { ...scene };

  const imagePrompt = fillTemplate(IMAGE_GEN_PROMPT, {
    visual_prompt: scene.visualPrompt,
    color_palette: (styleProfile.colorPalette ?? []).join(', '),
    lighting_style: trackB.lighting_style ?? 'cinematic',
    visual_style: styleProfile.visualStyle ?? '3D animation',
    aspect_ratio: styleProfile.targetAspectRatio ?? '16:9',
  });
  console.log(`[REFERENCE_IMAGE] scene ${scene.number} prompt:`, imagePrompt.slice(0, 300));

  const result = await adapter.generateImage(
    '',
    imagePrompt,
    styleProfile.targetAspectRatio ?? '16:9',
    undefined,
    refSheetBase64 ? { referenceImage: refSheetBase64 } : undefined,
  );
  console.log(`[REFERENCE_IMAGE] scene ${scene.number} result:`, result.imageUrl ? 'image generated' : 'no image');

  if (result.imageUrl) {
    updated.referenceImageUrl = result.imageUrl;
    // For image-only scenes, also set assetUrl so assembly can use it
    if (updated.assetType !== 'video') {
      updated.assetUrl = result.imageUrl;
    }
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
  // Try to load existing reference sheet for visual anchoring
  let refSheetBase64: string | undefined;
  const savedSheet = join(assetsDir, 'reference_sheet.png');
  if (existsSync(savedSheet)) {
    refSheetBase64 = `data:image/png;base64,${readFileSync(savedSheet).toString('base64')}`;
  }
  return generateSingleReferenceImage(adapter, scene, styleProfile, trackB, refSheetBase64);
}
