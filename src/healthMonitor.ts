import type { Page } from 'playwright';
import { probeSelectors, selectorToChain } from './selectorResolver.js';
import { autoDetectSelectors, autoDetectVideoSelectors, cleanupDebugScreenshots } from './chatAutomation.js';
import { SELECTOR_HEALTH_CHECK_INTERVAL_MS, SELECTOR_HEALTH_REDETECT_THRESHOLD, SELECTOR_HEALTH_WARN_THRESHOLD } from './constants.js';
import { createLogger } from './lib/logger.js';
import type { SelectorChain, ProviderId, AiResourceType } from './types.js';
import { WB_EVENT } from './types.js';
import type { SelectorService } from './selectorService.js';

const log = createLogger('HealthMonitor');

export type HealthMonitorDeps = {
  selectorService: SelectorService;
  getActivePage(): Page | null;
  getActiveAccountId(): string | null;
  getResourceType(accountId: string): AiResourceType | undefined;
  getResourceProvider(accountId: string): ProviderId | undefined;
  emit(event: { type: string; payload: unknown }): void;
};

/**
 * Periodically probes CSS selectors on the active page and triggers
 * re-detection when health degrades.  Extracted from Workbench.
 */
export class HealthMonitor {
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: HealthMonitorDeps) {}

  start(): void {
    if (this.healthCheckTimer) return;
    this.healthCheckTimer = setInterval(() => {
      this.check().catch((e: unknown) => {
        log.warn('health_check_error', { error: e instanceof Error ? e.message : String(e) });
      });
      cleanupDebugScreenshots().catch((e: unknown) => {
        log.warn('screenshot_cleanup_error', { error: e instanceof Error ? e.message : String(e) });
      });
    }, SELECTOR_HEALTH_CHECK_INTERVAL_MS);
    log.info('health_monitor_started', { intervalMs: SELECTOR_HEALTH_CHECK_INTERVAL_MS });
  }

  stop(): void {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
      log.info('health_monitor_stopped');
    }
  }

  private async check(): Promise<void> {
    const page = this.deps.getActivePage();
    const activeAccountId = this.deps.getActiveAccountId();
    if (!page || !activeAccountId) return;

    const provider = this.deps.getResourceProvider(activeAccountId);
    if (!provider) return;

    try {
      await page.title();
    } catch {
      return; // page is dead
    }

    const { selectorService } = this.deps;
    let selectors;
    try {
      selectors = selectorService.getSelectors(provider);
    } catch {
      return; // unknown provider
    }

    // Build selector chains for probing
    const chains: Record<string, SelectorChain | undefined> = {};
    const cachedChains = selectorService.getCachedChains(provider) ?? {};
    if (cachedChains.promptInput?.length) chains.promptInput = cachedChains.promptInput;
    else if (selectors.promptInput) chains.promptInput = selectorToChain(selectors.promptInput);
    if (cachedChains.sendButton?.length) chains.sendButton = cachedChains.sendButton;
    else if (selectors.sendButton) chains.sendButton = selectorToChain(selectors.sendButton);
    if (cachedChains.responseBlock?.length) chains.responseBlock = cachedChains.responseBlock;
    else if (selectors.responseBlock) chains.responseBlock = selectorToChain(selectors.responseBlock);
    if (cachedChains.readyIndicator?.length) chains.readyIndicator = cachedChains.readyIndicator;
    else if (selectors.readyIndicator) chains.readyIndicator = selectorToChain(selectors.readyIndicator);
    if (cachedChains.fileUploadTrigger?.length) chains.fileUploadTrigger = cachedChains.fileUploadTrigger;
    else if (selectors.fileUploadTrigger) chains.fileUploadTrigger = selectorToChain(selectors.fileUploadTrigger);

    const health = await probeSelectors(page, chains);
    log.info('selector_health_check', { provider, healthScore: health.healthScore, brokenSelectors: health.brokenSelectors });

    // Persist strategy tracking data
    let chainsUpdated = false;
    for (const detail of health.selectorDetails) {
      const updatedChain: SelectorChain = detail.strategies.map(sr => ({
        ...sr.strategy,
        lastWorked: sr.matched ? new Date().toISOString() : sr.strategy.lastWorked,
        failCount: sr.matched ? 0 : (sr.strategy.failCount ?? 0) + 1,
      }));
      selectorService.setCachedChain(provider, detail.name, updatedChain);
      chainsUpdated = true;
    }
    if (chainsUpdated) selectorService.persistSelectorCache();

    // Emit SSE warning if health is below warn threshold
    if (health.healthScore < SELECTOR_HEALTH_WARN_THRESHOLD) {
      this.deps.emit({
        type: WB_EVENT.SELECTOR_HEALTH_WARNING,
        payload: {
          provider,
          healthScore: health.healthScore,
          brokenSelectors: health.brokenSelectors,
        },
      });
    }

    // Re-trigger full auto-detection if health is critically low
    if (health.healthScore < SELECTOR_HEALTH_REDETECT_THRESHOLD) {
      log.warn('selector_health_redetect', { provider, healthScore: health.healthScore, threshold: SELECTOR_HEALTH_REDETECT_THRESHOLD });
      try {
        const resourceType = this.deps.getResourceType(activeAccountId);
        if (resourceType === 'video' || resourceType === 'image') {
          const detected = await autoDetectVideoSelectors(page);
          selectorService.applyDetectedVideoSelectors(provider, detected);
        } else {
          const detected = await autoDetectSelectors(page);
          selectorService.applyDetectedSelectors(provider, detected);
        }
      } catch {
        // non-critical
      }
    }
  }
}
