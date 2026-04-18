/* ------------------------------------------------------------------ */
/*  ResourceManager — unified AI resource management                   */
/*  Replaces AccountManager with a unified store for chat, video,      */
/*  and image AI resources.                                            */
/* ------------------------------------------------------------------ */

import { readFileSync, writeFileSync, renameSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import type { AiResource, AiResourceType, ProviderId, Account } from './types.js';
import { BUILTIN_PROVIDER_IDS, BUILTIN_PROVIDER_LABELS } from './providers.js';

let counter = 0;

function uid(): string {
  return `res_${Date.now()}_${++counter}`;
}

/**
 * Manages unified AI resources (chat, video, image) with persistence,
 * round-robin rotation, and quota tracking.
 *
 * On first launch, auto-migrates from the legacy split storage
 * (accounts.json + config.json.videoProviderConfig) if present.
 */
export class ResourceManager {
  private resources: AiResource[] = [];
  private savePath: string;
  /** Round-robin index per capability for fair rotation. */
  private rrIndex: Partial<Record<string, number>> = {};
  /**
   * Per-provider quota reset window in milliseconds.
   * If a resource has been exhausted for longer than this window,
   * its quota is automatically reset on the next `pickResource()` call.
   * Defaults to 24 hours (most free-tier daily limits).
   */
  private resetWindowMs: number = 24 * 60 * 60 * 1000;

  constructor(savePath?: string, skipSeed?: boolean) {
    this.savePath = savePath ?? join(process.cwd(), 'data', 'resources.json');
    if (skipSeed) return; // Test mode: start empty
    this.load();
  }

  /**
   * Set the auto-reset window (how long after exhaustion to auto-restore).
   * Default: 24 hours. Set to 0 to disable auto-reset.
   */
  setResetWindow(ms: number): void {
    this.resetWindowMs = ms;
  }

  /* -------------------------------------------------------------- */
  /*  Persistence                                                   */
  /* -------------------------------------------------------------- */

  private load(): void {
    if (existsSync(this.savePath)) {
      try {
        const raw = readFileSync(this.savePath, 'utf-8');
        this.resources = JSON.parse(raw) as AiResource[];
        return;
      } catch { /* corrupted – try migration */ }
    }
    // Try auto-migration from legacy files
    if (this.tryMigrate()) return;
    // First launch: seed defaults
    this.seedDefaults();
  }

  /**
   * Attempt auto-migration from legacy accounts.json + config.json.
   * Returns true if migration succeeded (resources were populated).
   */
  private tryMigrate(): boolean {
    const dir = dirname(this.savePath);
    const accountsPath = join(dir, 'accounts.json');
    const configPath = join(dir, 'config.json');
    let migrated = false;

    // Migrate accounts.json → chat resources
    if (existsSync(accountsPath)) {
      try {
        const raw = readFileSync(accountsPath, 'utf-8');
        const accounts = JSON.parse(raw) as Account[];
        for (const a of accounts) {
          this.resources.push({
            id: a.id,
            type: 'chat',
            provider: a.provider,
            label: a.label,
            siteUrl: this.inferSiteUrl(a.provider),
            profileDir: a.profileDir,
            quotaExhausted: a.quotaExhausted,
            quotaResetAt: a.quotaResetAt,
            capabilities: { text: true },
          });
        }
        renameSync(accountsPath, accountsPath + '.bak');
        migrated = true;
        console.log(`[ResourceManager] Migrated ${accounts.length} accounts from accounts.json`);
      } catch (err) {
        console.warn('[ResourceManager] Failed to migrate accounts.json:', err);
      }
    }

    // Migrate config.json videoProviderConfig → video resource
    if (existsSync(configPath)) {
      try {
        const raw = readFileSync(configPath, 'utf-8');
        const config = JSON.parse(raw) as Record<string, any>;
        const vpc = config.videoProviderConfig;
        if (vpc?.url) {
          this.resources.push({
            id: uid(),
            type: 'video',
            provider: this.inferProviderFromUrl(vpc.url),
            label: this.inferLabelFromUrl(vpc.url),
            siteUrl: vpc.url,
            profileDir: vpc.profileDir || join(dir, 'profiles', 'video'),
            quotaExhausted: false,
            capabilities: { video: true },
            selectors: {
              promptInput: vpc.promptInput,
              generateButton: vpc.generateButton,
              resultElement: vpc.videoResult,
              imageUploadTrigger: vpc.imageUploadTrigger,
              progressIndicator: vpc.progressIndicator,
              downloadButton: vpc.downloadButton,
            },
            timing: { maxWaitMs: vpc.maxWaitMs ?? 300_000 },
            queueDetection: vpc.queueDetection,
          });
          // Remove videoProviderConfig from config.json
          delete config.videoProviderConfig;
          writeFileSync(configPath, JSON.stringify(config, null, 2));
          migrated = true;
          console.log(`[ResourceManager] Migrated video provider from config.json`);
        }
      } catch (err) {
        console.warn('[ResourceManager] Failed to migrate config.json videoProviderConfig:', err);
      }
    }

    if (migrated) {
      this.persist();
    }
    return migrated;
  }

  private inferSiteUrl(provider: string): string {
    const urls: Record<string, string> = {
      chatgpt: 'https://chatgpt.com/',
      gemini: 'https://gemini.google.com/app',
      deepseek: 'https://chat.deepseek.com/',
      kimi: 'https://kimi.moonshot.cn/',
    };
    return urls[provider] ?? '';
  }

  private inferProviderFromUrl(url: string): string {
    try {
      const host = new URL(url).hostname.replace(/^www\./, '');
      const parts = host.split('.');
      return parts[0] === 'chat' || parts[0] === 'app' ? parts[1] : parts[0];
    } catch {
      return 'unknown';
    }
  }

  private inferLabelFromUrl(url: string): string {
    const provider = this.inferProviderFromUrl(url);
    return provider.charAt(0).toUpperCase() + provider.slice(1);
  }

  private persist(): void {
    const dir = dirname(this.savePath);
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    writeFileSync(this.savePath, JSON.stringify(this.resources, null, 2));
  }

  private seedDefaults(): void {
    const dataDir = dirname(this.savePath);
    for (const p of BUILTIN_PROVIDER_IDS) {
      this.resources.push({
        id: uid(),
        type: 'chat',
        provider: p,
        label: BUILTIN_PROVIDER_LABELS[p],
        siteUrl: this.inferSiteUrl(p),
        profileDir: join(dataDir, 'profiles', p),
        quotaExhausted: false,
        capabilities: { text: true },
      });
    }
    this.persist();
  }

  /* -------------------------------------------------------------- */
  /*  Public API                                                    */
  /* -------------------------------------------------------------- */

  /** Return all resources. */
  all(): AiResource[] {
    return [...this.resources];
  }

  /** Filter resources by type. */
  byType(type: AiResourceType): AiResource[] {
    return this.resources.filter((r) => r.type === type);
  }

  /** Filter resources that have a specific capability. */
  byCapability(cap: 'text' | 'image' | 'video' | 'fileUpload' | 'webSearch'): AiResource[] {
    return this.resources.filter((r) => r.capabilities[cap]);
  }

  /** Get a resource by id. */
  get(resourceId: string): AiResource | undefined {
    return this.resources.find((r) => r.id === resourceId);
  }

  /** Add a new resource. */
  addResource(resource: Omit<AiResource, 'id' | 'quotaExhausted'>): AiResource {
    const full: AiResource = {
      ...resource,
      id: uid(),
      quotaExhausted: false,
    };
    this.resources.push(full);
    this.persist();
    return full;
  }

  /** Remove a resource by id. */
  removeResource(resourceId: string): boolean {
    const idx = this.resources.findIndex((r) => r.id === resourceId);
    if (idx === -1) return false;
    this.resources.splice(idx, 1);
    this.persist();
    return true;
  }

  /**
   * Pick the best available resource for a given capability.
   * Uses true round-robin rotation for even quota utilization.
   * Prefers `preferredProvider` if specified.
   *
   * Before filtering, automatically resets any resources whose
   * quota exhaustion has exceeded the configured reset window.
   */
  pickResource(capability: 'text' | 'image' | 'video', preferredProvider?: ProviderId): AiResource | undefined {
    this.checkAndResetQuotas();
    const available = this.resources.filter((r) => !r.quotaExhausted && r.capabilities[capability]);
    if (available.length === 0) return undefined;

    // When preferredProvider is specified, round-robin within that provider's
    // resources — not just return the first match.
    let candidates = available;
    if (preferredProvider) {
      const filtered = available.filter((r) => r.provider === preferredProvider);
      if (filtered.length > 0) candidates = filtered;
    }

    // Per-provider round-robin key so different providers advance independently
    const rrKey = preferredProvider ? `${capability}:${preferredProvider}` : capability;
    const idx = (this.rrIndex[rrKey] ?? 0) % candidates.length;
    this.rrIndex[rrKey] = idx + 1;
    return candidates[idx];
  }

  /**
   * Check all exhausted resources and auto-reset those that have been
   * exhausted longer than the configured reset window.
   * Returns the number of resources that were auto-reset.
   */
  checkAndResetQuotas(): number {
    if (this.resetWindowMs <= 0) return 0;
    const now = Date.now();
    let resetCount = 0;
    for (const r of this.resources) {
      if (!r.quotaExhausted) continue;
      const exhaustedAt = r.quotaExhaustedAt ? new Date(r.quotaExhaustedAt).getTime() : 0;
      if (exhaustedAt > 0 && now - exhaustedAt >= this.resetWindowMs) {
        r.quotaExhausted = false;
        r.quotaResetAt = new Date(now).toISOString();
        r.quotaExhaustedAt = undefined;
        resetCount++;
        console.log(`[ResourceManager] Auto-reset quota for ${r.label} (${r.provider}) — exhausted ${Math.round((now - exhaustedAt) / 3600000)}h ago`);
      }
    }
    if (resetCount > 0) this.persist();
    return resetCount;
  }

  /** Mark a resource as quota-exhausted, recording the timestamp. */
  markQuotaExhausted(resourceId: string): void {
    const r = this.get(resourceId);
    if (!r) return;
    r.quotaExhausted = true;
    r.quotaExhaustedAt = new Date().toISOString();
    r.quotaResetAt = undefined;
    this.persist();
  }

  /** Reset quota for a resource. */
  resetQuota(resourceId: string): void {
    const r = this.get(resourceId);
    if (!r) return;
    r.quotaExhausted = false;
    r.quotaResetAt = new Date().toISOString();
    this.persist();
  }

  /** Reset all quotas. */
  resetAllQuotas(): void {
    for (const r of this.resources) {
      r.quotaExhausted = false;
      r.quotaResetAt = new Date().toISOString();
    }
    this.persist();
  }

  /** How many resources still have quota remaining. */
  availableCount(): number {
    return this.resources.filter((r) => !r.quotaExhausted).length;
  }

  /* -------------------------------------------------------------- */
  /*  Backward compatibility (Account-style API)                    */
  /* -------------------------------------------------------------- */

  /** Get all chat-type resources as legacy Account objects. */
  allAccounts(): Account[] {
    return this.byType('chat').map((r) => ({
      id: r.id,
      provider: r.provider,
      label: r.label,
      profileDir: r.profileDir,
      quotaExhausted: r.quotaExhausted,
      quotaResetAt: r.quotaResetAt,
    }));
  }

  /** Legacy: addAccount → addResource with type='chat'. */
  addAccount(provider: ProviderId, label: string, profileDir: string): Account {
    const r = this.addResource({
      type: 'chat',
      provider,
      label,
      siteUrl: this.inferSiteUrl(provider),
      profileDir,
      capabilities: { text: true },
    });
    return { id: r.id, provider: r.provider, label: r.label, profileDir: r.profileDir, quotaExhausted: false };
  }

  /** Legacy: removeAccount → removeResource. */
  removeAccount(accountId: string): boolean {
    return this.removeResource(accountId);
  }

  /** Legacy: pickAccount → pickResource('text'). */
  pickAccount(preferredProvider?: ProviderId): Account | undefined {
    const r = this.pickResource('text', preferredProvider);
    if (!r) return undefined;
    return { id: r.id, provider: r.provider, label: r.label, profileDir: r.profileDir, quotaExhausted: r.quotaExhausted, quotaResetAt: r.quotaResetAt };
  }

  /**
   * Build a VideoProviderConfig-compatible object from the first video resource.
   * Used by the pipeline stage that still expects the old config format.
   */
  getVideoProviderConfig(): Record<string, any> | null {
    const videoResources = this.byType('video');
    if (videoResources.length === 0) return null;
    const first = videoResources[0];
    return {
      url: first.siteUrl,
      promptInput: first.selectors?.promptInput ?? 'textarea',
      generateButton: first.selectors?.generateButton ?? 'button:has-text("生成")',
      videoResult: first.selectors?.resultElement ?? 'video',
      imageUploadTrigger: first.selectors?.imageUploadTrigger,
      progressIndicator: first.selectors?.progressIndicator,
      downloadButton: first.selectors?.downloadButton,
      maxWaitMs: first.timing?.maxWaitMs ?? 300_000,
      queueDetection: first.queueDetection,
      profileDir: first.profileDir,
      profileDirs: videoResources.map((r) => r.profileDir),
    };
  }

  /* -------------------------------------------------------------- */
  /*  API key registration as AiResource (type='api')               */
  /* -------------------------------------------------------------- */

  /**
   * Synchronise API keys from ConfigStore into the resource list.
   *
   * - Gemini API key    → provider='gemini',      capabilities={text,image}
   * - AIVideoMaker keys → provider='aivideomaker', capabilities={video}
   *
   * Existing api-type resources whose keys are no longer present are removed.
   * New keys are added. Unchanged keys are left as-is (preserving quota state).
   * The `apiKeyMasked` field stores a safe display string (first 10 chars + "...").
   */
  syncApiKeys(opts: { geminiApiKey?: string; aivideomakerApiKeys?: string[] }): void {
    const { geminiApiKey, aivideomakerApiKeys = [] } = opts;

    // Build the desired set of (provider, maskedKey) tuples
    const desired: { provider: string; key: string; masked: string; label: string; caps: AiResource['capabilities'] }[] = [];

    if (geminiApiKey) {
      desired.push({
        provider: 'gemini',
        key: geminiApiKey,
        masked: geminiApiKey.slice(0, 10) + '...',
        label: 'Gemini API',
        caps: { text: true, image: true },
      });
    }

    for (const k of aivideomakerApiKeys) {
      desired.push({
        provider: 'aivideomaker',
        key: k,
        masked: k.slice(0, 10) + '...',
        label: `AIVideoMaker (${k.slice(0, 8)})`,
        caps: { video: true },
      });
    }

    // Current api-type resources
    const existing = this.resources.filter(r => r.type === 'api');

    // Remove api resources whose key no longer exists
    const desiredMasks = new Set(desired.map(d => `${d.provider}:${d.masked}`));
    for (const ex of existing) {
      const tag = `${ex.provider}:${ex.apiKeyMasked ?? ''}`;
      if (!desiredMasks.has(tag)) {
        const idx = this.resources.indexOf(ex);
        if (idx !== -1) this.resources.splice(idx, 1);
      }
    }

    // Add new api resources that don't exist yet
    const existingMasks = new Set(
      this.resources.filter(r => r.type === 'api').map(r => `${r.provider}:${r.apiKeyMasked ?? ''}`),
    );
    for (const d of desired) {
      const tag = `${d.provider}:${d.masked}`;
      if (!existingMasks.has(tag)) {
        this.resources.push({
          id: uid(),
          type: 'api',
          provider: d.provider,
          label: d.label,
          siteUrl: '',
          profileDir: '',
          quotaExhausted: false,
          capabilities: d.caps,
          apiKeyMasked: d.masked,
        });
      }
    }

    this.persist();
  }
}
