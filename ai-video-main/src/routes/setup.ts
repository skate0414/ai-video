/* ------------------------------------------------------------------ */
/*  Setup routes — first-run experience and environment checks         */
/* ------------------------------------------------------------------ */

import { json, parseJsonBody, type Route } from './helpers.js';
import type { PipelineService } from '../pipeline/pipelineService.js';
import { execSync } from 'node:child_process';
import { createRequire } from 'node:module';

function isFFmpegAvailable(): boolean {
  try {
    execSync('ffmpeg -version', { stdio: 'ignore' });
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

export function setupRoutes(svc: PipelineService): Route[] {
  return [
    /* ---- Setup status check ---- */
    {
      method: 'GET',
      pattern: /^\/api\/setup\/status$/,
      handler: (_req, res) => {
        const accountCount = svc.getProviderCount();
        json(res, 200, {
          needsSetup: !svc.hasApiKey() && accountCount === 0,
          dataDir: svc.getDataDir(),
          hasApiKey: svc.hasApiKey(),
          accountCount,
          ffmpegAvailable: isFFmpegAvailable(),
          playwrightAvailable: isPlaywrightAvailable(),
          nodeVersion: process.version,
          platform: process.platform,
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
        }>(req);

        json(res, 200, svc.completeSetup(body));
      },
    },
  ];
}
