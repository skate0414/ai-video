import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Readable } from 'node:stream';
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { IncomingMessage, ServerResponse } from 'node:http';
import type { PipelineStage, ModelOverrides } from '../../pipeline/types.js';
import { ARTIFACT } from '../../constants.js';

/**
 * Pipeline route integration tests.
 * These test the route matching and handler wiring using a mock PipelineService.
 */

/** Create a mock IncomingMessage from a body string */
function createMockRequest(body: string, method = 'GET', url = '/'): IncomingMessage {
  const stream = Readable.from([Buffer.from(body)]);
  (stream as any).method = method;
  (stream as any).url = url;
  (stream as any).headers = {};
  return stream as unknown as IncomingMessage;
}

/** Create a mock ServerResponse that captures what was written */
function createMockResponse(): ServerResponse & { _status: number; _body: any; _headers: Record<string, any> } {
  const res = {
    _status: 0,
    _body: null as any,
    _headers: {} as Record<string, any>,
    headersSent: false,
    writeHead(status: number, headers?: Record<string, any>) {
      res._status = status;
      if (headers) Object.assign(res._headers, headers);
      return res;
    },
    setHeader(name: string, value: any) {
      res._headers[name] = value;
      return res;
    },
    end(body?: string) {
      if (body) {
        try { res._body = JSON.parse(body); } catch { res._body = body; }
      }
    },
    write: vi.fn(),
    pipe: vi.fn(),
  } as any;
  return res;
}

/** Minimal mock PipelineService */
function createMockService() {
  return {
    listProjects: vi.fn(() => []),
    createProject: vi.fn((topic: string, title?: string, overrides?: ModelOverrides) => ({
      id: 'proj_test',
      topic,
      title: title || topic,
      stageStatus: {},
      logs: [],
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })),
    loadProject: vi.fn((id: string) => {
      if (id === 'nonexistent') return null;
      return { id, topic: 'Test', stageStatus: {}, logs: [] };
    }),
    deleteProject: vi.fn((id: string) => id !== 'nonexistent'),
    startPipeline: vi.fn((id: string, resumeFrom?: PipelineStage) => ({ ok: true as const })),
    enqueueProject: vi.fn((id: string) => ({ ok: true as const, position: 'started' as const })),
    getQueueSnapshot: vi.fn(() => ({ active: [], queued: [], maxConcurrent: 3 })),
    stopPipeline: vi.fn(),
    retryStage: vi.fn(() => ({ ok: true as const })),
    resumePipeline: vi.fn(() => ({ ok: true as const })),
    requestPause: vi.fn(() => ({ ok: true as const })),
    regenerateScene: vi.fn(async () => ({ id: 'scene_1' })),
    updateScript: vi.fn((id: string, text: string) => ({ id, scriptOutput: { scriptText: text } })),
    updateScenes: vi.fn((id: string, scenes: any[]) => ({ id, scenes })),
    approveScene: vi.fn((id: string, sceneId: string) => ({ id })),
    rejectScene: vi.fn((id: string, sceneId: string) => ({ id })),
    approveQaReview: vi.fn((id: string, body: any) => ({ id, stageStatus: { QA_REVIEW: 'completed' } })),
    approveReferenceImages: vi.fn((id: string) => ({ id, stageStatus: { REFERENCE_IMAGE: 'completed' } })),
    setStyleProfile: vi.fn(async () => ({ id: 'proj_test' })),
    updateModelOverrides: vi.fn((id: string) => ({ id })),
    getConfig: vi.fn(() => ({})),
    updateConfig: vi.fn((body: any) => body),
    getTtsConfig: vi.fn(() => ({})),
    updateTtsConfig: vi.fn(),
    getVideoProviderConfig: vi.fn(() => null),
    updateVideoProviderConfig: vi.fn(),
    getResourcePlan: vi.fn(() => ({})),
    getProviderCapabilities: vi.fn(() => ({})),
    updateProviderCapability: vi.fn((id: string) => ({ id })),
    getSessions: vi.fn(() => []),
    exportProject: vi.fn((id: string) => {
      if (id === 'nonexistent') return null;
      return { project: { id } };
    }),
    importProject: vi.fn((bundle: any) => bundle.project),
    getDataDir: vi.fn(() => '/tmp/data'),
    getProjectDir: vi.fn((id: string) => `/tmp/data/projects/${id}`),
    saveProject: vi.fn(),
    invalidateArtifactCache: vi.fn(),
    getEta: vi.fn(() => null),
    getStageProviders: vi.fn(() => ({})),
    getProviderSummary: vi.fn(() => ({ providers: {}, sessions: [], hasApiKey: false })),
    getRouteTable: vi.fn(() => []),
    getGlobalCostSummary: vi.fn(() => ({ total: 0 })),
    getProjectCostSummary: vi.fn(() => ({ total: 0 })),
    getVideoProviderHealth: vi.fn(() => ({})),
    getVideoProviderRecommendation: vi.fn(() => ({})),
    getLatestTrace: vi.fn(() => null),
    getTrace: vi.fn(() => null),
    listTraces: vi.fn(() => []),
    getAiLogs: vi.fn(() => []),
    getQueueDetectionPresets: vi.fn(() => ({})),
    updateQueueDetectionPresets: vi.fn(),
    deleteQueueDetectionPreset: vi.fn((id: string) => id !== 'nonexistent'),
    updateStageProviderOverrides: vi.fn((id: string) => ({ id })),
    updateStoryboardReplication: vi.fn((id: string, body: any) => ({ id, storyboardReplication: body })),
    styleLibrary: {
      list: vi.fn(() => []),
      save: vi.fn((_name: string) => ({ id: 'tpl_1' })),
      load: vi.fn((id: string) => id === 'nonexistent' ? null : { id }),
      delete: vi.fn((id: string) => id !== 'nonexistent'),
    },
  };
}

