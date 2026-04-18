/* ------------------------------------------------------------------ */
/*  Scene quality scoring & retry helpers                             */
/* ------------------------------------------------------------------ */

import type { VisualDNA } from './stages/visualConsistency.js';
import type { CVQualityMetrics } from './stages/cvMetrics.js';
import type { Scene } from './types.js';

/** Per-scene multi-dimensional score (0-100) */
export interface SceneQualityScore {
  visualConsistency: number; // 0-100
  audioCompleteness: number; // 0-100
  assetIntegrity: number; // 0-100
  /** CV-based metrics (SSIM, sharpness) — populated when available. */
  cv?: CVQualityMetrics;
  overall: number; // weighted composite 0-100
}

export function computeOverallScore(s: SceneQualityScore): number {
  // weights: visual 50%, audio 20%, integrity 30%
  return Math.round((s.visualConsistency * 0.5 + s.audioCompleteness * 0.2 + s.assetIntegrity * 0.3) * 100) / 100;
}

/** Score visual consistency against reference DNA (0-100). If no refDNA, return 100. */
export function scoreVisualAgainstRef(sceneDna: VisualDNA | undefined, refDna: VisualDNA | undefined): number {
  if (!refDna || !sceneDna) return 100;
  // simple heuristic: color overlap + brightness match + keyword overlap
  const commonColors = sceneDna.dominantColors.filter(c => refDna.dominantColors.includes(c)).length;
  const colorScore = Math.min(100, (commonColors / Math.max(1, refDna.dominantColors.length)) * 100);
  const brightnessScore = sceneDna.brightness === refDna.brightness ? 100 : 70;
  const tempScore = sceneDna.colorTemperature === refDna.colorTemperature ? 100 : 75;
  const keywordOverlap = sceneDna.styleKeywords.filter(k => refDna.styleKeywords.includes(k)).length;
  const keywordScore = Math.min(100, (keywordOverlap / Math.max(1, refDna.styleKeywords.length)) * 100);

  // aggregate
  const score = Math.round((colorScore * 0.4 + brightnessScore * 0.15 + tempScore * 0.15 + keywordScore * 0.3) * 100) / 100;
  return score;
}

/** Build a scene quality score from available scene metadata and visual score. */
export function buildSceneQualityScore(scene: Scene, visualScore: number, cv?: CVQualityMetrics): SceneQualityScore {
  const audioCompleteness = scene.audioUrl ? 100 : 0;
  const assetIntegrity = scene.assetUrl ? 100 : (scene.keyframeUrl ? 60 : 0);

  // Blend CV metrics into visual score when available
  let adjustedVisual = visualScore;
  if (cv?.ssim !== undefined) {
    const ssimScore = cv.ssim * 100;
    adjustedVisual = visualScore * 0.6 + ssimScore * 0.25 + (cv.sharpness ?? 70) * 0.15;
  } else if (cv?.sharpness !== undefined) {
    adjustedVisual = visualScore * 0.85 + cv.sharpness * 0.15;
  }

  const s: SceneQualityScore = {
    visualConsistency: Math.round(Math.min(100, Math.max(0, adjustedVisual)) * 100) / 100,
    audioCompleteness,
    assetIntegrity,
    cv,
    overall: 0,
  };
  s.overall = computeOverallScore(s);
  return s;
}

export const DEFAULT_VISUAL_CONSISTENCY_THRESHOLD = 65; // below this triggers retry
export const DEFAULT_OVERALL_THRESHOLD = 70; // below this triggers degradation

export function shouldRetryBasedOnVisual(score: number, threshold = DEFAULT_VISUAL_CONSISTENCY_THRESHOLD): boolean {
  return score < threshold;
}

export function shouldDegradeBasedOnOverall(overall: number, threshold = DEFAULT_OVERALL_THRESHOLD): boolean {
  return overall < threshold;
}

export default {};
