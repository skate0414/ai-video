import { existsSync, createReadStream, statSync, readFileSync, writeFileSync, mkdirSync, readdirSync, unlinkSync } from 'node:fs';
import { basename, extname, resolve, normalize, join } from 'node:path';
import { ARTIFACT, EDITABLE_ARTIFACTS } from '../constants.js';
import type { PipelineStage, ModelOverrides } from '../pipeline/types.js';
import type { StageProviderOverrides } from '../../shared/types.js';
import { json, parseJsonBody, parseMultipartFile, sanitizeError, type Route } from './helpers.js';
import type { TTSSettings } from '../configStore.js';
import type { VideoProviderConfig } from '../adapters/videoProvider.js';
import { isEdgeTTSAvailable, listVoices } from '../adapters/ttsProvider.js';
import { isFFmpegAvailable } from '../adapters/ffmpegAssembler.js';
import { execSync } from 'node:child_process';
import { listPresets, getPreset } from '../providerPresets.js';
import { PipelineService } from '../pipeline/pipelineService.js';
import { resolveChromiumChannel } from '../browserManager.js';
import { buildTimeline, findFailureSpan, buildProviderDecisionPath, buildStageDiff, buildAiCallDiff, buildSpanTree } from '../pipeline/trace/analyzer.js';

/* ---- Helper: check if Playwright is installed ---- */

