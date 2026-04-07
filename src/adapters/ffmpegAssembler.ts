/* ------------------------------------------------------------------ */
/*  FFmpeg Assembler – server-side video composition via FFmpeg CLI     */
/*  Combines scene assets (images/videos + audio) into final MP4       */
/* ------------------------------------------------------------------ */

import { exec } from 'node:child_process';
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, basename } from 'node:path';
import { promisify } from 'node:util';

const execAsync = promisify(exec);
const TIMEOUT = 120_000; // 2 min per ffmpeg command

export interface AssemblyOptions {
  assetsDir: string;
  outputDir: string;
  projectTitle?: string;
  bgmPath?: string;
  bgmVolume?: number;          // 0-1, default 0.15
  onProgress?: (percent: number, message: string) => void;
}

/* ---- Public API ---- */

export async function isFFmpegAvailable(): Promise<boolean> {
  try {
    await execAsync('ffmpeg -version', { timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

export async function getMediaDuration(filePath: string): Promise<number> {
  try {
    const { stdout } = await execAsync(
      `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`,
      { timeout: 15_000 },
    );
    return parseFloat(stdout.trim()) || 0;
  } catch {
    return 0;
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
  const { assetsDir, outputDir, onProgress } = options;
  const tmpDir = join(outputDir, '_assembly_tmp');
  if (!existsSync(tmpDir)) mkdirSync(tmpDir, { recursive: true });

  const sceneVideos: string[] = [];
  const totalSteps = scenes.length + 3; // scenes + concat + subtitles + final
  let currentStep = 0;

  const progress = (msg: string) => {
    currentStep++;
    const pct = Math.round((currentStep / totalSteps) * 100);
    onProgress?.(pct, msg);
  };

  // ---- Step 1: Process each scene into a standalone video ----
  for (let i = 0; i < scenes.length; i++) {
    const scene = scenes[i];
    const sceneFile = join(tmpDir, `scene_${i}.mp4`);

    const assetPath = resolveAssetPath(scene.assetUrl, assetsDir);
    const audioPath = resolveAssetPath(scene.audioUrl, assetsDir);
    const duration = scene.audioDuration ?? scene.estimatedDuration ?? 5;

    if (scene.assetType === 'video' && assetPath && existsSync(assetPath)) {
      // Video scene: merge with audio
      if (audioPath && existsSync(audioPath)) {
        await ffmpeg(
          `-i "${assetPath}" -i "${audioPath}" -c:v libx264 -c:a aac -b:a 128k -shortest -y "${sceneFile}"`,
          tmpDir,
        );
      } else {
        // Video without separate audio — generate silent audio track
        await ffmpeg(
          `-i "${assetPath}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -c:v libx264 -c:a aac -b:a 128k -t ${duration} -shortest -y "${sceneFile}"`,
          tmpDir,
        );
      }
    } else if (assetPath && existsSync(assetPath)) {
      // Image scene: image → video with audio
      if (audioPath && existsSync(audioPath)) {
        const audioDur = await getMediaDuration(audioPath) || duration;
        await ffmpeg(
          `-loop 1 -i "${assetPath}" -i "${audioPath}" -c:v libx264 -tune stillimage -c:a aac -b:a 128k -pix_fmt yuv420p -t ${audioDur} -y "${sceneFile}"`,
          tmpDir,
        );
      } else {
        // Image without audio — static frame with silence
        await ffmpeg(
          `-loop 1 -i "${assetPath}" -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -c:v libx264 -tune stillimage -c:a aac -b:a 128k -pix_fmt yuv420p -t ${duration} -y "${sceneFile}"`,
          tmpDir,
        );
      }
    } else {
      // No asset — generate a black frame placeholder
      await ffmpeg(
        `-f lavfi -i color=c=black:s=1280x720:d=${duration} -f lavfi -i anullsrc=channel_layout=stereo:sample_rate=44100 -c:v libx264 -c:a aac -pix_fmt yuv420p -t ${duration} -y "${sceneFile}"`,
        tmpDir,
      );
    }

    sceneVideos.push(sceneFile);
    progress(`场景 ${i + 1}/${scenes.length} 合成完成`);
  }

  // ---- Step 2: Normalize & Concat ----
  // First normalize all scene videos to consistent format
  const normalizedVideos: string[] = [];
  for (let i = 0; i < sceneVideos.length; i++) {
    const normalized = join(tmpDir, `norm_${i}.mp4`);
    await ffmpeg(
      `-i "${sceneVideos[i]}" -vf "scale=1280:720:force_original_aspect_ratio=decrease,pad=1280:720:(ow-iw)/2:(oh-ih)/2,setsar=1" -r 30 -c:v libx264 -c:a aac -ar 44100 -ac 2 -y "${normalized}"`,
      tmpDir,
    );
    normalizedVideos.push(normalized);
  }

  const concatList = join(tmpDir, 'concat.txt');
  const concatContent = normalizedVideos.map(f => `file '${f}'`).join('\n');
  writeFileSync(concatList, concatContent);

  const concatOutput = join(tmpDir, 'concat.mp4');
  await ffmpeg(
    `-f concat -safe 0 -i "${concatList}" -c copy -y "${concatOutput}"`,
    tmpDir,
  );
  progress('场景拼接完成');

  // ---- Step 3: Burn subtitles ----
  const srtContent = generateSRT(scenes);
  const srtFile = join(tmpDir, 'subtitles.srt');
  writeFileSync(srtFile, srtContent, 'utf-8');

  const subsOutput = join(tmpDir, 'with_subs.mp4');
  // Use drawtext for each subtitle line to avoid libass dependency issues
  // We use subtitles filter with the SRT file
  const escapedSrt = srtFile.replace(/\\/g, '/').replace(/:/g, '\\:');
  await ffmpeg(
    `-i "${concatOutput}" -vf "subtitles='${escapedSrt}':force_style='FontSize=18,PrimaryColour=&HFFFFFF&,OutlineColour=&H000000&,Outline=2,MarginV=30'" -c:v libx264 -c:a copy -y "${subsOutput}"`,
    tmpDir,
  );
  progress('字幕烧录完成');

  // ---- Step 4: BGM Mix (optional) ----
  let finalInput = subsOutput;
  if (options.bgmPath && existsSync(options.bgmPath)) {
    const bgmVol = options.bgmVolume ?? 0.15;
    const bgmOutput = join(tmpDir, 'with_bgm.mp4');
    await ffmpeg(
      `-i "${subsOutput}" -i "${options.bgmPath}" -filter_complex "[1:a]volume=${bgmVol}[bgm];[0:a][bgm]amix=inputs=2:duration=first:dropout_transition=3[aout]" -map 0:v -map "[aout]" -c:v copy -c:a aac -y "${bgmOutput}"`,
      tmpDir,
    );
    finalInput = bgmOutput;
  }

  // ---- Step 5: Final output ----
  const timestamp = Date.now();
  const safeName = (options.projectTitle ?? 'video').replace(/[^a-zA-Z0-9_\u4e00-\u9fff-]/g, '_');
  const finalPath = join(outputDir, `${safeName}_${timestamp}.mp4`);
  await ffmpeg(
    `-i "${finalInput}" -c copy -movflags +faststart -y "${finalPath}"`,
    tmpDir,
  );
  progress('最终视频输出完成');

  // Cleanup tmp files
  try {
    for (const f of [...sceneVideos, ...normalizedVideos, concatList, concatOutput, subsOutput]) {
      if (existsSync(f)) unlinkSync(f);
    }
    if (options.bgmPath && existsSync(join(tmpDir, 'with_bgm.mp4'))) {
      unlinkSync(join(tmpDir, 'with_bgm.mp4'));
    }
  } catch { /* best-effort cleanup */ }

  return finalPath;
}

/* ---- Internal helpers ---- */

interface SceneInput {
  narrative: string;
  assetUrl?: string;
  assetType: 'image' | 'video' | 'placeholder';
  audioUrl?: string;
  audioDuration?: number;
  estimatedDuration?: number;
}

function formatSRT(seconds: number): string {
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

function resolveAssetPath(url: string | undefined, assetsDir: string): string | undefined {
  if (!url) return undefined;
  // Data URL → save to temp file in assetsDir
  if (url.startsWith('data:')) {
    const match = url.match(/^data:([^;]+);base64,(.+)$/);
    if (match) {
      const ext = match[1].includes('video') ? '.mp4' : match[1].includes('audio') ? '.wav' : '.png';
      const tmpFile = join(assetsDir, `_tmp_${Date.now()}${ext}`);
      writeFileSync(tmpFile, Buffer.from(match[2], 'base64'));
      return tmpFile;
    }
  }
  // Absolute path
  if (url.startsWith('/') || url.match(/^[A-Z]:\\/)) return url;
  // Relative to assetsDir
  const relative = join(assetsDir, basename(url));
  if (existsSync(relative)) return relative;
  // Try as-is
  if (existsSync(url)) return url;
  return undefined;
}

async function ffmpeg(args: string, cwd: string): Promise<string> {
  try {
    const { stdout, stderr } = await execAsync(`ffmpeg ${args}`, { cwd, timeout: TIMEOUT });
    return stdout;
  } catch (err: any) {
    const stderr = err.stderr ?? '';
    console.error(`[ffmpeg] Command failed: ffmpeg ${args.slice(0, 200)}...`);
    console.error(`[ffmpeg] stderr: ${stderr.slice(0, 500)}`);
    throw new Error(`FFmpeg error: ${stderr.slice(0, 300)}`);
  }
}
