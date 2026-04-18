import { existsSync, mkdirSync, readdirSync, statSync, createReadStream, copyFileSync, unlinkSync } from 'node:fs';
import { join, extname, basename, resolve, normalize } from 'node:path';
import { execSync } from 'node:child_process';
import { json, parseMultipartFile, sanitizeError, type Route } from './helpers.js';
import type { PipelineService } from '../pipeline/pipelineService.js';
import type { WorkbenchEvent } from '../../shared/types.js';
import { WB_EVENT } from '../../shared/types.js';

export interface BgmLibraryItem {
  filename: string;
  mood: string;
  title: string;
  duration: number | null;
  size: number;
}

const MIME_MAP: Record<string, string> = {
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac',
  '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
};

const ALLOWED_EXTENSIONS = new Set(['.mp3', '.wav', '.aac', '.m4a', '.ogg']);

/** Map reference/library moods to Pixabay URL paths. */
const PIXABAY_MOOD_PATHS: Record<string, string> = {
  happy: 'happy',
  calm: 'calm',
  sad: 'sad',
  inspiring: 'inspiring',
  dramatic: 'dramatic',
  epic: 'epic',
  unknown: '',
};

/**
 * Parse filename like "{mood}--{title}.mp3" into mood + title.
 * Falls back to mood="unknown", title=filename stem if no "--" separator.
 */
function parseLibraryFilename(filename: string): { mood: string; title: string } {
  const stem = filename.replace(/\.[^.]+$/, '');
  const idx = stem.indexOf('--');
  if (idx === -1) return { mood: 'unknown', title: stem };
  return { mood: stem.slice(0, idx), title: stem.slice(idx + 2) };
}

/**
 * Get audio duration via ffprobe. Returns null if ffprobe is unavailable or fails.
 */
function getAudioDuration(filePath: string): number | null {
  try {
    const out = execSync(
      `ffprobe -v quiet -print_format json -show_format "${filePath}"`,
      { timeout: 10_000 },
    ).toString();
    const parsed = JSON.parse(out);
    const dur = parseFloat(parsed?.format?.duration);
    return Number.isFinite(dur) ? dur : null;
  } catch {
    return null;
  }
}

function ensureLibraryDir(dataDir: string): string {
  const dir = join(dataDir, 'bgm-library');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  return dir;
}

