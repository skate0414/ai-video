/* ------------------------------------------------------------------ */
/*  CV Pre-processing – source video feature extraction               */
/*  Uses FFmpeg to detect shot boundaries, extract per-shot           */
/*  keyframes, and analyze visual features as compiler input.         */
/* ------------------------------------------------------------------ */

import { existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AIAdapter, LogEntry } from '../types.js';
import type { ShotBoundary, ShotCIR } from '../../cir/types.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';

const slog = createLogger('CvPreprocess');

const execFileAsync = promisify(execFile);

export interface CvPreprocessInput {
  videoFilePath: string;
  assetsDir: string;
}

export interface CvPreprocessOutput {
  dominantColors: string[];
  faceRatio: number;
  brightness: 'dark' | 'medium' | 'bright';
  keyframeCount: number;
  thumbnailPath?: string;
}

const log = createStageLog('STYLE_EXTRACTION');

async function buildFilePart(adapter: AIAdapter, filePath: string, mimeType: string): Promise<{ fileData: { fileUri: string; mimeType: string } }> {
  if (adapter.uploadFile) {
    const uploaded = await adapter.uploadFile({
      name: filePath.split('/').pop() || 'upload-file',
      path: filePath,
      mimeType,
    });
    return {
      fileData: {
        fileUri: uploaded.uri,
        mimeType: uploaded.mimeType || mimeType,
      },
    };
  }

  return {
    fileData: {
      fileUri: filePath,
      mimeType,
    },
  };
}

/**
 * Extract a thumbnail from the video using FFmpeg.
 * Falls back gracefully if FFmpeg is unavailable.
 */
async function extractThumbnail(videoPath: string, outputDir: string): Promise<string | undefined> {
  const thumbPath = join(outputDir, 'cv-thumbnail.jpg');
  if (existsSync(thumbPath)) return thumbPath;

  try {
    await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-ss', '5',
      '-vframes', '1',
      '-q:v', '2',
      '-y',
      thumbPath,
    ], { timeout: 15000 });
    return existsSync(thumbPath) ? thumbPath : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Get video duration using FFprobe.
 */
async function getVideoDuration(videoPath: string): Promise<number | undefined> {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'quiet',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      videoPath,
    ], { timeout: 10000 });
    const duration = parseFloat(stdout.trim());
    return isNaN(duration) ? undefined : duration;
  } catch {
    return undefined;
  }
}

/* ================================================================== */
/*  Shot Boundary Detection — FFmpeg scene filter                     */
/* ================================================================== */

/** Scene-change detection threshold (0-1). Lower = more sensitive. */
const SCENE_THRESHOLD = 0.3;
/** Minimum shot duration to avoid micro-shot noise (seconds). */
const MIN_SHOT_DURATION_SEC = 0.5;
/** Maximum number of shots to extract (safety cap). */
const MAX_SHOTS = 60;

/**
 * Detect shot boundaries using FFmpeg's scene-change detection filter.
 * Returns timestamps (in seconds) where shot changes were detected.
 */
async function detectShotBoundaries(videoPath: string, durationSec: number): Promise<number[]> {
  try {
    const { stdout } = await execFileAsync('ffmpeg', [
      '-i', videoPath,
      '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
      '-vsync', 'vfr',
      '-f', 'null',
      '-',
    ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 });

    // Parse showinfo output for pts_time values
    // FFmpeg showinfo prints: [Parsed_showinfo...] n:0 pts:1234 pts_time:1.234 ...
    const timestamps: number[] = [0]; // First shot always starts at 0
    const ptsRegex = /pts_time:\s*([\d.]+)/g;
    // showinfo output goes to stderr in most FFmpeg versions
    let match: RegExpExecArray | null;
    while ((match = ptsRegex.exec(stdout)) !== null) {
      const ts = parseFloat(match[1]);
      if (!isNaN(ts) && ts > 0) timestamps.push(ts);
    }

    // Deduplicate & filter micro-shots
    const filtered: number[] = [0];
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] - filtered[filtered.length - 1] >= MIN_SHOT_DURATION_SEC) {
        filtered.push(timestamps[i]);
      }
    }

    return filtered.slice(0, MAX_SHOTS);
  } catch {
    return [0]; // Fallback: treat entire video as one shot
  }
}

/**
 * Alternate detection: parse from stderr (FFmpeg sends showinfo to stderr).
 */
