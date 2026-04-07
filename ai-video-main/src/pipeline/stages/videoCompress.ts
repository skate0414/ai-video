import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';

const MAX_SIZE_MB = 30; // Only compress if larger than this

/**
 * Compress a video to a smaller size suitable for browser upload.
 * Returns the path to the compressed file, or the original if already small enough.
 */
export async function compressVideoForUpload(filePath: string): Promise<string> {
  const fileStat = await stat(filePath);
  const sizeMB = fileStat.size / (1024 * 1024);

  if (sizeMB <= MAX_SIZE_MB) {
    console.log(`[videoCompress] File is ${sizeMB.toFixed(1)}MB — no compression needed`);
    return filePath;
  }

  console.log(`[videoCompress] File is ${sizeMB.toFixed(1)}MB — compressing for upload...`);

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const outPath = path.join(dir, `${base}_compressed.mp4`);

  // Check if compressed version already exists and is recent
  try {
    const outStat = await stat(outPath);
    if (outStat.size > 0 && outStat.mtimeMs >= fileStat.mtimeMs) {
      const outMB = outStat.size / (1024 * 1024);
      console.log(`[videoCompress] Using existing compressed file (${outMB.toFixed(1)}MB)`);
      return outPath;
    }
  } catch { /* does not exist yet */ }

  // Target ~1 Mbps bitrate → ~10MB for 90s video
  const targetBitrate = '1000k';

  return new Promise((resolve, reject) => {
    const args = [
      '-y',           // overwrite
      '-i', filePath,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-b:v', targetBitrate,
      '-maxrate', '1500k',
      '-bufsize', '2000k',
      '-vf', 'scale=-2:720',  // 720p
      '-c:a', 'aac',
      '-b:a', '64k',
      '-movflags', '+faststart',
      outPath,
    ];

    console.log(`[videoCompress] Running ffmpeg (720p, ${targetBitrate})...`);
    const start = Date.now();

    execFile('ffmpeg', args, { timeout: 120_000 }, (err, _stdout, stderr) => {
      if (err) {
        console.warn(`[videoCompress] ffmpeg failed: ${err.message}`);
        console.warn(`[videoCompress] Falling back to original file`);
        resolve(filePath);
        return;
      }

      stat(outPath).then(outStat => {
        const outMB = outStat.size / (1024 * 1024);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        console.log(`[videoCompress] Done in ${elapsed}s — ${sizeMB.toFixed(1)}MB → ${outMB.toFixed(1)}MB`);
        resolve(outPath);
      }).catch(() => {
        console.warn(`[videoCompress] Cannot stat output, using original`);
        resolve(filePath);
      });
    });
  });
}
