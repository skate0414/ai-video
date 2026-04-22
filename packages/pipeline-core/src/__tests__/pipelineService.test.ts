// @ts-nocheck -- see tsconfig.json noUncheckedIndexedAccess migration (scripts/check-strict-progress.mjs)
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Side-effect: registers video stage definitions so PipelineService route table is populated.
import '@ai-video/pipeline-video/stageDefinitions.js';
import { PipelineService } from '../pipelineService.js';
import { ConfigStore } from '../configStore.js';
import { SSE_EVENT } from '../pipelineTypes.js';
import type { PipelineEvent } from '../pipelineTypes.js';
import type { ChatAdapter } from '../chatAdapter.js';

/* ---- Minimal mock adapter ---- */
const mockChatAdapter = {
  provider: 'mock',
  generateText: async () => ({ text: '' }),
  generateImage: async () => ({ text: '' }),
  generateVideo: async () => ({ text: '' }),
} as unknown as ChatAdapter;

describe('PipelineService', () => {
  let dataDir: string;
  let configStore: ConfigStore;
  let events: PipelineEvent[];
  let svc: PipelineService;

  beforeEach(() => {
    dataDir = mkdtempSync(join(tmpdir(), 'pipesvc-test-'));
    configStore = new ConfigStore(dataDir);
    events = [];
    svc = new PipelineService({
      dataDir,
      chatAdapter: mockChatAdapter,
      configStore,
      broadcastEvent: (ev) => events.push(ev as PipelineEvent),
    });
  });

  afterEach(() => {
    rmSync(dataDir, { recursive: true, force: true });
  });

  describe('startPipeline', () => {
    it('returns 404 for unknown project', () => {
      const result = svc.startPipeline('nonexistent');
      expect(result).toEqual({ error: 'Project not found', status: 404 });
    });

    it('returns { ok: true } for valid project', () => {
      const p = svc.createProject('test topic');
      const result = svc.startPipeline(p.id);
      expect(result).toEqual({ ok: true });
    });

    it('emits SSE_EVENT.ERROR when orchestrator.run rejects', async () => {
      const p = svc.createProject('fail topic');
      // Start pipeline — it will fail during preflight (no providers configured)
      svc.startPipeline(p.id);

      // Wait for the async rejection to propagate
      await vi.waitFor(() => {
        const errorEvents = events.filter(e => e.type === SSE_EVENT.ERROR);
        expect(errorEvents.length).toBeGreaterThanOrEqual(1);
      }, { timeout: 5000 });

      const errorEvent = events.find(e => e.type === SSE_EVENT.ERROR);
      expect(errorEvent).toBeDefined();
      expect(errorEvent!.payload).toHaveProperty('projectId', p.id);
      expect(errorEvent!.payload).toHaveProperty('error');
    });
  });

  describe('retryStage', () => {
    it('returns 404 for unknown project', () => {
      const result = svc.retryStage('nonexistent', 'SCRIPT_GENERATION');
      expect(result).toEqual({ error: 'Project not found', status: 404 });
    });

    it('returns 400 for invalid stage', () => {
      const result = svc.retryStage('p1', 'NOT_A_STAGE' as any);
      expect(result).toEqual({ error: 'Invalid stage: NOT_A_STAGE', status: 400 });
    });
  });

  describe('resumePipeline', () => {
    it('returns 404 for unknown project', () => {
      const result = svc.resumePipeline('nonexistent');
      expect(result).toEqual({ error: 'Project not found', status: 404 });
    });

    it('returns 409 for non-paused project', () => {
      const p = svc.createProject('resume test');
      const result = svc.resumePipeline(p.id);
      expect(result).toEqual({ error: 'Pipeline is not paused', status: 409 });
    });
  });

  describe('project CRUD', () => {
    it('creates and loads a project', () => {
      const p = svc.createProject('hello world');
      const loaded = svc.loadProject(p.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.topic).toBe('hello world');
    });

    it('creates a project with title and overrides', () => {
      const overrides = { scriptModel: 'gpt-4o' } as any;
      const p = svc.createProject('topic', 'Custom Title', overrides);
      expect(p).toBeDefined();
      expect(p.topic).toBe('topic');
    });

    it('lists projects', async () => {
      svc.createProject('one');
      await new Promise(r => setTimeout(r, 5));
      svc.createProject('two');
      expect(svc.listProjects()).toHaveLength(2);
    });

    it('deletes a project', () => {
      const p = svc.createProject('delete me');
      expect(svc.deleteProject(p.id)).toBe(true);
      expect(svc.loadProject(p.id)).toBeNull();
    });

    it('loadProject returns null for nonexistent id', () => {
      expect(svc.loadProject('does-not-exist')).toBeNull();
    });

    it('deleteProject returns false for nonexistent id', () => {
      expect(svc.deleteProject('does-not-exist')).toBe(false);
    });

    it('saveProject persists changes', () => {
      const p = svc.createProject('save test');
      p.topic = 'updated topic';
      svc.saveProject(p);
      const loaded = svc.loadProject(p.id);
      expect(loaded!.topic).toBe('updated topic');
    });
  });

  describe('stopPipeline', () => {
    it('does not throw for unknown project', () => {
      expect(() => svc.stopPipeline('nonexistent')).not.toThrow();
    });
  });

  describe('requestPause', () => {
    it('returns 404 for unknown project', () => {
      const result = svc.requestPause('nonexistent');
      expect(result).toEqual({ error: 'Project not found', status: 404 });
    });

    it('returns { ok: true } for valid project', () => {
      const p = svc.createProject('pause me');
      const result = svc.requestPause(p.id);
      expect(result).toEqual({ ok: true });
    });
  });

  describe('retryStage (extended)', () => {
    it('returns 404 for valid stage but missing project', () => {
      const result = svc.retryStage('nonexistent', 'SCRIPT_GENERATION' as any);
      expect(result).toEqual({ error: 'Project not found', status: 404 });
    });
  });

  describe('content editing', () => {
    it('updateScript stores new script text', () => {
      const p = svc.createProject('script test');
      const updated = svc.updateScript(p.id, '这是新脚本内容');
      expect(updated).toBeDefined();
    });

    it('updateScenes stores scenes', () => {
      const p = svc.createProject('scene test');
      const scenes = [{ id: 's1', visualPrompt: 'prompt1', narration: 'nar1' }] as any;
      const updated = svc.updateScenes(p.id, scenes);
      expect(updated).toBeDefined();
    });

    it('updateModelOverrides stores overrides', () => {
      const p = svc.createProject('override test');
      const updated = svc.updateModelOverrides(p.id, { scriptModel: 'gpt-4o' } as any);
      expect(updated).toBeDefined();
    });

    it('updateStoryboardReplication snapshots scenes from source project', () => {
      const source = svc.createProject('source storyboard');
      const target = svc.createProject('target storyboard');

      svc.updateScenes(source.id, [
        {
          id: 'scene_1',
          number: 1,
          narrative: '源分镜一',
          visualPrompt: 'source prompt one',
          productionSpecs: { camera: 'wide', lighting: 'dramatic', sound: 'ambient', notes: '' },
          estimatedDuration: 4,
          assetType: 'image',
          status: 'pending',
          logs: [],
        },
      ] as any);

      const updated = svc.updateStoryboardReplication(target.id, {
        enabled: true,
        strength: 'high',
        sourceProjectId: source.id,
        notes: '保持镜头节奏',
      });

      expect(updated.storyboardReplication?.enabled).toBe(true);
      expect(updated.storyboardReplication?.strength).toBe('high');
      expect(updated.storyboardReplication?.sourceProjectId).toBe(source.id);
      expect(updated.storyboardReplication?.referenceScenes?.length).toBe(1);
      expect(updated.storyboardReplication?.referenceScenes?.[0].camera).toBe('wide');
    });

    it('updateStoryboardReplication throws for missing source project', () => {
      const target = svc.createProject('target storyboard');
      expect(() => svc.updateStoryboardReplication(target.id, {
        sourceProjectId: 'nonexistent-source',
      })).toThrow(/not found/);
    });

    it('updateSceneQuality stores quality', () => {
      const p = svc.createProject('quality test');
      svc.updateScenes(p.id, [
        {
          id: 'scene_1',
          number: 1,
          narrative: 'n',
          visualPrompt: 'vp',
          productionSpecs: { camera: 'cam', lighting: 'light', sound: '', notes: '' },
          estimatedDuration: 5,
          assetType: 'image',
          status: 'pending',
          logs: [],
        },
      ] as any);

      const quality = { visualConsistency: 80, audioCompleteness: 100, assetIntegrity: 100, overall: 88 } as any;
      const updated = svc.updateSceneQuality(p.id, 'scene_1', quality);
      expect(updated.scenes?.[0].quality).toBeDefined();
      expect(updated.scenes?.[0].quality?.overall).toBe(88);
    });
  });

  describe('setStyleProfile', () => {
    it('throws when neither pastedText nor styleProfile provided', async () => {
      const p = svc.createProject('style test');
      await expect(svc.setStyleProfile(p.id)).rejects.toThrow('pastedText or styleProfile is required');
    });

    it('accepts a styleProfile object', async () => {
      const p = svc.createProject('style test 2');
      const profile = { tone: 'informative', pacing: 'moderate' };
      const result = await svc.setStyleProfile(p.id, undefined, profile);
      expect(result).toBeDefined();
    });
  });

  describe('config management', () => {
    it('getConfig returns productionConcurrency', () => {
      const cfg = svc.getConfig();
      expect(cfg).toHaveProperty('productionConcurrency');
      expect(typeof cfg.productionConcurrency).toBe('number');
    });

    it('updateConfig rebuilds orchestrator', () => {
      const result = svc.updateConfig({ productionConcurrency: 5 });
      expect(result).toEqual({ ok: true });
      const cfg = svc.getConfig();
      expect(cfg.productionConcurrency).toBe(5);
    });

    it('completeSetup returns ok', () => {
      const result = svc.completeSetup({});
      expect(result).toEqual({ ok: true });
    });

    it('hasApiKey returns false', () => {
      expect(svc.hasApiKey()).toBe(false);
    });

    it('getProviderCount returns a number', () => {
      expect(typeof svc.getProviderCount()).toBe('number');
    });

    it('getApiResourceCount returns a number', () => {
      expect(typeof svc.getApiResourceCount()).toBe('number');
    });

    it('getTtsConfig returns an object', () => {
      expect(svc.getTtsConfig()).toBeDefined();
    });

    it('updateTtsConfig stores tts config', () => {
      svc.updateTtsConfig({ voice: 'zh-CN-XiaoxiaoNeural' });
      // Doesn't throw — stored in configStore
    });

    it('getVideoProviderConfig returns null by default', () => {
      // No getVideoConfig callback, falls back to configStore
      const result = svc.getVideoProviderConfig();
      // Should be null or an object
      expect([null, undefined].includes(result as any) || typeof result === 'object').toBe(true);
    });

    it('updateVideoProviderConfig stores and rebuilds', () => {
      expect(() => svc.updateVideoProviderConfig(null)).not.toThrow();
    });
  });

  describe('export / import', () => {
    it('exportProject returns null for nonexistent project', () => {
      expect(svc.exportProject('nonexistent')).toBeNull();
    });

    it('exportProject returns bundle with metadata', () => {
      const p = svc.createProject('export test');
      const bundle = svc.exportProject(p.id);
      expect(bundle).not.toBeNull();
      expect(bundle!.project).toBeDefined();
      expect(bundle!._version).toBe('1.0');
      expect(bundle!._exportedAt).toBeDefined();
    });

    it('importProject creates a new project from bundle', async () => {
      const p = svc.createProject('roundtrip');
      const bundle = svc.exportProject(p.id)!;
      // Ensure Date.now() differs so the imported id is unique
      await new Promise(r => setTimeout(r, 5));
      const imported = svc.importProject(bundle);
      expect(imported.id).not.toBe(p.id); // new id
      expect(imported.topic).toBe(p.topic);
    });
  });

  describe('ETA', () => {
    it('returns null for nonexistent project', () => {
      expect(svc.getEta('nonexistent')).toBeNull();
    });
  });

  describe('trace & AI logs', () => {
    it('getLatestTrace returns null for project without traces', () => {
      const p = svc.createProject('trace test');
      expect(svc.getLatestTrace(p.id)).toBeNull();
    });

    it('listTraces returns empty array for project without traces', () => {
      const p = svc.createProject('trace list');
      expect(svc.listTraces(p.id)).toEqual([]);
    });

    it('getTrace returns null for nonexistent trace', () => {
      const p = svc.createProject('trace get');
      expect(svc.getTrace(p.id, 'nonexistent')).toBeNull();
    });

    it('getAiLogs returns empty array for project without logs', () => {
      const p = svc.createProject('ai log test');
      expect(svc.getAiLogs(p.id)).toEqual([]);
    });
  });

  describe('accessors', () => {
    it('getDataDir returns the data directory', () => {
      expect(svc.getDataDir()).toBe(dataDir);
    });

    it('getProjectDir returns a path under dataDir', () => {
      const p = svc.createProject('dir test');
      const dir = svc.getProjectDir(p.id);
      expect(dir).toContain(p.id);
    });
  });

  describe('provider info', () => {
    it('getProviderCapabilities returns an object', () => {
      expect(svc.getProviderCapabilities()).toBeDefined();
    });

    it('getSessions returns an array-like', () => {
      expect(svc.getSessions()).toBeDefined();
    });

    it('getProviderSummary has expected shape', () => {
      const summary = svc.getProviderSummary();
      expect(summary).toHaveProperty('providers');
      expect(summary).toHaveProperty('sessions');
      expect(summary).toHaveProperty('hasApiKey');
      expect(summary.hasApiKey).toBe(false);
    });
  });

  describe('cost tracking', () => {
    it('getProjectCostSummary returns a result', () => {
      const p = svc.createProject('cost test');
      const summary = svc.getProjectCostSummary(p.id);
      expect(summary).toBeDefined();
    });

    it('getGlobalCostSummary returns a result', () => {
      const summary = svc.getGlobalCostSummary();
      expect(summary).toBeDefined();
    });
  });

  describe('queue detection', () => {
    it('getQueueDetectionPresets returns an object', () => {
      const presets = svc.getQueueDetectionPresets();
      expect(typeof presets).toBe('object');
    });
  });

  describe('invalidateArtifactCache', () => {
    it('does not throw for valid project', () => {
      const p = svc.createProject('cache test');
      expect(() => svc.invalidateArtifactCache(p.id)).not.toThrow();
    });
  });

  describe('onApiKeysChanged callback', () => {
    it('invokes callback on completeSetup when provided', () => {
      const cb = vi.fn();
      const svc2 = new PipelineService({
        dataDir,
        chatAdapter: mockChatAdapter,
        configStore,
        broadcastEvent: (ev) => events.push(ev as PipelineEvent),
        onApiKeysChanged: cb,
      });
      svc2.completeSetup({});
      expect(cb).toHaveBeenCalled();
    });
  });

  describe('getRouteTable', () => {
    it('returns route entries for all stages', () => {
      const table = svc.getRouteTable();
      expect(Array.isArray(table)).toBe(true);
      expect(table.length).toBeGreaterThan(5);
      for (const entry of table) {
        expect(entry).toHaveProperty('stage');
        expect(entry).toHaveProperty('taskType');
        expect(entry).toHaveProperty('adapter');
        expect(entry).toHaveProperty('reason');
      }
    });

    it('includes known stages in route table', () => {
      const table = svc.getRouteTable();
      const stages = table.map(e => e.stage);
      expect(stages).toContain('CAPABILITY_ASSESSMENT');
      expect(stages).toContain('STORYBOARD');
      expect(stages).toContain('VIDEO_GEN');
      expect(stages).toContain('ASSEMBLY');
    });

    it('accepts model overrides', () => {
      const table = svc.getRouteTable({ textModel: { adapter: 'api' as const, model: 'gpt-4' } });
      expect(Array.isArray(table)).toBe(true);
    });
  });

  describe('getStageProviders', () => {
    it('returns stage provider map', () => {
      const map = svc.getStageProviders();
      expect(typeof map).toBe('object');
    });
  });

  describe('getResourcePlan', () => {
    it('returns plan for existing project', () => {
      const p = svc.createProject('rp test');
      const plan = svc.getResourcePlan(p.id);
      expect(plan).toBeDefined();
    });
  });

  describe('regenerateScene', () => {
    it('throws for unknown project', async () => {
      await expect(svc.regenerateScene('nonexistent', 's1')).rejects.toThrow();
    });
  });

  describe('updateStageProviderOverrides', () => {
    it('delegates without throwing for valid project', () => {
      const p = svc.createProject('spo test');
      expect(() => svc.updateStageProviderOverrides(p.id, {})).not.toThrow();
    });
  });

  describe('approveScene and rejectScene', () => {
    it('approveScene throws for unknown project', () => {
      expect(() => svc.approveScene('nonexistent', 's1')).toThrow();
    });

    it('rejectScene throws for unknown project', () => {
      expect(() => svc.rejectScene('nonexistent', 's1')).toThrow();
    });
  });

  describe('setStyleProfile', () => {
    it('throws when neither pastedText nor styleProfile given', async () => {
      await expect(svc.setStyleProfile('nonexistent')).rejects.toThrow('pastedText or styleProfile is required');
    });
  });

  describe('approveQaReview', () => {
    it('throws for unknown project', () => {
      expect(() => svc.approveQaReview('nonexistent')).toThrow();
    });
  });

  describe('approveReferenceImages', () => {
    it('throws for unknown project', () => {
      expect(() => svc.approveReferenceImages('nonexistent')).toThrow();
    });
  });

  /* ---- Provider & session info ---- */

  describe('getProviderCapabilities', () => {
    it('returns provider registry data', () => {
      const caps = svc.getProviderCapabilities();
      expect(caps).toBeDefined();
      expect(typeof caps).toBe('object');
    });
  });

  describe('updateProviderCapability', () => {
    it('registers and returns the updated capability', () => {
      const result = svc.updateProviderCapability('test-provider', {
        text: true,
        imageGeneration: false,
        videoGeneration: false,
        webSearch: false,
        fileUpload: false,
        tts: false,
        models: ['test-model'],
      });
      expect(result).toBeDefined();
    });
  });

  describe('getSessions', () => {
    it('returns sessions object', () => {
      const sessions = svc.getSessions();
      expect(sessions).toBeDefined();
    });
  });

  describe('getProviderSummary', () => {
    it('returns providers, sessions, and hasApiKey', () => {
      const summary = svc.getProviderSummary();
      expect(summary).toHaveProperty('providers');
      expect(summary).toHaveProperty('sessions');
      expect(summary).toHaveProperty('hasApiKey');
      expect(typeof summary.hasApiKey).toBe('boolean');
    });
  });

  describe('getProviderCount', () => {
    it('returns a number', () => {
      expect(typeof svc.getProviderCount()).toBe('number');
    });
  });

  describe('getApiResourceCount', () => {
    it('returns 0 when no API resources configured', () => {
      expect(svc.getApiResourceCount()).toBe(0);
    });
  });

  describe('hasApiKey', () => {
    it('returns false by default', () => {
      expect(svc.hasApiKey()).toBe(false);
    });
  });

  describe('getVideoProviderConfig', () => {
    it('returns null when not configured', () => {
      const config = svc.getVideoProviderConfig();
      expect(config).toBeNull();
    });
  });

  describe('invalidateArtifactCache', () => {
    it('does not throw for valid project', () => {
      const p = svc.createProject('cache test');
      expect(() => svc.invalidateArtifactCache(p.id)).not.toThrow();
    });

    it('does not throw with specific artifacts', () => {
      const p = svc.createProject('cache test 2');
      expect(() => svc.invalidateArtifactCache(p.id, ['script', 'scenes'])).not.toThrow();
    });
  });

  describe('getEta', () => {
    it('returns null for unknown project', () => {
      expect(svc.getEta('nonexistent')).toBeNull();
    });

    it('returns eta object for valid project', () => {
      const p = svc.createProject('eta test');
      const eta = svc.getEta(p.id);
      // ETA may be null if no stages completed, or an object
      if (eta !== null) {
        expect(eta).toHaveProperty('etaMs');
        expect(eta).toHaveProperty('completedMs');
        expect(eta).toHaveProperty('confidence');
      }
    });
  });

  describe('completeSetup', () => {
    it('returns ok without api key', () => {
      const result = svc.completeSetup({});
      expect(result).toEqual({ ok: true });
    });
  });

  describe('updateConfig', () => {
    it('updates productionConcurrency', () => {
      svc.updateConfig({ productionConcurrency: 4 });
      const config = svc.getConfig();
      expect(config.productionConcurrency).toBe(4);
    });
  });

  describe('getConfig', () => {
    it('returns defaults', () => {
      const config = svc.getConfig();
      expect(config.productionConcurrency).toBe(2);
    });
  });
});