async function detectShotBoundariesStderr(videoPath: string): Promise<number[]> {
  try {
    // Use spawn-style to capture stderr
    const result = await new Promise<string>((resolve, reject) => {
      const child = execFile('ffmpeg', [
        '-i', videoPath,
        '-vf', `select='gt(scene,${SCENE_THRESHOLD})',showinfo`,
        '-vsync', 'vfr',
        '-f', 'null',
        '-',
      ], { timeout: 120_000, maxBuffer: 10 * 1024 * 1024 }, (err, _stdout, stderr) => {
        // FFmpeg returns non-zero for -f null but that's expected
        resolve(stderr ?? '');
      });
    });

    const timestamps: number[] = [0];
    const ptsRegex = /pts_time:\s*([\d.]+)/g;
    let match: RegExpExecArray | null;
    while ((match = ptsRegex.exec(result)) !== null) {
      const ts = parseFloat(match[1]);
      if (!isNaN(ts) && ts > 0) timestamps.push(ts);
    }

    const filtered: number[] = [0];
    for (let i = 1; i < timestamps.length; i++) {
      if (timestamps[i] - filtered[filtered.length - 1] >= MIN_SHOT_DURATION_SEC) {
        filtered.push(timestamps[i]);
      }
    }

    return filtered.slice(0, MAX_SHOTS);
  } catch {
    return [0];
  }
}

/**
 * Extract a keyframe image for each shot at the given timestamps.
 * Returns paths to extracted keyframe images.
 */
async function extractShotKeyframes(
  videoPath: string,
  shotStartTimes: number[],
  outputDir: string,
): Promise<string[]> {
  const keyframePaths: string[] = [];

  for (let i = 0; i < shotStartTimes.length; i++) {
    const ts = shotStartTimes[i];
    const outPath = join(outputDir, `shot_${String(i).padStart(3, '0')}.jpg`);

    if (existsSync(outPath)) {
      keyframePaths.push(outPath);
      continue;
    }

    try {
      await execFileAsync('ffmpeg', [
        '-ss', String(ts + 0.1), // Slight offset to get a stable frame
        '-i', videoPath,
        '-vframes', '1',
        '-q:v', '2',
        '-y',
        outPath,
      ], { timeout: 15_000 });
      keyframePaths.push(existsSync(outPath) ? outPath : '');
    } catch {
      keyframePaths.push('');
    }
  }

  return keyframePaths;
}

/**
 * Analyze shot keyframes using AI to get per-shot metadata.
 * Batch-processes shots for efficiency.
 */
async function analyzeShotKeyframes(
  adapter: AIAdapter,
  keyframePaths: string[],
  shotStartTimes: number[],
  videoDurationSec: number,
  onLog: (entry: LogEntry) => void,
): Promise<ShotBoundary[]> {
  const shots: ShotBoundary[] = [];
  const validPaths = keyframePaths.map((p, i) => ({ path: p, index: i })).filter(x => x.path && existsSync(x.path));

  // Process in batches of 5 to avoid token limits
  const BATCH_SIZE = 5;
  for (let b = 0; b < validPaths.length; b += BATCH_SIZE) {
    const batch = validPaths.slice(b, b + BATCH_SIZE);

    const parts: any[] = [];
    for (const item of batch) {
      parts.push(
        await buildFilePart(adapter, item.path, 'image/jpeg'),
      );
    }
    parts.push({
      text: `Analyze these ${batch.length} video shot keyframes. For EACH image (in order), extract:
1. cameraMotion: the likely camera movement (pan, zoom, static, orbit, tilt, tracking, dolly)
2. transitionToNext: likely transition to the next shot (cut, dissolve, fade, wipe, zoom)
3. dominantColors: 3 most dominant colors as hex codes
4. subjectDescription: brief description of the main visual subject (max 20 words)

Output JSON array (one object per image, same order):
[
  {
    "cameraMotion": "static",
    "transitionToNext": "cut",
    "dominantColors": ["#hex1", "#hex2", "#hex3"],
    "subjectDescription": "..."
  }
]`,
    });

    try {
      const result = await adapter.generateText('', parts, {
        responseMimeType: 'application/json',
        timeoutMs: 60_000,
      });

      const parsed = extractJSON<any[]>(result.text ?? '');
      const items = Array.isArray(parsed) ? parsed : [];

      for (let j = 0; j < batch.length; j++) {
        const idx = batch[j].index;
        const ai = items[j] ?? {};
        const startSec = shotStartTimes[idx];
        const endSec = idx + 1 < shotStartTimes.length ? shotStartTimes[idx + 1] : videoDurationSec;

        shots.push({
          index: idx,
          startSec,
          endSec,
          durationSec: Math.round((endSec - startSec) * 100) / 100,
          keyframePath: keyframePaths[idx],
          cameraMotion: ai.cameraMotion ?? 'static',
          transitionToNext: normalizeTransition(ai.transitionToNext),
          dominantColors: Array.isArray(ai.dominantColors) ? ai.dominantColors.slice(0, 5) : [],
          subjectDescription: typeof ai.subjectDescription === 'string' ? ai.subjectDescription.slice(0, 100) : '',
        });
      }
    } catch (err) {
      // Fallback: create entries without AI metadata
      for (const item of batch) {
        const idx = item.index;
        const startSec = shotStartTimes[idx];
        const endSec = idx + 1 < shotStartTimes.length ? shotStartTimes[idx + 1] : videoDurationSec;
        shots.push({
          index: idx,
          startSec,
          endSec,
          durationSec: Math.round((endSec - startSec) * 100) / 100,
          keyframePath: keyframePaths[idx],
          cameraMotion: 'static',
          transitionToNext: 'cut',
          dominantColors: [],
          subjectDescription: '',
        });
      }
      onLog(log(`Shot analysis batch failed (fallback to defaults): ${err instanceof Error ? err.message : 'unknown'}`, 'warning'));
    }
  }

  // Sort by index and fix last shot's transition
  shots.sort((a, b) => a.index - b.index);
  if (shots.length > 0) {
    const last = shots[shots.length - 1];
    shots[shots.length - 1] = { ...last, transitionToNext: 'none' };
  }

  return shots;
}

