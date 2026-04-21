import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { ConfigStore } from './configStore.js';
import type { VideoProviderConfig } from './videoProvider.js';
import type { QueueDetectionConfig } from './runtimeTypes.js';
import {
  DEFAULT_REFINE_OPTIONS,
  packagingStyleToRefineOptions,
} from './types/domain/refine.js';
import {
  deleteQueueDetectionOverride,
  getQueueDetectionPresets,
  saveQueueDetectionOverrides,
} from './providerPresets.js';
import type { PipelineOrchestrator } from './orchestrator.js';
import type { AIVideoMakerAdapter } from './aivideomakerAdapter.js';
import { AIVideoMakerAdapter as AIVideoMakerAdapterCtor } from './aivideomakerAdapter.js';
import type { Logger } from '@ai-video/pipeline-core/libFacade.js';
import type { CoreRefineOptions } from './types/domain/refine.js';
import { toCoreRefineOptions, toSharedRefineOptions } from './types/domain/refine.js';

export interface ConfigRuntimeDeps {
  configStore: ConfigStore;
  aivideomakerAdapters: AIVideoMakerAdapter[];
  onApiKeysChanged?: (keys: { aivideomakerApiKeys?: string[] }) => void;
  rebuildOrchestrator: () => void;
}

export function getProviderCount(orchestrator: PipelineOrchestrator): number {
  return orchestrator.providerRegistry.getAll().length;
}

export function getApiResourceCount(accounts: Array<{ profileDir?: string }>): number {
  return accounts.filter(a => !a.profileDir).length;
}

export function hasApiKey(): boolean {
  return false;
}

function notifyApiKeysChanged(deps: ConfigRuntimeDeps): void {
  if (!deps.onApiKeysChanged) return;
  deps.onApiKeysChanged({
    aivideomakerApiKeys: deps.aivideomakerAdapters
      .map(a => (a as any).apiKey as string)
      .filter(Boolean),
  });
}

export function completeSetup(
  deps: ConfigRuntimeDeps,
  body: { aivideomakerApiKey?: string },
): { ok: true } {
  if (body.aivideomakerApiKey) {
    const existing = deps.aivideomakerAdapters.some(a => (a as any).apiKey === body.aivideomakerApiKey);
    if (!existing) deps.aivideomakerAdapters.push(new AIVideoMakerAdapterCtor(body.aivideomakerApiKey));
    deps.configStore.update({ aivideomakerApiKey: body.aivideomakerApiKey });
  }
  notifyApiKeysChanged(deps);
  return { ok: true };
}

export function getConfig(configStore: ConfigStore): { productionConcurrency: number; videoProviderConfig?: VideoProviderConfig } {
  const saved = configStore.get();
  const vpConfig = saved.videoProviderConfig;
  const profileDirs = vpConfig?.profileDirs?.length
    ? vpConfig.profileDirs
    : vpConfig?.profileDir
      ? [vpConfig.profileDir]
      : [];
  return {
    productionConcurrency: saved.productionConcurrency ?? 2,
    videoProviderConfig: profileDirs.length > 0 ? { ...vpConfig, profileDirs } as VideoProviderConfig : undefined,
  };
}

export function updateConfig(
  deps: ConfigRuntimeDeps,
  body: { aivideomakerApiKey?: string; productionConcurrency?: number },
): { ok: true } {
  if (body.aivideomakerApiKey) {
    const existing = deps.aivideomakerAdapters.some(a => (a as any).apiKey === body.aivideomakerApiKey);
    if (!existing) deps.aivideomakerAdapters.push(new AIVideoMakerAdapterCtor(body.aivideomakerApiKey));
  }
  deps.configStore.update({
    aivideomakerApiKey: body.aivideomakerApiKey || undefined,
    ...(body.productionConcurrency !== undefined ? { productionConcurrency: body.productionConcurrency } : {}),
  });
  deps.rebuildOrchestrator();
  notifyApiKeysChanged(deps);
  return { ok: true };
}

export function getVideoProviderConfig(
  configStore: ConfigStore,
  getVideoConfig?: () => VideoProviderConfig | null,
): VideoProviderConfig | null {
  return getVideoConfig?.() ?? configStore.get().videoProviderConfig ?? null;
}

export function updateVideoProviderConfig(
  configStore: ConfigStore,
  rebuildOrchestrator: () => void,
  config: VideoProviderConfig | null,
): void {
  configStore.update({ videoProviderConfig: config ?? undefined });
  rebuildOrchestrator();
}

export function getTtsConfig(configStore: ConfigStore): unknown {
  return configStore.get().ttsConfig ?? {};
}

