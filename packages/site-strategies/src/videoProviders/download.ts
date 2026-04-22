/* ------------------------------------------------------------------ */
/*  Download helpers for completed generated videos                   */
/* ------------------------------------------------------------------ */

import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Page } from 'playwright';
import { createLogger } from '@ai-video/lib/logger.js';
import type { ApiLog, VideoGenResult, VideoGenerationRuntime, WriteFailure } from './types.js';

const log = createLogger('VideoProviderDownload');

/** Minimum byte threshold for a valid video file (10 KB). */
const MIN_VIDEO_BYTES = 10_000;

/** Timeout in milliseconds for node:https CDN downloads. */
const CDN_DOWNLOAD_TIMEOUT_MS = 60_000;

/**
 * Download a video from a CDN URL using node:https.
 * Returns the downloaded Buffer, or null on failure or if the data is too small.
 * Enforces a timeout to prevent indefinite hangs on slow/unresponsive servers.
 *
 * @internal Exported for unit testing only.
 */
export async function downloadFromHttpUrl(cdnUrl: string): Promise<Buffer | null> {
  try {
    const { default: https } = await import('node:https');
    const data = await new Promise<Buffer>((resolve, reject) => {
      const req = https.get(cdnUrl, (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
        res.on('error', reject);
      });
      req.on('error', reject);
      req.setTimeout(CDN_DOWNLOAD_TIMEOUT_MS, () => {
        req.destroy(new Error(`CDN download timed out after ${CDN_DOWNLOAD_TIMEOUT_MS / 1000}s`));
      });
    });
    if (data.length < MIN_VIDEO_BYTES) {
      log.warn('cdn_download_too_small', { url: cdnUrl.slice(0, 120), bytes: data.length });
      return null;
    }
    return data;
  } catch (e) {
    log.warn('cdn_download_failed', { url: cdnUrl.slice(0, 120), error: e instanceof Error ? e.message : String(e) });
    return null;
  }
}

export async function downloadGeneratedVideo(
  page: Page,
  runtime: VideoGenerationRuntime,
  apiLogs: ApiLog[],
  writeFailure: WriteFailure,
): Promise<VideoGenResult | null> {
  const outputPath = join(runtime.outputDir, runtime.filename);

  if (runtime.strategy.extractVideoUrlFromApi && !existsSync(outputPath)) {
    for (const apiLog of [...apiLogs].reverse()) {
      if (!apiLog.body) continue;
      const cdnMatch = apiLog.body.match(/"resource"\s*:\s*"(https?:\/\/[^"]+(?:\.mp4|\/video\/[^"]+)[^"]*)"/);
      if (!cdnMatch) {
        const videoUrlMatch = apiLog.body.match(/"(https?:\/\/[^"]*(?:kcdn|ksyun|kwai|cos)[^"]*(?:\.mp4|video)[^"]*)"/);
        if (!videoUrlMatch) continue;
        const cdnUrl = videoUrlMatch[1]!;
        log.info('api_video_url_found', { url: cdnUrl.slice(0, 120) });
        const data = await downloadFromHttpUrl(cdnUrl);
        if (data) {
          writeFileSync(outputPath, data);
          log.info('video_saved_cdn', { path: outputPath, sizeMB: (data.length / 1024 / 1024).toFixed(1) });
        }
        if (existsSync(outputPath)) break;
        continue;
      }

      const cdnUrl = cdnMatch[1]!;
      log.info('api_cdn_url_found', { url: cdnUrl.slice(0, 120) });
      const data = await downloadFromHttpUrl(cdnUrl);
      if (data) {
        writeFileSync(outputPath, data);
        log.info('video_saved_cdn', { path: outputPath, sizeMB: (data.length / 1024 / 1024).toFixed(1) });
      }
      if (existsSync(outputPath)) break;
    }
  }

  if (!existsSync(outputPath)) {
    const dlBtn = page.locator('a[download], button:has-text("下载"), button:has-text("Download"), a[href*="download" i]').first();
    if (await dlBtn.count() > 0 && await dlBtn.isVisible()) {
      try {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 15_000 }),
          dlBtn.click(),
        ]);
        await download.saveAs(outputPath);
        log.info('video_saved_button', { path: outputPath });
      } catch (e) {
        log.warn('download_button_failed', { error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  if (!existsSync(outputPath)) {
    const videoUrl = await page.evaluate(`(
      () => {
        var urls = [];
        var walk = function(root) {
          root.querySelectorAll('video').forEach(function(v) {
            if (v.src && (v.src.startsWith('blob:') || v.src.startsWith('http'))) urls.push(v.src);
            var src = v.querySelector('source');
            if (src && src.src) urls.push(src.src);
          });
          root.querySelectorAll('*').forEach(function(el) {
            if (el.shadowRoot) walk(el.shadowRoot);
          });
        };
        walk(document);
        return urls.length > 0 ? urls[urls.length - 1] : null;
      }
    )()`).catch(() => null) as string | null;

    if (videoUrl) {
      log.info('video_url_extracting', { url: videoUrl.slice(0, 100) });
      try {
        if (videoUrl.startsWith('blob:')) {
          const base64 = await page.evaluate(`(async () => {
            var url = ${JSON.stringify(videoUrl)};
            return new Promise(function(resolve, reject) {
              var xhr = new XMLHttpRequest();
              xhr.open('GET', url, true);
              xhr.responseType = 'blob';
              xhr.onload = function() {
                if (xhr.status >= 200 && xhr.status < 300) {
                  var reader = new FileReader();
                  reader.onload = function() { resolve(reader.result.split(',')[1] || ''); };
                  reader.onerror = function() { reject(new Error('FileReader failed')); };
                  reader.readAsDataURL(xhr.response);
                } else { reject(new Error('XHR status ' + xhr.status)); }
              };
              xhr.onerror = function() { reject(new Error('XHR network error')); };
              xhr.send();
            });
          })()`) as string;
          if (base64) {
            writeFileSync(outputPath, Buffer.from(base64, 'base64'));
            log.info('video_saved_blob', { path: outputPath });
          }
        } else {
          const resp = await page.evaluate(`(async () => {
            var url = ${JSON.stringify(videoUrl)};
            return new Promise(function(resolve, reject) {
              var xhr = new XMLHttpRequest();
              xhr.open('GET', url, true);
              xhr.responseType = 'arraybuffer';
              xhr.onload = function() {
                if (xhr.status >= 200 && xhr.status < 300) {
                  resolve(Array.from(new Uint8Array(xhr.response)));
                } else { reject(new Error('XHR status ' + xhr.status)); }
              };
              xhr.onerror = function() { reject(new Error('XHR network error')); };
              xhr.send();
            });
          })()`) as number[];
          writeFileSync(outputPath, Buffer.from(resp));
          log.info('video_saved_url', { path: outputPath });
        }
      } catch (e) {
        log.warn('video_extraction_failed', { error: e instanceof Error ? e.message : String(e) });
      }
    }
  }

  if (existsSync(outputPath)) {
    return { localPath: outputPath };
  }

  log.warn('no_video_file_produced', { outputPath });
  writeFailure('NO_VIDEO_FILE: All download strategies failed', { outputPath });
  return null;
}
