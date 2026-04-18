/* ------------------------------------------------------------------ */
/*  Setup routes — first-run experience and environment checks         */
/* ------------------------------------------------------------------ */

import { json, parseJsonBody, type Route } from './helpers.js';
import type { PipelineService } from '../pipeline/pipelineService.js';
import { execSync, spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { resolveChromiumChannel } from '../browserManager.js';

function isFFmpegAvailable(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function isEdgeTTSAvailable(): boolean {
  try {
    execSync('edge-tts --version', { stdio: 'ignore', timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

function isPlaywrightAvailable(): boolean {
  try {
    const require = createRequire(import.meta.url);
    require.resolve('playwright');
    return true;
  } catch {
    return false;
  }
}

/**
 * Check whether a usable Chromium/Chrome browser is available for Playwright.
 * Returns true if either the Playwright bundled Chromium is installed or
 * the system Chrome is accessible via `channel: 'chrome'`.
 */
function isChromiumInstalled(): boolean {
  // If resolveChromiumChannel returns undefined, bundled Chromium is available.
  // If it returns 'chrome', we need system Chrome — verify it's reachable.
  const channel = resolveChromiumChannel();
  if (channel === undefined) return true; // Playwright bundled Chromium exists

  // Fallback: check if system Chrome/Chromium binary is on PATH
  const commands = process.platform === 'win32'
    ? ['where chrome']
    : ['which google-chrome', 'which google-chrome-stable', 'which chromium-browser', 'which chromium'];

  for (const cmd of commands) {
    try {
      execSync(cmd, { stdio: 'ignore', timeout: 5000 });
      return true;
    } catch { /* not found, try next */ }
  }
  return false;
}

export function setupRoutes(svc: PipelineService): Route[] {
  return [
    /* ---- Setup status check ---- */
    {
      method: 'GET',
      pattern: /^\/api\/setup\/status$/,
      handler: (_req, res) => {
        const accountCount = svc.getProviderCount();
        const apiResourceCount = svc.getApiResourceCount();
        json(res, 200, {
          needsSetup: !svc.hasApiKey() && accountCount === 0,
          dataDir: svc.getDataDir(),
          hasApiKey: svc.hasApiKey(),
          accountCount,
          apiResourceCount,
          ffmpegAvailable: isFFmpegAvailable(),
          edgeTtsAvailable: isEdgeTTSAvailable(),
          playwrightAvailable: isPlaywrightAvailable(),
          chromiumAvailable: isChromiumInstalled(),
          nodeVersion: process.version,
          platform: process.platform,
        });
      },
    },

    /* ---- Install Playwright Chromium browser ---- */
    {
      method: 'POST',
      pattern: /^\/api\/setup\/install-browser$/,
      handler: (_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const send = (data: Record<string, unknown>) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        send({ status: 'installing', message: '正在安装 Chromium 浏览器...' });

        const child = spawn('npx', ['playwright', 'install', 'chromium'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
        });

        child.stdout?.on('data', (chunk: Buffer) => {
          send({ status: 'progress', message: chunk.toString().trim() });
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          send({ status: 'progress', message: chunk.toString().trim() });
        });

        child.on('close', (code) => {
          if (code === 0) {
            send({ status: 'done', message: 'Chromium 安装完成 ✅' });
          } else {
            send({ status: 'error', message: `安装失败，退出码 ${code}` });
          }
          res.end();
        });

        child.on('error', (err) => {
          send({ status: 'error', message: `安装失败: ${err.message}` });
          res.end();
        });
      },
    },

    /* ---- Install edge-tts (Python package) ---- */
    {
      method: 'POST',
      pattern: /^\/api\/setup\/install-edge-tts$/,
      handler: (_req, res) => {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          Connection: 'keep-alive',
        });

        const send = (data: Record<string, unknown>) => {
          res.write(`data: ${JSON.stringify(data)}\n\n`);
        };

        send({ status: 'installing', message: '正在安装 edge-tts...' });

        const child = spawn('pip3', ['install', 'edge-tts'], {
          stdio: ['ignore', 'pipe', 'pipe'],
          shell: process.platform === 'win32',
        });

        child.stdout?.on('data', (chunk: Buffer) => {
          send({ status: 'progress', message: chunk.toString().trim() });
        });
        child.stderr?.on('data', (chunk: Buffer) => {
          send({ status: 'progress', message: chunk.toString().trim() });
        });

        child.on('close', (code) => {
          if (code === 0) {
            send({ status: 'done', message: 'edge-tts 安装完成 ✅' });
          } else {
            send({ status: 'error', message: `安装失败，退出码 ${code}。请手动运行: pip install edge-tts` });
          }
          res.end();
        });

        child.on('error', (err) => {
          send({ status: 'error', message: `安装失败: ${err.message}` });
          res.end();
        });
      },
    },

    /* ---- Complete setup (save config) ---- */
    {
      method: 'POST',
      pattern: /^\/api\/setup\/complete$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{
          geminiApiKey?: string;
          aivideomakerApiKey?: string;
        }>(req);

        json(res, 200, svc.completeSetup(body));
      },
    },
  ];
}
