/* ------------------------------------------------------------------ */
/*  PassRegistry – declarative compilation pass definitions          */
/* ------------------------------------------------------------------ */

import type {
  AIAdapter, PipelineProject, PipelineStage, PipelineEvent, LogEntry, ModelOverrides,
  StyleProfile, Scene,
} from './pipelineTypes.js';
import type { ProjectStore } from './projectStore.js';
import type { ProviderCapabilityRegistry } from './providerRegistry.js';
import type { PipelineServices } from './pipelineServices.js';
import type { VideoProviderConfig } from './videoProvider.js';

export interface StageRunContext {
  project: PipelineProject;
  projectId: string;
  assetsDir: string;
  getAdapter: (stage: PipelineStage, taskType: string, overrides?: ModelOverrides) => AIAdapter;
  getSessionAwareAdapter: (stage: PipelineStage, taskType: string, overrides?: ModelOverrides) => AIAdapter;
  addLog: (entry: LogEntry) => void;
  saveArtifact: (filename: string, data: unknown) => void;
  loadArtifact: <T>(filename: string) => T | undefined;
  isAborted: () => boolean;
  abortSignal?: AbortSignal;
  config: StageRunConfig;
  emitEvent: (event: PipelineEvent) => void;
  providerRegistry: ProviderCapabilityRegistry;
  regenerateScene: (projectId: string, sceneId: string) => Promise<Scene>;
  services?: PipelineServices;
}

export interface StageRunConfig {
  videoProviderConfig?: VideoProviderConfig;
  videoModel?: string;
  videoResolution?: '720p' | '1080p';
  productionConcurrency: number;
  ttsConfig?: { voice?: string; rate?: string; pitch?: string };
  aivideomakerAdapters?: AIAdapter[];
}

export interface StageDefinition {
  stage: PipelineStage;
  after?: PipelineStage | readonly PipelineStage[];
  before?: PipelineStage | readonly PipelineStage[];
  execute: (ctx: StageRunContext) => Promise<void>;
}

const registry: StageDefinition[] = [];

export function registerStage(def: StageDefinition): void {
  const existingIdx = registry.findIndex(d => d.stage === def.stage);
  if (existingIdx >= 0) {
    registry[existingIdx] = def;
    return;
  }
  registry.push(def);
}

function toArray<T>(v: T | readonly T[] | undefined): readonly T[] {
  if (v === undefined) return [];
  return Array.isArray(v) ? v : [v as T];
}

function sortRegistry(defs: readonly StageDefinition[]): StageDefinition[] {
  const byStage = new Map<PipelineStage, StageDefinition>();
  defs.forEach(d => byStage.set(d.stage, d));

  const rank = new Map<PipelineStage, number>();
  defs.forEach((d, i) => rank.set(d.stage, i));

  const edges = new Map<PipelineStage, Set<PipelineStage>>();
  const inDegree = new Map<PipelineStage, number>();
  defs.forEach(d => {
    edges.set(d.stage, new Set());
    inDegree.set(d.stage, 0);
  });

  const addEdge = (from: PipelineStage, to: PipelineStage) => {
    if (!byStage.has(from) || !byStage.has(to)) return;
    if (from === to) return;
    const outbound = edges.get(from);
    if (outbound && !outbound.has(to)) {
      outbound.add(to);
      inDegree.set(to, (inDegree.get(to) ?? 0) + 1);
    }
  };

  for (const d of defs) {
    for (const target of toArray(d.after)) addEdge(target, d.stage);
    for (const target of toArray(d.before)) addEdge(d.stage, target);
  }

  const pending = [...defs]
    .filter(d => (inDegree.get(d.stage) ?? 0) === 0)
    .sort((a, b) => (rank.get(a.stage) ?? 0) - (rank.get(b.stage) ?? 0));

  const out: StageDefinition[] = [];
  while (pending.length > 0) {
    pending.sort((a, b) => (rank.get(a.stage) ?? 0) - (rank.get(b.stage) ?? 0));
    const next = pending.shift()!;
    out.push(next);
    for (const succ of edges.get(next.stage) ?? []) {
      const remaining = (inDegree.get(succ) ?? 0) - 1;
      inDegree.set(succ, remaining);
      if (remaining === 0) {
        const def = byStage.get(succ);
        if (def) pending.push(def);
      }
    }
  }

  if (out.length !== defs.length) {
    const missing = defs.filter(d => !out.includes(d)).map(d => d.stage);
    throw new Error(
      `Cycle detected in stage ordering constraints. ` +
      `Unable to place: ${missing.join(', ')}.`,
    );
  }
  return out;
}

export function getStageDefinitions(): readonly StageDefinition[] {
  return sortRegistry(registry);
}

export function getStageOrder(): PipelineStage[] {
  return getStageDefinitions().map(d => d.stage);
}

export function __resetRegistryForTests(): void {
  registry.length = 0;
}

export function __getRegistrySizeForTests(): number {
  return registry.length;
}

export function __truncateRegistryForTests(size: number): void {
  if (size < 0 || size > registry.length) return;
  registry.length = size;
}
