import type { PipelineEvent } from '../../shared/types';

/* ---- Workbench types (single source of truth: shared/types.ts) ---- */

export type {
  ProviderId,
  ChatMode,
  ProviderInfo,
  Account,
  ModelOption,
  TaskItem,
  WorkbenchState,
} from '../../shared/types';

export type WorkbenchEvent =
  | { type: 'state'; payload: import('../../shared/types').WorkbenchState }
  | { type: 'task_started'; payload: { taskId: string; accountId: string } }
  | { type: 'task_done'; payload: { taskId: string; answer: string } }
  | { type: 'task_failed'; payload: { taskId: string; error: string } }
  | { type: 'quota_exhausted'; payload: { accountId: string } }
  | { type: 'account_switched'; payload: { fromAccountId: string; toAccountId: string } }
  | { type: 'login_browser_opened'; payload: { accountId: string } }
  | { type: 'login_browser_closed'; payload: { accountId: string } }
  | { type: 'stopped'; payload: Record<string, never> }
  // Pipeline events (re-use PipelineEvent union members)
  | PipelineEvent;

/* ---- Pipeline types (single source of truth: shared/types.ts) ---- */

export type {
  PipelineStage,
  ProcessStatus,
  QualityTier,
  ModelOverride,
  ModelOverrides,
  LogEntry as PipelineLogEntry,
  PipelineScene,
  PipelineProject,
  PipelineEvent,
} from '../../shared/types';

/* ---- Settings types ---- */

export interface EnvironmentStatus {
  ffmpegAvailable: boolean;
  edgeTtsAvailable: boolean;
  playwrightAvailable: boolean;
  nodeVersion: string;
  platform: string;
  dataDir: string;
}

export interface TTSSettings {
  voice?: string;
  rate?: string;
  pitch?: string;
}

export interface VideoProviderConfig {
  url: string;
  promptInput: string;
  imageUploadTrigger?: string;
  generateButton: string;
  progressIndicator?: string;
  videoResult: string;
  downloadButton?: string;
  maxWaitMs?: number;
  profileDir: string;
}
