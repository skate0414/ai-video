/* ------------------------------------------------------------------ */
/*  BackendRegistry – dynamic compiler backend capability tracking    */
/*  Each "backend" (LLM / image / video / TTS provider) is a codegen  */
/*  target; capabilities are derived from configured accounts.        */
/* ------------------------------------------------------------------ */

import type { ProviderId, SelectorHealth } from '../types.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { resolveDataDir, isElectronShell } from '../dataDir.js';

/** Capabilities a provider can support. */
export interface ProviderCapability {
  providerId: ProviderId;
  /** Provider supports text generation. */
  text: boolean;
  /** Provider supports image generation in chat. */
  imageGeneration: boolean;
  /** Provider supports video generation. */
  videoGeneration: boolean;
  /** Provider supports file upload (video/image/document). */
  fileUpload: boolean;
  /** Provider has built-in web search (Google Search grounding). */
  webSearch: boolean;
  /** Provider supports TTS / speech generation. */
  tts: boolean;
  /** Detected models available for this provider. */
  models: string[];
  /** Whether quota is currently exhausted. */
  quotaExhausted: boolean;
  /** ISO timestamp of last probe. */
  lastProbed?: string;
  /** Free tier daily limits (if known). */
  dailyLimits?: {
    textQueries?: number;
    imageGenerations?: number;
    videoGenerations?: number;
  };
  /** Selector health from the most recent probe. */
  selectorHealth?: SelectorHealth;
  /** Whether a browser profile directory exists on disk. */
  profileExists?: boolean;
}

/**
 * Load provider capability presets from data/provider-presets.json.
 *
 * Search order:
 * 1. User data directory (APPDATA_DIR / resolveDataDir()) — allows user overrides
 * 2. Bundled data/ directory relative to CWD (project root) — default presets
 *
 * Falls back to an empty record if neither location contains the file.
 */
function loadPresets(): Record<string, Omit<ProviderCapability, 'providerId'>> {
  try {
    const PRESET_FILENAME = 'provider-presets.json';
    const dataDir = resolveDataDir();
    let filePath = join(dataDir, PRESET_FILENAME);

    // Fallback: bundled data/ directory at project root (handles Electron
    // where dataDir points to the OS app-data folder, not the source tree).
    if (!existsSync(filePath)) {
      const bundledPath = resolve('data', PRESET_FILENAME);
      if (existsSync(bundledPath)) {
        filePath = bundledPath;
      }
    }
    if (!existsSync(filePath)) return {};
    const raw = JSON.parse(readFileSync(filePath, 'utf-8')) as Record<string, any>;
    const result: Record<string, Omit<ProviderCapability, 'providerId'>> = {};
    for (const [id, p] of Object.entries(raw)) {
      result[id] = {
        text: !!p.text,
        imageGeneration: !!p.imageGeneration,
        videoGeneration: !!p.videoGeneration,
        fileUpload: !!p.fileUpload,
        webSearch: !!p.webSearch,
        tts: !!p.tts,
        models: Array.isArray(p.models) ? p.models : [],
        quotaExhausted: false,
        dailyLimits: p.dailyLimits,
      };
    }
    return result;
  } catch {
    return {};
  }
}

/** Capability presets loaded from data/provider-presets.json. */
let _presetCache: Record<string, Omit<ProviderCapability, 'providerId'>> | null = null;
function getPresets(): Record<string, Omit<ProviderCapability, 'providerId'>> {
  if (!_presetCache) _presetCache = loadPresets();
  return _presetCache;
}

/** Account info used for seeding. */
export interface AccountSeed {
  provider: string;
  profileDir: string;
  quotaExhausted?: boolean;
}

/**
 * Registry that tracks provider capabilities at runtime.
 * Starts empty — must be seeded with `seedFromAccounts()` using
 * real configured accounts from AccountManager.
 */
export class ProviderCapabilityRegistry {
  private capabilities = new Map<string, ProviderCapability>();
  private savePath: string | null = null;

  constructor(savePath?: string) {
    // Start empty — no hardcoded providers
    if (savePath) {
      this.savePath = savePath;
      this.loadFromDisk();
    }
  }

  /**
   * Populate the registry from real configured accounts.
   * Only providers that have at least one account are registered.
   */
  seedFromAccounts(accounts: AccountSeed[]): void {
    this.capabilities.clear();
    for (const account of accounts) {
      const { provider, profileDir, quotaExhausted } = account;
      if (this.capabilities.has(provider)) continue; // already registered (first account wins)

      const preset = getPresets()[provider];
      // In Electron mode, sessions live in partition directories managed
      // by the shell, not in Playwright-style profile directories.
      const profileExists = (() => {
        if (!profileDir) return false; // API-only resources have no profile
        if (isElectronShell() && process.env.APPDATA_DIR) {
          const userDataDir = dirname(process.env.APPDATA_DIR);
          return existsSync(join(userDataDir, 'Partitions', `account-${provider}`));
        }
        return existsSync(profileDir);
      })();
      if (preset) {
        this.capabilities.set(provider, {
          providerId: provider,
          ...preset,
          quotaExhausted: quotaExhausted ?? false,
          profileExists,
        });
      } else {
        // Unknown provider — register with minimal capabilities
        this.capabilities.set(provider, {
          providerId: provider,
          text: true, imageGeneration: false, videoGeneration: false,
          fileUpload: false, webSearch: false, tts: false,
          models: [], quotaExhausted: quotaExhausted ?? false,
          profileExists,
        });
      }
    }
  }

