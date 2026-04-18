/* ------------------------------------------------------------------ */
/*  FFmpeg Assembler – linker: combines compiled assets into binary   */
/*  Links scene videos + audio tracks + subtitles into final .mp4.   */
/* ------------------------------------------------------------------ */

import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync, copyFileSync } from 'node:fs';
import { join, basename } from 'node:path';
import {
  ensurePathWithinBase,
  sanitizeFileName,
  sanitizeFileSystemPath,
  sanitizePathSegment,
} from '../lib/pathSafety.js';
import { BEAT_SNAP_TOLERANCE } from '../pipeline/stages/beatAlign.js';
import type { SubtitleStyle, TitleCardStyle } from '../../shared/types.js';

const TIMEOUT = 3_600_000; // 60 min per ffmpeg command

class FFmpegCommandError extends Error {
  constructor(
    message: string,
    readonly command: string,
    readonly stderr: string,
  ) {
    super(message);
    this.name = 'FFmpegCommandError';
  }
}

/** Encoding quality profile — configurable output quality controls. */
export interface EncodingProfile {
  /** Output width (default 1920). */
  width?: number;
  /** Output height (default 1080). */
  height?: number;
  /** Frames per second (default 30). */
  fps?: number;
  /** Video codec: 'libx264' | 'libx265' (default 'libx264'). */
  videoCodec?: 'libx264' | 'libx265';
  /** Constant Rate Factor — lower = higher quality (default 20, range 0-51). */
  crf?: number;
  /** Audio bitrate e.g. '192k' (default '192k'). */
  audioBitrate?: string;
  /** Audio sample rate (default 48000). */
  audioSampleRate?: number;
  /** x264 encoding preset (default 'medium'). */
  preset?: string;
  /** Maximum bitrate cap (e.g. '5M'). */
  maxrate?: string;
  /** Rate control buffer size (e.g. '10M'). */
  bufsize?: string;
}

/** Core encoding fields that always have a value after resolution. */
export interface ResolvedEncoding {
  width: number;
  height: number;
  fps: number;
  videoCodec: 'libx264' | 'libx265';
  crf: number;
  audioBitrate: string;
  audioSampleRate: number;
  preset: string;
  maxrate?: string;
  bufsize?: string;
}

/** Sensible 1080p defaults. */
export const DEFAULT_ENCODING: ResolvedEncoding = {
  width: 1920,
  height: 1080,
  fps: 30,
  videoCodec: 'libx264',
  crf: 20,
  audioBitrate: '192k',
  audioSampleRate: 48000,
  preset: 'medium',
};

/** Resolve partial profile against defaults. */
function resolveEncoding(p?: EncodingProfile): ResolvedEncoding {
  return {
    ...DEFAULT_ENCODING,
    ...p,
    preset: p?.preset ?? DEFAULT_ENCODING.preset,
  };
}

export interface AssemblyOptions {
  assetsDir: string;
  outputDir: string;
  projectTitle?: string;
  bgmPath?: string;
  bgmVolume?: number;          // 0-1, default 0.15
  bgmFadeIn?: number;          // BGM-only fade-in seconds, default 0
  bgmFadeOut?: number;         // BGM-only fade-out seconds, default 0
  parallelism?: number;        // scene processing concurrency, default 2
  onProgress?: (percent: number, message: string) => void;
  /** Per-scene transition types from VideoIR. Index i = transition after scene i.
   *  'cut' or undefined = hard cut (concat demuxer). Others use xfade filter. */
  transitions?: readonly ('cut' | 'dissolve' | 'fade' | 'wipe' | 'zoom' | 'none')[];
  /** Per-transition durations in seconds. When provided, overrides XFADE_DURATION per transition.
   *  Index i = duration for transition after scene i. Falls back to XFADE_DURATION if omitted. */
  transitionDurations?: readonly number[];
  /** Color grading filter string (FFmpeg filter chain) to apply during normalization.
   *  Built by buildColorGradeFilter() from VideoIR style metadata. */
  colorGradeFilter?: string;
  /** Output encoding quality profile. */
  encoding?: EncodingProfile;
  /** Enable two-pass encoding for premium quality (better bitrate distribution). */
  twoPass?: boolean;
  /** Enable fade-in (seconds) at video start. Default 0 (disabled). */
  fadeInDuration?: number;
  /** Enable fade-out (seconds) at video end. Default 0 (disabled). */
  fadeOutDuration?: number;
  /** Project title for intro title card overlay. If set, a brief title card is shown at start. */
  titleCard?: string;
  /** BGM beat timestamps (seconds) detected from the background music file.
   *  Used to snap transition points to the nearest musical beat. */
  bgmBeats?: readonly number[];
  /** Subtitle style configuration. If not provided, uses classic white preset. */
  subtitleStyle?: SubtitleStyle;
  /** Title card style configuration. If provided with text, overrides titleCard string. */
  titleCardStyle?: TitleCardStyle;
  /** Default transition duration override in seconds. */
  defaultTransitionDuration?: number;
}

/* ---- Public API ---- */

export async function isFFmpegAvailable(): Promise<boolean> {
  try {
    await execFileText(FFMPEG_BIN, ['-version'], 10_000);
    return true;
  } catch {
    return false;
  }
}

export async function getMediaDuration(filePath: string): Promise<number> {
  try {
    const safeFilePath = sanitizeFileSystemPath(filePath, 'media file path');
    const { stdout } = await execFileText(
      FFPROBE_BIN,
      [
        '-v', 'error',
        '-show_entries', 'format=duration',
        '-of', 'default=noprint_wrappers=1:nokey=1',
        safeFilePath,
      ],
      15_000,
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
  }
}

/**
 * Check if an audio file is effectively silent.
 * Uses ffmpeg's volumedetect filter to measure mean volume.
 * Returns mean_volume in dB (e.g. -91.0 for silence, -20.0 for normal speech).
 * Returns -Infinity if detection fails.
 */
export async function getAudioMeanVolume(filePath: string): Promise<number> {
  try {
    const safeFilePath = sanitizeFileSystemPath(filePath, 'audio file path');
    const { stderr } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(FFMPEG_BIN, [
        '-i', safeFilePath,
        '-af', 'volumedetect',
        '-f', 'null',
        '-',
      ], { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true });
      let stdout = '';
      let stderr = '';
      const timer = setTimeout(() => child.kill('SIGKILL'), 30_000);
      child.stdout.on('data', (c: Buffer) => { stdout += c.toString(); });
      child.stderr.on('data', (c: Buffer) => { stderr += c.toString(); });
      child.on('error', err => { clearTimeout(timer); reject(err); });
      child.on('close', () => { clearTimeout(timer); resolve({ stdout, stderr }); });
    });
    const match = stderr.match(/mean_volume:\s*(-?[\d.]+)\s*dB/);
    return match ? parseFloat(match[1]) : -Infinity;
  } catch {
    return -Infinity;
  }
}