describe('Pipeline routes', () => {
  let routes: Array<{ method: string; pattern: RegExp; handler: Function }>;
  let svc: ReturnType<typeof createMockService>;

  beforeEach(async () => {
    svc = createMockService();
    // Import the route factory
    const { pipelineRoutesV2 } = await import('../pipeline.js');
    routes = pipelineRoutesV2(svc as any);
  });

  function findRoute(method: string, path: string) {
    for (const route of routes) {
      if (route.method !== method) continue;
      const match = route.pattern.exec(path);
      if (match) return { route, match };
    }
    return null;
  }

  async function callRoute(method: string, path: string, body = '{}') {
    const found = findRoute(method, path);
    if (!found) throw new Error(`No route matched: ${method} ${path}`);
    const req = createMockRequest(body, method, path);
    const res = createMockResponse();
    await found.route.handler(req, res, found.match);
    return res;
  }

  it('GET /api/pipeline lists projects', async () => {
    const res = await callRoute('GET', '/api/pipeline');
    expect(svc.listProjects).toHaveBeenCalled();
    expect(res._status).toBe(200);
  });

  it('POST /api/pipeline creates a project', async () => {
    const res = await callRoute('POST', '/api/pipeline', '{"topic":"My Topic"}');
    expect(svc.createProject).toHaveBeenCalledWith('My Topic', undefined, undefined);
    expect(res._status).toBe(201);
    expect(res._body.topic).toBe('My Topic');
  });

  it('POST /api/pipeline returns 400 when topic is empty', async () => {
    const res = await callRoute('POST', '/api/pipeline', '{"topic":""}');
    expect(res._status).toBe(400);
    expect(res._body.error).toContain('topic');
  });

  it('POST /api/pipeline/batch creates multiple projects', async () => {
    const res = await callRoute(
      'POST',
      '/api/pipeline/batch',
      JSON.stringify({ topics: ['A', 'B'], titlePrefix: 'Batch' }),
    );

    expect(res._status).toBe(201);
    expect(res._body.ok).toBe(true);
    expect(res._body.count).toBe(2);
    expect(svc.createProject).toHaveBeenCalledTimes(2);
  });

  it('POST /api/pipeline/batch/start enqueues projects and reports partial failure', async () => {
    (svc.enqueueProject as any).mockImplementation((id: string) => {
      if (id === 'proj_bad') return { error: 'Project not found', status: 404 };
      return { ok: true as const, position: 'started' as const };
    });

    const res = await callRoute(
      'POST',
      '/api/pipeline/batch/start',
      JSON.stringify({ projectIds: ['proj_ok', 'proj_bad'] }),
    );

    expect(res._status).toBe(207);
    expect(res._body.started).toEqual(['proj_ok']);
    expect(res._body.failed).toEqual([{ projectId: 'proj_bad', error: 'Project not found', status: 404 }]);
  });

  it('GET /api/pipeline/:id returns a project', async () => {
    const res = await callRoute('GET', '/api/pipeline/proj_123');
    expect(svc.loadProject).toHaveBeenCalledWith('proj_123');
    expect(res._status).toBe(200);
  });

  it('GET /api/pipeline/:id returns 404 for unknown project', async () => {
    const res = await callRoute('GET', '/api/pipeline/nonexistent');
    expect(res._status).toBe(404);
  });

  it('DELETE /api/pipeline/:id deletes a project', async () => {
    const res = await callRoute('DELETE', '/api/pipeline/proj_123');
    expect(svc.deleteProject).toHaveBeenCalledWith('proj_123');
    expect(res._status).toBe(200);
  });

  it('DELETE /api/pipeline/:id returns 404 for unknown project', async () => {
    const res = await callRoute('DELETE', '/api/pipeline/nonexistent');
    expect(res._status).toBe(404);
  });

  it('POST /api/pipeline/:id/start starts a pipeline', async () => {
    const res = await callRoute('POST', '/api/pipeline/proj_123/start');
    expect(svc.startPipeline).toHaveBeenCalledWith('proj_123', undefined);
    expect(res._status).toBe(200);
  });

  it('POST /api/pipeline/:id/stop stops a pipeline', async () => {
    const res = await callRoute('POST', '/api/pipeline/proj_123/stop');
    expect(svc.stopPipeline).toHaveBeenCalledWith('proj_123');
    expect(res._status).toBe(200);
  });

  it('POST /api/pipeline/:id/retry/:stage retries a stage', async () => {
    const res = await callRoute('POST', '/api/pipeline/proj_123/retry/SCRIPT_GENERATION');
    expect(svc.retryStage).toHaveBeenCalledWith('proj_123', 'SCRIPT_GENERATION', undefined);
    expect(res._status).toBe(200);
  });

  it('POST /api/pipeline/:id/resume resumes a pipeline', async () => {
    const res = await callRoute('POST', '/api/pipeline/proj_123/resume');
    expect(svc.resumePipeline).toHaveBeenCalledWith('proj_123');
    expect(res._status).toBe(200);
  });

  it('POST /api/pipeline/:id/qa-override approves QA review', async () => {
    const res = await callRoute('POST', '/api/pipeline/proj_123/qa-override', '{"feedback":"Looks good"}');
    expect(svc.approveQaReview).toHaveBeenCalled();
    expect(res._status).toBe(200);
  });

  it('POST /api/pipeline/:id/approve-reference approves reference images', async () => {
    const res = await callRoute('POST', '/api/pipeline/proj_123/approve-reference');
    expect(svc.approveReferenceImages).toHaveBeenCalledWith('proj_123');
    expect(res._status).toBe(200);
  });

  it('GET /api/config returns config', async () => {
    const res = await callRoute('GET', '/api/config');
    expect(svc.getConfig).toHaveBeenCalled();
    expect(res._status).toBe(200);
  });

  it('GET /api/sessions returns sessions', async () => {
    const res = await callRoute('GET', '/api/sessions');
    expect(svc.getSessions).toHaveBeenCalled();
    expect(res._status).toBe(200);
  });

  it('GET /api/data-dir returns data directory', async () => {
    const res = await callRoute('GET', '/api/data-dir');
    expect(res._status).toBe(200);
    expect(res._body.dataDir).toBe('/tmp/data');
  });

  it('route patterns match expected URL formats', () => {
    // Verify key route patterns exist
    expect(findRoute('GET', '/api/pipeline')).not.toBeNull();
    expect(findRoute('POST', '/api/pipeline')).not.toBeNull();
    expect(findRoute('POST', '/api/pipeline/batch')).not.toBeNull();
    expect(findRoute('POST', '/api/pipeline/batch/start')).not.toBeNull();
    expect(findRoute('GET', '/api/pipeline/proj_123')).not.toBeNull();
    expect(findRoute('DELETE', '/api/pipeline/proj_123')).not.toBeNull();
    expect(findRoute('POST', '/api/pipeline/proj_123/start')).not.toBeNull();
    expect(findRoute('POST', '/api/pipeline/proj_123/stop')).not.toBeNull();
    expect(findRoute('POST', '/api/pipeline/proj_123/resume')).not.toBeNull();
    expect(findRoute('POST', '/api/pipeline/proj_123/retry/QA_REVIEW')).not.toBeNull();
    expect(findRoute('PUT', '/api/pipeline/proj_123/script')).not.toBeNull();
    expect(findRoute('PUT', '/api/pipeline/proj_123/scenes')).not.toBeNull();
    expect(findRoute('GET', '/api/config')).not.toBeNull();
    expect(findRoute('POST', '/api/config')).not.toBeNull();
    expect(findRoute('GET', '/api/presets')).not.toBeNull();
    expect(findRoute('GET', '/api/sessions')).not.toBeNull();
    expect(findRoute('GET', '/api/data-dir')).not.toBeNull();
    // Additional route patterns
    expect(findRoute('GET', '/api/pipeline/proj_123/eta')).not.toBeNull();
    expect(findRoute('POST', '/api/pipeline/proj_123/pause')).not.toBeNull();
    expect(findRoute('POST', '/api/pipeline/proj_123/scenes/s1/approve')).not.toBeNull();
    expect(findRoute('POST', '/api/pipeline/proj_123/scenes/s1/reject')).not.toBeNull();
    expect(findRoute('POST', '/api/pipeline/proj_123/scenes/s1/regenerate')).not.toBeNull();
    expect(findRoute('POST', '/api/pipeline/proj_123/style-profile')).not.toBeNull();
    expect(findRoute('PUT', '/api/pipeline/proj_123/overrides')).not.toBeNull();
    expect(findRoute('PUT', '/api/pipeline/proj_123/stage-overrides')).not.toBeNull();
    expect(findRoute('PUT', '/api/pipeline/proj_123/storyboard-replication')).not.toBeNull();
    expect(findRoute('GET', '/api/pipeline/stage-providers')).not.toBeNull();
    expect(findRoute('GET', '/api/config/tts')).not.toBeNull();
    expect(findRoute('POST', '/api/config/tts')).not.toBeNull();
    expect(findRoute('GET', '/api/config/video-provider')).not.toBeNull();
    expect(findRoute('POST', '/api/config/video-provider')).not.toBeNull();
    expect(findRoute('GET', '/api/config/queue-detection')).not.toBeNull();
    expect(findRoute('POST', '/api/config/queue-detection')).not.toBeNull();
    expect(findRoute('GET', '/api/pipeline/proj_123/export')).not.toBeNull();
    expect(findRoute('POST', '/api/pipeline/import')).not.toBeNull();
    expect(findRoute('GET', '/api/providers/summary')).not.toBeNull();
    expect(findRoute('GET', '/api/config/route-table')).not.toBeNull();
    expect(findRoute('GET', '/api/style-templates')).not.toBeNull();
    expect(findRoute('POST', '/api/style-templates')).not.toBeNull();
    expect(findRoute('GET', '/api/costs')).not.toBeNull();
    expect(findRoute('GET', '/api/pipeline/proj_123/costs')).not.toBeNull();
    expect(findRoute('GET', '/api/providers/video-health')).not.toBeNull();
    expect(findRoute('GET', '/api/pipeline/proj_123/traces')).not.toBeNull();
    expect(findRoute('GET', '/api/pipeline/proj_123/trace')).not.toBeNull();
    expect(findRoute('GET', '/api/pipeline/proj_123/ai-logs')).not.toBeNull();
  });

  /* -- ETA -- */
  it('GET /api/pipeline/:id/eta', async () => {
    const res = await callRoute('GET', '/api/pipeline/proj_123/eta');
    expect(res._status).toBe(200);
    expect(svc.getEta).toHaveBeenCalledWith('proj_123');
  });

  /* -- Pause -- */
  it('POST /api/pipeline/:id/pause', async () => {
    const res = await callRoute('POST', '/api/pipeline/proj_123/pause');
    expect(res._status).toBe(200);
    expect(svc.requestPause).toHaveBeenCalledWith('proj_123');
  });

  /* -- Script -- */
  it('PUT /api/pipeline/:id/script updates script', async () => {
    const res = await callRoute('PUT', '/api/pipeline/proj_123/script', '{"scriptText":"New script"}');
    expect(res._status).toBe(200);
    expect(svc.updateScript).toHaveBeenCalledWith('proj_123', 'New script');
  });

  it('PUT /api/pipeline/:id/script rejects empty scriptText', async () => {
    const res = await callRoute('PUT', '/api/pipeline/proj_123/script', '{}');
    expect(res._status).toBe(400);
  });

  /* -- Scenes -- */
  it('PUT /api/pipeline/:id/scenes updates scenes', async () => {
    const res = await callRoute('PUT', '/api/pipeline/proj_123/scenes', '{"scenes":[{"id":"s1"}]}');
    expect(res._status).toBe(200);
    expect(svc.updateScenes).toHaveBeenCalled();
  });

  it('PUT /api/pipeline/:id/scenes rejects missing scenes', async () => {
    const res = await callRoute('PUT', '/api/pipeline/proj_123/scenes', '{}');
    expect(res._status).toBe(400);
  });

  /* -- Approve/reject scenes -- */
  it('POST approve-scene calls approveScene', async () => {
    const res = await callRoute('POST', '/api/pipeline/proj_123/scenes/s1/approve');
    expect(res._status).toBe(200);
    expect(svc.approveScene).toHaveBeenCalledWith('proj_123', 's1');
  });

  it('POST reject-scene calls rejectScene', async () => {
    const res = await callRoute('POST', '/api/pipeline/proj_123/scenes/s1/reject');
    expect(res._status).toBe(200);
    expect(svc.rejectScene).toHaveBeenCalledWith('proj_123', 's1', undefined);
  });

  /* -- Regenerate scene -- */
  it('POST regenerate-scene calls regenerateScene', async () => {
    const res = await callRoute('POST', '/api/pipeline/proj_123/scenes/s1/regenerate', '{"feedback":"改进画面"}');
    expect(res._status).toBe(200);
    expect(svc.regenerateScene).toHaveBeenCalledWith('proj_123', 's1', '改进画面');
  });

  /* -- Style profile -- */
  it('POST style-profile calls setStyleProfile', async () => {
    const res = await callRoute('POST', '/api/pipeline/proj_123/style-profile', '{"styleProfile":{"tone":"dramatic"}}');
    expect(res._status).toBe(200);
    expect(svc.setStyleProfile).toHaveBeenCalled();
  });

  /* -- Model overrides -- */
  it('PUT overrides updates model overrides', async () => {
    const res = await callRoute('PUT', '/api/pipeline/proj_123/overrides', '{"modelOverrides":{"scriptModel":"gpt-4o"}}');
    expect(res._status).toBe(200);
    expect(svc.updateModelOverrides).toHaveBeenCalled();
  });

  /* -- Stage provider overrides -- */
  it('PUT stage-overrides updates overrides', async () => {
    const res = await callRoute('PUT', '/api/pipeline/proj_123/stage-overrides', '{"stageProviderOverrides":{}}');
    expect(res._status).toBe(200);
    expect(svc.updateStageProviderOverrides).toHaveBeenCalled();
  });

  it('PUT storyboard-replication updates project settings', async () => {
    const res = await callRoute(
      'PUT',
      '/api/pipeline/proj_123/storyboard-replication',
      JSON.stringify({ enabled: true, strength: 'high', sourceProjectId: 'proj_ref' }),
    );
    expect(res._status).toBe(200);
    expect(svc.updateStoryboardReplication).toHaveBeenCalledWith(
      'proj_123',
      expect.objectContaining({ enabled: true, strength: 'high', sourceProjectId: 'proj_ref' }),
    );
  });

  /* -- Stage providers -- */
  it('GET stage-providers route exists', async () => {
    // Note: /api/pipeline/stage-providers may be matched by the project GET route first
    // depending on route order. We just verify the route pattern exists.
    expect(findRoute('GET', '/api/pipeline/stage-providers')).not.toBeNull();
  });

  /* -- Config -- */
  it('POST /api/config updates config', async () => {
    const res = await callRoute('POST', '/api/config', '{"productionConcurrency":4}');
    expect(res._status).toBe(200);
    expect(svc.updateConfig).toHaveBeenCalled();
  });

  /* -- TTS config -- */
  it('GET /api/config/tts', async () => {
    const res = await callRoute('GET', '/api/config/tts');
    expect(res._status).toBe(200);
    expect(svc.getTtsConfig).toHaveBeenCalled();
  });

  it('POST /api/config/tts', async () => {
    const res = await callRoute('POST', '/api/config/tts', '{"voice":"zh-CN-XiaoxiaoNeural"}');
    expect(res._status).toBe(200);
    expect(svc.updateTtsConfig).toHaveBeenCalled();
  });

  /* -- Video provider config -- */
  it('GET /api/config/video-provider', async () => {
    const res = await callRoute('GET', '/api/config/video-provider');
    expect(res._status).toBe(200);
    expect(svc.getVideoProviderConfig).toHaveBeenCalled();
  });

  it('POST /api/config/video-provider', async () => {
    const res = await callRoute('POST', '/api/config/video-provider', '{"provider":"klingai"}');
    expect(res._status).toBe(200);
    expect(svc.updateVideoProviderConfig).toHaveBeenCalled();
  });

  /* -- Queue detection -- */
  it('GET /api/config/queue-detection', async () => {
    const res = await callRoute('GET', '/api/config/queue-detection');
    expect(res._status).toBe(200);
    expect(svc.getQueueDetectionPresets).toHaveBeenCalled();
  });

  it('POST /api/config/queue-detection', async () => {
    const res = await callRoute('POST', '/api/config/queue-detection', '{"klingai":{"queueKeywords":["排队"]}}');
    expect(res._status).toBe(200);
    expect(svc.updateQueueDetectionPresets).toHaveBeenCalled();
  });

  it('DELETE /api/config/queue-detection/:id', async () => {
    const res = await callRoute('DELETE', '/api/config/queue-detection/klingai');
    expect(res._status).toBe(200);
    expect(svc.deleteQueueDetectionPreset).toHaveBeenCalledWith('klingai');
  });

  it('DELETE /api/config/queue-detection/:id returns 404 for unknown', async () => {
    const res = await callRoute('DELETE', '/api/config/queue-detection/nonexistent');
    expect(res._status).toBe(404);
  });

  /* -- Resource plan -- */
  it('GET /api/pipeline/:id/resource-plan', async () => {
    const res = await callRoute('GET', '/api/pipeline/proj_123/resource-plan');
    expect(res._status).toBe(200);
    expect(svc.getResourcePlan).toHaveBeenCalled();
  });

  it('GET /api/pipeline/:id/resource-plan returns 404 for unknown project', async () => {
    const res = await callRoute('GET', '/api/pipeline/nonexistent/resource-plan');
    expect(res._status).toBe(404);
  });

  /* -- Provider capabilities -- */
  it('GET /api/providers/capabilities', async () => {
    const res = await callRoute('GET', '/api/providers/capabilities');
    expect(res._status).toBe(200);
    expect(svc.getProviderCapabilities).toHaveBeenCalled();
  });

  it('PUT /api/providers/:id/capabilities', async () => {
    const res = await callRoute('PUT', '/api/providers/chatgpt/capabilities', '{"text":true}');
    expect(res._status).toBe(200);
    expect(svc.updateProviderCapability).toHaveBeenCalledWith('chatgpt', { text: true });
  });

  /* -- Presets -- */
  it('GET /api/presets/:id returns preset', async () => {
    const res = await callRoute('GET', '/api/presets/chatgpt');
    expect(res._status).toBe(200);
    expect(res._body.id).toBe('chatgpt');
  });

  it('GET /api/presets/:id returns 404 for unknown preset', async () => {
    const res = await callRoute('GET', '/api/presets/nonexistent');
    expect(res._status).toBe(404);
  });

  /* -- Export -- */
  it('GET /api/pipeline/:id/export returns export bundle', async () => {
    const res = await callRoute('GET', '/api/pipeline/proj_123/export');
    expect(res._status).toBe(200);
    expect(svc.exportProject).toHaveBeenCalledWith('proj_123');
  });

  it('GET /api/pipeline/:id/export returns 404 for nonexistent', async () => {
    const res = await callRoute('GET', '/api/pipeline/nonexistent/export');
    expect(res._status).toBe(404);
  });

  /* -- Import -- */
  it('POST /api/pipeline/import imports a project', async () => {
    const bundle = { project: { id: 'old_id', topic: 'test' } };
    const res = await callRoute('POST', '/api/pipeline/import', JSON.stringify(bundle));
    expect(res._status).toBe(201);
    expect(svc.importProject).toHaveBeenCalled();
  });

  it('POST /api/pipeline/import rejects invalid bundle', async () => {
    const res = await callRoute('POST', '/api/pipeline/import', '{"project":{}}');
    expect(res._status).toBe(400);
  });

  /* -- Provider summary -- */
  it('GET /api/providers/summary', async () => {
    const res = await callRoute('GET', '/api/providers/summary');
    expect(res._status).toBe(200);
    expect(svc.getProviderSummary).toHaveBeenCalled();
  });

  /* -- Route table -- */
  it('GET /api/config/route-table', async () => {
    const res = await callRoute('GET', '/api/config/route-table');
    expect(res._status).toBe(200);
    expect(svc.getRouteTable).toHaveBeenCalled();
  });

  /* -- Style templates -- */
  it('GET /api/style-templates', async () => {
    const res = await callRoute('GET', '/api/style-templates');
    expect(res._status).toBe(200);
    expect(svc.styleLibrary.list).toHaveBeenCalled();
  });

  it('POST /api/style-templates creates template', async () => {
    const res = await callRoute('POST', '/api/style-templates', '{"name":"My Style","topic":"test","styleProfile":{"tone":"fun"}}');
    expect(res._status).toBe(201);
    expect(svc.styleLibrary.save).toHaveBeenCalled();
  });

  it('POST /api/style-templates rejects missing name', async () => {
    const res = await callRoute('POST', '/api/style-templates', '{"styleProfile":{}}');
    expect(res._status).toBe(400);
  });

  it('GET /api/style-templates/:id', async () => {
    const res = await callRoute('GET', '/api/style-templates/tpl_1');
    expect(res._status).toBe(200);
  });

  it('GET /api/style-templates/:id returns 404 for unknown', async () => {
    const res = await callRoute('GET', '/api/style-templates/nonexistent');
    expect(res._status).toBe(404);
  });

  it('DELETE /api/style-templates/:id', async () => {
    const res = await callRoute('DELETE', '/api/style-templates/tpl_1');
    expect(res._status).toBe(200);
  });

  it('DELETE /api/style-templates/:id returns 404 for unknown', async () => {
    const res = await callRoute('DELETE', '/api/style-templates/nonexistent');
    expect(res._status).toBe(404);
  });

  /* -- Costs -- */
  it('GET /api/costs', async () => {
    const res = await callRoute('GET', '/api/costs');
    expect(res._status).toBe(200);
    expect(svc.getGlobalCostSummary).toHaveBeenCalled();
  });

  it('GET /api/pipeline/:id/costs', async () => {
    const res = await callRoute('GET', '/api/pipeline/proj_123/costs');
    expect(res._status).toBe(200);
    expect(svc.getProjectCostSummary).toHaveBeenCalledWith('proj_123');
  });

  /* -- Video provider health -- */
  it('GET /api/providers/video-health', async () => {
    const res = await callRoute('GET', '/api/providers/video-health');
    expect(res._status).toBe(200);
    expect(svc.getVideoProviderHealth).toHaveBeenCalled();
  });

  it('GET /api/providers/video-health/:id/recommendation', async () => {
    const res = await callRoute('GET', '/api/providers/video-health/klingai/recommendation');
    expect(res._status).toBe(200);
    expect(svc.getVideoProviderRecommendation).toHaveBeenCalledWith('klingai');
  });

  /* -- Traces -- */
  it('GET /api/pipeline/:id/traces', async () => {
    const res = await callRoute('GET', '/api/pipeline/proj_123/traces');
    expect(res._status).toBe(200);
    expect(svc.listTraces).toHaveBeenCalledWith('proj_123');
  });

  it('GET /api/pipeline/:id/trace returns 404 when no trace', async () => {
    const res = await callRoute('GET', '/api/pipeline/proj_123/trace');
    expect(res._status).toBe(404);
  });

  it('GET /api/pipeline/:id/traces/:traceId returns 404 when not found', async () => {
    const res = await callRoute('GET', '/api/pipeline/proj_123/traces/abc');
    expect(res._status).toBe(404);
  });

  /* -- AI logs -- */
  it('GET /api/pipeline/:id/ai-logs', async () => {
    const res = await callRoute('GET', '/api/pipeline/proj_123/ai-logs');
    expect(res._status).toBe(200);
    expect(svc.getAiLogs).toHaveBeenCalledWith('proj_123');
  });

  /* ---- PUT artifact invalidates cache (regression: ??= silent-drop) ---- */
  describe('PUT /api/pipeline/:id/artifacts/:filename', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'artifact-test-'));
      const projDir = join(tempDir, 'proj_123');
      mkdirSync(projDir, { recursive: true });
      writeFileSync(join(projDir, ARTIFACT.RESEARCH), '{"facts":[]}');
      writeFileSync(join(projDir, ARTIFACT.NARRATIVE_MAP), '{"narrativeMap":{}}');
      svc.getProjectDir.mockReturnValue(projDir);
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('invalidates artifact cache after writing research.json', async () => {
      const newData = { facts: ['new fact 1', 'new fact 2'] };
      const res = await callRoute('PUT', `/api/pipeline/proj_123/artifacts/${ARTIFACT.RESEARCH}`, JSON.stringify(newData));
      expect(res._status).toBe(200);
      expect(svc.invalidateArtifactCache).toHaveBeenCalledWith('proj_123', [ARTIFACT.RESEARCH]);
    });

    it('invalidates artifact cache after writing narrative-map.json', async () => {
      const newData = { narrativeMap: { beats: ['beat1', 'beat2'] } };
      const res = await callRoute('PUT', `/api/pipeline/proj_123/artifacts/${ARTIFACT.NARRATIVE_MAP}`, JSON.stringify(newData));
      expect(res._status).toBe(200);
      expect(svc.invalidateArtifactCache).toHaveBeenCalledWith('proj_123', [ARTIFACT.NARRATIVE_MAP]);
    });

    it('rejects non-editable artifact names', async () => {
      const res = await callRoute('PUT', `/api/pipeline/proj_123/artifacts/${ARTIFACT.SCRIPT}`, '{}');
      expect(res._status).toBe(400);
      expect(svc.invalidateArtifactCache).not.toHaveBeenCalled();
    });
  });

  /* ---- GET artifact ---- */
  describe('GET /api/pipeline/:id/artifacts/:filename', () => {
    let tempDir: string;

    beforeEach(() => {
      tempDir = mkdtempSync(join(tmpdir(), 'artifact-read-'));
      const projDir = join(tempDir, 'proj_123');
      mkdirSync(projDir, { recursive: true });
      writeFileSync(join(projDir, ARTIFACT.RESEARCH), '{"facts":["a","b"]}');
      svc.getProjectDir.mockReturnValue(projDir);
    });

    afterEach(() => {
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('reads an existing artifact', async () => {
      const res = await callRoute('GET', `/api/pipeline/proj_123/artifacts/${ARTIFACT.RESEARCH}`);
      expect(res._status).toBe(200);
      expect(res._body.facts).toEqual(['a', 'b']);
    });

    it('rejects unknown artifact names', async () => {
      const res = await callRoute('GET', '/api/pipeline/proj_123/artifacts/evil.json');
      expect(res._status).toBe(400);
    });

    it('returns 404 for missing artifact file', async () => {
      const res = await callRoute('GET', `/api/pipeline/proj_123/artifacts/${ARTIFACT.CALIBRATION}`);
      expect(res._status).toBe(404);
    });
  });

  /* ---- Video streaming ---- */
  describe('GET /api/pipeline/:id/video', () => {
    it('returns 404 when project not found', async () => {
      const res = await callRoute('GET', '/api/pipeline/nonexistent/video');
      expect(res._status).toBe(404);
    });

    it('returns 404 when project has no video path', async () => {
      svc.loadProject.mockReturnValueOnce({ id: 'proj_123', topic: 'Test', finalVideoPath: undefined, stageStatus: {}, logs: [] } as any);
      const res = await callRoute('GET', '/api/pipeline/proj_123/video');
      expect(res._status).toBe(404);
    });
  });

  /* ---- Asset serving ---- */
  describe('GET /api/pipeline/:id/assets/:filename', () => {
    it('returns 404 for missing asset', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'asset-test-'));
      const projDir = join(tempDir, 'proj_123');
      mkdirSync(join(projDir, 'assets'), { recursive: true });
      svc.getProjectDir.mockReturnValue(projDir);

      const res = await callRoute('GET', '/api/pipeline/proj_123/assets/missing.png');
      expect(res._status).toBe(404);
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('blocks path traversal', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'asset-test-'));
      const projDir = join(tempDir, 'proj_123');
      mkdirSync(join(projDir, 'assets'), { recursive: true });
      svc.getProjectDir.mockReturnValue(projDir);

      const found = findRoute('GET', '/api/pipeline/proj_123/assets/..')!;
      const req = createMockRequest('', 'GET', '/api/pipeline/proj_123/assets/..');
      const res = createMockResponse();
      await found.route.handler(req, res, found.match);
      expect(res._status).toBe(403);
      rmSync(tempDir, { recursive: true, force: true });
    });
  });

  /* ---- Global asset serving ---- */
  describe('GET /api/assets/:path', () => {
    it('returns 404 for missing global asset', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'global-asset-'));
      mkdirSync(join(tempDir, 'assets'), { recursive: true });
      svc.getDataDir.mockReturnValue(tempDir);

      const found = findRoute('GET', '/api/assets/nope.png')!;
      const req = createMockRequest('', 'GET', '/api/assets/nope.png');
      const res = createMockResponse();
      await found.route.handler(req, res, found.match);
      expect(res._status).toBe(404);
      rmSync(tempDir, { recursive: true, force: true });
    });

    it('blocks path traversal in global assets', async () => {
      const tempDir = mkdtempSync(join(tmpdir(), 'global-asset-'));
      mkdirSync(join(tempDir, 'assets'), { recursive: true });
      svc.getDataDir.mockReturnValue(tempDir);

      const found = findRoute('GET', '/api/assets/..%2F..%2Fetc%2Fpasswd')!;
      const req = createMockRequest('', 'GET', '/api/assets/..%2F..%2Fetc%2Fpasswd');
      const res = createMockResponse();
      await found.route.handler(req, res, found.match);
      expect(res._status).toBe(403);
      rmSync(tempDir, { recursive: true, force: true });
    });
  });

  /* ---- Trace with analysis ---- */
  describe('Trace analysis endpoints', () => {
    const fakeBundle = {
      projectId: 'proj_123',
      traceId: 'trace_1',
      startedAt: '2024-01-01T00:00:00Z',
      endedAt: '2024-01-01T00:01:00Z',
      events: [],
      status: 'completed',
      stageSummary: {},
    };

    it('GET /api/pipeline/:id/trace returns analysis', async () => {
      svc.getLatestTrace.mockReturnValue(fakeBundle as any);
      svc.getAiLogs.mockReturnValue([]);
      const res = await callRoute('GET', '/api/pipeline/proj_123/trace');
      expect(res._status).toBe(200);
      expect(res._body.bundle).toBeDefined();
      expect(res._body.analysis).toBeDefined();
      expect(res._body.analysis.timeline).toBeDefined();
      expect(res._body.analysis.spanTree).toBeDefined();
    });

    it('GET /api/pipeline/:id/traces/:traceId returns analysis', async () => {
      svc.getTrace.mockReturnValue(fakeBundle as any);
      svc.getAiLogs.mockReturnValue([]);
      const res = await callRoute('GET', '/api/pipeline/proj_123/traces/trace_1');
      expect(res._status).toBe(200);
      expect(res._body.bundle).toBeDefined();
      expect(res._body.analysis.failureSpan).toBeDefined();
    });
  });

  /* ---- Error handling in mutating routes ---- */
  describe('error handling', () => {
    it('PUT /api/pipeline/:id/script returns 400 on update error', async () => {
      svc.updateScript.mockImplementation(() => { throw new Error('Not found'); });
      const res = await callRoute('PUT', '/api/pipeline/proj_123/script', '{"scriptText":"bad"}');
      expect(res._status).toBe(400);
    });

    it('POST approve-scene returns 400 on error', async () => {
      svc.approveScene.mockImplementation(() => { throw new Error('Invalid'); });
      const res = await callRoute('POST', '/api/pipeline/proj_123/scenes/s1/approve');
      expect(res._status).toBe(400);
    });

    it('POST reject-scene returns 400 on error', async () => {
      svc.rejectScene.mockImplementation(() => { throw new Error('Invalid'); });
      const res = await callRoute('POST', '/api/pipeline/proj_123/scenes/s1/reject');
      expect(res._status).toBe(400);
    });

    it('POST regenerate-scene returns 409 for already-regenerating', async () => {
      svc.regenerateScene.mockRejectedValue(new Error('Scene is already being regenerated'));
      const res = await callRoute('POST', '/api/pipeline/proj_123/scenes/s1/regenerate');
      expect(res._status).toBe(409);
    });

    it('POST /api/pipeline/:id/start returns error status from svc', async () => {
      svc.startPipeline.mockReturnValue({ error: 'Not found', status: 404 } as any);
      const res = await callRoute('POST', '/api/pipeline/proj_123/start');
      expect(res._status).toBe(404);
    });

    it('POST /api/pipeline/:id/retry returns error status from svc', async () => {
      svc.retryStage.mockReturnValue({ error: 'Not running', status: 400 } as any);
      const res = await callRoute('POST', '/api/pipeline/proj_123/retry/SCRIPT_GENERATION');
      expect(res._status).toBe(400);
    });

    it('POST /api/pipeline/:id/resume returns error from svc', async () => {
      svc.resumePipeline.mockReturnValue({ error: 'Not paused', status: 400 } as any);
      const res = await callRoute('POST', '/api/pipeline/proj_123/resume');
      expect(res._status).toBe(400);
    });

    it('POST /api/pipeline/:id/pause returns error from svc', async () => {
      svc.requestPause.mockReturnValue({ error: 'Not running', status: 400 } as any);
      const res = await callRoute('POST', '/api/pipeline/proj_123/pause');
      expect(res._status).toBe(400);
    });
  });

  /* ---- Batch operations edge cases ---- */
  it('POST /api/pipeline/batch returns 400 for empty topics', async () => {
    const res = await callRoute('POST', '/api/pipeline/batch', '{"topics":[]}');
    expect(res._status).toBe(400);
  });

  it('POST /api/pipeline/batch/start returns 400 for empty ids', async () => {
    const res = await callRoute('POST', '/api/pipeline/batch/start', '{"projectIds":[]}');
    expect(res._status).toBe(400);
  });

  it('POST /api/pipeline/batch/start returns 200 when all succeed', async () => {
    svc.enqueueProject.mockReturnValue({ ok: true as const, position: 'started' as const });
    const res = await callRoute('POST', '/api/pipeline/batch/start', '{"projectIds":["p1","p2"]}');
    expect(res._status).toBe(200);
    expect(res._body.ok).toBe(true);
    expect(res._body.started).toEqual(['p1', 'p2']);
  });

  /* ---- refine-options ---- */
  describe('refine-options', () => {
    it('GET /api/pipeline/:id/refine-options returns options', async () => {
      (svc as any).getRefineOptions = vi.fn(() => ({ bgmVolume: 0.15, subtitlePreset: 'classic_white' }));
      const res = await callRoute('GET', '/api/pipeline/proj_123/refine-options');
      expect(res._status).toBe(200);
      expect(res._body).toEqual({ bgmVolume: 0.15, subtitlePreset: 'classic_white' });
      expect((svc as any).getRefineOptions).toHaveBeenCalledWith('proj_123');
    });

    it('GET /api/pipeline/:id/refine-options returns 404 for unknown project', async () => {
      const res = await callRoute('GET', '/api/pipeline/nonexistent/refine-options');
      expect(res._status).toBe(404);
    });

    it('PUT /api/pipeline/:id/refine-options updates options', async () => {
      (svc as any).updateRefineOptions = vi.fn((id: string, body: any) => ({ bgmVolume: 0.3, ...body }));
      const res = await callRoute('PUT', '/api/pipeline/proj_123/refine-options', '{"bgmVolume":0.3}');
      expect(res._status).toBe(200);
      expect((svc as any).updateRefineOptions).toHaveBeenCalledWith('proj_123', { bgmVolume: 0.3 });
    });

    it('PUT /api/pipeline/:id/refine-options returns 404 for unknown project', async () => {
      const res = await callRoute('PUT', '/api/pipeline/nonexistent/refine-options', '{"bgmVolume":0.3}');
      expect(res._status).toBe(404);
    });

    it('PUT /api/pipeline/:id/refine-options returns 400 for invalid JSON', async () => {
      const res = await callRoute('PUT', '/api/pipeline/proj_123/refine-options', 'NOT_JSON');
      expect(res._status).toBe(400);
    });
  });

  /* ---- upload-bgm ---- */
  describe('upload-bgm', () => {
    it('POST /api/pipeline/:id/upload-bgm returns 404 for unknown project', async () => {
      const res = await callRoute('POST', '/api/pipeline/nonexistent/upload-bgm', '{}');
      expect(res._status).toBe(404);
    });

    it('POST /api/pipeline/:id/upload-bgm returns 400 when filename missing', async () => {
      const res = await callRoute('POST', '/api/pipeline/proj_123/upload-bgm', '{"data":"abc"}');
      expect(res._status).toBe(400);
      expect(res._body.error).toContain('filename');
    });

    it('POST /api/pipeline/:id/upload-bgm returns 400 when data missing', async () => {
      const res = await callRoute('POST', '/api/pipeline/proj_123/upload-bgm', '{"filename":"test.mp3"}');
      expect(res._status).toBe(400);
      expect(res._body.error).toContain('data');
    });

    it('POST /api/pipeline/:id/upload-bgm rejects disallowed file types', async () => {
      const body = JSON.stringify({ filename: 'malware.exe', data: Buffer.from('fake').toString('base64') });
      const res = await callRoute('POST', '/api/pipeline/proj_123/upload-bgm', body);
      expect(res._status).toBe(400);
      expect(res._body.error).toContain('not allowed');
    });

    it('POST /api/pipeline/:id/upload-bgm accepts allowed audio types', async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'bgm-test-'));
      const projectDir = join(tmpDir, 'projects', 'proj_bgm');
      mkdirSync(projectDir, { recursive: true });
      svc.getProjectDir.mockReturnValue(projectDir);
      svc.loadProject.mockReturnValue({ id: 'proj_bgm', stageStatus: {} } as any);

      const audioData = Buffer.from('fake-audio-content');
      const body = JSON.stringify({ filename: 'my-bgm.mp3', data: audioData.toString('base64') });
      const res = await callRoute('POST', '/api/pipeline/proj_bgm/upload-bgm', body);
      expect(res._status).toBe(200);
      expect(res._body.ok).toBe(true);
      expect(res._body.filename).toBe('bgm.mp3');
      expect(res._body.size).toBe(audioData.length);

      // Verify file was written
      const bgmPath = join(projectDir, 'bgm', 'bgm.mp3');
      expect(readFileSync(bgmPath).toString()).toBe('fake-audio-content');

      // Cleanup
      rmSync(tmpDir, { recursive: true, force: true });
    });

    it('POST /api/pipeline/:id/upload-bgm sanitizes path traversal in filename', async () => {
      const tmpDir = mkdtempSync(join(tmpdir(), 'bgm-safe-'));
      const projectDir = join(tmpDir, 'projects', 'proj_safe');
      mkdirSync(projectDir, { recursive: true });
      svc.getProjectDir.mockReturnValue(projectDir);
      svc.loadProject.mockReturnValue({ id: 'proj_safe', stageStatus: {} } as any);

      const body = JSON.stringify({
        filename: '../../../etc/passwd.wav',
        data: Buffer.from('safe').toString('base64'),
      });
      const res = await callRoute('POST', '/api/pipeline/proj_safe/upload-bgm', body);
      // Should succeed because basename() strips path traversal and file goes to bgm/bgm.wav
      expect(res._status).toBe(200);
      expect(res._body.filename).toBe('bgm.wav');

      rmSync(tmpDir, { recursive: true, force: true });
    });
  });
});
