/* ------------------------------------------------------------------ */
/*  CustomProviderStore – CRUD for user-added AI providers            */
/* ------------------------------------------------------------------ */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { BUILTIN_PROVIDER_IDS, BUILTIN_PROVIDER_LABELS } from './providers.js';
import type { ProviderSelectors, ProviderId, BuiltinProviderId, ProviderInfo } from './types.js';

export interface CustomProviderEntry {
  label: string;
  selectors: ProviderSelectors;
}

export class CustomProviderStore {
  private providers: Record<string, CustomProviderEntry> = {};

  constructor(private readonly savePath: string) {
    this.load();
  }

  private load(): void {
    if (!this.savePath) return;
    try {
      if (existsSync(this.savePath)) {
        this.providers = JSON.parse(readFileSync(this.savePath, 'utf-8'));
      }
    } catch {
      // corrupted file – start fresh
    }
  }

  persist(): void {
    if (!this.savePath) return;
    try {
      const dir = dirname(this.savePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.savePath, JSON.stringify(this.providers, null, 2));
    } catch {
      // non-critical
    }
  }

  get(id: string): CustomProviderEntry | undefined {
    return this.providers[id];
  }

  set(id: string, entry: CustomProviderEntry): void {
    this.providers[id] = entry;
    this.persist();
  }

  remove(id: string): boolean {
    if (!this.providers[id]) return false;
    delete this.providers[id];
    this.persist();
    return true;
  }

  has(id: string): boolean {
    return id in this.providers;
  }

  /** Full provider list including builtins. */
  getProviderList(): ProviderInfo[] {
    const builtins: ProviderInfo[] = BUILTIN_PROVIDER_IDS.map((id) => ({
      id,
      label: BUILTIN_PROVIDER_LABELS[id],
      builtin: true,
    }));
    const custom: ProviderInfo[] = Object.entries(this.providers).map(([id, cfg]) => ({
      id,
      label: cfg.label,
      builtin: false,
    }));
    return [...builtins, ...custom];
  }
}
