import { existsSync, createReadStream, statSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { basename, join } from 'node:path';
import { PipelineOrchestrator, type PipelineConfig } from '../pipeline/orchestrator.js';
import type { PipelineEvent, QualityTier, PipelineStage, ModelOverrides } from '../pipeline/types.js';
import type { ChatAdapter } from '../adapters/chatAdapter.js';
import { GeminiAdapter } from '../adapters/geminiAdapter.js';
import { json, parseJsonBody, type Route } from './helpers.js';
import type { ConfigStore, TTSSettings } from '../configStore.js';
import type { VideoProviderConfig } from '../adapters/videoProvider.js';
import { isEdgeTTSAvailable, listVoices } from '../adapters/ttsProvider.js';
import { isFFmpegAvailable } from '../adapters/ffmpegAssembler.js';
import { execSync } from 'node:child_process';
import { listPresets, getPreset } from '../providerPresets.js';

/* ---- Helper: check if Playwright is installed ---- */

function isPlaywrightInstalled(): boolean {
  try {
    execSync('npx playwright --version', { stdio: 'ignore', timeout: 10_000 });
    return true;
  } catch {
    return false;
  }
}

/* ---- Shared mutable context for pipeline & config routes ---- */

export interface PipelineContext {
  orchestrator: PipelineOrchestrator;
  chatAdapter: ChatAdapter;
  apiAdapter: GeminiAdapter | undefined;
  geminiApiKey: string;
  dataDir: string;
  defaultQualityTier: QualityTier;
  configStore: ConfigStore;
  broadcastEvent: (event: unknown) => void;
}

function rebuildOrchestrator(ctx: PipelineContext, tier: QualityTier): void {
  const saved = ctx.configStore.get();
  ctx.orchestrator = new PipelineOrchestrator(ctx.chatAdapter, {
    dataDir: ctx.dataDir,
    qualityTier: tier,
    apiAdapter: ctx.apiAdapter,
    videoProviderConfig: saved.videoProviderConfig,
    productionConcurrency: saved.productionConcurrency,
    ttsConfig: saved.ttsConfig,
  });
  ctx.orchestrator.onEvent((event: PipelineEvent) => {
    ctx.broadcastEvent(event);
  });
}

/* ---- Route definitions ---- */

export function pipelineRoutes(ctx: PipelineContext): Route[] {
  return [
    /* ---- List projects ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline$/,
      handler: (_req, res) => json(res, 200, ctx.orchestrator.listProjects()),
    },

    /* ---- Create project ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{
          topic: string;
          title?: string;
          qualityTier?: QualityTier;
          modelOverrides?: ModelOverrides;
        }>(req);
        if (!body.topic?.trim()) return json(res, 400, { error: 'topic is required' });

        const tier = body.qualityTier ?? ctx.defaultQualityTier;
        if (tier !== ctx.orchestrator.getQualityTier()) {
          rebuildOrchestrator(ctx, tier);
        }
        const project = ctx.orchestrator.createProject(body.topic.trim(), body.title?.trim(), body.modelOverrides);
        json(res, 201, project);
      },
    },

    /* ---- Get project ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)$/,
      handler: (_req, res, match) => {
        const project = ctx.orchestrator.loadProject(match.groups!.id);
        if (!project) return json(res, 404, { error: 'Project not found' });
        json(res, 200, project);
      },
    },

    /* ---- Delete project ---- */
    {
      method: 'DELETE',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)$/,
      handler: (_req, res, match) => {
        const deleted = ctx.orchestrator.deleteProject(match.groups!.id);
        if (!deleted) return json(res, 404, { error: 'Project not found' });
        json(res, 200, { ok: true });
      },
    },

    /* ---- Start / run pipeline ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/start$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ videoFilePath?: string }>(req).catch(() => ({} as { videoFilePath?: string }));
        ctx.orchestrator.run(match.groups!.id, body.videoFilePath).catch((err) => {
          console.error('[pipeline] run error:', err);
        });
        json(res, 200, { ok: true, projectId: match.groups!.id });
      },
    },

    /* ---- Stop pipeline ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/stop$/,
      handler: (_req, res) => {
        ctx.orchestrator.abort();
        json(res, 200, { ok: true });
      },
    },

    /* ---- Retry stage ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/retry\/(?<stage>[A-Z_]+)$/,
      handler: (_req, res, match) => {
        const { id, stage } = match.groups!;
        ctx.orchestrator.retryStage(id, stage as PipelineStage).catch((err) => {
          console.error('[pipeline] retry error:', err);
        });
        json(res, 200, { ok: true, projectId: id, stage });
      },
    },

    /* ---- Regenerate scene ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/scenes\/(?<sceneId>[^/]+)\/regenerate$/,
      handler: async (_req, res, match) => {
        try {
          const scene = await ctx.orchestrator.regenerateSceneAssets(match.groups!.id, match.groups!.sceneId);
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
        ctx.orchestrator.resumePipeline(match.groups!.id).catch((err) => {
          console.error('[pipeline] resume error:', err);
        });
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
          const project = ctx.orchestrator.updateScript(match.groups!.id, body.scriptText);
          json(res, 200, project);
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
          const project = ctx.orchestrator.updateScenes(match.groups!.id, body.scenes);
          json(res, 200, project);
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
          const project = ctx.orchestrator.approveScene(match.groups!.id, match.groups!.sceneId);
          json(res, 200, project);
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
          const project = ctx.orchestrator.rejectScene(match.groups!.id, match.groups!.sceneId);
          json(res, 200, project);
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },

    /* ---- QA override (approve manually) ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/qa-override$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{ feedback?: string }>(req).catch(() => ({} as { feedback?: string }));
        try {
          const project = ctx.orchestrator.approveQaReview(match.groups!.id, body);
          json(res, 200, project);
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
          const project = ctx.orchestrator.approveReferenceImages(match.groups!.id);
          json(res, 200, project);
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },

    /* ---- Set style profile (manual analysis) ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/style-profile$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<{
          pastedText?: string;
          styleProfile?: any;
          topic?: string;
        }>(req);
        try {
          let styleProfile;
          if (body.styleProfile) {
            styleProfile = body.styleProfile;
          } else if (body.pastedText) {
            const { runStyleExtractionManual } = await import('../pipeline/stages/styleExtraction.js');
            const result = runStyleExtractionManual(body.pastedText, body.topic ?? '');
            styleProfile = result.styleProfile;
          } else {
            return json(res, 400, { error: 'pastedText or styleProfile is required' });
          }
          const project = ctx.orchestrator.setStyleProfile(match.groups!.id, styleProfile);
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
          const project = ctx.orchestrator.updateModelOverrides(match.groups!.id, body.modelOverrides ?? {});
          json(res, 200, project);
        } catch (err) {
          json(res, 400, { error: err instanceof Error ? err.message : String(err) });
        }
      },
    },

    /* ---- Config: dynamic API key / quality tier ---- */
    {
      method: 'POST',
      pattern: /^\/api\/config$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<{
          geminiApiKey?: string;
          qualityTier?: QualityTier;
          productionConcurrency?: number;
        }>(req);
        if (body.geminiApiKey) {
          ctx.geminiApiKey = body.geminiApiKey;
          ctx.apiAdapter = new GeminiAdapter(ctx.geminiApiKey);
        }
        const tier = body.qualityTier ?? (ctx.apiAdapter ? 'balanced' : 'free');
        ctx.configStore.update({
          geminiApiKey: ctx.geminiApiKey || undefined,
          qualityTier: tier,
          ...(body.productionConcurrency !== undefined ? { productionConcurrency: body.productionConcurrency } : {}),
        });
        rebuildOrchestrator(ctx, tier);
        json(res, 200, {
          ok: true,
          qualityTier: tier,
          hasApiKey: !!ctx.geminiApiKey,
        });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/config$/,
      handler: (_req, res) => {
        const saved = ctx.configStore.get();
        json(res, 200, {
          qualityTier: ctx.orchestrator.getQualityTier(),
          hasApiKey: !!ctx.geminiApiKey,
          productionConcurrency: saved.productionConcurrency ?? 2,
        });
      },
    },

    /* ---- Config: environment diagnostics ---- */
    {
      method: 'GET',
      pattern: /^\/api\/config\/environment$/,
      handler: async (_req, res) => {
        const [ffmpeg, edgeTts, playwright] = await Promise.all([
          isFFmpegAvailable(),
          isEdgeTTSAvailable(),
          isPlaywrightInstalled(),
        ]);
        json(res, 200, {
          ffmpegAvailable: ffmpeg,
          edgeTtsAvailable: edgeTts,
          playwrightAvailable: playwright,
          nodeVersion: process.version,
          platform: process.platform,
          dataDir: ctx.dataDir,
        });
      },
    },

    /* ---- Config: TTS settings ---- */
    {
      method: 'GET',
      pattern: /^\/api\/config\/tts$/,
      handler: (_req, res) => {
        const saved = ctx.configStore.get();
        json(res, 200, saved.ttsConfig ?? {});
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/config\/tts$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<TTSSettings>(req);
        ctx.configStore.update({ ttsConfig: body });
        json(res, 200, { ok: true, ttsConfig: body });
      },
    },
    {
      method: 'GET',
      pattern: /^\/api\/config\/tts\/voices$/,
      handler: async (req, res) => {
        const url = new URL(req.url ?? '/', 'http://localhost');
        const locale = url.searchParams.get('locale') ?? undefined;
        const voices = await listVoices(locale);
        json(res, 200, { voices });
      },
    },

    /* ---- Config: Video provider ---- */
    {
      method: 'GET',
      pattern: /^\/api\/config\/video-provider$/,
      handler: (_req, res) => {
        const saved = ctx.configStore.get();
        json(res, 200, saved.videoProviderConfig ?? null);
      },
    },
    {
      method: 'POST',
      pattern: /^\/api\/config\/video-provider$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<VideoProviderConfig | null>(req);
        ctx.configStore.update({ videoProviderConfig: body ?? undefined });
        rebuildOrchestrator(ctx, ctx.orchestrator.getQualityTier());
        json(res, 200, { ok: true, videoProviderConfig: body });
      },
    },

    /* ---- Download final video ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/video$/,
      handler: (_req, res, match) => {
        const project = ctx.orchestrator.loadProject(match.groups!.id);
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

    /* ---- Resource plan for a project ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/resource-plan$/,
      handler: (_req, res, match) => {
        const project = ctx.orchestrator.loadProject(match.groups!.id);
        if (!project) return json(res, 404, { error: 'Project not found' });
        const plan = ctx.orchestrator.getResourcePlan(match.groups!.id, project.modelOverrides);
        json(res, 200, plan);
      },
    },

    /* ---- Provider capabilities ---- */
    {
      method: 'GET',
      pattern: /^\/api\/providers\/capabilities$/,
      handler: (_req, res) => {
        json(res, 200, ctx.orchestrator.providerRegistry.toJSON());
      },
    },

    /* ---- Update provider capability ---- */
    {
      method: 'PUT',
      pattern: /^\/api\/providers\/(?<id>[^/]+)\/capabilities$/,
      handler: async (req, res, match) => {
        const body = await parseJsonBody<Record<string, any>>(req);
        ctx.orchestrator.providerRegistry.register(match.groups!.id, body);
        json(res, 200, ctx.orchestrator.providerRegistry.get(match.groups!.id));
      },
    },

    /* ---- Provider presets ---- */
    {
      method: 'GET',
      pattern: /^\/api\/presets$/,
      handler: (_req, res) => {
        json(res, 200, listPresets());
      },
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

    /* ---- Session info ---- */
    {
      method: 'GET',
      pattern: /^\/api\/sessions$/,
      handler: (_req, res) => {
        json(res, 200, ctx.orchestrator.sessionManager.getAllSessions());
      },
    },

    /* ---- Export project (JSON bundle) ---- */
    {
      method: 'GET',
      pattern: /^\/api\/pipeline\/(?<id>[^/]+)\/export$/,
      handler: (_req, res, match) => {
        const { id } = match.groups!;
        const project = ctx.orchestrator.loadProject(id);
        if (!project) return json(res, 404, { error: 'Project not found' });

        const projectDir = ctx.orchestrator.getProjectDir(id);
        const bundle: Record<string, any> = { project };

        // Include all JSON artifacts
        const artifactNames = ['capability-assessment.json', 'style-profile.json', 'research.json',
          'calibration.json', 'narrative-map.json', 'script.json', 'qa-review.json',
          'scenes.json', 'refinement.json'];
        for (const name of artifactNames) {
          const filePath = join(projectDir, name);
          if (existsSync(filePath)) {
            try { bundle[name] = JSON.parse(readFileSync(filePath, 'utf-8')); } catch { /* skip */ }
          }
        }

        bundle._exportedAt = new Date().toISOString();
        bundle._version = '1.0';
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Content-Disposition': `attachment; filename="${id}.json"`,
        });
        res.end(JSON.stringify(bundle, null, 2));
      },
    },

    /* ---- Import project (JSON bundle) ---- */
    {
      method: 'POST',
      pattern: /^\/api\/pipeline\/import$/,
      handler: async (req, res) => {
        const body = await parseJsonBody<Record<string, any>>(req);
        if (!body.project?.id || !body.project?.topic) {
          return json(res, 400, { error: 'Invalid export bundle: missing project data' });
        }

        const projectId = `proj_${Date.now()}`;
        const imported = { ...body.project, id: projectId, createdAt: body.project.createdAt, updatedAt: new Date().toISOString() };

        const projectDir = ctx.orchestrator.getProjectDir(projectId);
        if (!existsSync(projectDir)) mkdirSync(projectDir, { recursive: true });

        writeFileSync(join(projectDir, 'project.json'), JSON.stringify(imported, null, 2));

        // Restore artifacts
        const artifactNames = ['capability-assessment.json', 'style-profile.json', 'research.json',
          'calibration.json', 'narrative-map.json', 'script.json', 'qa-review.json',
          'scenes.json', 'refinement.json'];
        for (const name of artifactNames) {
          if (body[name]) {
            writeFileSync(join(projectDir, name), JSON.stringify(body[name], null, 2));
          }
        }

        json(res, 201, imported);
      },
    },

    /* ---- Data directory info ---- */
    {
      method: 'GET',
      pattern: /^\/api\/data-dir$/,
      handler: (_req, res) => {
        json(res, 200, { dataDir: ctx.dataDir });
      },
    },
  ];
}
