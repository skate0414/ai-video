import type { Account, ChatMode, ModelOption, ProviderId, ProviderInfo, TaskItem, WorkbenchState, PipelineProject, PipelineScene, QualityTier, PipelineStage, ModelOverrides, EnvironmentStatus, TTSSettings, VideoProviderConfig, SiteAutomationConfig } from '../types';

/** Detect API base — Vite proxy in dev, direct backend in Tauri. */
function getApiBase(): string {
  if (typeof window !== 'undefined' &&
    (window.location.protocol === 'tauri:' ||
     (window.location.protocol === 'https:' && window.location.hostname === 'tauri.localhost'))) {
    return 'http://127.0.0.1:3220/api';
  }
  return '/api';
}

const BASE = getApiBase();

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...init?.headers },
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${await res.text()}`);
  return res.json() as Promise<T>;
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

  addProviderFromUrl: (chatUrl: string) =>
    request<{ providerId: string; accountId: string }>('/providers/from-url', {
      method: 'POST',
      body: JSON.stringify({ chatUrl }),
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

  createProject: (topic: string, title?: string, qualityTier?: QualityTier) =>
    request<PipelineProject>('/pipeline', {
      method: 'POST',
      body: JSON.stringify({ topic, title, qualityTier }),
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

  retryStage: (projectId: string, stage: PipelineStage) =>
    request<{ ok: boolean }>(`/pipeline/${projectId}/retry/${stage}`, { method: 'POST' }),

  regenerateScene: (projectId: string, sceneId: string) =>
    request<PipelineScene>(`/pipeline/${projectId}/scenes/${sceneId}/regenerate`, { method: 'POST' }),

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

  rejectScene: (projectId: string, sceneId: string) =>
    request<PipelineProject>(`/pipeline/${projectId}/scenes/${sceneId}/reject`, { method: 'POST' }),

  qaOverride: (projectId: string, feedback?: string) =>
    request<PipelineProject>(`/pipeline/${projectId}/qa-override`, {
      method: 'POST',
      body: JSON.stringify({ feedback }),
    }),

  approveReferenceImages: (projectId: string) =>
    request<PipelineProject>(`/pipeline/${projectId}/approve-reference`, { method: 'POST' }),

  setStyleProfile: (projectId: string, data: { pastedText?: string; styleProfile?: any; topic?: string }) =>
    request<PipelineProject>(`/pipeline/${projectId}/style-profile`, {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  updateModelOverrides: (projectId: string, modelOverrides: ModelOverrides) =>
    request<PipelineProject>(`/pipeline/${projectId}/overrides`, {
      method: 'PUT',
      body: JSON.stringify({ modelOverrides }),
    }),

  getConfig: () =>
    request<{ qualityTier: QualityTier; hasApiKey: boolean; productionConcurrency: number }>('/config'),

  updateConfig: (data: { geminiApiKey?: string; qualityTier?: QualityTier; productionConcurrency?: number }) =>
    request<{ ok: boolean; qualityTier: QualityTier; hasApiKey: boolean }>('/config', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

  getVideoUrl: (projectId: string) => `/api/pipeline/${projectId}/video`,

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
    request<{ needsSetup: boolean; dataDir: string; hasApiKey: boolean; accountCount: number; ffmpegAvailable: boolean }>('/setup/status'),

  completeSetup: (data: { geminiApiKey?: string }) =>
    request<{ ok: boolean }>('/setup/complete', {
      method: 'POST',
      body: JSON.stringify(data),
    }),

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

  // ---- Provider Presets ----
  listPresets: () =>
    request<Array<{ id: string; label: string; type: string }>>('/presets'),

  getPreset: (id: string) =>
    request<SiteAutomationConfig>(`/presets/${encodeURIComponent(id)}`),
};
