/* ------------------------------------------------------------------ */
/*  Temporal Quality – scene-to-scene consistency validation          */
/*  Checks visual continuity between adjacent scenes by comparing    */
/*  last frame of scene N to first frame of scene N+1.               */
/*  Uses SSIM + color histogram distance via FFmpeg.                 */
/* ------------------------------------------------------------------ */

import { execFile } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { createLogger } from '../../lib/logger.js';
import { sanitizeFileSystemPath } from '../../lib/pathSafety.js';

const log = createLogger('TemporalQuality');

function resolveFFmpegBin(): string {
  const brewed = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  return existsSync(brewed) ? brewed : 'ffmpeg';
}

const FFMPEG_BIN = resolveFFmpegBin();

export interface TemporalMetrics {
  /** Number of scene pairs checked. */
  pairsChecked: number;
  /** Number of pairs with abrupt visual discontinuity. */
  discontinuities: number;
  /** SSIM values between adjacent scene boundaries (last frame → first frame). */
  boundarySsim: (number | undefined)[];
  /** Whether temporal quality is acceptable overall. */
  passed: boolean;
  /** Human-readable issues. */
  issues: string[];
}

/** Minimum SSIM between adjacent scene endpoints to consider "smooth." */
const BOUNDARY_SSIM_THRESHOLD = 0.15;

/** Maximum allowed discontinuities (as fraction of total pairs). */
const MAX_DISCONTINUITY_RATIO = 0.5;

/**
 * Extract a single frame from a video at a given timestamp.
 * Returns the path to the extracted frame image, or undefined on failure.
 */
export async function extractFrame(
  videoPath: string,
  timestampSec: number,
  outputPath: string,
): Promise<string | undefined> {
  const safeVideo = sanitizeFileSystemPath(videoPath, 'frame extraction video');
  const safeOutput = sanitizeFileSystemPath(outputPath, 'frame extraction output');

  try {
    await execFilePromise(FFMPEG_BIN, [
      '-ss', String(Math.max(0, timestampSec)),
      '-i', safeVideo,
      '-frames:v', '1',
      '-q:v', '2',
      '-y', safeOutput,
    ], 15_000);
    return existsSync(safeOutput) ? safeOutput : undefined;
  } catch (err) {
    log.warn('frame_extraction_failed', { video: videoPath, ts: timestampSec, error: err instanceof Error ? err.message : String(err) });
    return undefined;
  }
}

/**
 * Compute SSIM between two image files using FFmpeg.
 */
async function computeSSIM(img1: string, img2: string): Promise<number | undefined> {
  if (!existsSync(img1) || !existsSync(img2)) return undefined;

  try {
    const { stderr } = await execFilePromise(FFMPEG_BIN, [
      '-i', img1,
      '-i', img2,
      '-lavfi', 'ssim',
      '-f', 'null',
      '-',
    ], 15_000);

    const match = stderr.match(/All:([\d.]+)/);
    return match ? parseFloat(match[1]) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Check temporal consistency across scene boundaries.
 *
 * For each pair of adjacent scenes, extracts:
 * - Last frame of scene N
 * - First frame of scene N+1
 * Then computes SSIM between them.
 *
 * Low SSIM between adjacent scenes is normal for scene cuts,
 * but extremely low values with dissolve/fade transitions indicate problems.
 *
 * @param sceneVideoPaths Ordered paths to per-scene video files
 * @param transitions Transition types between scenes (cut, dissolve, etc.)
 * @param tmpDir Temp directory for extracted frames
 */
export async function computeTemporalMetrics(
  sceneVideoPaths: string[],
  transitions: readonly (string | undefined)[],
  tmpDir: string,
): Promise<TemporalMetrics> {
  const issues: string[] = [];
  const boundarySsim: (number | undefined)[] = [];
  let discontinuities = 0;
  let pairsChecked = 0;

  const framesDir = join(tmpDir, 'temporal_frames');
  if (!existsSync(framesDir)) mkdirSync(framesDir, { recursive: true });

  for (let i = 0; i < sceneVideoPaths.length - 1; i++) {
    const currentPath = sceneVideoPaths[i];
    const nextPath = sceneVideoPaths[i + 1];

    if (!currentPath || !nextPath || !existsSync(currentPath) || !existsSync(nextPath)) {
      boundarySsim.push(undefined);
      continue;
    }

    // Get duration of current scene to extract last frame
    let duration: number;
    try {
      const { stdout } = await execFilePromise(FFMPEG_BIN.replace('ffmpeg', 'ffprobe'), [
        '-v', 'quiet',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        currentPath,
      ], 10_000);
      duration = parseFloat(stdout.trim()) || 5;
    } catch {
      duration = 5;
    }

    const lastFramePath = join(framesDir, `scene_${i}_last.jpg`);
    const firstFramePath = join(framesDir, `scene_${i + 1}_first.jpg`);

    // Extract last frame of current scene and first frame of next scene
    const [lastFrame, firstFrame] = await Promise.all([
      extractFrame(currentPath, Math.max(0, duration - 0.1), lastFramePath),
      extractFrame(nextPath, 0.05, firstFramePath),
    ]);

    if (!lastFrame || !firstFrame) {
      boundarySsim.push(undefined);
      continue;
    }

    const ssim = await computeSSIM(lastFrame, firstFrame);
    boundarySsim.push(ssim);
    pairsChecked++;

    if (ssim !== undefined && ssim < BOUNDARY_SSIM_THRESHOLD) {
      const transition = transitions[i] ?? 'cut';
      // Only flag as discontinuity for non-cut transitions (cuts are expected to be abrupt)
      if (transition !== 'cut' && transition !== 'none') {
        discontinuities++;
        issues.push(`Scene ${i + 1}→${i + 2}: SSIM ${ssim.toFixed(3)} with ${transition} transition (expected ≥${BOUNDARY_SSIM_THRESHOLD})`);
      }
    }
  }

  const totalPairs = sceneVideoPaths.length - 1;
  const passed = totalPairs === 0 || discontinuities / Math.max(1, pairsChecked) <= MAX_DISCONTINUITY_RATIO;

  log.info('temporal_metrics', {
    pairsChecked,
    discontinuities,
    avgSsim: boundarySsim.filter((s): s is number => s !== undefined).reduce((a, b) => a + b, 0) / Math.max(1, pairsChecked),
    passed,
    issueCount: issues.length,
  });

  return { pairsChecked, discontinuities, boundarySsim, passed, issues };
}

/* ---- Utility ---- */

function execFilePromise(
  command: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      if (error && !stderr) {
        reject(error);
      } else {
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
      }
    });
  });
}