/** @internal Exported for testing */
export function normalizeTransition(raw: unknown): ShotBoundary['transitionToNext'] {
  const s = String(raw ?? 'cut').toLowerCase();
  if (s.includes('dissolve')) return 'dissolve';
  if (s.includes('fade')) return 'fade';
  if (s.includes('wipe')) return 'wipe';
  if (s.includes('zoom')) return 'zoom';
  if (s.includes('none')) return 'none';
  return 'cut';
}

/**
 * Build a ShotCIR from detected boundaries and analyzed keyframes.
 */
/** @internal Exported for testing */
export function buildShotCIR(shots: ShotBoundary[], videoDurationSec: number): ShotCIR {
  const totalDuration = shots.reduce((sum, s) => sum + s.durationSec, 0) || 1;
  const rhythmSignature = shots.map(s => Math.round((s.durationSec / totalDuration) * 1000) / 1000);

  return {
    _cir: 'ShotAnalysis',
    version: 1,
    shots,
    totalShots: shots.length,
    avgShotDurationSec: Math.round((totalDuration / shots.length) * 100) / 100,
    rhythmSignature,
    videoDurationSec,
  };
}

/**
 * Run CV pre-processing on the reference video.
 * Extracts dominant colors, face presence, and brightness using AI analysis
 * of a thumbnail frame. This provides ground-truth visual data that
 * supplements the LLM's style extraction (which may hallucinate colors).
 */
