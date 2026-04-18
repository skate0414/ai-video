import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname } from 'node:path';
import { getPreset } from './providerPresets.js';
import { chainToSelector, selectorToChain } from './selectorResolver.js';
import { CustomProviderStore } from './customProviderStore.js';
import { ResourceManager } from './resourceManager.js';
import { createLogger } from './lib/logger.js';
import { WB_EVENT } from './types.js';
import type { ProviderSelectors, ProviderId, SelectorChain } from './types.js';
import type { DetectedSelectors, DetectedVideoSelectors } from './chatAutomation.js';

const log = createLogger('SelectorService');

export type SelectorEventSink = {
  emit(event: { type: string; payload: unknown }): void;
  emitState(): void;
};

/**
 * Manages CSS selector overrides, caching, and auto-detection results.
 * Extracted from Workbench to keep that class focused on orchestration.
 */
export class SelectorService {
  /** Custom selector overrides keyed by provider id. */
  private selectorOverrides: Partial<Record<ProviderId, Partial<ProviderSelectors>>> = {};
  /** SelectorChain cache keyed by provider → field name. Preserved across restarts. */
  private selectorChainCache: Partial<Record<ProviderId, Record<string, SelectorChain>>> = {};

  constructor(
    private readonly cachePath: string,
    private readonly customProviderStore: CustomProviderStore,
    private readonly resources: ResourceManager,
    private readonly sink: SelectorEventSink,
  ) {
    this.loadSelectorCache();
  }

  /* ------------------------------------------------------------------ */
  /*  Cache persistence                                                 */
  /* ------------------------------------------------------------------ */

  private loadSelectorCache(): void {
    if (!this.cachePath) return;
    try {
      if (existsSync(this.cachePath)) {
        const raw = readFileSync(this.cachePath, 'utf-8');
        const cache = JSON.parse(raw) as Record<string, {
          selectors: Partial<ProviderSelectors>;
          chains?: Record<string, SelectorChain>;
          detectedAt: string;
        }>;
        for (const [provider, entry] of Object.entries(cache)) {
          if (entry?.selectors) {
            const sel = { ...entry.selectors };
            if (getPreset(provider)) {
              delete sel.responseBlock;
              delete sel.promptInput;
              delete sel.readyIndicator;
            }
            this.selectorOverrides[provider] = { ...this.selectorOverrides[provider], ...sel };
          }
          if (entry?.chains) {
            this.selectorChainCache[provider] = entry.chains;
          }
        }
      }
    } catch {
      // corrupted file – start fresh
    }
  }

  persistSelectorCache(): void {
    if (!this.cachePath) return;
    try {
      const cache: Record<string, {
        selectors: Partial<ProviderSelectors>;
        chains?: Record<string, SelectorChain>;
        detectedAt: string;
      }> = {};
      for (const [provider, overrides] of Object.entries(this.selectorOverrides)) {
        if (overrides && Object.keys(overrides).length > 0) {
          cache[provider] = {
            selectors: overrides,
            chains: this.selectorChainCache[provider],
            detectedAt: new Date().toISOString(),
          };
        }
      }
      const dir = dirname(this.cachePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.cachePath, JSON.stringify(cache, null, 2));
    } catch {
      // non-critical – ignore write errors
    }
  }

  /* ------------------------------------------------------------------ */
  /*  Public API                                                        */
  /* ------------------------------------------------------------------ */

  setProviderSelectors(provider: ProviderId, overrides: Partial<ProviderSelectors>): void {
    this.selectorOverrides[provider] = overrides;
  }

  getSelectors(provider: ProviderId): ProviderSelectors {
    const preset = getPreset(provider);
    let base: ProviderSelectors | undefined;
    if (preset) {
      base = {
        chatUrl: preset.siteUrl,
        promptInput: chainToSelector(preset.selectors.promptInput),
        responseBlock: preset.selectors.responseBlock ? chainToSelector(preset.selectors.responseBlock) : '',
        readyIndicator: preset.selectors.readyIndicator ? chainToSelector(preset.selectors.readyIndicator) : chainToSelector(preset.selectors.promptInput),
        sendButton: preset.selectors.sendButton ? chainToSelector(preset.selectors.sendButton) : undefined,
        quotaExhaustedIndicator: preset.selectors.quotaExhaustedIndicator ? chainToSelector(preset.selectors.quotaExhaustedIndicator) : undefined,
        modelPickerTrigger: preset.selectors.modelPickerTrigger ? chainToSelector(preset.selectors.modelPickerTrigger) : undefined,
        modelOptionSelector: preset.selectors.modelOptionSelector ? chainToSelector(preset.selectors.modelOptionSelector) : undefined,
        fileUploadTrigger: preset.selectors.fileUploadTrigger ? chainToSelector(preset.selectors.fileUploadTrigger) : undefined,
      };
    }
    if (!base) {
      base = this.customProviderStore.get(provider)?.selectors;
    }
    if (!base) throw new Error(`Unknown provider "${provider}". Add it as a custom provider first.`);
    return { ...base, ...this.selectorOverrides[provider] };
  }

