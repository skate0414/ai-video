import type { Account, AiResource, AiResourceType, ChatMode, ModelOption, ProviderId, ProviderInfo, TaskItem, WorkbenchState, PipelineProject, PipelineScene, PipelineStage, ModelOverrides, StageProviderOverrides, StageProviderMap, EnvironmentStatus, TTSSettings, VideoProviderConfig, SiteAutomationConfig } from '../types';
import { BACKEND_ORIGIN } from '../config';
import { logger } from '../lib/logger';

/** Detect API base — Vite proxy in dev, direct backend in Electron/desktop. */
function getApiBase(): string {
  if (typeof window !== 'undefined' &&
    (window.location.protocol === 'file:' ||
     window.location.protocol === 'app:')) {
    return `${BACKEND_ORIGIN}/api`;
  }
  return '/api';
}

const BASE = getApiBase();
const DEFAULT_TIMEOUT_MS = 30_000;

async function request<T>(path: string, init?: RequestInit & { timeoutMs?: number }): Promise<T> {
  const method = init?.method ?? 'GET';
  const timeoutMs = init?.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const timer = logger.time('api', `${method} ${path}`);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

  // Allow caller to also abort via their own signal
  if (init?.signal) {
    init.signal.addEventListener('abort', () => controller.abort());
  }

  try {
    const { timeoutMs: _, ...fetchInit } = init ?? {};
    const res = await fetch(`${BASE}${path}`, {
      ...fetchInit,
      signal: controller.signal,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
    if (!res.ok) {
      const body = await res.text();
      timer.fail({ method, path, status: res.status, error: body });
      throw new Error(`API ${res.status}: ${body}`);
    }
    timer.end({ method, path, status: res.status });
    return res.json() as Promise<T>;
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') {
      timer.fail({ method, path, error: 'timeout' });
      throw new Error(`API timeout after ${timeoutMs}ms: ${method} ${path}`);
    }
    if (!(err instanceof Error && err.message.startsWith('API '))) {
      timer.fail({ method, path, error: err instanceof Error ? err.message : String(err) });
    }
    throw err;
  } finally {
    clearTimeout(timeoutId);
  }
}

export const api = {
  getState: () => request<WorkbenchState>('/state'),

  addTasks: (questions: string[], preferredProvider?: ProviderId, preferredModel?: string, attachments?: string[]) =>
    request<TaskItem[]>('/tasks', {
      method: 'POST',
      body: JSON.stringify({ questions, preferredProvider, preferredModel, attachments }),
    }),

  removeTask: (taskId: string) =>
    request<{ ok: boolean }>(`/tasks/${taskId}`, { method: 'DELETE' }),

  clearTasks: () =>
    request<{ ok: boolean }>('/tasks/clear', { method: 'POST' }),

  addAccount: (provider: ProviderId, label: string, profileDir: string) =>
    request<Account>('/accounts', {
      method: 'POST',
      body: JSON.stringify({ provider, label, profileDir }),
    }),

  removeAccount: (accountId: string) =>
    request<{ ok: boolean }>(`/accounts/${accountId}`, { method: 'DELETE' }),

  resetQuotas: () =>
    request<{ ok: boolean }>('/accounts/reset-quotas', { method: 'POST' }),

  openLoginBrowser: (accountId: string) =>
    request<{ ok: boolean }>(`/accounts/${accountId}/login`, { method: 'POST' }),

  closeLoginBrowser: (accountId: string) =>
    request<{ ok: boolean }>(`/accounts/${accountId}/close-login`, { method: 'POST' }),

  // ---- Unified Resources ----
  getResources: () =>
    request<AiResource[]>('/resources'),

  getResourcesByType: (type: AiResourceType) =>
    request<AiResource[]>(`/resources/by-type/${type}`),

  addResource: (resource: { type: AiResourceType; provider: string; label: string; siteUrl: string; profileDir: string; capabilities: Record<string, boolean> }) =>
    request<AiResource>('/resources', {
      method: 'POST',
      body: JSON.stringify(resource),
    }),

  removeResource: (resourceId: string) =>
    request<{ ok: boolean }>(`/resources/${resourceId}`, { method: 'DELETE' }),

  loginResource: (resourceId: string) =>
    request<{ ok: boolean }>(`/resources/${resourceId}/login`, { method: 'POST' }),

  closeResourceLogin: (resourceId: string) =>
    request<{ ok: boolean }>(`/resources/${resourceId}/close-login`, { method: 'POST' }),

  resetResourceQuotas: () =>
    request<{ ok: boolean }>('/resources/reset-quotas', { method: 'POST' }),

  start: () => request<{ ok: boolean }>('/start', { method: 'POST' }),

  stop: () => request<{ ok: boolean }>('/stop', { method: 'POST' }),

  setChatMode: (mode: ChatMode) =>
    request<{ ok: boolean }>('/chat-mode', {
      method: 'POST',
      body: JSON.stringify({ mode }),
    }),

  getProviders: () =>
    request<Array<{ id: ProviderId; selectors: Record<string, string>; models: ModelOption[] }>>('/providers'),

  addProvider: (id: string, label: string, selectors: Record<string, string>) =>
    request<ProviderInfo>('/providers', {
      method: 'POST',
      body: JSON.stringify({ id, label, selectors }),
    }),

  addProviderFromUrl: (chatUrl: string, type?: string) =>
    request<{ providerId: string; accountId: string }>('/providers/from-url', {
      method: 'POST',
      body: JSON.stringify({ chatUrl, type }),
    }),

  removeProvider: (id: string) =>
    request<{ ok: boolean }>(`/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }),

  getModels: (provider: ProviderId) =>
    request<ModelOption[]>(`/models/${provider}`),

  detectModels: (provider: ProviderId) =>
    request<ModelOption[]>(`/models/${provider}`, { method: 'POST' }),

  uploadFiles: (files: Array<{ name: string; data: string }>) =>
    request<{ paths: string[] }>('/upload', {
      method: 'POST',
      body: JSON.stringify({ files }),
    }),

  // ---- Pipeline ----
  listProjects: () =>
    request<PipelineProject[]>('/pipeline'),

  createProject: (topic: string, title?: string) =>
    request<PipelineProject>('/pipeline', {
      method: 'POST',
      body: JSON.stringify({ topic, title }),
    }),

  getProject: (projectId: string) =>
    request<PipelineProject>(`/pipeline/${projectId}`),

  deleteProject: (projectId: string) =>
    request<{ ok: boolean }>(`/pipeline/${projectId}`, { method: 'DELETE' }),

  startPipeline: (projectId: string, videoFilePath?: string) =>
    request<{ ok: boolean; projectId: string }>(`/pipeline/${projectId}/start`, {
      method: 'POST',
      body: JSON.stringify({ videoFilePath }),
    }),

  stopPipeline: (projectId: string) =>
    request<{ ok: boolean }>(`/pipeline/${projectId}/stop`, { method: 'POST' }),

  retryStage: (projectId: string, stage: PipelineStage, directive?: string) =>
    request<{ ok: boolean }>(`/pipeline/${projectId}/retry/${stage}`, {
      method: 'POST',
      body: JSON.stringify({ directive }),
    }),

  getEta: (projectId: string) =>
    request<{ etaMs: number | null; completedMs?: number; confidence?: 'high' | 'low' }>(`/pipeline/${projectId}/eta`),

  regenerateScene: (projectId: string, sceneId: string, feedback?: string) =>
    request<PipelineScene>(`/pipeline/${projectId}/scenes/${sceneId}/regenerate`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),

  resumePipeline: (projectId: string) =>
    request<{ ok: boolean }>(`/pipeline/${projectId}/resume`, { method: 'POST' }),

  updateScript: (projectId: string, scriptText: string) =>
    request<PipelineProject>(`/pipeline/${projectId}/script`, {
      method: 'PUT',
      body: JSON.stringify({ scriptText }),
    }),

  updateScenes: (projectId: string, scenes: PipelineScene[]) =>
    request<PipelineProject>(`/pipeline/${projectId}/scenes`, {
      method: 'PUT',
      body: JSON.stringify({ scenes }),
    }),

  approveScene: (projectId: string, sceneId: string) =>
    request<PipelineProject>(`/pipeline/${projectId}/scenes/${sceneId}/approve`, { method: 'POST' }),

  rejectScene: (projectId: string, sceneId: string, reason?: string) =>
    request<PipelineProject>(`/pipeline/${projectId}/scenes/${sceneId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    }),

  qaOverride: (projectId: string, feedback?: string) =>
    request<PipelineProject>(`/pipeline/${projectId}/qa-override`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),

  approveReferenceImages: (projectId: string) =>
    request<PipelineProject>(`/pipeline/${projectId}/approve-reference`, { method: 'POST' }),

  setStyleProfile: (projectId: string, data: { pastedText?: string; styleProfile?: any; topic?: string; formatSignature?: Record<string, unknown> }) =>
    request<PipelineProject>(`/pipeline/${projectId}/style-profile`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateModelOverrides: (projectId: string, modelOverrides: ModelOverrides) =>
    request<PipelineProject>(`/pipeline/${projectId}/overrides`, {
      method: 'PUT',
      body: JSON.stringify({ modelOverrides }),
    }),

  getStageProviders: () =>
    request<StageProviderMap>('/pipeline/stage-providers'),

  updateStageProviderOverrides: (projectId: string, stageProviderOverrides: StageProviderOverrides) =>
    request<PipelineProject>(`/pipeline/${projectId}/stage-overrides`, {
      method: 'PUT',
      body: JSON.stringify({ stageProviderOverrides }),
    }),

  getConfig: () =>
    request<{ productionConcurrency: number }>('/config'),

  updateConfig: (data: { aivideomakerApiKey?: string; productionConcurrency?: number }) =>
    request<{ ok: boolean }>('/config', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getVideoUrl: (projectId: string) => `/api/pipeline/${projectId}/video`,
  getVideoDownloadUrl: (projectId: string) => `/api/pipeline/${projectId}/video?dl=1`,

  // ---- Resource Planning ----
  getResourcePlan: (projectId: string) =>
    request<any>(`/pipeline/${projectId}/resource-plan`),

  getProviderCapabilities: () =>
    request<Record<string, any>>('/providers/capabilities'),

  updateProviderCapability: (providerId: string, data: Record<string, any>) =>
    request<any>(`/providers/${encodeURIComponent(providerId)}/capabilities`, {
      method: 'PUT',
      body: JSON.stringify(data),
    }),

  getSessions: () =>
    request<any[]>('/sessions'),

  // ---- Export / Import ----
  exportProject: (projectId: string) =>
    request<Record<string, any>>(`/pipeline/${projectId}/export`),

  importProject: (bundle: Record<string, any>) =>
    request<PipelineProject>('/pipeline/import', {
      method: 'POST',
      body: JSON.stringify(bundle),
    }),

  getDataDir: () =>
    request<{ dataDir: string }>('/data-dir'),

  // ---- Setup / first-run ----
  getSetupStatus: () =>
    request<{ needsSetup: boolean; dataDir: string; hasApiKey: boolean; accountCount: number; ffmpegAvailable: boolean; edgeTtsAvailable: boolean; playwrightAvailable: boolean; chromiumAvailable: boolean; nodeVersion: string; platform: string }>('/setup/status'),

  completeSetup: (data: { aivideomakerApiKey?: string }) =>
    request<{ ok: boolean }>('/setup/complete', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  installBrowser: () =>
    fetch(`${BASE}/setup/install-browser`, { method: 'POST' }),

  // ---- Extended config (settings page) ----
  getEnvironment: () =>
    request<EnvironmentStatus>('/config/environment'),

  getTtsConfig: () =>
    request<TTSSettings>('/config/tts'),

  updateTtsConfig: (data: TTSSettings) =>
    request<{ ok: boolean; ttsConfig: TTSSettings }>('/config/tts', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getTtsVoices: (locale?: string) =>
    request<{ voices: string[] }>(`/config/tts/voices${locale ? `?locale=${encodeURIComponent(locale)}` : ''}`),

  getVideoProviderConfig: () =>
    request<VideoProviderConfig | null>('/config/video-provider'),

  updateVideoProviderConfig: (data: VideoProviderConfig | null) =>
    request<{ ok: boolean; videoProviderConfig: VideoProviderConfig | null }>('/config/video-provider', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  // ---- Queue Detection ----
  getQueueDetectionPresets: () =>
    request<Record<string, import('../types').QueueDetectionConfig>>('/config/queue-detection'),

  updateQueueDetectionPresets: (data: Record<string, import('../types').QueueDetectionConfig>) =>
    request<{ ok: boolean; queueDetection: Record<string, import('../types').QueueDetectionConfig> }>('/config/queue-detection', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  deleteQueueDetectionPreset: (providerId: string) =>
    request<{ ok: boolean }>(`/config/queue-detection/${encodeURIComponent(providerId)}`, {
      method: 'DELETE',
    }),

  // ---- Provider Presets ----
  listPresets: () =>
    request<Array<{ id: string; label: string; type: string }>>('/presets'),

  getPreset: (id: string) =>
    request<SiteAutomationConfig>(`/presets/${encodeURIComponent(id)}`),

  // ---- Provider Summary (dashboard) ----
  getProviderSummary: () =>
    request<{ providers: any; sessions: any[] }>('/providers/summary'),

  // ---- Route Table ----
  getRouteTable: () =>
    request<Array<{ stage: string; taskType: string; adapter: string; provider?: string; model?: string; reason: string }>>('/config/route-table'),

  // ---- Style Templates ----
  listStyleTemplates: () =>
    request<Array<{ id: string; name: string; topic: string; createdAt: string }>>('/style-templates'),

  getStyleTemplate: (id: string) =>
    request<{ id: string; name: string; topic: string; createdAt: string; styleProfile: Record<string, unknown>; formatSignature?: Record<string, unknown> }>(`/style-templates/${id}`),

  saveStyleTemplate: (name: string, topic: string, styleProfile: Record<string, unknown>, formatSignature?: Record<string, unknown>) =>
    request<{ id: string; name: string }>('/style-templates', {
      method: 'POST',
      body: JSON.stringify({ name, topic, styleProfile, formatSignature }),
    }),

  deleteStyleTemplate: (id: string) =>
    request<{ ok: boolean }>(`/style-templates/${id}`, { method: 'DELETE' }),

  // ---- Cost tracking ----
  getGlobalCosts: () =>
    request<import('../types').GlobalCostSummary>('/costs'),

  // ---- Video provider health ----
  getVideoProviderHealth: () =>
    request<Array<{ providerId: string; label: string; siteUrl: string; status: string; healthScore: number; consecutiveFailures: number }>>('/providers/video-health'),

  // ---- Pipeline Artifacts ----
  loadArtifact: <T = unknown>(projectId: string, filename: string) =>
    request<T>(`/pipeline/${projectId}/artifacts/${encodeURIComponent(filename)}`),

  updateArtifact: (projectId: string, filename: string, data: unknown) =>
    request<{ ok: boolean }>(`/pipeline/${projectId}/artifacts/${encodeURIComponent(filename)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    }),

  // ---- Trace Replay ----
  listTraces: (projectId: string) =>
    request<Array<{ traceId: string; startedAt: string; outcome: string; durationMs?: number }>>(`/pipeline/${projectId}/traces`),

  getLatestTrace: (projectId: string) =>
    request<{ bundle: import('../types').TraceReplayBundle; analysis: import('../types').TraceAnalysis }>(`/pipeline/${projectId}/trace`),

  getTrace: (projectId: string, traceId: string) =>
    request<{ bundle: import('../types').TraceReplayBundle; analysis: import('../types').TraceAnalysis }>(`/pipeline/${projectId}/traces/${traceId}`),

  getAiLogs: (projectId: string) =>
    request<import('../types').AiLogEntry[]>(`/pipeline/${projectId}/ai-logs`),

  // ---- Prompt overrides ----
  getPromptDefaults: () =>
    request<Record<string, string>>('/prompts/defaults'),

  getProjectPrompts: (projectId: string) =>
    request<Record<string, { default: string; override: string | null; active: string }>>(`/pipeline/${projectId}/prompts`),

  setPromptOverride: (projectId: string, promptName: string, text: string) =>
    request<PipelineProject>(`/pipeline/${projectId}/prompts/${encodeURIComponent(promptName)}`, {
      method: 'PUT',
      body: JSON.stringify({ text }),
    }),

  deletePromptOverride: (projectId: string, promptName: string) =>
    request<PipelineProject>(`/pipeline/${projectId}/prompts/${encodeURIComponent(promptName)}`, {
      method: 'DELETE',
    }),

  // ---- Iteration records ----
  getIterations: (projectId: string) =>
    request<unknown[]>(`/pipeline/${projectId}/iterations`),

  // ---- Video Refinement ----
  uploadBgm: (projectId: string, file: File) => {
    const formData = new FormData();
    formData.append('bgm', file);
    return fetch(`${BASE}/pipeline/${projectId}/upload-bgm`, {
      method: 'POST',
      body: formData,
    }).then(res => res.json() as Promise<{ ok: boolean; filename: string; size: number }>);
  },

  deleteBgm: (projectId: string) =>
    request<{ ok: boolean }>(`/pipeline/${projectId}/bgm`, { method: 'DELETE' }),

  getBgmInfo: (projectId: string) =>
    request<{ hasBgm: boolean; filename?: string; size?: number }>(`/pipeline/${projectId}/bgm`),

  getBgmStreamUrl: (projectId: string) =>
    `${BASE}/pipeline/${projectId}/bgm/stream`,

  getRefineOptions: (projectId: string) =>
    request<import('../types').RefineOptions>(`/pipeline/${projectId}/refine-options`),

  getRefineProvenance: (projectId: string) =>
    request<{ fields: string[] }>(`/pipeline/${projectId}/refine-provenance`),

  getRefineReferenceDefaults: (projectId: string) =>
    request<import('../types').RefineOptions>(`/pipeline/${projectId}/refine-reference-defaults`),

  updateRefineOptions: (projectId: string, options: import('../types').RefineOptions) =>
    request<{ ok: boolean }>(`/pipeline/${projectId}/refine-options`, {
      method: 'PUT',
      body: JSON.stringify(options),
    }),

  reAssemble: (projectId: string) =>
    request<{ ok: boolean }>(`/pipeline/${projectId}/re-assemble`, { method: 'POST' }),

  // ---- BGM Library ----
  listBgmLibrary: () =>
    request<Array<{ filename: string; mood: string; title: string; duration: number | null; size: number }>>('/bgm-library'),

  getBgmLibraryStreamUrl: (filename: string) =>
    `${BASE}/bgm-library/${encodeURIComponent(filename)}/stream`,

  uploadToBgmLibrary: (file: File) => {
    const formData = new FormData();
    formData.append('bgm', file);
    return fetch(`${BASE}/bgm-library/upload`, {
      method: 'POST',
      body: formData,
    }).then(res => res.json() as Promise<{ ok: boolean; filename: string; mood: string; title: string; duration: number | null; size: number }>);
  },

  importBgmFromLibrary: (projectId: string, filename: string) =>
    request<{ ok: boolean; filename: string; size: number }>(`/pipeline/${projectId}/bgm/from-library`, {
      method: 'POST',
      body: JSON.stringify({ filename }),
    }),

  openPixabayBrowser: (mood?: string) =>
    request<{ ok: boolean; tabId?: string; fallbackUrl?: string }>('/bgm-library/open-pixabay', {
      method: 'POST',
      body: JSON.stringify({ mood }),
    }),
};
