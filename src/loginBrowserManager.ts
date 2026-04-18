import type { BrowserContext, Page } from 'playwright';
import { launchPersistentContextWithRetry } from './browserManager.js';
import { autoDetectSelectors, autoDetectVideoSelectors, scrapeModels } from './chatAutomation.js';
import { getPreset } from './providerPresets.js';
import { isElectronShell } from './dataDir.js';
import { createLogger } from './lib/logger.js';
import type { ProviderId, ModelOption } from './types.js';
import { WB_EVENT } from './types.js';
import type { SelectorService } from './selectorService.js';
import type { ModelStore } from './modelStore.js';
import type { ResourceManager } from './resourceManager.js';

const log = createLogger('LoginBrowserManager');

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

export type LoginBrowserEventSink = {
  emit(event: { type: string; payload: unknown }): void;
  emitState(): void;
};

export type LoginBrowserDeps = {
  selectorService: SelectorService;
  modelStore: ModelStore;
  resources: ResourceManager;
  sink: LoginBrowserEventSink;
  closeBrowser(): Promise<void>;
};

/**
 * Manages login browser sessions (manual login) for individual accounts.
 * Extracted from Workbench.
 */
export class LoginBrowserManager {
  private loginSessions = new Map<string, BrowserContext>();

  constructor(private readonly deps: LoginBrowserDeps) {}

  has(accountId: string): boolean { return this.loginSessions.has(accountId); }
  keys(): IterableIterator<string> { return this.loginSessions.keys(); }

  async open(accountId: string): Promise<void> {
    if (this.loginSessions.has(accountId)) return;

    const { selectorService, resources, sink, closeBrowser, modelStore } = this.deps;
    const account = resources.get(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);

    // Release profile lock: close the active browser if it uses the same profile
    // (The caller — Workbench — passes its own closeBrowser which checks activeAccountId)

    // Determine the login URL
    let loginUrl: string;
    let isVideoProvider = false;
    try {
      const selectors = selectorService.getSelectors(account.provider);
      loginUrl = selectors.chatUrl;
    } catch {
      const preset = getPreset(account.provider);
      if (preset?.siteUrl) {
        loginUrl = preset.siteUrl;
        isVideoProvider = true;
      } else {
        throw new Error(`Unknown provider "${account.provider}". No chatUrl or siteUrl found.`);
      }
    }

    const context = await launchPersistentContextWithRetry(account.profileDir, { retries: 3, active: true });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(loginUrl, { waitUntil: 'domcontentloaded' });

    context.on('close', () => {
      this.loginSessions.delete(accountId);
      sink.emit({ type: WB_EVENT.LOGIN_BROWSER_CLOSED, payload: { accountId } });
      sink.emitState();
    });

    this.loginSessions.set(accountId, context);
    sink.emit({ type: WB_EVENT.LOGIN_BROWSER_OPENED, payload: { accountId } });
    sink.emitState();

    // Auto-detect in the background
    if (!isVideoProvider) {
      const selectors = selectorService.getSelectors(account.provider);
      page.waitForSelector(selectors.readyIndicator, { timeout: 15_000 })
        .catch((e: unknown) => {
          log.warn('ready_indicator_not_found', { context: 'login', error: e instanceof Error ? e.message : String(e) });
        })
        .then(() => page.waitForTimeout(3_000))
        .then(() => this.autoDetectModels(page, account.provider))
        .catch((e: unknown) => {
          log.warn('auto_detect_models_failed', { context: 'login', error: e instanceof Error ? e.message : String(e) });
        });
    } else {
      (async () => {
        try {
          await page.waitForTimeout(5_000);
          const detected = await autoDetectVideoSelectors(page);
          log.info('video_selectors_auto_detected', { provider: account.provider });
          selectorService.applyDetectedVideoSelectors(account.provider, detected);
        } catch {
          // non-critical
        }
      })();
    }
  }

  async close(accountId: string): Promise<void> {
    const ctx = this.loginSessions.get(accountId);
    if (!ctx) return;
    this.loginSessions.delete(accountId);
    await ctx.close().catch((e: unknown) => log.warn('browser_context_close_failed', { context: 'login', error: String(e) }));
    if (isElectronShell()) {
      await delay(500);
    } else {
      await delay(500);
    }
    this.deps.sink.emit({ type: WB_EVENT.LOGIN_BROWSER_CLOSED, payload: { accountId } });
    this.deps.sink.emitState();
  }

  async openWithAutoDetect(
    accountId: string,
    chatUrl: string,
    providerId: string,
    isBuiltin: boolean,
  ): Promise<void> {
    if (this.loginSessions.has(accountId)) return;

    const { selectorService, resources, sink } = this.deps;
    const account = resources.get(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);

    const context = await launchPersistentContextWithRetry(account.profileDir, { retries: 3, active: true });
    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(chatUrl, { waitUntil: 'domcontentloaded' });

    context.on('close', () => {
      this.loginSessions.delete(accountId);
      sink.emit({ type: WB_EVENT.LOGIN_BROWSER_CLOSED, payload: { accountId } });
      sink.emitState();
    });

    this.loginSessions.set(accountId, context);
    sink.emit({ type: WB_EVENT.LOGIN_BROWSER_OPENED, payload: { accountId } });
    sink.emitState();

    // Background: auto-detect selectors + models
    (async () => {
      try {
        await page.waitForTimeout(5_000);
        const detected = await autoDetectSelectors(page);
        log.info('selectors_auto_detected', { provider: providerId });
        selectorService.applyDetectedSelectors(providerId, detected);
        await this.autoDetectModels(page, providerId);
      } catch {
        // non-critical
      }
    })();
  }

  /** Run model detection on a page. Results stored in modelStore. */
  async autoDetectModels(page: Page, provider: ProviderId): Promise<void> {
    const { selectorService, modelStore, sink } = this.deps;
    try {
      const selectors = selectorService.getSelectors(provider);
      const scraped = await scrapeModels(page, selectors);
      if (scraped.length > 0) {
        const models: ModelOption[] = scraped.map((m) => ({
          id: m.id,
          label: m.label,
          selectSteps: selectors.modelPickerTrigger
            ? [selectors.modelPickerTrigger, `text=${m.label}`]
            : undefined,
        }));
        modelStore.set(provider, models);
        sink.emit({ type: WB_EVENT.MODELS_DETECTED, payload: { provider, models } });
        sink.emitState();
      }
    } catch (err) {
      log.warn('auto_detect_models_failed', { provider, error: err instanceof Error ? err.message : String(err) });
    }
  }
}
