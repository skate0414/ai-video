/* ------------------------------------------------------------------ */
/*  Config persistence — save/load app configuration to config.json    */
/* ------------------------------------------------------------------ */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { QualityTier } from './pipeline/types.js';
import type { VideoProviderConfig } from './adapters/videoProvider.js';

export interface TTSSettings {
  voice?: string;
  rate?: string;
  pitch?: string;
}

export interface AppConfig {
  geminiApiKey?: string;
  qualityTier?: QualityTier;
  ttsConfig?: TTSSettings;
  videoProviderConfig?: VideoProviderConfig;
  productionConcurrency?: number;
}

export class ConfigStore {
  private filePath: string;
  private config: AppConfig;

  constructor(dataDir: string) {
    this.filePath = join(dataDir, 'config.json');
    this.config = this.load();
  }

  private load(): AppConfig {
    if (!existsSync(this.filePath)) return {};
    try {
      const raw = readFileSync(this.filePath, 'utf-8');
      return JSON.parse(raw) as AppConfig;
    } catch {
      return {};
    }
  }

  private persist(): void {
    const dir = dirname(this.filePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.filePath, JSON.stringify(this.config, null, 2));
  }

  get(): AppConfig {
    return { ...this.config };
  }

  update(partial: Partial<AppConfig>): AppConfig {
    Object.assign(this.config, partial);
    // Remove undefined keys to keep config.json clean
    for (const key of Object.keys(this.config) as (keyof AppConfig)[]) {
      if (this.config[key] === undefined) delete this.config[key];
    }
    this.persist();
    return { ...this.config };
  }
}