/**
 * Probe basic video info: duration, width, height.
 * Returns undefined on failure.
 */
export async function getVideoInfo(filePath: string): Promise<{ duration: number; width: number; height: number } | undefined> {
  try {
    const safeFilePath = sanitizeFileSystemPath(filePath, 'video file path');
    const { stdout } = await execFileText(
      FFPROBE_BIN,
      [
        '-v', 'error',
        '-select_streams', 'v:0',
        '-show_entries', 'stream=width,height',
        '-show_entries', 'format=duration',
        '-of', 'json',
        safeFilePath,
      ],
      15_000,
    );
    const data = JSON.parse(stdout);
    const duration = parseFloat(data.format?.duration) || 0;
    const stream = data.streams?.[0];
    const width = Number(stream?.width) || 0;
    const height = Number(stream?.height) || 0;
    return { duration, width, height };
  } catch {
    return undefined;
  }
}

/**
 * Generate SRT subtitle file from scene narratives.
 */
export function generateSRT(scenes: SceneInput[]): string {
  const lines: string[] = [];
  let cumulative = 0;

  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const duration = scene.audioDuration ?? scene.estimatedDuration ?? 5;
    const start = formatSRT(cumulative);
    const end = formatSRT(cumulative + duration);

    lines.push(`${i + 1}`);
    lines.push(`${start} --> ${end}`);
    lines.push(scene.narrative);
    lines.push('');

    cumulative += duration;
  }
  return lines.join('\n');
}

/**
 * Assemble scenes into a final video file.
 *
 * Pipeline:
 * 1. Per-scene: image+audio → scene_N.mp4  OR  video+audio merge → scene_N.mp4
 * 2. Concat all scene videos
 * 3. Burn subtitles (drawtext)
 * 4. Mix BGM if provided
 * 5. Output final.mp4
 */