  /** Get a SelectorChain for a specific field of a provider. */
  getSelectorChain(provider: ProviderId, field: string): SelectorChain | undefined {
    const cached = this.selectorChainCache[provider]?.[field];
    if (cached && cached.length > 0) return cached;
    const preset = getPreset(provider);
    if (preset) {
      const chain = preset.selectors[field as keyof typeof preset.selectors] as SelectorChain | undefined;
      if (chain && chain.length > 0) return chain;
    }
    return undefined;
  }

  /** Get cached chains for a provider (used by health monitor). */
  getCachedChains(provider: ProviderId): Record<string, SelectorChain> | undefined {
    return this.selectorChainCache[provider];
  }

  /** Update cached chains for a provider (used by health monitor). */
  setCachedChain(provider: ProviderId, field: string, chain: SelectorChain): void {
    if (!this.selectorChainCache[provider]) this.selectorChainCache[provider] = {};
    this.selectorChainCache[provider]![field] = chain;
  }

  /* ------------------------------------------------------------------ */
  /*  Auto-detection application                                        */
  /* ------------------------------------------------------------------ */

  applyDetectedSelectors(provider: ProviderId, detected: DetectedSelectors): void {
    const overrides: Partial<ProviderSelectors> = { ...this.selectorOverrides[provider] };
    if (detected.promptInput) overrides.promptInput = detected.promptInput;
    if (detected.sendButton) overrides.sendButton = detected.sendButton;
    const hasPreset = !!getPreset(provider);
    if (detected.responseBlock && !hasPreset) overrides.responseBlock = detected.responseBlock;
    if (detected.readyIndicator) overrides.readyIndicator = detected.readyIndicator;
    if (detected.fileUploadTrigger && !hasPreset) overrides.fileUploadTrigger = detected.fileUploadTrigger;
    this.selectorOverrides[provider] = overrides;

    // Bridge: also update AiResource.selectors
    const resources = this.resources.all().filter(r => r.provider === provider);
    for (const resource of resources) {
      if (!resource.selectors) resource.selectors = {};
      if (detected.promptInput) resource.selectors.promptInput = detected.promptInput;
      if (detected.sendButton) resource.selectors.sendButton = detected.sendButton;
      if (detected.responseBlock && !hasPreset) resource.selectors.responseBlock = detected.responseBlock;
      if (detected.readyIndicator) resource.selectors.readyIndicator = detected.readyIndicator;
      if (detected.fileUploadTrigger && !hasPreset) resource.selectors.imageUploadTrigger = detected.fileUploadTrigger;
    }

    // For custom providers, also persist to disk
    const custom = this.customProviderStore.get(provider);
    if (custom) {
      Object.assign(custom.selectors, overrides);
      this.customProviderStore.persist();
    }

    this.persistSelectorCache();
    this.sink.emit({
      type: WB_EVENT.SELECTORS_UPDATED,
      payload: {
        provider,
        source: 'auto_detect',
        fields: Object.keys(overrides).filter(k => overrides[k as keyof ProviderSelectors]),
      },
    });
    this.sink.emitState();
  }

  applyDetectedVideoSelectors(provider: ProviderId, detected: DetectedVideoSelectors): void {
    const overrides: Partial<ProviderSelectors> = { ...this.selectorOverrides[provider] };
    if (detected.promptInput) overrides.promptInput = detected.promptInput;
    if (detected.generateButton) overrides.sendButton = detected.generateButton;
    if (detected.imageUploadTrigger) overrides.fileUploadTrigger = detected.imageUploadTrigger;
    this.selectorOverrides[provider] = overrides;

    // Bridge: also update AiResource.selectors
    const resources = this.resources.all().filter(r => r.provider === provider);
    for (const resource of resources) {
      if (!resource.selectors) resource.selectors = {};
      if (detected.promptInput) resource.selectors.promptInput = detected.promptInput;
      if (detected.generateButton) resource.selectors.generateButton = detected.generateButton;
      if (detected.imageUploadTrigger) resource.selectors.imageUploadTrigger = detected.imageUploadTrigger;
      if (detected.videoResult) resource.selectors.resultElement = detected.videoResult;
      if (detected.progressIndicator) resource.selectors.progressIndicator = detected.progressIndicator;
      if (detected.downloadButton) resource.selectors.downloadButton = detected.downloadButton;
    }

    log.info('video_selectors_applied', { provider });
    this.persistSelectorCache();
    this.sink.emit({
      type: WB_EVENT.SELECTORS_UPDATED,
      payload: {
        provider,
        source: 'auto_detect',
        fields: [
          ...(detected.promptInput ? ['promptInput'] : []),
          ...(detected.generateButton ? ['generateButton'] : []),
          ...(detected.imageUploadTrigger ? ['imageUploadTrigger'] : []),
          ...(detected.videoResult ? ['resultElement'] : []),
          ...(detected.progressIndicator ? ['progressIndicator'] : []),
          ...(detected.downloadButton ? ['downloadButton'] : []),
        ],
      },
    });
    this.sink.emitState();
  }
}
