import { execFile } from 'node:child_process';
import { stat } from 'node:fs/promises';
import path from 'node:path';
import { createLogger } from '../../lib/logger.js';

const slog = createLogger('VideoCompress');

const MAX_SIZE_MB = 30; // Only compress if larger than this

/** C4: Configurable compression settings */
export interface CompressionOptions {
  targetBitrate?: string;   // default '1000k'
  maxRate?: string;         // default '1500k'
  bufSize?: string;         // default '2000k'
  scaleHeight?: number;     // default 720
  audioBitrate?: string;    // default '64k'
}

const DEFAULT_COMPRESSION: Required<CompressionOptions> = {
  targetBitrate: '1000k',
  maxRate: '1500k',
  bufSize: '2000k',
  scaleHeight: 720,
  audioBitrate: '64k',
};

/**
 * Compress a video to a smaller size suitable for browser upload.
 * Returns the path to the compressed file, or the original if already small enough.
 */
export async function compressVideoForUpload(filePath: string, options?: CompressionOptions): Promise<string> {
  const fileStat = await stat(filePath);
  const sizeMB = fileStat.size / (1024 * 1024);

  if (sizeMB <= MAX_SIZE_MB) {
    slog.info('skip_compression', { sizeMB: sizeMB.toFixed(1), reason: 'under threshold' });
    return filePath;
  }

  slog.info('start_compression', { sizeMB: sizeMB.toFixed(1) });

  const dir = path.dirname(filePath);
  const ext = path.extname(filePath);
  const base = path.basename(filePath, ext);
  const outPath = path.join(dir, `${base}_compressed.mp4`);

  // Check if compressed version already exists and is recent
  try {
    const outStat = await stat(outPath);
    if (outStat.size > 0 && outStat.mtimeMs >= fileStat.mtimeMs) {
      const outMB = outStat.size / (1024 * 1024);
      slog.info('using_cached', { outMB: outMB.toFixed(1) });
      return outPath;
    }
  } catch { /* does not exist yet */ }

  // Target ~1 Mbps bitrate → ~10MB for 90s video
  const cfg = { ...DEFAULT_COMPRESSION, ...options };

  return new Promise((resolve, reject) => {
    const args = [
      '-y',           // overwrite
      '-i', filePath,
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-b:v', cfg.targetBitrate,
      '-maxrate', cfg.maxRate,
      '-bufsize', cfg.bufSize,
      '-vf', `scale=-2:${cfg.scaleHeight}`,
      '-c:a', 'aac',
      '-b:a', cfg.audioBitrate,
      '-movflags', '+faststart',
      outPath,
    ];

    slog.info('running_ffmpeg', { resolution: `${cfg.scaleHeight}p`, targetBitrate: cfg.targetBitrate });
    const start = Date.now();

    execFile('ffmpeg', args, { timeout: 120_000 }, (err, _stdout, stderr) => {
      if (err) {
        slog.warn('ffmpeg_failed', { error: err.message });
        slog.warn('fallback_original');
        resolve(filePath);
        return;
      }

      stat(outPath).then(outStat => {
        const outMB = outStat.size / (1024 * 1024);
        const elapsed = ((Date.now() - start) / 1000).toFixed(1);
        slog.info('compression_done', { elapsed, inputMB: sizeMB.toFixed(1), outputMB: outMB.toFixed(1) });
        resolve(outPath);
      }).catch(() => {
        slog.warn('stat_failed', { detail: 'cannot stat output, using original' });
        resolve(filePath);
      });
    });
  });
}
