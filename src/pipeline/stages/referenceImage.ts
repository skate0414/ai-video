/* ------------------------------------------------------------------ */
/*  Pass 9: Reference Image – codegen (visual style anchors)          */
/*  Generates per-scene reference images as visual codegen targets.  */
/* ------------------------------------------------------------------ */

import type { AIAdapter, Scene, LogEntry } from '../types.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';
import { ARTIFACT } from '../../constants.js';
import type { VideoIR } from '../../cir/types.js';

const slog = createLogger('ReferenceImage');
import { generateReferenceSheet } from './referenceSheet.js';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildImagePromptFromVideoIRScene,
  buildNegativePrompt,
  getAspectRatioFromVideoIR,
  getVideoIRScene,
} from './videoIRPromptSemantics.js';
import {
  extractVisualDNA,
  scoreVisualConsistency,
  buildConsistencyReport,
  type VisualDNA,
} from './visualConsistency.js';
import { pickBestCandidate } from './multiCandidate.js';
import { computeCVMetrics, computeSSIM, type CVQualityMetrics } from './cvMetrics.js';
import { computeBackoffDelay, getRetryBudget } from './retryResilience.js';

export interface ReferenceImageInput {
  scenes: Scene[];
  videoIR: VideoIR;
  assetsDir: string;
  topic?: string;
  /** When true, only generate images for a small sample of scenes (for fast style review). */
  sampleOnly?: boolean;
  /** Number of candidate images to generate per scene; best is picked by quality score (default 1). */
  candidateCount?: number;
}

/** Default number of sample scenes for style review gate. */
const SAMPLE_SIZE = 3;

/** Consistency score threshold — images below this are regenerated. */
const CONSISTENCY_THRESHOLD = 40;

/** Maximum retry attempts for consistency-rejected images. */
const CONSISTENCY_MAX_RETRIES = getRetryBudget();

const log = createStageLog('REFERENCE_IMAGE');

/**
 * Pick representative sample indices: first, middle, last.
 */
function pickSampleIndices(total: number, size: number): number[] {
  if (total <= size) return Array.from({ length: total }, (_, i) => i);
  const indices = new Set<number>();
  indices.add(0);                              // first
  indices.add(total - 1);                      // last
  indices.add(Math.floor(total / 2));          // middle
  // fill remaining if size > 3
  for (let step = 1; indices.size < size && step < total; step++) {
    indices.add(Math.round(step * (total / size)));
  }
  return [...indices].sort((a, b) => a - b);
}

/**
 * Generate reference images for review.
 *
 * When `sampleOnly` is true (default), generates images only for a small
 * sample of scenes (first / middle / last) so the user can quickly validate
 * the visual style before committing to the full run.
 *
 * Call `runRemainingReferenceImages` after approval to fill in the rest.
 */
