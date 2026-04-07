import { existsSync, createReadStream, statSync } from 'node:fs';
import { basename } from 'node:path';
import type { QualityTier, PipelineStage, ModelOverrides } from '../pipeline/types.js';
import { json, parseJsonBody, type Route } from './helpers.js';
import type { TTSSettings } from '../configStore.js';
import type { VideoProviderConfig } from '../adapters/videoProvider.js';
import { isEdgeTTSAvailable, listVoices } from '../adapters/ttsProvider.js';
import { isFFmpegAvailable } from '../adapters/ffmpegAssembler.js';
import { execSync } from 'node:child_process';
import { listPresets, getPreset } from '../providerPresets.js';
import { PipelineService } from '../pipeline/pipelineService.js';

/* ---- Helper: check if Playwright is installed ---- */

function isPlaywrightInstalled(): boolean {
  try {
    execSync('npx playwright --version', { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/* ================================================================== */
/*  pipelineRoutesV2 – facade-based routes using PipelineService       */
/*  Routes NEVER access orchestrator internals directly.              */
/* ================================================================== */

export function pipelineRoutesV2(svc: PipelineService): Route[] {
  return [
    /* ---- List projects ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline$/,
      handler: (_req, res) => json(res, 200, svc.listProjects()),
    },

    /* ---- Create project ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{ topic: string; title?: string; qualityTier?: QualityTier; modelOverrides?: ModelOverrides }>(req);
        if (!body.topic?.trim()) return json(res, 400, { error: 'topic is required' });
        const project = svc.createProject(body.topic.trim(), body.title?.trim(), body.qualityTier, body.modelOverrides);
        json(res, 201, project);
      },
    },

    /* ---- Get project ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)$/,
      handler: (_req, res, match) => {
        const project = svc.loadProject(match.groups!.id);
        if (!project) return json(res, 404, { error: 'Project not found' });
        json(res, 200, project);
      },
    },

    /* ---- Delete project ---- */
    {
      method: 'DELETE',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)$/,
      handler: (_req, res, match) => {
        const deleted = svc.deleteProject(match.groups!.id);
        if (!deleted) return json(res, 404, { error: 'Project not found' });
        json(res, 200, { ok: true });
      },
    },

    /* ---- Start pipeline ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/start$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ videoFilePath?: string }>(req).catch(() => ({} as { videoFilePath?: string }));
        svc.startPipeline(match.groups!.id, body.videoFilePath);
        json(res, 200, { ok: true, projectId: match.groups!.id });
      },
    },

    /* ---- Stop pipeline ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/stop$/,
      handler: (_req, res, match) => {
        svc.stopPipeline(match.groups!.id);
        json(res, 200, { ok: true });
      },
    },

    /* ---- Retry stage ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/retry\/(?<stage>[A-Z_]+)$/,
      handler: (_req, res, match) => {
        svc.retryStage(match.groups!.id, match.groups!.stage as PipelineStage);
        json(res, 200, { ok: true, projectId: match.groups!.id, stage: match.groups!.stage });
      },
    },

    /* ---- Regenerate scene ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/scenes\/(?<sceneId>[^/]+)\/regenerate$/,
      handler: async (_req, res, match) => {
        try {
          const scene = await svc.regenerateScene(match.groups!.id, match.groups!.sceneId);
          json(res, 200, scene);
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },

    /* ---- Resume pipeline ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/resume$/,
      handler: (_req, res, match) => {
        svc.resumePipeline(match.groups!.id);
        json(res, 200, { ok: true, projectId: match.groups!.id });
      },
    },

    /* ---- Update script ---- */
    {
      method: 'PUT',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/script$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ scriptText: string }>(req);
        if (!body.scriptText) return json(res, 400, { error: 'scriptText is required' });
        try {
          json(res, 200, svc.updateScript(match.groups!.id, body.scriptText));
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },

    /* ---- Update scenes ---- */
    {
      method: 'PUT',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/scenes$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ scenes: any[] }>(req);
        if (!body.scenes) return json(res, 400, { error: 'scenes array is required' });
        try {
          json(res, 200, svc.updateScenes(match.groups!.id, body.scenes));
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },

    /* ---- Approve scene ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/scenes\/(?<sceneId>[^/]+)\/approve$/,
      handler: (_req, res, match) => {
        try {
          json(res, 200, svc.approveScene(match.groups!.id, match.groups!.sceneId));
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },

    /* ---- Reject scene ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/scenes\/(?<sceneId>[^/]+)\/reject$/,
      handler: (_req, res, match) => {
        try {
          json(res, 200, svc.rejectScene(match.groups!.id, match.groups!.sceneId));
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },

    /* ---- QA override ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/qa-override$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ feedback?: string }>(req).catch(() => ({} as { feedback?: string }));
        try {
          json(res, 200, svc.approveQaReview(match.groups!.id, body));
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },

    /* ---- Approve reference images ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/approve-reference$/,
      handler: (_req, res, match) => {
        try {
          json(res, 200, svc.approveReferenceImages(match.groups!.id));
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },

    /* ---- Set style profile ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/style-profile$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ pastedText?: string; styleProfile?: any; topic?: string }>(req);
        try {
          const project = await svc.setStyleProfile(match.groups!.id, body.pastedText, body.styleProfile, body.topic);
          json(res, 200, project);
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },

    /* ---- Update model overrides ---- */
    {
      method: 'PUT',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/overrides$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ modelOverrides: ModelOverrides }>(req);
        try {
          json(res, 200, svc.updateModelOverrides(match.groups!.id, body.modelOverrides ?? {}));
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },

    /* ---- Config ---- */
    {
      method: 'GET',
      pattern: /^\/api\/config$/,
      handler: (_req, res) => json(res, 200, svc.getConfig()),
    },
    {
      method: 'POST',
      pattern: /^\/api\/config$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{ geminiApiKey?: string; qualityTier?: QualityTier; productionConcurrency?: number }>(req);
        json(res, 200, svc.updateConfig(body));
      },
    },

    /* ---- Environment diagnostics ---- */
    {
      method: 'GET',
      pattern: /^\/api\/config\/environment$/,
      handler: async (_req, res) => {
        const [ffmpeg, edgeTts, playwright] = await Promise.all([
          isFFmpegAvailable(),
          isEdgeTTSAvailable(),
          isPlaywrightInstalled(),
        ]);
        json(res, 200, { ffmpegAvailable: ffmpeg, edgeTtsAvailable: edgeTts, playwrightAvailable: playwright, nodeVersion: process.version, platform: process.platform, dataDir: svc.getDataDir() });
      },
    },

    /* ---- TTS config ---- */
    {
      method: 'GET',
      pattern: /^\/api\/config\/tts$/,
      handler: (_req, res) => json(res, 200, svc.getTtsConfig()),
    },
    {
      method: 'POST',
      pattern: /^\/api\/config\/tts$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<TTSSettings>(req);
        svc.updateTtsConfig(body);
        json(res, 200, { ok: true, ttsConfig: body });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/config\/tts\/voices$/,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const voices = await listVoices(url.searchParams.get('locale') ?? undefined);
        json(res, 200, { voices });
      },
    },

    /* ---- Video provider config ---- */
    {
      method: 'GET',
      pattern: /^\/api\/config\/video-provider$/,
      handler: (_req, res) => json(res, 200, svc.getVideoProviderConfig()),
    },
    {
      method: 'POST',
      pattern: /^\/api\/config\/video-provider$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<VideoProviderConfig | null>(req);
        svc.updateVideoProviderConfig(body);
        json(res, 200, { ok: true, videoProviderConfig: body });
      },
    },

    /* ---- Download final video ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/video$/,
      handler: (_req, res, match) => {
        const project = svc.loadProject(match.groups!.id);
        if (!project?.finalVideoPath || !existsSync(project.finalVideoPath)) {
          return json(res, 404, { error: 'Video not found' });
        }
        const stat = statSync(project.finalVideoPath);
        res.writeHead(200, {
          'Content-Type': 'video/mp4',
          'Content-Length': stat.size,
          'Content-Disposition': `attachment; filename="${basename(project.finalVideoPath)}"`,
        });
        createReadStream(project.finalVideoPath).pipe(res);
      },
    },

    /* ---- Resource plan ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/resource-plan$/,
      handler: (_req, res, match) => {
        const project = svc.loadProject(match.groups!.id);
        if (!project) return json(res, 404, { error: 'Project not found' });
        json(res, 200, svc.getResourcePlan(match.groups!.id, project.modelOverrides));
      },
    },

    /* ---- Provider capabilities ---- */
    {
      method: 'GET',
      pattern: /^\/api\/providers\/capabilities$/,
      handler: (_req, res) => json(res, 200, svc.getProviderCapabilities()),
    },
    {
      method: 'PUT',
      pattern: /^\/api\/providers\/(?<id>[^/]+)\/capabilities$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<Record<string, any>>(req);
        json(res, 200, svc.updateProviderCapability(match.groups!.id, body));
      },
    },

    /* ---- Presets ---- */
    {
      method: 'GET',
      pattern: /^\/api\/presets$/,
      handler: (_req, res) => json(res, 200, listPresets()),
    },
    {
      method: 'GET',
      pattern: /^\/api\/presets\/(?<id>[^/]+)$/,
      handler: (_req, res, match) => {
        const preset = getPreset(decodeURIComponent(match.groups!.id));
        if (!preset) return json(res, 404, { error: 'Preset not found' });
        json(res, 200, preset);
      },
    },

    /* ---- Sessions ---- */
    {
      method: 'GET',
      pattern: /^\/api\/sessions$/,
      handler: (_req, res) => json(res, 200, svc.getSessions()),
    },

    /* ---- Export ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/export$/,
      handler: (_req, res, match) => {
        const bundle = svc.exportProject(match.groups!.id);
        if (!bundle) return json(res, 404, { error: 'Project not found' });
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${match.groups!.id}.json"`,
        });
        res.end(JSON.stringify(bundle, null, 2));
      },
    },

    /* ---- Import ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/import$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<Record<string, any>>(req);
        if (!body.project?.id || !body.project?.topic) {
          return json(res, 400, { error: 'Invalid export bundle: missing project data' });
        }
        json(res, 201, svc.importProject(body));
      },
    },

    /* ---- Data directory ---- */
    {
      method: 'GET',
      pattern: /^\/api\/data-dir$/,
      handler: (_req, res) => json(res, 200, { dataDir: svc.getDataDir() }),
    },
  ];
}
