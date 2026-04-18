/* ------------------------------------------------------------------ */
/*  ModelStore – persists auto-detected model lists per provider      */
/* ------------------------------------------------------------------ */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import type { ProviderId, ModelOption } from './types.js';

export class ModelStore {
  private models: Partial<Record<ProviderId, ModelOption[]>> = {};

  constructor(private readonly savePath: string) {
    this.load();
  }

  private load(): void {
    if (!this.savePath) return;
    try {
      if (existsSync(this.savePath)) {
        this.models = JSON.parse(readFileSync(this.savePath, 'utf-8'));
      }
    } catch {
      // corrupted file – start fresh
    }
  }

  private persist(): void {
    if (!this.savePath) return;
    try {
      const dir = dirname(this.savePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.savePath, JSON.stringify(this.models, null, 2));
    } catch {
      // non-critical
    }
  }

  get(provider: ProviderId): ModelOption[] | undefined {
    return this.models[provider];
  }

  set(provider: ProviderId, models: ModelOption[]): void {
    this.models[provider] = models;
    this.persist();
  }

  getAll(): Partial<Record<ProviderId, ModelOption[]>> {
    return { ...this.models };
  }

  hasModels(provider: ProviderId): boolean {
    return (this.models[provider]?.length ?? 0) > 0;
  }
}