export async function runReferenceImage(
  adapter: AIAdapter,
  input: ReferenceImageInput,
  onLog?: (entry: LogEntry) => void,
): Promise<Scene[]> {
  const emit = onLog ?? (() => {});
  const { scenes, videoIR, assetsDir, topic, sampleOnly = true } = input;
  const candidateCount = input.candidateCount ?? 1;
  const results = scenes.map(s => ({ ...s }));
  const aspectRatio = getAspectRatioFromVideoIR(videoIR);

  // Sync asset types from VideoIR — compile pass is the source of truth.
  for (let i = 0; i < results.length; i++) {
    const irScene = getVideoIRScene(videoIR, results[i].number, i);
    results[i].assetType = irScene.assetType;
  }

  // ---- Generate or load the style reference sheet ----
  let refSheetBase64: string | undefined;
  const savedSheet = join(assetsDir, ARTIFACT.REFERENCE_SHEET);
  if (existsSync(savedSheet)) {
    refSheetBase64 = `data:image/png;base64,${readFileSync(savedSheet).toString('base64')}`;
    emit(log('Loaded existing reference sheet from disk'));
  } else if (topic) {
    const baseScene = videoIR.scenes[0];
    if (baseScene) {
      refSheetBase64 = await generateReferenceSheet(adapter, topic, {
        visualStyle: baseScene.visualStyle,
        colorPalette: baseScene.colorPalette,
        lightingStyle: baseScene.lightingStyle,
        aspectRatio,
      }, assetsDir, emit);
    }
  }

  // Determine which scenes to generate now
  const indicesToGenerate = sampleOnly
    ? pickSampleIndices(results.length, SAMPLE_SIZE)
    : Array.from({ length: results.length }, (_, i) => i);

  const label = sampleOnly
    ? `${indicesToGenerate.length} sample scenes (for style review)`
    : `${results.length} scenes`;

  emit(log(`Generating reference images for ${label}${refSheetBase64 ? ' (with visual anchor)' : ''}...`));

  // Extract VisualDNA from reference sheet for consistency scoring
  let refDNA: VisualDNA | undefined;
  if (refSheetBase64) {
    const savedSheetPath = join(assetsDir, ARTIFACT.REFERENCE_SHEET);
    if (existsSync(savedSheetPath)) {
      try {
        refDNA = await extractVisualDNA(adapter, savedSheetPath, emit);
        emit(log(`Reference sheet DNA: ${refDNA.dominantColors.join(', ')} | ${refDNA.brightness} | ${refDNA.colorTemperature}`));
      } catch {
        emit(log('Could not extract reference sheet DNA — skipping consistency checks', 'warning'));
      }
    }
  }

  const sceneDNAs: (VisualDNA | undefined)[] = new Array(results.length);

  // Phase 2a: Track previous scene's palette for inheritance across scenes
  let previousScenePalette: readonly string[] | undefined;
  // Phase 2b: Track previous scene's reference image path for adjacent SSIM check
  let previousRefImagePath: string | undefined;

  /** Phase 2b: SSIM threshold — scenes below this vs their predecessor are retried with stronger palette hint. */
  const ADJACENT_SSIM_THRESHOLD = 0.3;

  for (const i of indicesToGenerate) {
    const scene = results[i];
    try {
      emit(log(`Generating reference image for scene ${scene.number}${candidateCount > 1 ? ` (${candidateCount} candidates)` : ''}...`));

      // Multi-candidate: generate N images in parallel, score each, keep the best.
      const { result: updated } = await pickBestCandidate<Scene>(
        async () => generateSingleReferenceImage(adapter, scene, videoIR, assetsDir, refSheetBase64, i, aspectRatio, previousScenePalette),
        async (candidate) => {
          if (!refDNA || !candidate.referenceImageUrl || !existsSync(candidate.referenceImageUrl)) return 100;
          const dna = await extractVisualDNA(adapter, candidate.referenceImageUrl, emit);
          const { scoreVisualAgainstRef } = await import('../sceneQuality.js');
          return scoreVisualAgainstRef(dna, refDNA);
        },
        candidateCount,
      );
      let best = updated;

      // Consistency gate: score against reference sheet and retry if too low
      if (refDNA && best.referenceImageUrl && existsSync(best.referenceImageUrl)) {
        const sceneDna = await extractVisualDNA(adapter, best.referenceImageUrl, emit);
        sceneDNAs[i] = sceneDna;
        const score = scoreVisualConsistency(sceneDna, refDNA);
        slog.info('consistency_score', { scene: scene.number, score });
        // New: integrate scene quality scoring and retry/degrade thresholds
        const { scoreVisualAgainstRef, buildSceneQualityScore, shouldRetryBasedOnVisual, shouldDegradeBasedOnOverall, DEFAULT_VISUAL_CONSISTENCY_THRESHOLD, DEFAULT_OVERALL_THRESHOLD } = await import('../sceneQuality.js');
        const visualScore = scoreVisualAgainstRef(sceneDna, refDNA);

        // Compute CV metrics (SSIM + sharpness) against reference sheet
        let cvMetrics: CVQualityMetrics | undefined;
        const refSheetOnDisk = join(assetsDir, ARTIFACT.REFERENCE_SHEET);
        if (existsSync(refSheetOnDisk) && existsSync(best.referenceImageUrl!)) {
          try {
            cvMetrics = await computeCVMetrics(best.referenceImageUrl!, refSheetOnDisk);
          } catch { /* non-fatal */ }
        }

        const quality = buildSceneQualityScore(best, visualScore, cvMetrics);
        slog.info('consistency_score', { scene: scene.number, visualScore, overall: quality.overall, cv: cvMetrics });

        // Attach quality report to scene logs for auditability
        best.logs = best.logs ?? [];
        best.logs.push(`quality:${JSON.stringify(quality)}`);

        // Degrade to image-only/fallback when overall is too low
        if (shouldDegradeBasedOnOverall(quality.overall, DEFAULT_OVERALL_THRESHOLD)) {
          emit(log(`Scene ${scene.number} overall quality ${quality.overall} < ${DEFAULT_OVERALL_THRESHOLD} — marking as degraded/fallback`, 'warning'));
          best.assetType = 'image';
          // prefer existing reference image as fallback asset
          if (best.referenceImageUrl) {
            best.assetUrl = best.referenceImageUrl;
            best.status = 'done';
          }
        }

        if (shouldRetryBasedOnVisual(visualScore, DEFAULT_VISUAL_CONSISTENCY_THRESHOLD)) {
          emit(log(`Scene ${scene.number} visual score ${visualScore} < ${DEFAULT_VISUAL_CONSISTENCY_THRESHOLD} — retrying...`, 'warning'));
          for (let retry = 0; retry < CONSISTENCY_MAX_RETRIES; retry++) {
            best = await generateSingleReferenceImage(adapter, best, videoIR, assetsDir, refSheetBase64, i, aspectRatio, previousScenePalette);
            if (best.referenceImageUrl && existsSync(best.referenceImageUrl)) {
              const retryDna = await extractVisualDNA(adapter, best.referenceImageUrl, emit);
              sceneDNAs[i] = retryDna;
              const retryScore = scoreVisualConsistency(retryDna, refDNA);
              slog.info('consistency_retry', { scene: scene.number, retry: retry + 1, score: retryScore });
              if (!shouldRetryBasedOnVisual(retryScore, DEFAULT_VISUAL_CONSISTENCY_THRESHOLD)) {
                emit(log(`Scene ${scene.number} retry passed with score ${retryScore}`, 'success'));
                break;
              }
            }
          }
        } else {
          emit(log(`Scene ${scene.number} consistency: ${visualScore}/100`));
        }

        // Phase 2a: Update palette for next scene's inheritance
        if (sceneDNAs[i]?.dominantColors?.length) {
          previousScenePalette = sceneDNAs[i]!.dominantColors;
        }
      }

      // Phase 2b: Adjacent scene SSIM check — verify visual continuity between consecutive scenes
      if (previousRefImagePath && best.referenceImageUrl && existsSync(best.referenceImageUrl)) {
        try {
          const adjacentSSIM = await computeSSIM(previousRefImagePath, best.referenceImageUrl);
          if (adjacentSSIM !== undefined) {
            slog.info('adjacent_ssim', { scene: scene.number, ssim: adjacentSSIM });
            best.logs = best.logs ?? [];
            best.logs.push(`adjacent_ssim:${adjacentSSIM.toFixed(3)}`);

            if (adjacentSSIM < ADJACENT_SSIM_THRESHOLD) {
              emit(log(`Scene ${scene.number} adjacent SSIM ${adjacentSSIM.toFixed(3)} < ${ADJACENT_SSIM_THRESHOLD} — retrying with strengthened palette hint`, 'warning'));
              // Retry once with the previous scene's palette enforced
              const retried = await generateSingleReferenceImage(adapter, best, videoIR, assetsDir, refSheetBase64, i, aspectRatio, previousScenePalette);
              if (retried.referenceImageUrl && existsSync(retried.referenceImageUrl)) {
                const retrySSIM = await computeSSIM(previousRefImagePath, retried.referenceImageUrl);
                slog.info('adjacent_ssim_retry', { scene: scene.number, ssim: retrySSIM });
                if (retrySSIM !== undefined && retrySSIM > adjacentSSIM) {
                  best = retried;
                  // Update VisualDNA after retry
                  const retryDna = await extractVisualDNA(adapter, retried.referenceImageUrl, emit);
                  sceneDNAs[i] = retryDna;
                  if (retryDna.dominantColors?.length) {
                    previousScenePalette = retryDna.dominantColors;
                  }
                }
              }
            }
          }
        } catch {
          slog.warn('adjacent_ssim_error', { scene: scene.number });
        }
      }

      // Update previous scene reference image path for next iteration
      if (best.referenceImageUrl && existsSync(best.referenceImageUrl)) {
        previousRefImagePath = best.referenceImageUrl;
      }

      results[i] = best;
      emit(log(`Scene ${scene.number} reference image generated`, 'success'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results[i].logs.push(`Reference image error: ${msg}`);
      emit(log(`Scene ${scene.number} reference image failed: ${msg}`, 'error'));
    }
  }

  // Log consistency report if we have DNA data
  const validDNAs = sceneDNAs.filter((d): d is VisualDNA => d !== undefined);
  if (refDNA && validDNAs.length > 0) {
    const report = buildConsistencyReport(validDNAs, refDNA, CONSISTENCY_THRESHOLD);
    slog.info('consistency_report', { avgScore: report.averageScore, outliers: report.outlierIndices.length });
    emit(log(`Visual consistency: avg=${report.averageScore}/100, outliers=${report.outlierIndices.length}/${validDNAs.length}`));
  }

  const generated = results.filter(s => s.referenceImageUrl).length;
  emit(log(`Reference images complete: ${generated}/${indicesToGenerate.length}`, 'success'));
  return results;
}

/**
 * Generate reference images for scenes that don't yet have one.
 * Called after the user approves the style sample.
 */
export async function runRemainingReferenceImages(
  adapter: AIAdapter,
  input: ReferenceImageInput,
  onLog?: (entry: LogEntry) => void,
): Promise<Scene[]> {
  const emit = onLog ?? (() => {});
  const { scenes, videoIR, assetsDir } = input;
  const results = scenes.map(s => ({ ...s }));
  const aspectRatio = getAspectRatioFromVideoIR(videoIR);

  // Keep runtime scene asset decisions aligned with VideoIR.
  for (let i = 0; i < results.length; i++) {
    const irScene = getVideoIRScene(videoIR, results[i].number, i);
    results[i].assetType = irScene.assetType;
  }

  // Load reference sheet for visual anchoring
  let refSheetBase64: string | undefined;
  const savedSheet = join(assetsDir, ARTIFACT.REFERENCE_SHEET);
  if (existsSync(savedSheet)) {
    refSheetBase64 = `data:image/png;base64,${readFileSync(savedSheet).toString('base64')}`;
  }

  const remaining = results
    .map((s, i) => ({ scene: s, index: i }))
    .filter(({ scene }) => !scene.referenceImageUrl);

  if (remaining.length === 0) {
    emit(log('All scenes already have reference images'));
    return results;
  }

  emit(log(`Generating remaining ${remaining.length} reference images...`));

  for (const { scene, index } of remaining) {
    try {
      emit(log(`Generating reference image for scene ${scene.number}...`));
      const updated = await generateSingleReferenceImage(adapter, scene, videoIR, assetsDir, refSheetBase64, index, aspectRatio);
      results[index] = updated;
      // Mark as approved since the user already confirmed the style
      results[index].reviewStatus = 'approved';
      emit(log(`Scene ${scene.number} reference image generated`, 'success'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      results[index].logs.push(`Reference image error: ${msg}`);
      emit(log(`Scene ${scene.number} reference image failed: ${msg}`, 'error'));
    }
  }

  const generated = results.filter(s => s.referenceImageUrl).length;
  emit(log(`All reference images complete: ${generated}/${results.length}`, 'success'));
  return results;
}

async function generateSingleReferenceImage(
  adapter: AIAdapter,
  scene: Scene,
  videoIR: VideoIR,
  assetsDir: string,
  refSheetBase64?: string,
  fallbackIndex = 0,
  aspectRatio = '16:9',
  previousScenePalette?: readonly string[],
): Promise<Scene> {
  const updated = { ...scene };
  const irScene = getVideoIRScene(videoIR, scene.number, fallbackIndex);

  const imagePrompt = buildImagePromptFromVideoIRScene(irScene, aspectRatio, previousScenePalette);
  const negativePrompt = buildNegativePrompt(irScene.visualStyle);
  slog.debug('scene_prompt', { scene: scene.number, prompt: imagePrompt.slice(0, 300) });

  const result = await adapter.generateImage(
    '',
    imagePrompt,
    aspectRatio,
    negativePrompt,
    refSheetBase64 ? { referenceImage: refSheetBase64 } : undefined,
  );
  slog.debug('scene_result', { scene: scene.number, type: result.imageUrl ? 'image generated' : 'no image' });

  let finalUrl = result.imageUrl;

  // Handle base64 data URI (e.g. from Gemini API) — write to disk
  if (!finalUrl && result.base64) {
    if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });
    const match = result.base64.match(/^data:image\/(\w+);base64,(.+)$/);
    const ext = match?.[1] ?? 'png';
    const b64data = match?.[2] ?? result.base64;
    const filePath = join(assetsDir, `ref_scene_${scene.number}.${ext}`);
    writeFileSync(filePath, Buffer.from(b64data, 'base64'));
    finalUrl = filePath;
  }

  if (finalUrl) {
    updated.referenceImageUrl = finalUrl;
    // For image-only scenes, also set assetUrl so assembly can use it
    if (updated.assetType !== 'video') {
      updated.assetUrl = finalUrl;
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
  videoIR: VideoIR,
  assetsDir: string,
): Promise<Scene> {
  const aspectRatio = getAspectRatioFromVideoIR(videoIR);
  // Try to load existing reference sheet for visual anchoring
  let refSheetBase64: string | undefined;
  const savedSheet = join(assetsDir, ARTIFACT.REFERENCE_SHEET);
  if (existsSync(savedSheet)) {
    refSheetBase64 = `data:image/png;base64,${readFileSync(savedSheet).toString('base64')}`;
  }
  return generateSingleReferenceImage(adapter, scene, videoIR, assetsDir, refSheetBase64, 0, aspectRatio);
}