export async function assembleVideo(
  scenes: SceneInput[],
  options: AssemblyOptions,
): Promise<string> {
  const safeAssetsDir = sanitizeFileSystemPath(options.assetsDir, 'assetsDir');
  const safeOutputDir = sanitizeFileSystemPath(options.outputDir, 'outputDir');
  const safeBgmPath = options.bgmPath
    ? sanitizeFileSystemPath(options.bgmPath, 'bgmPath')
    : undefined;
  const { onProgress } = options;
  const enc = resolveEncoding(options.encoding);
  const res = `${enc.width}:${enc.height}`;
  const resTag = `${enc.width}x${enc.height}`;
  const tmpDir = ensurePathWithinBase(safeOutputDir, join(safeOutputDir, '_assembly_tmp'), 'tmpDir');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const sceneVideos: string[] = new Array(scenes.length);
  const parallelism = Math.max(1, Math.min(4, Math.floor(options.parallelism ?? 2)));
  const totalSteps = scenes.length + 3; // scenes + concat + subtitles + final
  let currentStep = 0;

  const progress = (msg: string) => {
    currentStep++;
    const pct = Math.round((currentStep / totalSteps) * 100);
    onProgress?.(pct, msg);
  };

  // ---- Step 1: Process each scene into a standalone video ----
  await runWithConcurrency(scenes, parallelism, async (scene, i) => {
    const sceneFile = ensurePathWithinBase(tmpDir, join(tmpDir, `scene_${i}.mp4`), 'scene file');

    const assetPath = resolveAssetPath(scene.assetUrl, safeAssetsDir);
    const audioPath = resolveAssetPath(scene.audioUrl, safeAssetsDir);
    const duration = scene.audioDuration ?? scene.estimatedDuration ?? 5;

    if (scene.assetType === 'video' && assetPath && existsSync(assetPath)) {
      // Video scene: merge with audio (A/V sync-aware)
      if (audioPath && existsSync(audioPath)) {
        const audioDur = await getMediaDuration(audioPath) || duration;
        const videoDur = await getMediaDuration(assetPath) || duration;

        // Phase 6a: compute A/V sync strategy (audio-primary policy)
        const { computeAVSyncStrategy, buildAVSyncArgs } = await import('../pipeline/stages/avSync.js');
        const syncResult = computeAVSyncStrategy(videoDur, audioDur);
        const syncArgs = buildAVSyncArgs(syncResult);

        if (syncArgs.loopInput) {
          // Loop video to match audio length
          const filterArgs: string[] = [];
          if (syncArgs.audioFilter) filterArgs.push('-af', syncArgs.audioFilter);
          await ffmpeg([
            '-stream_loop', '-1',
            '-i', assetPath,
            '-i', audioPath,
            '-map', '0:v',
            '-map', '1:a',
            ...filterArgs,
            '-c:v', enc.videoCodec,
            '-crf', String(enc.crf),
            '-c:a', 'aac',
            '-b:a', enc.audioBitrate,
            ...syncArgs.outputFlags,
            '-y', sceneFile,
          ], tmpDir);
        } else {
          // Standard merge with optional A/V sync adjustments
          const vfParts: string[] = [];
          const afParts: string[] = [];
          if (syncArgs.videoFilter) vfParts.push(syncArgs.videoFilter);
          if (syncArgs.audioFilter) afParts.push(syncArgs.audioFilter);
          const filterArgs: string[] = [];
          if (vfParts.length > 0) filterArgs.push('-vf', vfParts.join(','));
          if (afParts.length > 0) filterArgs.push('-af', afParts.join(','));
          await ffmpeg([
            '-i', assetPath,
            '-i', audioPath,
            '-map', '0:v',
            '-map', '1:a',
            ...filterArgs,
            '-c:v', enc.videoCodec,
            '-crf', String(enc.crf),
            '-c:a', 'aac',
            '-b:a', enc.audioBitrate,
            ...syncArgs.outputFlags,
            '-y', sceneFile,
          ], tmpDir);
        }
      } else {
        // Video without separate audio — generate silent audio track
        await ffmpeg([
          '-i', assetPath,
          '-f', 'lavfi',
          '-i', `anullsrc=channel_layout=stereo:sample_rate=${enc.audioSampleRate}`,
          '-c:v', enc.videoCodec,
          '-crf', String(enc.crf),
          '-c:a', 'aac',
          '-b:a', enc.audioBitrate,
          '-t', String(duration),
          '-shortest',
          '-y', sceneFile,
        ], tmpDir);
      }
    } else if (assetPath && existsSync(assetPath)) {
      // Image scene: image → video with Ken Burns (zoom-pan) effect + audio
      // Motion variant resolved from scene camera motion metadata or cycled per scene
      const fps = enc.fps;
      const { resolveKenBurnsVariant, buildKenBurnsFilter } = await import('../pipeline/stages/cameraMotion.js');
      const variant = resolveKenBurnsVariant(scene.cameraMotion, i);
      const kenBurnsFilter = (totalFrames: number) =>
        buildKenBurnsFilter(variant, totalFrames, enc.width, enc.height, fps);
      if (audioPath && existsSync(audioPath)) {
        const audioDur = await getMediaDuration(audioPath) || duration;
        const totalFrames = Math.ceil(audioDur * fps);
        await ffmpeg([
          '-loop', '1',
          '-i', assetPath,
          '-i', audioPath,
          '-vf', kenBurnsFilter(totalFrames),
          '-c:v', enc.videoCodec,
          '-crf', String(enc.crf),
          '-c:a', 'aac',
          '-b:a', enc.audioBitrate,
          '-pix_fmt', 'yuv420p',
          '-t', String(audioDur),
          '-y', sceneFile,
        ], tmpDir);
      } else {
        // Image without audio — Ken Burns with silence
        const totalFrames = Math.ceil(duration * fps);
        await ffmpeg([
          '-loop', '1',
          '-i', assetPath,
          '-f', 'lavfi',
          '-i', `anullsrc=channel_layout=stereo:sample_rate=${enc.audioSampleRate}`,
          '-vf', kenBurnsFilter(totalFrames),
          '-c:v', enc.videoCodec,
          '-crf', String(enc.crf),
          '-c:a', 'aac',
          '-b:a', enc.audioBitrate,
          '-pix_fmt', 'yuv420p',
          '-t', String(duration),
          '-y', sceneFile,
        ], tmpDir);
      }
    } else {
      // No asset — generate a black frame placeholder with TTS audio if available
      if (audioPath && existsSync(audioPath)) {
        const audioDur = await getMediaDuration(audioPath) || duration;
        await ffmpeg([
          '-f', 'lavfi',
          '-i', `color=c=black:s=${resTag}:d=${audioDur}`,
          '-i', audioPath,
          '-map', '0:v',
          '-map', '1:a',
          '-c:v', enc.videoCodec,
          '-crf', String(enc.crf),
          '-c:a', 'aac',
          '-b:a', enc.audioBitrate,
          '-pix_fmt', 'yuv420p',
          '-t', String(audioDur),
          '-y', sceneFile,
        ], tmpDir);
      } else {
        await ffmpeg([
          '-f', 'lavfi',
          '-i', `color=c=black:s=${resTag}:d=${duration}`,
          '-f', 'lavfi',
          '-i', `anullsrc=channel_layout=stereo:sample_rate=${enc.audioSampleRate}`,
          '-c:v', enc.videoCodec,
          '-crf', String(enc.crf),
          '-c:a', 'aac',
          '-b:a', enc.audioBitrate,
          '-pix_fmt', 'yuv420p',
          '-t', String(duration),
          '-y', sceneFile,
        ], tmpDir);
      }
    }

    sceneVideos[i] = sceneFile;
    progress(`场景 ${i + 1}/${scenes.length} 合成完成`);
  });

  // ---- Step 1b: Mix per-scene ambient SFX (if sound design hints present) ----
  const { resolveSFXLayer } = await import('../pipeline/stages/sfxDesign.js');
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    if (!scene.soundDesign || !sceneVideos[i]) continue;
    const dur = scene.audioDuration ?? scene.estimatedDuration ?? 5;
    const sfx = resolveSFXLayer(scene.soundDesign, dur);
    if (!sfx) continue;
    const sfxOutput = ensurePathWithinBase(tmpDir, join(tmpDir, `sfx_${i}.mp4`), 'sfx scene file');
    try {
      await ffmpeg([
        '-i', sceneVideos[i],
        '-f', 'lavfi', '-i', sfx.lavfiSource,
        '-filter_complex',
        `[1:a]volume=${sfx.volume}[sfx];[0:a][sfx]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
        '-map', '0:v', '-map', '[aout]',
        '-c:v', 'copy', '-c:a', 'aac', '-b:a', enc.audioBitrate,
        '-y', sfxOutput,
      ], tmpDir);
      sceneVideos[i] = sfxOutput;
    } catch {
      // Non-fatal: continue without SFX for this scene
    }
  }

  // ---- Step 2: Normalize & Concat (with optional transitions) ----
  // First normalize all scene videos to consistent format
  // Use format-aware normalization filter (supports non-16:9 aspect ratios)
  const { resolveFormatPreset } = await import('../pipeline/stages/formatPresets.js');
  const formatPreset = resolveFormatPreset(enc.width, enc.height);
  const colorGrade = options.colorGradeFilter ?? '';
  const baseVf = formatPreset.normFilter;
  const normVf = colorGrade ? `${baseVf},${colorGrade}` : baseVf;
  const normalizedVideos: string[] = new Array(sceneVideos.length);
  // Build encoding quality args (preset, rate control)
  const presetArgs = ['-preset', enc.preset];
  const rateArgs = enc.maxrate ? ['-maxrate', enc.maxrate, '-bufsize', enc.bufsize ?? enc.maxrate] : [];

  // Phase 6b: Global colour normalisation — extract reference from first scene
  const { parseColorStats, buildColorCorrectionFilter, buildSignalstatsArgs } = await import('../pipeline/stages/globalLUT.js');
  type ColorStats = import('../pipeline/stages/globalLUT.js').ColorStats;
  let referenceColorStats: ColorStats | undefined;

  // Normalize scene 0 first to establish the colour reference
  if (sceneVideos.length > 0 && sceneVideos[0]) {
    const normalized0 = ensurePathWithinBase(tmpDir, join(tmpDir, 'norm_0.mp4'), 'normalized scene file');
    await ffmpeg([
      '-i', sceneVideos[0],
      '-vf', normVf,
      '-r', String(enc.fps),
      '-c:v', enc.videoCodec,
      '-crf', String(enc.crf),
      ...presetArgs,
      ...rateArgs,
      '-c:a', 'aac',
      '-b:a', enc.audioBitrate,
      '-ar', String(enc.audioSampleRate),
      '-ac', '2',
      '-y', normalized0,
    ], tmpDir);
    normalizedVideos[0] = normalized0;

    // Extract colour stats from normalised reference scene
    try {
      const statsOutput = await ffmpeg(buildSignalstatsArgs(normalized0), tmpDir);
      referenceColorStats = parseColorStats(statsOutput);
    } catch { /* non-fatal — proceed without global colour correction */ }
  }

  // Normalize remaining scenes with optional per-scene colour correction
  if (sceneVideos.length > 1) {
    await runWithConcurrency(sceneVideos.slice(1), parallelism, async (sceneVideo, rawIdx) => {
      const i = rawIdx + 1;
      const normalized = ensurePathWithinBase(tmpDir, join(tmpDir, `norm_${i}.mp4`), 'normalized scene file');

      // Phase 6b: Attempt per-scene colour correction toward the reference
      let perSceneVf = normVf;
      if (referenceColorStats) {
        try {
          const scnStatsOutput = await ffmpeg(buildSignalstatsArgs(sceneVideo), tmpDir);
          const sceneStats = parseColorStats(scnStatsOutput);
          if (sceneStats) {
            const correction = buildColorCorrectionFilter(referenceColorStats, sceneStats);
            if (correction) {
              perSceneVf = `${normVf},${correction}`;
            }
          }
        } catch { /* non-fatal — use default normVf */ }
      }

      await ffmpeg([
        '-i', sceneVideo,
        '-vf', perSceneVf,
        '-r', String(enc.fps),
        '-c:v', enc.videoCodec,
        '-crf', String(enc.crf),
        ...presetArgs,
        ...rateArgs,
        '-c:a', 'aac',
        '-b:a', enc.audioBitrate,
        '-ar', String(enc.audioSampleRate),
        '-ac', '2',
        '-y', normalized,
      ], tmpDir);
      normalizedVideos[i] = normalized;
    });
  }

  // ---- Step 2b: BGM beat detection (for transition alignment) ----
  let detectedBeats: readonly number[] | undefined = options.bgmBeats;
  if (!detectedBeats && safeBgmPath && existsSync(safeBgmPath)) {
    try {
      const { buildBeatDetectionArgs, parseBeatsFromAstats } = await import('../pipeline/stages/beatAlign.js');
      const beatArgs = buildBeatDetectionArgs(safeBgmPath);
      const beatOutput = await new Promise<string>((resolve, reject) => {
        const proc = spawn(FFMPEG_BIN, beatArgs, { cwd: tmpDir, timeout: TIMEOUT });
        let stdout = '';
        proc.stdout.on('data', (d: Buffer) => { stdout += d.toString(); });
        proc.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(`beat detection exit ${code}`)));
        proc.on('error', reject);
      });
      const bgmDuration = await getMediaDuration(safeBgmPath);
      const beatInfo = parseBeatsFromAstats(beatOutput, bgmDuration);
      if (beatInfo.beats.length > 0) {
        detectedBeats = beatInfo.beats;
      }
    } catch {
      // Non-fatal: continue without beat alignment
    }
  }

  // Determine if any non-cut transitions are needed
  const transitions = options.transitions ?? [];
  const hasXfade = transitions.some((t, i) => i < normalizedVideos.length - 1 && t && t !== 'cut' && t !== 'none');

  let concatOutput: string;
  let concatList: string | undefined;

  const simpleConcatFallback = async (): Promise<string> => {
    concatList = ensurePathWithinBase(tmpDir, join(tmpDir, 'concat.txt'), 'concat list');
    const concatContent = normalizedVideos.map(f => `file '${sanitizePathSegment(basename(f), 'concat filename')}'`).join('\n');
    writeFileSync(concatList, concatContent);
    const out = ensurePathWithinBase(tmpDir, join(tmpDir, 'concat.mp4'), 'concat output');
    await ffmpeg([
      '-f', 'concat',
      '-safe', '0',
      '-i', concatList,
      '-c', 'copy',
      '-y', out,
    ], tmpDir);
    return out;
  };

  if (hasXfade && normalizedVideos.length >= 2) {
    // Use xfade filter_complex for transitions, fall back to simple concat on failure
    concatOutput = ensurePathWithinBase(tmpDir, join(tmpDir, 'concat.mp4'), 'concat output');
    try {
      const defaultXfadeDur = options.defaultTransitionDuration ?? XFADE_DURATION;
      await concatWithXfade(normalizedVideos, transitions, concatOutput, tmpDir, enc, options.transitionDurations, detectedBeats, defaultXfadeDur);
    } catch {
      // xfade filter graph failed (common with many inputs) — fall back to hard cut concat
      concatOutput = await simpleConcatFallback();
    }
  } else {
    concatOutput = await simpleConcatFallback();
  }
  progress('场景拼接完成');

  // ---- Step 3: Burn subtitles (strict: failure blocks pipeline) ----
  const srtContent = generateSRT(scenes);
  const srtFile = ensurePathWithinBase(tmpDir, join(tmpDir, 'subtitles.srt'), 'subtitle file');
  writeFileSync(srtFile, srtContent, 'utf-8');

  const subsFile = ensurePathWithinBase(tmpDir, join(tmpDir, 'with_subs.mp4'), 'subtitle output');
  // Use relative filename to avoid FFmpeg filter-graph path-escaping issues
  const srtRelative = 'subtitles.srt';
  let subsOutput = concatOutput;

  // Build subtitle style from options or use defaults
  const subStyle = options.subtitleStyle ?? {
    fontName: 'Arial',
    fontSize: 20,
    primaryColor: '#FFFFFF',
    outlineColor: '#000000',
    outlineWidth: 2,
    shadowEnabled: true,
    marginV: 35,
    backdropEnabled: false,
    backdropOpacity: 0,
  };
  const subtitleForceStyle = buildSubtitleForceStyle(subStyle);

  try {
    await ffmpeg([
      '-i', concatOutput,
      '-vf', `subtitles=${srtRelative}:force_style='${subtitleForceStyle}'`,
      '-c:v', enc.videoCodec,
      '-crf', String(enc.crf),
      '-c:a', 'copy',
      '-y', subsFile,
    ], tmpDir);
    subsOutput = subsFile;
    progress('字幕烧录完成');
  } catch (e) {
    const stderrPath = ensurePathWithinBase(safeOutputDir, join(safeOutputDir, 'assembly_subtitle_ffmpeg.stderr.log'), 'subtitle stderr log');
    const stderr = e instanceof FFmpegCommandError
      ? e.stderr
      : (e instanceof Error ? e.message : String(e));
    writeFileSync(stderrPath, stderr, 'utf-8');
    // Non-fatal: continue without burned-in subtitles (SRT file still available)
    progress('字幕烧录失败（跳过），SRT文件已保留');
  }
  // Copy SRT to output dir for external use
  const outputSrt = ensurePathWithinBase(safeOutputDir, join(safeOutputDir, 'subtitles.srt'), 'output subtitle file');
  try { copyFileSync(srtFile, outputSrt); } catch { /* ignore */ }

  // ---- Step 4: Audio loudness normalization + BGM Mix ----
  // Apply EBU R128 loudness normalization to speech, then side-chain compress
  // BGM under voice (auto-ducking) before final mixing.
  let finalInput = subsOutput;

  // 4a. Normalize speech loudness to -16 LUFS (EBU R128)
  const loudnormOutput = ensurePathWithinBase(tmpDir, join(tmpDir, 'loudnorm.mp4'), 'loudnorm output');
  try {
    await ffmpeg([
      '-i', subsOutput,
      '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', enc.audioBitrate,
      '-y', loudnormOutput,
    ], tmpDir);
    finalInput = loudnormOutput;
  } catch {
    // Non-fatal: continue without loudness normalization
  }

  // 4b. Mix BGM with side-chain compression (auto-ducking)
  if (safeBgmPath && existsSync(safeBgmPath)) {
    const bgmVol = options.bgmVolume ?? 0.15;
    const bgmFadeIn = options.bgmFadeIn ?? 0;
    const bgmFadeOut = options.bgmFadeOut ?? 0;
    const bgmOutput = ensurePathWithinBase(tmpDir, join(tmpDir, 'with_bgm.mp4'), 'bgm output');

    // Build BGM pre-processing chain: volume → optional fade in/out
    let bgmChain = `[1:a]volume=${bgmVol}`;
    if (bgmFadeIn > 0) bgmChain += `,afade=t=in:d=${bgmFadeIn}`;
    if (bgmFadeOut > 0) {
      try {
        // Use video duration (not BGM duration) since amix truncates BGM to video length
        const videoDur = await getMediaDuration(finalInput);
        if (videoDur > bgmFadeOut) {
          bgmChain += `,afade=t=out:st=${(videoDur - bgmFadeOut).toFixed(3)}:d=${bgmFadeOut}`;
        }
      } catch { /* skip fade-out if duration unknown */ }
    }
    bgmChain += '[bgmscaled]';

    // Side-chain compressor: BGM is ducked when speech is present.
    // Chain: BGM volume+fade → sidechaincompress (keyed off speech) → amix
    await ffmpeg([
      '-i', finalInput,
      '-i', safeBgmPath,
      '-filter_complex',
      `${bgmChain};` +
      `[bgmscaled][0:a]sidechaincompress=threshold=0.02:ratio=6:attack=200:release=1000[ducked];` +
      `[0:a][ducked]amix=inputs=2:duration=first:dropout_transition=3[aout]`,
      '-map', '0:v',
      '-map', '[aout]',
      '-c:v', 'copy',
      '-c:a', 'aac',
      '-b:a', enc.audioBitrate,
      '-y', bgmOutput,
    ], tmpDir);
    finalInput = bgmOutput;
  }

  // ---- Step 5: Final output (fade in/out + title card + two-pass encoding) ----
  const timestamp = Date.now();
  const safeName = sanitizeFileName(options.projectTitle ?? 'video', 'video');
  const finalPath = ensurePathWithinBase(safeOutputDir, join(safeOutputDir, `${safeName}_${timestamp}.mp4`), 'final output path');

  // Build video filter chain for final output (fade in/out + title card)
  const finalVfParts: string[] = [];
  const fadeIn = options.fadeInDuration ?? 0;
  const fadeOut = options.fadeOutDuration ?? 0;

  if (fadeIn > 0) {
    finalVfParts.push(`fade=t=in:d=${fadeIn}`);
  }
  if (fadeOut > 0) {
    // fade=t=out requires start time; we compute from input duration
    try {
      const inputDur = await getMediaDuration(finalInput);
      if (inputDur > fadeOut) {
        finalVfParts.push(`fade=t=out:st=${(inputDur - fadeOut).toFixed(3)}:d=${fadeOut}`);
      }
    } catch { /* skip fade-out if duration unknown */ }
  }
  // Title card: draw project title at start with configurable style
  const titleCardConfig = options.titleCardStyle ?? (options.titleCard ? {
    text: options.titleCard,
    fontSize: 48,
    fontColor: '#FFFFFF',
    duration: 3,
  } : null);
  if (titleCardConfig?.text) {
    const safeTitle = titleCardConfig.text.replace(/'/g, "'\\''").replace(/:/g, '\\:');
    const fontSize = titleCardConfig.fontSize ?? 48;
    const fontColor = (titleCardConfig.fontColor ?? '#FFFFFF').replace('#', '');
    const duration = titleCardConfig.duration ?? 3;
    // Calculate fade timing: 0.5s fade in, hold, 0.5s fade out
    const fadeInEnd = 0.5;
    const holdEnd = duration - 0.5;
    finalVfParts.push(
      `drawtext=text='${safeTitle}':fontcolor=0x${fontColor}:fontsize=${fontSize}:x=(w-text_w)/2:y=(h-text_h)/2:alpha='if(lt(t,${fadeInEnd}),t/${fadeInEnd},if(lt(t,${holdEnd}),1,if(lt(t,${duration}),(${duration}-t)/${duration - holdEnd},0)))'`
    );
  }

  // Audio fade in/out
  const finalAfParts: string[] = [];
  if (fadeIn > 0) finalAfParts.push(`afade=t=in:d=${fadeIn}`);
  if (fadeOut > 0) {
    try {
      const inputDur = await getMediaDuration(finalInput);
      if (inputDur > fadeOut) {
        finalAfParts.push(`afade=t=out:st=${(inputDur - fadeOut).toFixed(3)}:d=${fadeOut}`);
      }
    } catch { /* skip */ }
  }

  const hasFinalFilters = finalVfParts.length > 0 || finalAfParts.length > 0;
  const useTwoPass = options.twoPass === true && hasFinalFilters === false;

  if (useTwoPass) {
    // Two-pass encoding: pass 1 (analysis) + pass 2 (encode)
    const passlogfile = ensurePathWithinBase(tmpDir, join(tmpDir, 'ffmpeg2pass'), 'passlog');
    await ffmpeg([
      '-i', finalInput,
      '-c:v', enc.videoCodec,
      '-b:v', enc.maxrate ?? '5M',
      '-preset', enc.preset,
      '-pass', '1',
      '-passlogfile', passlogfile,
      '-an',
      '-f', 'null',
      '-y', '/dev/null',
    ], tmpDir);
    await ffmpeg([
      '-i', finalInput,
      '-c:v', enc.videoCodec,
      '-b:v', enc.maxrate ?? '5M',
      '-preset', enc.preset,
      '-pass', '2',
      '-passlogfile', passlogfile,
      '-c:a', 'aac',
      '-b:a', enc.audioBitrate,
      '-movflags', '+faststart',
      '-y', finalPath,
    ], tmpDir);
    // Cleanup passlog files
    try {
      for (const ext of ['-0.log', '-0.log.mbtree']) {
        const logF = `${passlogfile}${ext}`;
        if (existsSync(logF)) unlinkSync(logF);
      }
    } catch { /* best-effort */ }
  } else if (hasFinalFilters) {
    // Single-pass with video/audio filters (fades, title card)
    const filterArgs: string[] = [];
    if (finalVfParts.length > 0) filterArgs.push('-vf', finalVfParts.join(','));
    if (finalAfParts.length > 0) filterArgs.push('-af', finalAfParts.join(','));
    await ffmpeg([
      '-i', finalInput,
      ...filterArgs,
      '-c:v', enc.videoCodec,
      '-crf', String(enc.crf),
      '-preset', enc.preset,
      '-c:a', 'aac',
      '-b:a', enc.audioBitrate,
      '-movflags', '+faststart',
      '-y', finalPath,
    ], tmpDir);
  } else {
    // Stream-copy (no filters needed)
    await ffmpeg([
      '-i', finalInput,
      '-c', 'copy',
      '-movflags', '+faststart',
      '-y', finalPath,
    ], tmpDir);
  }
  progress('最终视频输出完成');

  // Cleanup tmp files
  try {
    const filesToClean = [...sceneVideos, ...normalizedVideos, concatOutput, subsOutput, loudnormOutput];
    if (concatList) filesToClean.push(concatList);
    for (const f of filesToClean) {
      if (existsSync(f)) unlinkSync(f);
    }
    const bgmOutput = ensurePathWithinBase(tmpDir, join(tmpDir, 'with_bgm.mp4'), 'bgm output');
    if (safeBgmPath && existsSync(bgmOutput)) {
      unlinkSync(bgmOutput);
    }
    // Cleanup data-URL temp files created by resolveAssetPath
    for (const f of dataUrlTempFiles.splice(0)) {
      try { if (existsSync(f)) unlinkSync(f); } catch { /* ignore */ }
    }
  } catch { /* best-effort cleanup */ }

  return finalPath;
}

/* ---- Internal helpers ---- */

/** @internal Exported for testing */
export const XFADE_MAP: Readonly<Record<string, string>> = Object.freeze({
  dissolve: 'dissolve',
  fade: 'fade',
  wipe: 'wipeleft',
  zoom: 'zoomin',
});

/** @internal Exported for testing */
export const XFADE_DURATION = 0.5; // seconds per transition

/**
 * Concatenate normalised videos with xfade transitions.
 * Uses filter_complex to chain xfade filters pairwise.
 *
 * For N videos with transitions [t0, t1, ..., t_{N-2}]:
 *   [0:v][1:v]xfade=transition=t0:offset=d0-0.5:duration=0.5[v01];
 *   [v01][2:v]xfade=...
 * Audio is concatenated with acrossfade for smooth blending.
 */
/**
 * Build the xfade/concat filter_complex string from durations and transitions.
 * Pure function — no I/O. Exported for testing.
 * @param transitionDurations Per-transition durations in seconds. Falls back to defaultDuration or XFADE_DURATION.
 * @param defaultDuration Default transition duration when not specified per-transition.
 * @internal
 */
export function buildXfadeFilterGraph(
  durations: (number | null)[],
  transitions: readonly ('cut' | 'dissolve' | 'fade' | 'wipe' | 'zoom' | 'none')[],
  transitionDurations?: readonly number[],
  /** Phase 6c: BGM beat timestamps for offset snapping. */
  bgmBeats?: readonly number[],
  /** Default transition duration when not specified per-transition. */
  defaultDuration?: number,
): { vFilters: string[]; aFilters: string[] } {
  const n = durations.length;
  const vFilters: string[] = [];
  const aFilters: string[] = [];
  if (n < 2) return { vFilters, aFilters };
  const xfadeDefault = defaultDuration ?? XFADE_DURATION;

  // Phase 6c: helper to snap an offset to the nearest beat within tolerance
  const BEAT_SNAP_TOL = BEAT_SNAP_TOLERANCE;
  const snapToBeat = (offset: number): number => {
    if (!bgmBeats || bgmBeats.length === 0) return offset;
    let nearest = offset;
    let bestDist = Infinity;
    for (const b of bgmBeats) {
      const dist = Math.abs(b - offset);
      if (dist < bestDist) {
        bestDist = dist;
        nearest = b;
      }
    }
    return bestDist <= BEAT_SNAP_TOL ? nearest : offset;
  };

  let prevVideoLabel = '[0:v]';
  let prevAudioLabel = '[0:a]';
  let cumulativeOffset = durations[0] || 5;

  for (let i = 1; i < n; i++) {
    const tType = transitions[i - 1] ?? 'cut';
    let xfadeName = XFADE_MAP[tType] ?? '';
    const outVideoLabel = i === n - 1 ? '[vout]' : `[v${i}]`;
    const outAudioLabel = i === n - 1 ? '[aout]' : `[a${i}]`;
    const xDur = transitionDurations?.[i - 1] ?? xfadeDefault;

    // Guard: both the outgoing and incoming clips must be at least 2×xDur
    // to produce a valid FFmpeg xfade filter graph. Downgrade to hard cut otherwise.
    const prevDur = durations[i - 1] || 5;
    const curDur = durations[i] || 5;
    if (xfadeName && (prevDur < xDur * 2 || curDur < xDur * 2)) {
      xfadeName = '';
    }

    if (xfadeName) {
      const rawOffset = Math.max(0, cumulativeOffset - xDur);
      // Phase 6c: snap transition offset to nearest BGM beat
      const offset = snapToBeat(rawOffset);
      vFilters.push(`${prevVideoLabel}[${i}:v]xfade=transition=${xfadeName}:offset=${offset.toFixed(3)}:duration=${xDur}${outVideoLabel}`);
      aFilters.push(`${prevAudioLabel}[${i}:a]acrossfade=d=${xDur}:c1=tri:c2=tri${outAudioLabel}`);
      cumulativeOffset = offset + (durations[i] || 5);
    } else {
      vFilters.push(`${prevVideoLabel}[${i}:v]concat=n=2:v=1:a=0${outVideoLabel}`);
      aFilters.push(`${prevAudioLabel}[${i}:a]concat=n=2:v=0:a=1${outAudioLabel}`);
      cumulativeOffset += (durations[i] || 5);
    }

    prevVideoLabel = outVideoLabel;
    prevAudioLabel = outAudioLabel;
  }

  return { vFilters, aFilters };
}

async function concatWithXfade(
  videos: string[],
  transitions: readonly ('cut' | 'dissolve' | 'fade' | 'wipe' | 'zoom' | 'none')[],
  outputPath: string,
  cwd: string,
  enc: ResolvedEncoding = DEFAULT_ENCODING,
  transitionDurations?: readonly number[],
  bgmBeats?: readonly number[],
  defaultDuration?: number,
): Promise<void> {
  const n = videos.length;
  if (n < 2) return;

  // Get durations for offset calculation
  const durations = await Promise.all(videos.map(v => getMediaDuration(v)));

  const inputs: string[] = [];
  for (const v of videos) inputs.push('-i', v);

  const { vFilters, aFilters } = buildXfadeFilterGraph(durations, transitions, transitionDurations, bgmBeats, defaultDuration);
  const filterComplex = [...vFilters, ...aFilters].join(';');

  await ffmpeg([
    ...inputs,
    '-filter_complex', filterComplex,
    '-map', '[vout]',
    '-map', '[aout]',
    '-c:v', enc.videoCodec,
    '-crf', String(enc.crf),
    '-c:a', 'aac',
    '-b:a', enc.audioBitrate,
    '-pix_fmt', 'yuv420p',
    '-y', outputPath,
  ], cwd);
}

interface SceneInput {
  narrative: string;
  assetUrl?: string;
  assetType: 'image' | 'video' | 'placeholder';
  audioUrl?: string;
  audioDuration?: number;
  estimatedDuration?: number;
  /** Camera motion hint for Ken Burns variant selection (e.g. "pan left", "zoom in", "static"). */
  cameraMotion?: string;
  /** Sound design hint for ambient SFX (e.g. "ambient drone", "rising tension"). */
  soundDesign?: string;
}

/** @internal Exported for testing */
export function formatSRT(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  const ms = Math.round((seconds % 1) * 1000);
  return `${pad(h)}:${pad(m)}:${pad(s)},${pad3(ms)}`;
}

function pad(n: number): string {
  return n.toString().padStart(2, '0');
}

function pad3(n: number): string {
  return n.toString().padStart(3, '0');
}

/**
 * Convert hex color (#RRGGBB) to FFmpeg ASS color format (&HBBGGRR&).
 * @internal Exported for testing.
 */
export function hexToAssColor(hex: string): string {
  const clean = hex.replace('#', '');
  if (clean.length !== 6) return '&HFFFFFF&';
  const r = clean.slice(0, 2);
  const g = clean.slice(2, 4);
  const b = clean.slice(4, 6);
  return `&H${b}${g}${r}&`.toUpperCase();
}

/**
 * Build FFmpeg subtitles filter force_style string from SubtitleStyle.
 * @internal Exported for testing.
 */
export function buildSubtitleForceStyle(style: SubtitleStyle): string {
  const parts: string[] = [
    `Fontname=${style.fontName}`,
    `FontSize=${style.fontSize}`,
    `PrimaryColour=${hexToAssColor(style.primaryColor)}`,
    `OutlineColour=${hexToAssColor(style.outlineColor)}`,
    `Outline=${style.outlineWidth}`,
    `Shadow=${style.shadowEnabled ? 1 : 0}`,
    `MarginV=${style.marginV}`,
  ];

  // Backdrop: use BackColour with alpha channel
  if (style.backdropEnabled && style.backdropOpacity > 0) {
    // ASS BackColour format: &HAABBGGRR (AA = alpha, 00 = opaque, FF = transparent)
    const alpha = Math.round((1 - style.backdropOpacity) * 255).toString(16).padStart(2, '0').toUpperCase();
    parts.push(`BackColour=&H${alpha}000000&`);
    parts.push('BorderStyle=4'); // Opaque box behind subtitles
  } else {
    parts.push('BackColour=&H00000000&'); // Fully transparent
  }

  return parts.join(',');
}

async function runWithConcurrency<T>(
  items: readonly T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<void>,
): Promise<void> {
  const limit = Math.max(1, Math.floor(concurrency));
  let next = 0;

  const runOne = async (): Promise<void> => {
    const index = next++;
    if (index >= items.length) return;
    await worker(items[index], index);
    await runOne();
  };

  const runners = Array.from({ length: Math.min(limit, items.length) }, () => runOne());
  await Promise.all(runners);
}

/** Track data-URL temp files so they can be cleaned up after assembly. */
const dataUrlTempFiles: string[] = [];

function resolveAssetPath(url: string | undefined, assetsDir: string): string | undefined {
  if (!url) return undefined;
  const safeAssetsDir = sanitizeFileSystemPath(assetsDir, 'assetsDir');
  // Data URL → save to temp file in assetsDir
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const ext = match[1].includes('video') ? '.mp4' : match[1].includes('audio') ? '.wav' : '.png';
      const tempName = sanitizeFileName(`tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}${ext}`, `tmp${ext}`);
      const tmpFile = ensurePathWithinBase(safeAssetsDir, join(safeAssetsDir, tempName), 'temporary asset file');
      writeFileSync(tmpFile, Buffer.from(match[2], 'base64'));
      dataUrlTempFiles.push(tmpFile);
      return tmpFile;
    }
  }
  if (/^[a-z]+:\/\//i.test(url)) return undefined;
  // Absolute path
  if (url.startsWith('/') || url.match(/^[A-Z]:\\/)) {
    const absolutePath = sanitizeFileSystemPath(url, 'asset path');
    return existsSync(absolutePath) ? absolutePath : undefined;
  }
  // Relative to assetsDir
  const relativeName = sanitizePathSegment(basename(url), 'asset filename');
  const relative = ensurePathWithinBase(safeAssetsDir, join(safeAssetsDir, relativeName), 'asset path');
  if (existsSync(relative)) return relative;
  // Try as-is
  try {
    const asIs = sanitizeFileSystemPath(url, 'asset path');
    if (existsSync(asIs)) return asIs;
  } catch {
    return undefined;
  }
  return undefined;
}

function resolvePreferredBinary(name: 'ffmpeg' | 'ffprobe'): string {
  const brewedBinary = `/opt/homebrew/opt/ffmpeg-full/bin/${name}`;
  return existsSync(brewedBinary) ? brewedBinary : name;
}

const FFMPEG_BIN = resolvePreferredBinary('ffmpeg');
const FFPROBE_BIN = resolvePreferredBinary('ffprobe');

function execFileText(
  binary: string,
  args: readonly string[],
  timeout: number,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(binary, [...args], { timeout, windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(Object.assign(error, { stderr: stderr ?? '' }));
        return;
      }
      resolve({ stdout: stdout ?? '', stderr: stderr ?? '' });
    });
  });
}

function formatCommandForLog(binary: string, args: readonly string[]): string {
  return [binary, ...args.map(arg => (/\s/.test(arg) ? JSON.stringify(arg) : arg))].join(' ');
}

async function ffmpeg(args: readonly string[], cwd: string): Promise<string> {
  const safeCwd = sanitizeFileSystemPath(cwd, 'ffmpeg cwd');
  const command = formatCommandForLog(FFMPEG_BIN, args);
  try {
    const { stdout } = await new Promise<{ stdout: string; stderr: string }>((resolve, reject) => {
      const child = spawn(FFMPEG_BIN, [...args], {
        cwd: safeCwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        windowsHide: true,
      });
      let stdout = '';
      let stderr = '';
      let didTimeout = false;

      const timer = setTimeout(() => {
        didTimeout = true;
        child.kill('SIGKILL');
      }, TIMEOUT);

      child.stdout.on('data', chunk => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', chunk => {
        stderr += chunk.toString();
      });
      child.on('error', err => {
        clearTimeout(timer);
        reject(err);
      });
      child.on('close', (code, signal) => {
        clearTimeout(timer);
        if (code === 0) {
          resolve({ stdout, stderr });
          return;
        }
        const suffix = didTimeout
          ? `timed out after ${TIMEOUT}ms`
          : `exited with code ${code ?? 'unknown'}${signal ? ` (${signal})` : ''}`;
        reject(new FFmpegCommandError(`FFmpeg error: ${(stderr || suffix).slice(-400)}`, command, stderr || suffix));
      });
    });
    return stdout;
  } catch (err) {
    const stderr = err instanceof FFmpegCommandError
      ? err.stderr
      : (err instanceof Error ? err.message : String(err));
    console.error(`[ffmpeg] Command failed: ${command.slice(0, 200)}...`);
    console.error(`[ffmpeg] stderr: ${stderr.slice(-500)}`);
    if (err instanceof FFmpegCommandError) {
      throw err;
    }
    throw new FFmpegCommandError(`FFmpeg error: ${stderr.slice(-400)}`, command, stderr);
  }
}