function isPlaywrightInstalled(): boolean {
  try {
    execSync('npx playwright --version', { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

function isChromiumInstalled(): boolean {
  const channel = resolveChromiumChannel();
  if (channel === undefined) return true;
  const commands = process.platform === 'win32'
    ? ['where chrome']
    : ['which google-chrome', 'which google-chrome-stable', 'which chromium-browser', 'which chromium'];
  for (const cmd of commands) {
    try { execSync(cmd, { stdio: 'ignore', timeout: 5000 }); return true; } catch { /* not found */ }
  }
  return false;
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
        const body = await parseJsonBody<{ topic: string; title?: string; modelOverrides?: ModelOverrides }>(req);
        if (!body.topic?.trim()) return json(res, 400, { error: 'topic is required' });
        const project = svc.createProject(body.topic.trim(), body.title?.trim(), body.modelOverrides);
        json(res, 201, project);
      },
    },

    /* ---- Batch create projects ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/batch$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{
          topics: string[];
          titlePrefix?: string;
          modelOverrides?: ModelOverrides;
        }>(req);
        const topics = (body.topics ?? [])
          .map((t) => t?.trim())
          .filter((t): t is string => !!t);
        if (topics.length === 0) {
          return json(res, 400, { error: 'topics array is required' });
        }

        const projects = topics.map((topic, idx) => {
          const title = body.titlePrefix?.trim()
            ? `${body.titlePrefix.trim()} #${idx + 1}`
            : undefined;
          return svc.createProject(topic, title, body.modelOverrides);
        });

        json(res, 201, { ok: true, count: projects.length, projects });
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
      pattern: /^\/api\/pipeline\/(?<id>(?!batch\/)[^/]+)\/start$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ videoFilePath?: string }>(req).catch(() => ({} as { videoFilePath?: string }));
        const result = svc.startPipeline(match.groups!.id, body.videoFilePath);
        if ('error' in result) return json(res, result.status, { error: result.error });
        json(res, 200, { ok: true, projectId: match.groups!.id });
      },
    },

    /* ---- Batch start pipelines (bounded concurrency via queue) ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/batch\/start$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{ projectIds: string[] }>(req);
        const projectIds = (body.projectIds ?? [])
          .map((id) => id?.trim())
          .filter((id): id is string => !!id);
        if (projectIds.length === 0) {
          return json(res, 400, { error: 'projectIds array is required' });
        }

        const started: string[] = [];
        const queued: string[] = [];
        const failed: Array<{ projectId: string; error: string; status: number }> = [];

        for (const projectId of projectIds) {
          const result = svc.enqueueProject(projectId);
          if ('error' in result) {
            failed.push({ projectId, error: result.error, status: result.status });
          } else if (result.position === 'started') {
            started.push(projectId);
          } else {
            queued.push(projectId);
          }
        }

        const hasFailure = failed.length > 0;
        json(res, hasFailure ? 207 : 200, {
          ok: !hasFailure,
          started,
          queued,
          failed,
        });
      },
    },

    /* ---- Queue / running status ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/running$/,
      handler: (_req, res) => json(res, 200, svc.getQueueSnapshot()),
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
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ directive?: string }>(req).catch(() => ({} as { directive?: string }));
        const result = svc.retryStage(match.groups!.id, match.groups!.stage as PipelineStage, body.directive);
        if ('error' in result) return json(res, result.status, { error: result.error });
        json(res, 200, { ok: true, projectId: match.groups!.id, stage: match.groups!.stage });
      },
    },

    /* ---- ETA estimate ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/eta$/,
      handler: (_req, res, match) => {
        const eta = svc.getEta(match.groups!.id);
        json(res, 200, eta ?? { etaMs: null });
      },
    },

    /* ---- Regenerate scene (with optional feedback) ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/scenes\/(?<sceneId>[^/]+)\/regenerate$/,
      handler: async (req, res, match) => {
        try {
          const body = await parseJsonBody<{ feedback?: string }>(req).catch(() => ({} as { feedback?: string }));
          const scene = await svc.regenerateScene(match.groups!.id, match.groups!.sceneId, body.feedback);
          json(res, 200, scene);
        } catch (err) {
          const msg = sanitizeError(err);
          const status = msg.includes('already being regenerated') ? 409 : 400;
          json(res, status, { error: msg });
        }
      },
    },

    /* ---- Resume pipeline ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/resume$/,
      handler: (_req, res, match) => {
        const result = svc.resumePipeline(match.groups!.id);
        if ('error' in result) return json(res, result.status, { error: result.error });
        json(res, 200, { ok: true, projectId: match.groups!.id });
      },
    },

    /* ---- Pause pipeline ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/pause$/,
      handler: (_req, res, match) => {
        const result = svc.requestPause(match.groups!.id);
        if ('error' in result) return json(res, result.status, { error: result.error });
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
          json(res, 400, { error: sanitizeError(err) });
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
          json(res, 400, { error: sanitizeError(err) });
        }
      },
    },

      /* ---- Update scene quality ---- */
      {
        method: 'PUT',
        pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/scenes\/(?<sceneId>[^/]+)\/quality$/,
        handler: async (req, res, match) => {
          try {
            const body = await parseJsonBody<any>(req);
            if (!body || typeof body !== 'object') return json(res, 400, { error: 'quality body required' });
            json(res, 200, svc.updateSceneQuality(match.groups!.id, match.groups!.sceneId, body));
          } catch (err) {
            json(res, 400, { error: sanitizeError(err) });
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
          json(res, 400, { error: sanitizeError(err) });
        }
      },
    },

    /* ---- Reject scene ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/scenes\/(?<sceneId>[^/]+)\/reject$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ reason?: string }>(req).catch(() => ({} as { reason?: string }));
        try {
          json(res, 200, svc.rejectScene(match.groups!.id, match.groups!.sceneId, body.reason));
        } catch (err) {
          json(res, 400, { error: sanitizeError(err) });
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
          json(res, 400, { error: sanitizeError(err) });
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
          json(res, 400, { error: sanitizeError(err) });
        }
      },
    },

    /* ---- Set style profile ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/style-profile$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ pastedText?: string; styleProfile?: any; topic?: string; formatSignature?: any }>(req);
        try {
          const project = await svc.setStyleProfile(match.groups!.id, body.pastedText, body.styleProfile, body.topic, body.formatSignature);
          json(res, 200, project);
        } catch (err) {
          json(res, 400, { error: sanitizeError(err) });
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
          json(res, 400, { error: sanitizeError(err) });
        }
      },
    },

    /* ---- Stage provider overrides ---- */
    {
      method: 'PUT',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/stage-overrides$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ stageProviderOverrides: StageProviderOverrides }>(req);
        try {
          json(res, 200, svc.updateStageProviderOverrides(match.groups!.id, body.stageProviderOverrides ?? {}));
        } catch (err) {
          json(res, 400, { error: sanitizeError(err) });
        }
      },
    },

    /* ---- Storyboard replication settings ---- */
    {
      method: 'PUT',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/storyboard-replication$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ enabled?: boolean; strength?: 'low' | 'medium' | 'high'; sourceProjectId?: string; notes?: string }>(req);
        try {
          json(res, 200, svc.updateStoryboardReplication(match.groups!.id, body ?? {}));
        } catch (err) {
          const msg = sanitizeError(err);
          const status = msg.toLowerCase().includes('not found') ? 404 : 400;
          json(res, status, { error: msg });
        }
      },
    },

    /* ---- Stage providers (available AI providers per stage) ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/stage-providers$/,
      handler: (_req, res) => json(res, 200, svc.getStageProviders()),
    },

    /* ---- Prompt overrides CRUD ---- */
    {
      method: 'GET',
      pattern: /^\/api\/prompts\/defaults$/,
      handler: (_req, res) => {
        const { getPromptNames, getPromptDefault } = require('../pipeline/promptResolver.js') as typeof import('../pipeline/promptResolver.js');
        const names = getPromptNames();
        const defaults: Record<string, string> = {};
        for (const n of names) defaults[n] = getPromptDefault(n) ?? '';
        json(res, 200, defaults);
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/prompts$/,
      handler: (_req, res, match) => {
        const project = svc.loadProject(match.groups!.id);
        if (!project) return json(res, 404, { error: 'Project not found' });
        const { getAllPrompts } = require('../pipeline/promptResolver.js') as typeof import('../pipeline/promptResolver.js');
        json(res, 200, getAllPrompts(project));
      },
    },
    {
      method: 'PUT',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/prompts\/(?<promptName>[^/]+)$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ text: string }>(req);
        if (typeof body.text !== 'string') return json(res, 400, { error: 'text is required' });
        try {
          json(res, 200, svc.setPromptOverride(match.groups!.id, decodeURIComponent(match.groups!.promptName), body.text));
        } catch (err) {
          json(res, 400, { error: sanitizeError(err) });
        }
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/prompts\/(?<promptName>[^/]+)$/,
      handler: (_req, res, match) => {
        try {
          json(res, 200, svc.deletePromptOverride(match.groups!.id, decodeURIComponent(match.groups!.promptName)));
        } catch (err) {
          json(res, 400, { error: sanitizeError(err) });
        }
      },
    },

    /* ---- Iteration records ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/iterations$/,
      handler: (_req, res, match) => {
        try {
          json(res, 200, svc.getIterations(match.groups!.id));
        } catch (err) {
          json(res, 400, { error: sanitizeError(err) });
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
        const body = await parseJsonBody<{ aivideomakerApiKey?: string; productionConcurrency?: number }>(req);
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
        json(res, 200, { ffmpegAvailable: ffmpeg, edgeTtsAvailable: edgeTts, playwrightAvailable: playwright, chromiumAvailable: isChromiumInstalled(), nodeVersion: process.version, platform: process.platform, dataDir: svc.getDataDir() });
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

    /* ---- Queue detection presets ---- */
    {
      method: 'GET',
      pattern: /^\/api\/config\/queue-detection$/,
      handler: (_req, res) => json(res, 200, svc.getQueueDetectionPresets()),
    },
    {
      method: 'POST',
      pattern: /^\/api\/config\/queue-detection$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<Record<string, any>>(req);
        if (!body || typeof body !== 'object') return json(res, 400, { error: 'Invalid body' });
        svc.updateQueueDetectionPresets(body);
        json(res, 200, { ok: true, queueDetection: svc.getQueueDetectionPresets() });
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/config\/queue-detection\/(?<id>[^/]+)$/,
      handler: (_req, res, match) => {
        const id = decodeURIComponent(match.groups!.id);
        const deleted = svc.deleteQueueDetectionPreset(id);
        if (!deleted) return json(res, 404, { error: 'Override not found' });
        json(res, 200, { ok: true });
      },
    },

    /* ---- Stream / Download final video ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/video$/,
      handler: (req, res, match) => {
        const project = svc.loadProject(match.groups!.id);
        if (!project?.finalVideoPath || !existsSync(project.finalVideoPath)) {
          return json(res, 404, { error: 'Video not found' });
        }
        const stat = statSync(project.finalVideoPath);
        const total = stat.size;
        const url = new URL(req.url ?? '', 'http://localhost');
        const wantDownload = url.searchParams.has('dl');
        const range = req.headers.range;

        if (range) {
          const parts = range.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : total - 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${total}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': 'video/mp4',
          });
          createReadStream(project.finalVideoPath, { start, end }).pipe(res);
        } else {
          const headers: Record<string, string | number> = {
            'Content-Type': 'video/mp4',
            'Content-Length': total,
            'Accept-Ranges': 'bytes',
          };
          if (wantDownload) {
            headers['Content-Disposition'] = `attachment; filename="${basename(project.finalVideoPath)}"`;
          }
          res.writeHead(200, headers);
          createReadStream(project.finalVideoPath).pipe(res);
        }
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

    /* ---- Provider summary (for SetupPage dashboard) ---- */
    {
      method: 'GET',
      pattern: /^\/api\/providers\/summary$/,
      handler: (_req, res) => json(res, 200, svc.getProviderSummary()),
    },

    /* ---- Route table (current routing decisions per stage) ---- */
    {
      method: 'GET',
      pattern: /^\/api\/config\/route-table$/,
      handler: (_req, res) => json(res, 200, svc.getRouteTable()),
    },

    /* ---- Style templates ---- */
    {
      method: 'GET',
      pattern: /^\/api\/style-templates$/,
      handler: (_req, res) => json(res, 200, svc.styleLibrary.list()),
    },
    {
      method: 'POST',
      pattern: /^\/api\/style-templates$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{ name: string; topic: string; styleProfile: Record<string, unknown>; formatSignature?: any }>(req);
        if (!body.name?.trim() || !body.styleProfile) return json(res, 400, { error: 'name and styleProfile required' });
        json(res, 201, svc.styleLibrary.save(body.name.trim(), body.topic ?? '', body.styleProfile, body.formatSignature));
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/style-templates\/(?<id>[^/]+)$/,
      handler: (_req, res, match) => {
        const tpl = svc.styleLibrary.load(match.groups!.id);
        if (!tpl) return json(res, 404, { error: 'Template not found' });
        json(res, 200, tpl);
      },
    },
    {
      method: 'DELETE',
      pattern: /^\/api\/style-templates\/(?<id>[^/]+)$/,
      handler: (_req, res, match) => {
        const deleted = svc.styleLibrary.delete(match.groups!.id);
        if (!deleted) return json(res, 404, { error: 'Template not found' });
        json(res, 200, { ok: true });
      },
    },
    /* ---- Cost tracking ---- */
    {
      method: 'GET',
      pattern: /^\/api\/costs$/,
      handler: (_req, res) => json(res, 200, svc.getGlobalCostSummary()),
    },
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/costs$/,
      handler: (_req, res, match) => {
        json(res, 200, svc.getProjectCostSummary(match.groups!.id));
      },
    },

    /* ---- Video provider health ---- */
    {
      method: 'GET',
      pattern: /^\/api\/providers\/video-health$/,
      handler: (_req, res) => json(res, 200, svc.getVideoProviderHealth()),
    },
    {
      method: 'GET',
      pattern: /^\/api\/providers\/video-health\/(?<id>[^/]+)\/recommendation$/,
      handler: (_req, res, match) => {
        json(res, 200, svc.getVideoProviderRecommendation(decodeURIComponent(match.groups!.id)));
      },
    },

    /* ---- Serve pipeline artifact files (JSON) ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/artifacts\/(?<filename>[^/]+)$/,
      handler: (_req, res, match) => {
        const projectDir = svc.getProjectDir(match.groups!.id);
        const filename = match.groups!.filename;
        // Whitelist artifact filenames
        const allowed: readonly string[] = Object.values(ARTIFACT);
        if (!allowed.includes(filename)) return json(res, 400, { error: 'Invalid artifact name' });
        const filePath = join(projectDir, filename);
        if (!existsSync(filePath)) return json(res, 404, { error: 'Artifact not found' });
        try {
          const data = JSON.parse(readFileSync(filePath, 'utf-8'));
          json(res, 200, data);
        } catch {
          json(res, 500, { error: 'Failed to read artifact' });
        }
      },
    },

    /* ---- Update pipeline artifact files (JSON) ---- */
    {
      method: 'PUT',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/artifacts\/(?<filename>[^/]+)$/,
      handler: async (req, res, match) => {
        const projectDir = svc.getProjectDir(match.groups!.id);
        const filename = match.groups!.filename;
        if (!EDITABLE_ARTIFACTS.includes(filename)) return json(res, 400, { error: 'Artifact is not editable' });
        if (!existsSync(projectDir)) return json(res, 404, { error: 'Project not found' });
        try {
          const body = await parseJsonBody<Record<string, unknown>>(req);
          const filePath = join(projectDir, filename);
          writeFileSync(filePath, JSON.stringify(body, null, 2), 'utf-8');

          // Invalidate the ??= cached field so next stage re-reads from disk
          svc.invalidateArtifactCache(match.groups!.id, [filename]);

          json(res, 200, { ok: true });
        } catch {
          json(res, 500, { error: 'Failed to write artifact' });
        }
      },
    },

    /* ---- Serve project-level asset files ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/assets\/(?<filename>[^/]+)$/,
      handler: (_req, res, match) => {
        const projectDir = svc.getProjectDir(match.groups!.id);
        const filename = match.groups!.filename;
        const assetsDir = resolve(projectDir, 'assets');
        const filePath = resolve(assetsDir, filename);
        if (!normalize(filePath).startsWith(normalize(assetsDir))) {
          return json(res, 403, { error: 'Forbidden' });
        }
        if (!existsSync(filePath)) {
          return json(res, 404, { error: 'File not found' });
        }
        const ext = extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
          '.bmp': 'image/bmp',
        };
        const contentType = mimeTypes[ext] ?? 'application/octet-stream';
        const stat = statSync(filePath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=3600',
        });
        createReadStream(filePath).pipe(res);
      },
    },

    /* ---- Serve asset files (images, etc.) ---- */
    {
      method: 'GET',
      pattern: /^\/api\/assets\/(.+)$/,
      handler: (_req, res, match) => {
        const relPath = decodeURIComponent(match[1]);
        // Security: prevent path traversal
        const assetsDir = resolve(svc.getDataDir(), 'assets');
        const filePath = resolve(assetsDir, relPath);
        if (!normalize(filePath).startsWith(normalize(assetsDir))) {
          return json(res, 403, { error: 'Forbidden' });
        }
        if (!existsSync(filePath)) {
          return json(res, 404, { error: 'File not found' });
        }
        const ext = extname(filePath).toLowerCase();
        const mimeTypes: Record<string, string> = {
          '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
          '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml',
          '.bmp': 'image/bmp',
        };
        const contentType = mimeTypes[ext] ?? 'application/octet-stream';
        const stat = statSync(filePath);
        res.writeHead(200, {
          'Content-Type': contentType,
          'Content-Length': stat.size,
          'Cache-Control': 'public, max-age=3600',
        });
        createReadStream(filePath).pipe(res);
      },
    },

    /* ---- List traces for a project ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/traces$/,
      handler: (_req, res, match) => {
        const traces = svc.listTraces(match.groups!.id);
        json(res, 200, traces);
      },
    },

    /* ---- Get latest trace bundle (with analysis) ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/trace$/,
      handler: (_req, res, match) => {
        const bundle = svc.getLatestTrace(match.groups!.id);
        if (!bundle) return json(res, 404, { error: 'No trace data found' });
        const timeline = buildTimeline(bundle);
        const failureSpan = findFailureSpan(bundle);
        const providerPath = buildProviderDecisionPath(bundle);
        const stageDiff = buildStageDiff(bundle);
        const aiDiffs = buildAiCallDiff(svc.getAiLogs(match.groups!.id), {
          startedAt: bundle.startedAt,
          endedAt: bundle.endedAt,
        });
        const spanTree = buildSpanTree(bundle);
        json(res, 200, { bundle, analysis: { timeline, failureSpan, providerPath, stageDiff, aiDiffs, spanTree } });
      },
    },

    /* ---- Get specific trace bundle by traceId ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/traces\/(?<traceId>[^/]+)$/,
      handler: (_req, res, match) => {
        const bundle = svc.getTrace(match.groups!.id, match.groups!.traceId);
        if (!bundle) return json(res, 404, { error: 'Trace not found' });
        const timeline = buildTimeline(bundle);
        const failureSpan = findFailureSpan(bundle);
        const providerPath = buildProviderDecisionPath(bundle);
        const stageDiff = buildStageDiff(bundle);
        const aiDiffs = buildAiCallDiff(svc.getAiLogs(match.groups!.id), {
          startedAt: bundle.startedAt,
          endedAt: bundle.endedAt,
        });
        const spanTree = buildSpanTree(bundle);
        json(res, 200, { bundle, analysis: { timeline, failureSpan, providerPath, stageDiff, aiDiffs, spanTree } });
      },
    },

    /* ---- AI logs (input/output diff) ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/ai-logs$/,
      handler: (_req, res, match) => {
        const logs = svc.getAiLogs(match.groups!.id);
        json(res, 200, logs);
      },
    },

    /* ---- Persistent JSONL event log ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/event-log$/,
      handler: (_req, res, match) => {
        json(res, 200, svc.getEventLog(match.groups!.id));
      },
    },

    /* ---- BGM upload for refinement ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/upload-bgm$/,
      handler: async (req, res, match) => {
        const projectId = match.groups!.id;
        const project = svc.loadProject(projectId);
        if (!project) return json(res, 404, { error: 'Project not found' });

        const contentType = req.headers['content-type'] || '';
        const MAX_BGM_SIZE = 50 * 1024 * 1024; // 50 MB

        // Allowed audio extensions
        const ALLOWED_BGM_EXTENSIONS = new Set(['.mp3', '.wav', '.aac', '.m4a', '.ogg']);

        try {
          let filename: string;
          let fileData: Buffer;

          if (contentType.includes('multipart/form-data')) {
            // Multipart upload from browser FormData
            const file = await parseMultipartFile(req, MAX_BGM_SIZE + 1024 * 64);
            filename = file.filename;
            fileData = file.data;
          } else {
            // Legacy JSON base64 upload
            const body = await parseJsonBody<{ filename: string; data: string }>(req, MAX_BGM_SIZE * 1.5);
            if (!body.filename || !body.data) {
              return json(res, 400, { error: 'filename and data are required' });
            }
            filename = body.filename;
            fileData = Buffer.from(body.data, 'base64');
          }

          if (fileData.length > MAX_BGM_SIZE) {
            return json(res, 400, { error: 'File exceeds 50 MB limit' });
          }

          const safeName = basename(filename).replace(/[^a-zA-Z0-9._\-\u4e00-\u9fff]/g, '_');
          const ext = extname(safeName).toLowerCase();
          if (!ALLOWED_BGM_EXTENSIONS.has(ext)) {
            return json(res, 400, { error: `File type not allowed. Supported: ${[...ALLOWED_BGM_EXTENSIONS].join(', ')}` });
          }

          // Save BGM to project directory
          const projectDir = svc.getProjectDir(projectId);
          const bgmDir = join(projectDir, 'bgm');
          if (!existsSync(bgmDir)) mkdirSync(bgmDir, { recursive: true });

          // Remove any existing bgm.* files before writing new one
          if (existsSync(bgmDir)) {
            for (const f of readdirSync(bgmDir)) {
              if (f.startsWith('bgm.')) unlinkSync(join(bgmDir, f));
            }
          }

          // Use fixed filename 'bgm' with original extension
          const bgmPath = join(bgmDir, `bgm${ext}`);

          // Path containment: ensure final path stays within project directory
          const resolvedBgm = resolve(bgmPath);
          const resolvedProject = resolve(projectDir);
          if (!resolvedBgm.startsWith(resolvedProject + '/') && resolvedBgm !== resolvedProject) {
            return json(res, 400, { error: 'Invalid path' });
          }

          writeFileSync(bgmPath, fileData);

          json(res, 200, { ok: true, filename: `bgm${ext}`, size: fileData.length });
        } catch (err) {
          const msg = sanitizeError(err);
          json(res, 400, { error: msg });
        }
      },
    },

    /* ---- Remove BGM ---- */
    {
      method: 'DELETE',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/bgm$/,
      handler: (_req, res, match) => {
        const projectId = match.groups!.id;
        const project = svc.loadProject(projectId);
        if (!project) return json(res, 404, { error: 'Project not found' });

        const projectDir = svc.getProjectDir(projectId);
        const bgmDir = join(projectDir, 'bgm');

        try {
          if (existsSync(bgmDir)) {
            const files = readdirSync(bgmDir);
            for (const file of files) {
              if (file.startsWith('bgm.')) {
                const bgmPath = join(bgmDir, file);
                if (existsSync(bgmPath)) {
                  const { unlinkSync } = require('node:fs');
                  unlinkSync(bgmPath);
                }
              }
            }
          }
          json(res, 200, { ok: true });
        } catch (err) {
          json(res, 500, { error: sanitizeError(err) });
        }
      },
    },

    /* ---- Get current BGM info ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/bgm$/,
      handler: (_req, res, match) => {
        const projectId = match.groups!.id;
        const project = svc.loadProject(projectId);
        if (!project) return json(res, 404, { error: 'Project not found' });

        const projectDir = svc.getProjectDir(projectId);
        const bgmDir = join(projectDir, 'bgm');

        // Look for any bgm.* file
        if (existsSync(bgmDir)) {
          const files = readdirSync(bgmDir);
          const bgmFile = files.find(f => f.startsWith('bgm.'));
          if (bgmFile) {
            const bgmPath = join(bgmDir, bgmFile);
            const stat = statSync(bgmPath);
            return json(res, 200, { hasBgm: true, filename: bgmFile, size: stat.size, path: bgmPath });
          }
        }
        json(res, 200, { hasBgm: false });
      },
    },

    /* ---- Stream BGM audio (supports Range requests for seeking) ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/bgm\/stream$/,
      handler: (req, res, match) => {
        const projectId = match.groups!.id;
        const project = svc.loadProject(projectId);
        if (!project) return json(res, 404, { error: 'Project not found' });

        const projectDir = svc.getProjectDir(projectId);
        const bgmDir = join(projectDir, 'bgm');
        if (!existsSync(bgmDir)) return json(res, 404, { error: 'No BGM uploaded' });

        const files = readdirSync(bgmDir);
        const bgmFile = files.find(f => f.startsWith('bgm.'));
        if (!bgmFile) return json(res, 404, { error: 'No BGM uploaded' });

        const bgmPath = join(bgmDir, bgmFile);
        const stat = statSync(bgmPath);
        const fileSize = stat.size;

        const MIME_MAP: Record<string, string> = {
          '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac',
          '.m4a': 'audio/mp4', '.ogg': 'audio/ogg',
        };
        const ext = extname(bgmFile).toLowerCase();
        const contentType = MIME_MAP[ext] || 'application/octet-stream';

        const rangeHeader = req.headers.range;
        if (rangeHeader) {
          const parts = rangeHeader.replace(/bytes=/, '').split('-');
          const start = parseInt(parts[0], 10);
          const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
          if (start >= fileSize || end >= fileSize || start > end) {
            res.writeHead(416, { 'Content-Range': `bytes */${fileSize}` });
            return res.end();
          }
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${fileSize}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': end - start + 1,
            'Content-Type': contentType,
          });
          createReadStream(bgmPath, { start, end }).pipe(res);
        } else {
          res.writeHead(200, {
            'Content-Length': fileSize,
            'Content-Type': contentType,
            'Accept-Ranges': 'bytes',
          });
          createReadStream(bgmPath).pipe(res);
        }
      },
    },

    /* ---- Get refine options ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/refine-options$/,
      handler: (_req, res, match) => {
        const projectId = match.groups!.id;
        const project = svc.loadProject(projectId);
        if (!project) return json(res, 404, { error: 'Project not found' });
        json(res, 200, svc.getRefineOptions(projectId));
      },
    },

    /* ---- Get refine provenance (fields inferred from reference video) ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/refine-provenance$/,
      handler: (_req, res, match) => {
        const projectId = match.groups!.id;
        const project = svc.loadProject(projectId);
        if (!project) return json(res, 404, { error: 'Project not found' });
        json(res, 200, { fields: svc.getRefineProvenance(projectId) });
      },
    },

    /* ---- Get reference defaults (base + packaging-inferred, no user overrides) ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/refine-reference-defaults$/,
      handler: (_req, res, match) => {
        const projectId = match.groups!.id;
        const project = svc.loadProject(projectId);
        if (!project) return json(res, 404, { error: 'Project not found' });
        json(res, 200, svc.getRefineReferenceDefaults(projectId));
      },
    },

    /* ---- Update refine options ---- */
    {
      method: 'PUT',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/refine-options$/,
      handler: async (req, res, match) => {
        const projectId = match.groups!.id;
        const project = svc.loadProject(projectId);
        if (!project) return json(res, 404, { error: 'Project not found' });

        try {
          const body = await parseJsonBody<any>(req);
          json(res, 200, svc.updateRefineOptions(projectId, body));
        } catch (err) {
          json(res, 400, { error: sanitizeError(err) });
        }
      },
    },

    /* ---- Re-assemble video with refine options ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/re-assemble$/,
      handler: async (req, res, match) => {
        const projectId = match.groups!.id;
        const project = svc.loadProject(projectId);
        if (!project) return json(res, 404, { error: 'Project not found' });

        // Check if assembly stage completed
        if (project.stageStatus.ASSEMBLY !== 'completed') {
          return json(res, 400, { error: 'ASSEMBLY stage must be completed before re-assembly' });
        }

        try {
          // Start re-assembly (async, returns immediately)
          svc.startReAssembly(projectId);
          json(res, 200, { ok: true, message: '重新组装已开始' });
        } catch (err) {
          json(res, 500, { error: sanitizeError(err) });
        }
      },
    },
  ];
}