export function bgmLibraryRoutes(svc: PipelineService, broadcastEvent?: (event: WorkbenchEvent) => void): Route[] {
  return [
    /* ---- List BGM library ---- */
    {
      method: 'GET',
      pattern: /^\/api\/bgm-library$/,
      handler: (_req, res) => {
        const libDir = ensureLibraryDir(svc.getDataDir());
        const files = readdirSync(libDir).filter(f => {
          const ext = extname(f).toLowerCase();
          return ALLOWED_EXTENSIONS.has(ext);
        });

        const items: BgmLibraryItem[] = files.map(f => {
          const { mood, title } = parseLibraryFilename(f);
          const filePath = join(libDir, f);
          const stat = statSync(filePath);
          const duration = getAudioDuration(filePath);
          return { filename: f, mood, title, duration, size: stat.size };
        });

        json(res, 200, items);
      },
    },

    /* ---- Stream BGM from library (Range support) ---- */
    {
      method: 'GET',
      pattern: /^\/api\/bgm-library\/(?<filename>[^/]+)\/stream$/,
      handler: (req, res, match) => {
        const filename = decodeURIComponent(match.groups!.filename);
        const safeName = basename(filename);
        const libDir = ensureLibraryDir(svc.getDataDir());
        const filePath = resolve(libDir, safeName);

        // Path containment check
        if (!normalize(filePath).startsWith(normalize(libDir))) {
          json(res, 403, { error: 'Forbidden' }); return;
        }
        if (!existsSync(filePath)) {
          json(res, 404, { error: 'File not found' }); return;
        }

        const ext = extname(safeName).toLowerCase();
        const contentType = MIME_MAP[ext] || 'application/octet-stream';
        const stat = statSync(filePath);
        const fileSize = stat.size;

        const rangeHeader = req.headers.range;
        if (rangeHeader) {
          const parts = rangeHeader.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          if (start >= fileSize || end >= fileSize || start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
            res.end(); return;
          }
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': contentType,
          });
          createReadStream(filePath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
          });
          createReadStream(filePath).pipe(res);
        }
      },
    },

    /* ---- Upload file to BGM library ---- */
    {
      method: 'POST',
      pattern: /^\/api\/bgm-library\/upload$/,
      handler: async (req, res) => {
        const MAX_SIZE = 50 * 1024 * 1024; // 50 MB

        try {
          const file = await parseMultipartFile(req, MAX_SIZE + 1024 * 64);
          const safeName = basename(file.filename).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
          const ext = extname(safeName).toLowerCase();
          if (!ALLOWED_EXTENSIONS.has(ext)) {
            return json(res, 400, { error: `Unsupported format. Allowed: ${[...ALLOWED_EXTENSIONS].join(', ')}` });
          }
          if (file.data.length > MAX_SIZE) {
            return json(res, 400, { error: 'File exceeds 50 MB limit' });
          }

          const libDir = ensureLibraryDir(svc.getDataDir());
          const destPath = join(libDir, safeName);

          // Path containment
          if (!normalize(resolve(destPath)).startsWith(normalize(libDir))) {
            return json(res, 400, { error: 'Invalid filename' });
          }

          const { writeFileSync } = await import('node:fs');
          writeFileSync(destPath, file.data);

          const { mood, title } = parseLibraryFilename(safeName);
          const duration = getAudioDuration(destPath);

          json(res, 201, { ok: true, filename: safeName, mood, title, duration, size: file.data.length });
        } catch (err) {
          json(res, 400, { error: sanitizeError(err) });
        }
      },
    },

    /* ---- Copy library BGM to project ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/bgm\/from-library$/,
      handler: async (req, res, match) => {
        const projectId = match.groups!.id;
        const project = svc.loadProject(projectId);
        if (!project) return json(res, 404, { error: 'Project not found' });

        const { parseJsonBody } = await import('./helpers.js');
        const body = await parseJsonBody<{ filename: string }>(req);
        if (!body.filename) return json(res, 400, { error: 'filename is required' });

        const safeName = basename(body.filename);
        const ext = extname(safeName).toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
          return json(res, 400, { error: 'Unsupported audio format' });
        }

        const libDir = ensureLibraryDir(svc.getDataDir());
        const srcPath = resolve(libDir, safeName);

        // Path containment
        if (!normalize(srcPath).startsWith(normalize(libDir))) {
          return json(res, 403, { error: 'Forbidden' });
        }
        if (!existsSync(srcPath)) {
          return json(res, 404, { error: 'Library file not found' });
        }

        const projectDir = svc.getProjectDir(projectId);
        const bgmDir = join(projectDir, 'bgm');
        if (!existsSync(bgmDir)) mkdirSync(bgmDir, { recursive: true });

        // Remove existing bgm.* files
        for (const f of readdirSync(bgmDir)) {
          if (f.startsWith('bgm.')) {
            const { unlinkSync } = await import('node:fs');
            unlinkSync(join(bgmDir, f));
          }
        }

        const destPath = join(bgmDir, `bgm${ext}`);
        copyFileSync(srcPath, destPath);
        const stat = statSync(destPath);

        json(res, 200, { ok: true, filename: `bgm${ext}`, size: stat.size });
      },
    },

    /* ---- Open Pixabay Music browse tab in Electron ---- */
    {
      method: 'POST',
      pattern: /^\/api\/bgm-library\/open-pixabay$/,
      handler: async (req, res) => {
        const { parseJsonBody } = await import('./helpers.js');
        const body = await parseJsonBody<{ mood?: string }>(req);
        const mood = (body.mood ?? '').toLowerCase().trim();

        // Build Pixabay URL with mood parameter if applicable
        const moodPath = PIXABAY_MOOD_PATHS[mood] ?? '';
        // Collapse double slashes from empty moodPath while preserving ://
        const finalUrl = `https://pixabay.com/music/search/${moodPath}/`
          .replace('://', ':||')
          .replace(/\/+/g, '/')
          .replace(':||', '://');

        // Try to open browse tab in Electron via automation server
        try {
          const token = process.env.ELECTRON_AUTOMATION_TOKEN;
          if (!token) {
            // Not in Electron mode — return fallback URL
            return json(res, 200, { ok: false, fallbackUrl: finalUrl });
          }

          const response = await fetch('http://127.0.0.1:3221/automation/browse', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${token}` },
            body: JSON.stringify({ url: finalUrl, title: 'Pixabay Music' }),
          });

          if (!response.ok) {
            return json(res, 200, { ok: false, fallbackUrl: finalUrl });
          }

          const data = await response.json() as { tabId: string };
          json(res, 200, { ok: true, tabId: data.tabId });
        } catch (err) {
          console.error('[BGMLibrary] Failed to open Pixabay tab:', err);
          json(res, 200, { ok: false, fallbackUrl: finalUrl });
        }
      },
    },

    /* ---- Handle audio download completion from Pixabay ---- */
    {
      method: 'POST',
      pattern: /^\/api\/bgm-library\/download-complete$/,
      handler: async (req, res) => {
        const { parseJsonBody } = await import('./helpers.js');
        const body = await parseJsonBody<{ filePath: string; filename: string }>(req);
        const { filePath, filename } = body;

        if (!filePath || !filename) {
          return json(res, 400, { error: 'filePath and filename are required' });
        }

        try {
          // Defense-in-depth: reject filePath containing path traversal sequences
          const normalizedSrc = normalize(resolve(filePath));
          if (normalizedSrc.includes('..') || normalizedSrc.includes('\0')) {
            return json(res, 403, { error: 'Forbidden' });
          }

          // Validate file exists and is audio
          if (!existsSync(filePath)) {
            return json(res, 404, { error: 'Downloaded file not found' });
          }

          const ext = extname(filename).toLowerCase();
          if (!ALLOWED_EXTENSIONS.has(ext)) {
            return json(res, 400, { error: 'Unsupported audio format' });
          }

          const stat = statSync(filePath);
          if (stat.size === 0 || stat.size > 50 * 1024 * 1024) {
            return json(res, 400, { error: 'File size invalid (0 or >50MB)' });
          }

          // Parse mood and title from filename
          let parsedFilename = filename;
          const { mood, title } = parseLibraryFilename(parsedFilename);

          // Sanitize for safe filename
          const safeName = basename(filename).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
          const libDir = ensureLibraryDir(svc.getDataDir());
          const destPath = join(libDir, `${mood}--${title}${ext}`);

          // Path containment check
          if (!normalize(resolve(destPath)).startsWith(normalize(libDir))) {
            return json(res, 403, { error: 'Forbidden' });
          }

          // Copy file to library
          copyFileSync(filePath, destPath);

          // Get duration
          const duration = getAudioDuration(destPath);
          const finalSize = statSync(destPath).size;

          // Broadcast SSE event
          if (broadcastEvent) {
            broadcastEvent({
              type: WB_EVENT.BGM_DOWNLOAD_READY,
              payload: {
                filename: `${mood}--${title}${ext}`,
                originalName: filename,
                mood,
                title,
                size: finalSize,
              },
            });
          }

          json(res, 200, { ok: true, filename: `${mood}--${title}${ext}`, mood, title, duration, size: finalSize });
        } catch (err) {
          console.error('[BGMLibrary] Failed to process download:', err);
          json(res, 500, { error: sanitizeError(err) });
        }
      },
    },
  ];
}