  /**
   * Get capability info for a provider.
   */
  get(providerId: string): ProviderCapability | undefined {
    return this.capabilities.get(providerId);
  }

  /**
   * Get all registered providers.
   */
  getAll(): ProviderCapability[] {
    return [...this.capabilities.values()];
  }

  /**
   * Register or update a provider's capabilities.
   */
  register(providerId: string, cap: Partial<Omit<ProviderCapability, 'providerId'>>): void {
    const existing = this.capabilities.get(providerId);
    if (existing) {
      Object.assign(existing, cap, { lastProbed: new Date().toISOString() });
    } else {
      this.capabilities.set(providerId, {
        providerId,
        text: cap.text ?? true,
        imageGeneration: cap.imageGeneration ?? false,
        videoGeneration: cap.videoGeneration ?? false,
        fileUpload: cap.fileUpload ?? false,
        webSearch: cap.webSearch ?? false,
        tts: cap.tts ?? false,
        models: cap.models ?? [],
        quotaExhausted: cap.quotaExhausted ?? false,
        profileExists: cap.profileExists,
        lastProbed: new Date().toISOString(),
        dailyLimits: cap.dailyLimits,
      });
    }
  }

  /**
   * Mark a provider's quota as exhausted.
   */
  markQuotaExhausted(providerId: string): void {
    const cap = this.capabilities.get(providerId);
    if (cap) cap.quotaExhausted = true;
  }

  /**
   * Reset a provider's quota (e.g. after daily reset).
   */
  resetQuota(providerId: string): void {
    const cap = this.capabilities.get(providerId);
    if (cap) cap.quotaExhausted = false;
  }

  /**
   * Reset all providers' quota states (e.g. daily auto-reset).
   */
  resetAllQuotas(): void {
    for (const cap of this.capabilities.values()) {
      cap.quotaExhausted = false;
    }
  }

  /**
   * Find the best provider for a specific capability need.
   * Returns providers sorted by availability (non-exhausted first).
   */
  findProviders(need: {
    text?: boolean;
    imageGeneration?: boolean;
    videoGeneration?: boolean;
    fileUpload?: boolean;
    webSearch?: boolean;
  }): ProviderCapability[] {
    const matches = [...this.capabilities.values()].filter((cap) => {
      if (need.text && !cap.text) return false;
      if (need.imageGeneration && !cap.imageGeneration) return false;
      if (need.videoGeneration && !cap.videoGeneration) return false;
      if (need.fileUpload && !cap.fileUpload) return false;
      if (need.webSearch && !cap.webSearch) return false;
      return true;
    });

    // Sort: non-exhausted first, then alphabetically
    return matches.sort((a, b) => {
      if (a.quotaExhausted !== b.quotaExhausted) {
        return a.quotaExhausted ? 1 : -1;
      }
      return a.providerId.localeCompare(b.providerId);
    });
  }

  /**
   * Serialize capabilities for persistence or API response.
   */
  toJSON(): Record<string, ProviderCapability> {
    const result: Record<string, ProviderCapability> = {};
    for (const [id, cap] of this.capabilities) {
      result[id] = { ...cap };
    }
    return result;
  }

  /**
   * Update selector health for a provider.
   */
  updateSelectorHealth(providerId: string, health: SelectorHealth): void {
    const cap = this.capabilities.get(providerId);
    if (cap) {
      cap.selectorHealth = health;
      cap.lastProbed = health.lastProbed;
      this.persist();
    }
  }

  /* ---- Persistence ---- */

  private loadFromDisk(): void {
    if (!this.savePath) return;
    try {
      if (existsSync(this.savePath)) {
        const raw = readFileSync(this.savePath, 'utf-8');
        const data = JSON.parse(raw) as Record<string, Partial<ProviderCapability>>;
        for (const [id, cap] of Object.entries(data)) {
          const existing = this.capabilities.get(id);
          if (existing) {
            // Merge persisted data onto runtime entries
            if (cap.selectorHealth) existing.selectorHealth = cap.selectorHealth;
            if (cap.lastProbed) existing.lastProbed = cap.lastProbed;
            if (cap.dailyLimits) existing.dailyLimits = cap.dailyLimits;
            if (typeof cap.quotaExhausted === 'boolean') existing.quotaExhausted = cap.quotaExhausted;
          }
          // Ignore entries not in the current registry (stale provider data)
        }
      }
    } catch {
      // Corrupted file — start fresh
    }
  }

  /**
   * Persist current state to disk (non-critical — errors are swallowed).
   */
  persist(): void {
    if (!this.savePath) return;
    try {
      const dir = dirname(this.savePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.savePath, JSON.stringify(this.toJSON(), null, 2));
    } catch {
      // Non-critical — ignore write errors
    }
  }
}