export function updateTtsConfig(configStore: ConfigStore, config: any): void {
  configStore.update({ ttsConfig: config });
}

export function readQueueDetectionPresets(): Record<string, QueueDetectionConfig> {
  return getQueueDetectionPresets();
}

export function writeQueueDetectionPresets(overrides: Record<string, QueueDetectionConfig>): void {
  saveQueueDetectionOverrides(overrides);
}

export function removeQueueDetectionPreset(providerId: string): boolean {
  return deleteQueueDetectionOverride(providerId);
}

export function getRefineOptions(
  orchestrator: PipelineOrchestrator,
  projectId: string,
): CoreRefineOptions {
  const projectDir = orchestrator.getProjectDir(projectId);
  const optionsPath = join(projectDir, 'refine-options.json');

  let smartDefaults: Partial<CoreRefineOptions> = {};
  try {
    const cirPath = join(projectDir, 'style-analysis.cir.json');
    if (existsSync(cirPath)) {
      const styleCIR = JSON.parse(readFileSync(cirPath, 'utf-8'));
      const { options } = packagingStyleToRefineOptions(
        styleCIR.packagingTrack,
        styleCIR.confidence,
        styleCIR.audioTrack?.bgmRelativeVolume,
      );
      smartDefaults = options;
    }
  } catch {
    // fallback
  }

  const base = toCoreRefineOptions({ ...DEFAULT_REFINE_OPTIONS, ...smartDefaults });
  if (!existsSync(optionsPath)) return base;
  try {
    const saved = JSON.parse(readFileSync(optionsPath, 'utf-8'));
    return toCoreRefineOptions({ ...base, ...saved });
  } catch {
    return base;
  }
}

export function getRefineProvenance(orchestrator: PipelineOrchestrator, projectId: string): string[] {
  const projectDir = orchestrator.getProjectDir(projectId);
  try {
    const cirPath = join(projectDir, 'style-analysis.cir.json');
    if (!existsSync(cirPath)) return [];
    const styleCIR = JSON.parse(readFileSync(cirPath, 'utf-8'));
    const { provenance } = packagingStyleToRefineOptions(
      styleCIR.packagingTrack,
      styleCIR.confidence,
      styleCIR.audioTrack?.bgmRelativeVolume,
    );
    return [...provenance];
  } catch {
    return [];
  }
}

export function getRefineReferenceDefaults(
  orchestrator: PipelineOrchestrator,
  projectId: string,
): CoreRefineOptions {
  const projectDir = orchestrator.getProjectDir(projectId);
  let smartDefaults: Partial<CoreRefineOptions> = {};
  try {
    const cirPath = join(projectDir, 'style-analysis.cir.json');
    if (existsSync(cirPath)) {
      const styleCIR = JSON.parse(readFileSync(cirPath, 'utf-8'));
      const { options } = packagingStyleToRefineOptions(
        styleCIR.packagingTrack,
        styleCIR.confidence,
        styleCIR.audioTrack?.bgmRelativeVolume,
      );
      smartDefaults = options;
    }
  } catch {
    // fallback
  }
  return toCoreRefineOptions({ ...DEFAULT_REFINE_OPTIONS, ...smartDefaults });
}

export function updateRefineOptions(
  orchestrator: PipelineOrchestrator,
  projectId: string,
  options: Partial<CoreRefineOptions>,
): CoreRefineOptions {
  const projectDir = orchestrator.getProjectDir(projectId);
  const optionsPath = join(projectDir, 'refine-options.json');
  const current = getRefineOptions(orchestrator, projectId);
  const updated = { ...current, ...options };
  writeFileSync(optionsPath, JSON.stringify(toSharedRefineOptions(updated), null, 2), 'utf-8');
  return updated;
}

export function startReAssembly(
  orchestrator: PipelineOrchestrator,
  projectId: string,
  log: Logger,
): void {
  const project = orchestrator.loadProject(projectId);
  if (!project) throw new Error(`Project ${projectId} not found`);
  const refineOptions = getRefineOptions(orchestrator, projectId);
  const projectDir = orchestrator.getProjectDir(projectId);
  const bgmDir = join(projectDir, 'bgm');
  let bgmPath: string | undefined;
  if (existsSync(bgmDir)) {
    const files = readdirSync(bgmDir);
    const bgmFile = files.find(f => f.startsWith('bgm.'));
    if (bgmFile) bgmPath = join(bgmDir, bgmFile);
  }
  (project as any).refineOptions = refineOptions;
  if (bgmPath) (project as any).bgmPath = bgmPath;
  orchestrator.saveProject(project);
  orchestrator.retryStage(projectId, 'ASSEMBLY').catch((err) => {
    log.error('re_assembly_failed', err, { projectId });
  });
}
