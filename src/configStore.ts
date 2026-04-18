/* ------------------------------------------------------------------ */
/*  Config persistence — save/load app configuration to config.json    */
/* ------------------------------------------------------------------ */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { randomBytes } from 'node:crypto';
import type { VideoProviderConfig } from './adapters/videoProvider.js';
import type { FallbackPolicy } from './adapters/fallbackAdapter.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('ConfigStore');

/* ---- Schema Versioning ---- */

/**
 * Current schema version. Bump this and add a migration entry whenever
 * the persisted config shape changes.
 */
export const CURRENT_SCHEMA_VERSION = 2;

/**
 * Migration function: receives the raw JSON object at version N and
 * returns the object upgraded to version N+1.
 */
type Migration = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * Registry of migrations keyed by *source* version.
 * E.g. key 1 → migrates from v1 to v2.
 */
const MIGRATIONS: Record<number, Migration> = {
  // v1 → v2: add _schemaVersion field (no structural changes yet)
  1: (raw) => ({ ...raw, _schemaVersion: 2 }),
};

/**
 * Detect version and run all necessary migrations sequentially.
 * Returns the fully-upgraded raw object.
 */
export function migrateConfig(raw: Record<string, unknown>): Record<string, unknown> {
  let version = typeof raw._schemaVersion === 'number' ? raw._schemaVersion : 1;
  while (version < CURRENT_SCHEMA_VERSION) {
    const migrate = MIGRATIONS[version];
    if (!migrate) {
      log.warn('unknown_schema_version', { version, current: CURRENT_SCHEMA_VERSION });
      break;
    }
    raw = migrate(raw);
    version++;
  }
  raw._schemaVersion = CURRENT_SCHEMA_VERSION;
  return raw;
}

export interface TTSSettings {
  voice?: string;
  rate?: string;
  pitch?: string;
}

export interface AppConfig {
  geminiApiKey?: string;
  aivideomakerApiKey?: string;
  /** Multiple aivideomaker API keys for parallel free-account video gen. */
  aivideomakerApiKeys?: string[];
  ttsConfig?: TTSSettings;
  videoProviderConfig?: VideoProviderConfig;
  productionConcurrency?: number;
  /** Maximum number of projects that run concurrently in batch mode. */
  maxConcurrentProjects?: number;
  /** Controls free→paid fallback behaviour: 'auto' | 'confirm' | 'block' */
  fallbackPolicy?: FallbackPolicy;
  /** Preferred video model label (e.g. '可灵 2.5'). */
  videoModel?: string;
}

const VALID_FALLBACK_POLICIES = new Set(['auto', 'confirm', 'block']);

/**
 * Validate parsed config at runtime — strip invalid fields, log warnings.
 * Returns a cleaned copy.
 */
function validateConfig(raw: Record<string, unknown>): AppConfig {
  const config: AppConfig = {};
  const warnings: string[] = [];

  if (raw.geminiApiKey !== undefined) {
    if (typeof raw.geminiApiKey === 'string') config.geminiApiKey = raw.geminiApiKey;
    else warnings.push('geminiApiKey must be a string');
  }

  if (raw.aivideomakerApiKey !== undefined) {
    if (typeof raw.aivideomakerApiKey === 'string') config.aivideomakerApiKey = raw.aivideomakerApiKey;
    else warnings.push('aivideomakerApiKey must be a string');
  }

  if (raw.aivideomakerApiKeys !== undefined) {
    if (Array.isArray(raw.aivideomakerApiKeys) && raw.aivideomakerApiKeys.every((k: unknown) => typeof k === 'string')) {
      config.aivideomakerApiKeys = raw.aivideomakerApiKeys as string[];
    } else {
      warnings.push('aivideomakerApiKeys must be an array of strings');
    }
  }

  if (raw.fallbackPolicy !== undefined) {
    if (typeof raw.fallbackPolicy === 'string' && VALID_FALLBACK_POLICIES.has(raw.fallbackPolicy)) {
      config.fallbackPolicy = raw.fallbackPolicy as FallbackPolicy;
    } else {
      warnings.push(`fallbackPolicy must be one of: ${[...VALID_FALLBACK_POLICIES].join(', ')}`);
    }
  }

  if (raw.productionConcurrency !== undefined) {
    if (typeof raw.productionConcurrency === 'number' && Number.isInteger(raw.productionConcurrency) && raw.productionConcurrency > 0) {
      config.productionConcurrency = raw.productionConcurrency;
    } else {
      warnings.push('productionConcurrency must be a positive integer');
    }
  }

  if (raw.ttsConfig !== undefined) {
    if (typeof raw.ttsConfig === 'object' && raw.ttsConfig !== null && !Array.isArray(raw.ttsConfig)) {
      config.ttsConfig = raw.ttsConfig as TTSSettings;
    } else {
      warnings.push('ttsConfig must be an object');
    }
  }

  if (raw.videoProviderConfig !== undefined) {
    if (typeof raw.videoProviderConfig === 'object' && raw.videoProviderConfig !== null && !Array.isArray(raw.videoProviderConfig)) {
      config.videoProviderConfig = raw.videoProviderConfig as VideoProviderConfig;
    } else {
      warnings.push('videoProviderConfig must be an object');
    }
  }

  if (raw.videoModel !== undefined) {
    if (typeof raw.videoModel === 'string') config.videoModel = raw.videoModel;
    else warnings.push('videoModel must be a string');
  }

  if (warnings.length > 0) {
    log.warn('config_validation_warnings', { warnings });
  }
  return config;
}

export class ConfigStore {
  private filePath: string;
  private config: AppConfig;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'config.json');
    this.config = this.load();
    log.info('loaded', { path: this.filePath, keys: Object.keys(this.config).join(','), hasVideoProvider: !!this.config.videoProviderConfig, hasGemini: !!this.config.geminiApiKey });
  }

  private load(): AppConfig {
    if (!existsSync(this.filePath)) {
      log.warn('config_not_found', { path: this.filePath });
      return {};
    }
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      let parsed = JSON.parse(raw);
      const migrated = migrateConfig(parsed);
      const config = validateConfig(migrated);
      // Re-persist if schema was upgraded
      if (parsed._schemaVersion !== CURRENT_SCHEMA_VERSION) {
        this.config = config;
        this.persist();
      }
      return config;
    } catch (err) {
      log.error('parse_failed', err, { path: this.filePath });
      return {};
    }
  }

  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    const payload = { _schemaVersion: CURRENT_SCHEMA_VERSION, ...this.config };
    const tmpPath = `${this.filePath}.${randomBytes(6).toString('hex')}.tmp`;
    writeFileSync(tmpPath, JSON.stringify(payload, null, 2));
    renameSync(tmpPath, this.filePath);
  }

  get(): AppConfig {
    return { ...this.config };
  }

  update(partial: Partial<AppConfig>): AppConfig {
    // Validate incoming partial before merging
    const validated = validateConfig(partial as Record<string, unknown>);
    Object.assign(this.config, validated);
    // Delete keys explicitly set to undefined in the input (e.g. removing videoProviderConfig)
    for (const key of Object.keys(partial) as (keyof AppConfig)[]) {
      if (partial[key] === undefined) delete this.config[key];
    }
    // Remove undefined keys to keep config.json clean
    for (const key of Object.keys(this.config) as (keyof AppConfig)[]) {
      if (this.config[key] === undefined) delete this.config[key];
    }
    this.persist();
    return { ...this.config };
  }
}