export async function runCvPreprocess(
  adapter: AIAdapter,
  input: CvPreprocessInput,
  onLog?: (entry: LogEntry) => void,
): Promise<CvPreprocessOutput> {
  const emit = onLog ?? (() => {});

  emit(log('Running CV pre-processing on reference video...'));

  const cvDir = join(input.assetsDir, 'cv');
  if (!existsSync(cvDir)) mkdirSync(cvDir, { recursive: true });

  // Extract thumbnail
  const thumbnailPath = await extractThumbnail(input.videoFilePath, cvDir);
  const duration = await getVideoDuration(input.videoFilePath);

  if (duration) {
    emit(log(`Video duration: ${duration.toFixed(1)}s`));
  }

  if (!thumbnailPath) {
    emit(log('CV pre-processing: could not extract thumbnail, using defaults', 'warning'));
    return {
      dominantColors: [],
      faceRatio: 0,
      brightness: 'medium',
      keyframeCount: 0,
    };
  }

  // Use AI to analyze the thumbnail for color/face data
  emit(log('Analyzing thumbnail for colors and face presence...'));

  const prompt: any[] = [
    await buildFilePart(adapter, thumbnailPath, 'image/jpeg'),
    {
      text: `Analyze this video thumbnail frame. Extract:
1. The 5 most dominant colors as hex codes
2. Face ratio: what fraction (0.0-1.0) of the frame contains human faces? 0 if no faces.
3. Overall brightness: dark, medium, or bright

Output JSON only:
{
  "dominantColors": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
  "faceRatio": 0.0-1.0,
  "brightness": "dark/medium/bright"
}`,
    },
  ];

  try {
    slog.debug('analyzing_thumbnail', { path: thumbnailPath });
    const result = await adapter.generateText('', prompt, {
      responseMimeType: 'application/json',
      timeoutMs: 1_200_000,
    });
    slog.debug('response_preview', { content: (result.text ?? '').slice(0, 500) });

    const cvData = extractJSON<any>(result.text ?? '');
    slog.debug('parsed_result', { cvData: cvData ? JSON.stringify(cvData).slice(0, 300) : 'null' });
    if (cvData) {
      emit(log(`CV analysis: ${(cvData.dominantColors ?? []).length} colors, face ratio: ${cvData.faceRatio ?? 0}`, 'success'));
      return {
        dominantColors: cvData.dominantColors ?? [],
        faceRatio: cvData.faceRatio ?? 0,
        brightness: cvData.brightness ?? 'medium',
        keyframeCount: 1,
        thumbnailPath,
      };
    }
  } catch (err) {
    emit(log(`CV analysis failed: ${err instanceof Error ? err.message : 'unknown error'}`, 'warning'));
  }

  return {
    dominantColors: [],
    faceRatio: 0,
    brightness: 'medium',
    keyframeCount: 1,
    thumbnailPath,
  };
}

/* ================================================================== */
/*  Shot Analysis — full shot boundary + keyframe pipeline            */
/* ================================================================== */

export interface ShotAnalysisInput {
  videoFilePath: string;
  assetsDir: string;
}

/**
 * Run shot boundary detection and per-shot keyframe analysis.
 *
 * Pipeline:
 * 1. FFmpeg scene-change filter detects shot boundaries
 * 2. Per-shot keyframe extraction at each boundary timestamp
 * 3. AI analysis of keyframes for camera motion, transitions, colors
 * 4. Build ShotCIR with temporal rhythm signature
 */
export async function runShotAnalysis(
  adapter: AIAdapter,
  input: ShotAnalysisInput,
  onLog?: (entry: LogEntry) => void,
): Promise<ShotCIR> {
  const emit = onLog ?? (() => {});

  const shotsDir = join(input.assetsDir, 'shots');
  if (!existsSync(shotsDir)) mkdirSync(shotsDir, { recursive: true });

  const duration = await getVideoDuration(input.videoFilePath);
  if (!duration || duration <= 0) {
    emit(log('Could not determine video duration — creating single-shot fallback', 'warning'));
    return buildShotCIR([], 0);
  }

  // Step 1: Detect shot boundaries
  emit(log(`Detecting shot boundaries (threshold=${SCENE_THRESHOLD})...`));
  let timestamps = await detectShotBoundaries(input.videoFilePath, duration);

  // If stdout parsing found nothing, try stderr (FFmpeg sends showinfo there)
  if (timestamps.length <= 1) {
    timestamps = await detectShotBoundariesStderr(input.videoFilePath);
  }

  emit(log(`Detected ${timestamps.length} shot boundaries`));
  slog.info('shot_boundaries', { count: timestamps.length, timestamps: timestamps.slice(0, 20) });

  // Step 2: Extract per-shot keyframes
  emit(log('Extracting per-shot keyframes...'));
  const keyframePaths = await extractShotKeyframes(input.videoFilePath, timestamps, shotsDir);
  const validCount = keyframePaths.filter(p => p && existsSync(p)).length;
  emit(log(`Extracted ${validCount}/${timestamps.length} keyframes`));

  // Step 3: Analyze keyframes with AI
  emit(log('Analyzing shot keyframes for camera motion and transitions...'));
  const shots = await analyzeShotKeyframes(adapter, keyframePaths, timestamps, duration, emit);

  // Step 4: Build ShotCIR
  const shotCIR = buildShotCIR(shots, duration);
  emit(log(`Shot analysis complete: ${shotCIR.totalShots} shots, avg ${shotCIR.avgShotDurationSec}s/shot`, 'success'));

  // Cleanup: remove extracted keyframe images (data is now in CIR)
  try {
    rmSync(shotsDir, { recursive: true, force: true });
  } catch { /* best-effort cleanup */ }

  return shotCIR;
}
