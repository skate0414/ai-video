/* ------------------------------------------------------------------ */
/*  CV Pre-processing – extract low-level visual features from video  */
/*  Uses FFmpeg to extract keyframes, then AI to analyze colors/faces */
/*  Inspired by ai-suite's CV pre-processing step                    */
/* ------------------------------------------------------------------ */

import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { AIAdapter, LogEntry } from '../types.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';

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
    {
      fileData: {
        fileUri: thumbnailPath,
        mimeType: 'image/jpeg',
      },
    },
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
    const result = await adapter.generateText('', prompt, {
      responseMimeType: 'application/json',
    });

    const cvData = extractJSON<any>(result.text ?? '');
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
