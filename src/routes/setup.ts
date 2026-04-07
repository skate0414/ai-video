/* ------------------------------------------------------------------ */
/*  Setup routes — first-run experience and environment checks         */
/* ------------------------------------------------------------------ */

import { json, parseJsonBody, type Route } from './helpers.js';
import type { PipelineContext } from './pipeline.js';
import { execSync } from 'node:child_process';
import { GeminiAdapter } from '../adapters/geminiAdapter.js';
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

export function setupRoutes(ctx: PipelineContext): Route[] {
  return [
    /* ---- Setup status check ---- */
    {
      method: 'GET',
      pattern: /^\/api\/setup\/status$/,
      handler: (_req, res) => {
        const accountCount = ctx.orchestrator.providerRegistry.getAll().length;
        json(res, 200, {
          needsSetup: !ctx.geminiApiKey && accountCount === 0,
          dataDir: ctx.dataDir,
          hasApiKey: !!ctx.geminiApiKey,
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

        if (body.geminiApiKey) {
          ctx.geminiApiKey = body.geminiApiKey;
          ctx.apiAdapter = new GeminiAdapter(ctx.geminiApiKey);
          ctx.configStore.update({ geminiApiKey: body.geminiApiKey });
        }

        json(res, 200, {
          ok: true,
          hasApiKey: !!ctx.geminiApiKey,
        });
      },
    },
  ];
}
