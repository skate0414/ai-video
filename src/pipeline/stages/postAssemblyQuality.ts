/* ------------------------------------------------------------------ */
/*  Post-Assembly Quality Metrics                                     */
/*  Perceptual & structural checks on the final assembled video.      */
/*  Uses FFmpeg filter chains — no external CV libraries required.    */
/* ------------------------------------------------------------------ */

import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createLogger } from '../../lib/logger.js';
import { sanitizeFileSystemPath } from '../../lib/pathSafety.js';

const log = createLogger('PostAssemblyQuality');

function resolveFFmpegBin(): string {
  const brewed = '/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg';
  return existsSync(brewed) ? brewed : 'ffmpeg';
}

const FFMPEG_BIN = resolveFFmpegBin();

export interface PostAssemblyMetrics {
  /** Number of detected black frames (potential scene boundary artifacts) */
  blackFrameCount: number;
  /** Number of detected silence gaps > 0.5s (potential audio sync issues) */
  silenceGapCount: number;
  /** Peak audio level in dBFS (>-1.0 indicates possible clipping) */
  peakAudioLevel: number | undefined;
  /** Average audio loudness in LUFS */
  integratedLoudness: number | undefined;
  /** Overall quality pass/fail */
  passed: boolean;
  /** List of quality issues found */
  issues: string[];
}

/** Thresholds for quality checks */
const MAX_BLACK_FRAMES = 3;
const MAX_SILENCE_GAPS = 2;
const PEAK_CLIP_THRESHOLD = -0.5; // dBFS — above this is clipping

/**
 * Run post-assembly quality checks on a final video file.
 * Non-fatal: returns metrics even if individual checks fail.
 */
export async function computePostAssemblyMetrics(
  videoPath: string,
): Promise<PostAssemblyMetrics> {
  const safePath = sanitizeFileSystemPath(videoPath, 'post-assembly video');
  const issues: string[] = [];

  // Run checks in parallel
  const [blackFrames, silenceGaps, audioLevels] = await Promise.all([
    detectBlackFrames(safePath),
    detectSilenceGaps(safePath),
    measureAudioLevels(safePath),
  ]);

  if (blackFrames > MAX_BLACK_FRAMES) {
    issues.push(`${blackFrames} black frames detected (max ${MAX_BLACK_FRAMES})`);
  }
  if (silenceGaps > MAX_SILENCE_GAPS) {
    issues.push(`${silenceGaps} silence gaps > 0.5s (max ${MAX_SILENCE_GAPS})`);
  }
  if (audioLevels.peak !== undefined && audioLevels.peak > PEAK_CLIP_THRESHOLD) {
    issues.push(`Audio peak ${audioLevels.peak.toFixed(1)} dBFS exceeds ${PEAK_CLIP_THRESHOLD} (possible clipping)`);
  }

  const passed = issues.length === 0;

  log.info('post_assembly_metrics', {
    blackFrames, silenceGaps,
    peak: audioLevels.peak, loudness: audioLevels.loudness,
    passed, issueCount: issues.length,
  });

  return {
    blackFrameCount: blackFrames,
    silenceGapCount: silenceGaps,
    peakAudioLevel: audioLevels.peak,
    integratedLoudness: audioLevels.loudness,
    passed,
    issues,
  };
}

/* ---- Individual checks ---- */

async function detectBlackFrames(videoPath: string): Promise<number> {
  try {
    const { stderr } = await execFilePromise(FFMPEG_BIN, [
      '-i', videoPath,
      '-vf', 'blackdetect=d=0.1:pix_th=0.10',
      '-an', '-f', 'null', '-',
    ], 30_000);

    // Count black_start events in blackdetect output
    const matches = stderr.match(/black_start/g);
    return matches?.length ?? 0;
  } catch (err) {
    log.warn('black_frame_detection_failed', { error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

async function detectSilenceGaps(videoPath: string): Promise<number> {
  try {
    const { stderr } = await execFilePromise(FFMPEG_BIN, [
      '-i', videoPath,
      '-af', 'silencedetect=n=-40dB:d=0.5',
      '-vn', '-f', 'null', '-',
    ], 30_000);

    // Count silence_start events
    const matches = stderr.match(/silence_start/g);
    return matches?.length ?? 0;
  } catch (err) {
    log.warn('silence_detection_failed', { error: err instanceof Error ? err.message : String(err) });
    return 0;
  }
}

async function measureAudioLevels(
  videoPath: string,
): Promise<{ peak: number | undefined; loudness: number | undefined }> {
  try {
    const { stderr } = await execFilePromise(FFMPEG_BIN, [
      '-i', videoPath,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=summary',
      '-vn', '-f', 'null', '-',
    ], 30_000);

    // Parse loudnorm summary output
    const peakMatch = stderr.match(/Input True Peak:\s+([-\d.]+)/);
    const loudMatch = stderr.match(/Input Integrated:\s+([-\d.]+)/);

    return {
      peak: peakMatch ? parseFloat(peakMatch[1]) : undefined,
      loudness: loudMatch ? parseFloat(loudMatch[1]) : undefined,
    };
  } catch (err) {
    log.warn('audio_level_measurement_failed', { error: err instanceof Error ? err.message : String(err) });
    return { peak: undefined, loudness: undefined };
  }
}

/* ---- Utility ---- */

function execFilePromise(
  command: string,
  args: string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(command, args, { timeout, maxBuffer: 10 * 1024 * 1024 }, (error, stdout, stderr) => {
      // FFmpeg returns non-zero for -f null but still outputs data — treat as success if stderr has content
      if (error && !stderr) {
        reject(error);
      } else {
        resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
      }
    });
  });
}
