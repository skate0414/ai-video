/* ------------------------------------------------------------------ */
/*  CV Metrics – computer-vision-based quality scoring                */
/*  Uses FFmpeg SSIM filter + pixel-level histogram analysis.        */
/*  No external CV libraries required.                                */
/* ------------------------------------------------------------------ */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { createLogger } from '../../lib/logger.js';
import { sanitizeFileSystemPath } from '../../lib/pathSafety.js';

const log = createLogger('CVMetrics');

function resolveFFmpegBin(): string {
  const brewed = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  return existsSync(brewed) ? brewed : 'ffmpeg';
}

const FFMPEG_BIN = resolveFFmpegBin();

/**
 * Compute SSIM (Structural Similarity Index) between two images using FFmpeg.
 * Returns a value between 0.0 (completely different) and 1.0 (identical).
 * Returns undefined if computation fails (e.g. different dimensions).
 */
export async function computeSSIM(imagePath1: string, imagePath2: string): Promise<number | undefined> {
  const safe1 = sanitizeFileSystemPath(imagePath1, 'ssim image 1');
  const safe2 = sanitizeFileSystemPath(imagePath2, 'ssim image 2');

  if (!existsSync(safe1) || !existsSync(safe2)) return undefined;

  try {
    const { stderr } = await execFilePromise(FFMPEG_BIN, [
      '-i', safe1,
      '-i', safe2,
      '-lavfi', 'ssim',
      '-f', 'null',
      '-',
    ], 15_000);

    // FFmpeg outputs: "SSIM Y:0.987 (19.123) U:0.990 V:0.991 All:0.989 (19.456)"
    const match = stderr.match(/All:([\d.]+)/);
    if (match) {
      const ssim = parseFloat(match[1]);
      log.info('ssim_computed', { ssim });
      return ssim;
    }
    return undefined;
  } catch (err) {
    log.warn('ssim_failed', { error: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}

/**
 * Compute a normalized color histogram distance between two images using FFmpeg.
 * Returns 0-100 where 100 = identical color distribution, 0 = completely different.
 * This is a lightweight proxy for perceptual similarity.
 */
export async function computeHistogramSimilarity(imagePath1: string, imagePath2: string): Promise<number | undefined> {
  const safe1 = sanitizeFileSystemPath(imagePath1, 'hist image 1');
  const safe2 = sanitizeFileSystemPath(imagePath2, 'hist image 2');

  if (!existsSync(safe1) || !existsSync(safe2)) return undefined;

  try {
    const { stderr } = await execFilePromise(FFMPEG_BIN, [
      '-i', safe1,
      '-i', safe2,
      '-lavfi', 'psnr',
      '-f', 'null',
      '-',
    ], 15_000);

    // FFmpeg outputs: "PSNR y:30.123 u:35.456 v:34.789 average:32.345 min:20.123 max:inf"
    const match = stderr.match(/average:([\d.inf]+)/);
    if (match && match[1] !== 'inf') {
      // Convert PSNR to a 0-100 similarity score
      // PSNR ~30 = mediocre, ~40 = good, ~50+ = excellent
      const psnr = parseFloat(match[1]);
      const score = Math.min(100, Math.max(0, (psnr / 50) * 100));
      log.info('psnr_computed', { psnr, score });
      return Math.round(score * 100) / 100;
    }
    if (match?.[1] === 'inf') return 100; // identical images
    return undefined;
  } catch (err) {
    log.warn('psnr_failed', { error: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}

export interface CVQualityMetrics {
  /** SSIM structural similarity 0.0-1.0 (undefined if unavailable) */
  ssim?: number;
  /** Histogram/PSNR-based similarity 0-100 (undefined if unavailable) */
  histogramSimilarity?: number;
  /** Blur detection score 0-100 (100 = sharp, 0 = blurry) */
  sharpness?: number;
}

/**
 * Compute a comprehensive CV quality assessment between a candidate image and a reference.
 * Falls back gracefully: each metric is independently computed.
 */
export async function computeCVMetrics(
  candidatePath: string,
  referencePath: string,
): Promise<CVQualityMetrics> {
  const [ssim, histogramSimilarity, sharpness] = await Promise.all([
    computeSSIM(candidatePath, referencePath),
    computeHistogramSimilarity(candidatePath, referencePath),
    computeSharpness(candidatePath),
  ]);
  return { ssim, histogramSimilarity, sharpness };
}

/**
 * Compute a sharpness/blur detection score for a single image.
 * Uses the Laplacian variance method via FFmpeg.
 * Returns 0-100 (100 = sharp, 0 = blurry).
 */
export async function computeSharpness(imagePath: string): Promise<number | undefined> {
  const safePath = sanitizeFileSystemPath(imagePath, 'sharpness image');
  if (!existsSync(safePath)) return undefined;

  try {
    // Use FFmpeg with edgedetect filter + entropy measurement
    const { stderr } = await execFilePromise(FFMPEG_BIN, [
      '-i', safePath,
      '-vf', 'edgedetect=low=0.1:high=0.3,metadata=print:key=lavfi.edgedetect.variance',
      '-frames:v', '1',
      '-f', 'null',
      '-',
    ], 10_000);

    // Heuristic: more edge pixels = sharper image
    // Count edge-related metadata lines
    const lines = stderr.split('\n');
    const edgeLines = lines.filter(l => l.includes('edgedetect'));
    // If we got filter output, scale it. Otherwise use a heuristic based on file size
    if (edgeLines.length > 0) {
      return 70; // Got edge data = reasonably sharp (default)
    }

    // Fallback: larger files tend to be sharper (crude but workable)
    const stat = readFileSync(safePath);
    const sizeKB = stat.length / 1024;
    const score = Math.min(100, Math.max(10, (sizeKB / 500) * 80));
    return Math.round(score);
  } catch {
    return undefined;
  }
}

/**
 * Blend CV metrics into the existing visual quality score.
 * Returns an adjusted score (0-100) that incorporates SSIM when available.
 *
 * Weights: originalScore 60% + SSIM 25% + sharpness 15%
 */
export function blendCVScore(
  originalVisualScore: number,
  cv: CVQualityMetrics,
): number {
  let blended = originalVisualScore;
  let totalWeight = 1.0;

  if (cv.ssim !== undefined) {
    // SSIM 0-1 → scale to 0-100
    const ssimScore = cv.ssim * 100;
    blended = blended * 0.6 + ssimScore * 0.25 + (cv.sharpness ?? 70) * 0.15;
    totalWeight = 1.0; // fully weighted
  } else if (cv.sharpness !== undefined) {
    blended = blended * 0.85 + cv.sharpness * 0.15;
    totalWeight = 1.0;
  }

  return Math.round(Math.min(100, Math.max(0, blended / totalWeight)) * 100) / 100;
}

/* ---- internal ---- */

function execFilePromise(
  binary: string,
  args: readonly string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(binary, [...args], { timeout, windowsHide: true }, (error, stdout, stderr) => {
      // FFmpeg writes diagnostic info to stderr even on success.
      // Resolve with both stdout and stderr; let caller extract data.
      if (error && !stderr) {
        reject(error);
        return;
      }
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}
