/* ------------------------------------------------------------------ */
/*  ProviderCapabilityRegistry – dynamic provider capability tracking */
/*  Replaces hardcoded 'provider: gemini' in quality router with     */
/*  runtime-detected capability data.                                 */
/* ------------------------------------------------------------------ */

import type { ProviderId, SelectorHealth } from '../types.js';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';

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
}

/** Default capabilities for known built-in providers. */
const BUILTIN_CAPABILITIES: Record<string, Omit<ProviderCapability, 'providerId'>> = {
  gemini: {
    text: true,
    imageGeneration: true,
    videoGeneration: false,
    fileUpload: true,
    webSearch: true,
    tts: false,
    models: [],
    quotaExhausted: false,
    dailyLimits: { textQueries: 50, imageGenerations: 10 },
  },
  chatgpt: {
    text: true,
    imageGeneration: true,
    videoGeneration: false,
    fileUpload: true,
    webSearch: true,
    tts: false,
    models: [],
    quotaExhausted: false,
    dailyLimits: { textQueries: 40 },
  },
  deepseek: {
    text: true,
    imageGeneration: false,
    videoGeneration: false,
    fileUpload: false,
    webSearch: true,
    tts: false,
    models: [],
    quotaExhausted: false,
    dailyLimits: { textQueries: 50 },
  },
  kimi: {
    text: true,
    imageGeneration: false,
    videoGeneration: false,
    fileUpload: true,
    webSearch: true,
    tts: false,
    models: [],
    quotaExhausted: false,
    dailyLimits: { textQueries: 50 },
  },
  seedance: {
    text: false,
    imageGeneration: false,
    videoGeneration: true,
    fileUpload: true,
    webSearch: false,
    tts: false,
    models: [],
    quotaExhausted: false,
    dailyLimits: { videoGenerations: 5 },
  },
};

/**
 * Registry that tracks provider capabilities at runtime.
 * Capabilities can be seeded from known defaults and updated
 * via dynamic probing or user feedback.
 */
export class ProviderCapabilityRegistry {
  private capabilities = new Map<string, ProviderCapability>();
  private savePath: string | null = null;

  constructor(savePath?: string) {
    // Seed with built-in defaults
    for (const [id, cap] of Object.entries(BUILTIN_CAPABILITIES)) {
      this.capabilities.set(id, { providerId: id, ...cap });
    }
    // Load persisted overrides if path provided
    if (savePath) {
      this.savePath = savePath;
      this.loadFromDisk();
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
            // Merge persisted data onto built-in defaults
            if (cap.selectorHealth) existing.selectorHealth = cap.selectorHealth;
            if (cap.lastProbed) existing.lastProbed = cap.lastProbed;
            if (cap.dailyLimits) existing.dailyLimits = cap.dailyLimits;
            if (typeof cap.quotaExhausted === 'boolean') existing.quotaExhausted = cap.quotaExhausted;
          } else {
            // Custom provider — restore fully
            this.capabilities.set(id, {
              providerId: id,
              text: cap.text ?? false,
              imageGeneration: cap.imageGeneration ?? false,
              videoGeneration: cap.videoGeneration ?? false,
              fileUpload: cap.fileUpload ?? false,
              webSearch: cap.webSearch ?? false,
              tts: cap.tts ?? false,
              models: cap.models ?? [],
              quotaExhausted: cap.quotaExhausted ?? false,
              lastProbed: cap.lastProbed,
              dailyLimits: cap.dailyLimits,
              selectorHealth: cap.selectorHealth,
            });
          }
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
