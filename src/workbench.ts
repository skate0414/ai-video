import { type BrowserContext, type Page } from 'playwright';
import fs from 'node:fs/promises';
import path, { join, dirname } from 'node:path';
import { execSync } from 'node:child_process';
import { TaskQueue } from './taskQueue.js';
import { ResourceManager } from './resourceManager.js';
import { PROVIDER_MODELS, BUILTIN_PROVIDER_IDS } from './providers.js';
import { openChat, sendPrompt, selectModel, scrapeModels, checkQuotaExhausted, uploadFiles, typePromptText, autoDetectSelectors, autoDetectVideoSelectors } from './chatAutomation.js';
import { matchPresetByUrl } from './providerPresets.js';
import { STEALTH_ARGS, launchPersistentContextWithRetry } from './browserManager.js';
import { isElectronShell } from './dataDir.js';
import { quotaBus } from './quotaBus.js';
import type { Account, AiResource, AiResourceType, WorkbenchEvent, WorkbenchState, ProviderSelectors, ProviderId, BuiltinProviderId, ChatMode, ModelOption, ProviderInfo, SelectorChain, TaskItem } from './types.js';
import { WB_EVENT } from './types.js';
import { createLogger } from './lib/logger.js';
import { ModelStore } from './modelStore.js';
import { CustomProviderStore } from './customProviderStore.js';
import { SelectorService } from './selectorService.js';
import { HealthMonitor } from './healthMonitor.js';
import { LoginBrowserManager } from './loginBrowserManager.js';

const log = createLogger('Workbench');

export type EventListener = (event: WorkbenchEvent) => void;

/** Small helper to wait for Chrome to release a profile directory lock. */
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Launch a persistent browser context with retry.
 * Delegates to the shared BrowserManager implementation.
 */
async function launchWithRetry(
  profileDir: string,
  _stealthArgs: readonly string[],
  retries = 3,
  options?: { active?: boolean },
): Promise<BrowserContext> {
  return launchPersistentContextWithRetry(profileDir, { retries, active: options?.active });
}

/**
 * Fuzzy-match a preferred model name against available ModelOptions.
 *
 * Matching priority:
 * 1. Exact id match
 * 2. Case-insensitive id or label match
 * 3. Normalized match (strip non-alphanumeric)
 * 4. Tail-word match (last word of preferredModel, e.g. "Pro" in "Gemini 3.1 Pro")
 */
function findModelMatch(models: readonly ModelOption[], preferredModel: string): ModelOption | undefined {
  // 1. Exact id
  let match = models.find(m => m.id === preferredModel);
  if (match) return match;

  // 2. Case-insensitive id or label
  const lower = preferredModel.toLowerCase();
  match = models.find(m => m.id.toLowerCase() === lower || m.label.toLowerCase() === lower);
  if (match) return match;

  // 3. Normalized (remove all non-alphanumeric)
  const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, '');
  const target = normalize(preferredModel);
  match = models.find(m => normalize(m.id) === target || normalize(m.label) === target);
  if (match) return match;

  // 4. Tail-word match — e.g. "Gemini 3.1 Pro" → "pro" matches id "pro"
  const words = preferredModel.trim().split(/\s+/);
  if (words.length > 1) {
    const tail = words[words.length - 1].toLowerCase();
    if (tail.length >= 2) {
      match = models.find(m => m.id.toLowerCase() === tail || m.label.toLowerCase() === tail);
      if (match) return match;
    }
  }

  return undefined;
}

/**
 * The core automation engine.
 *
 * Coordinates the task queue, account manager, and Playwright sessions
 * to process batch questions through free-tier AI chat websites.
 */
export class Workbench {
  readonly tasks = new TaskQueue();
  readonly resources: ResourceManager;

  private readonly modelStore: ModelStore;
  private readonly customProviderStore: CustomProviderStore;
  private readonly dataDir: string;
  readonly selectorService: SelectorService;
  private readonly healthMonitor: HealthMonitor;
  readonly loginBrowser: LoginBrowserManager;

  constructor(savePath?: string, skipSeed?: boolean) {
    this.resources = new ResourceManager(savePath, skipSeed);
    const dataDir = dirname(savePath ?? join(process.cwd(), 'data', 'resources.json'));
    this.dataDir = dataDir;
    const modelsSavePath = skipSeed ? '' : join(dataDir, 'models.json');
    const providersSavePath = skipSeed ? '' : join(dataDir, 'providers.json');
    const selectorCachePath = skipSeed ? '' : join(dataDir, 'selector-cache.json');
    this.modelStore = new ModelStore(modelsSavePath);
    this.customProviderStore = new CustomProviderStore(providersSavePath);

    const sink = {
      emit: (event: WorkbenchEvent) => this.emit(event),
      emitState: () => this.emitState(),
    };

    this.selectorService = new SelectorService(selectorCachePath, this.customProviderStore, this.resources, sink);

    this.healthMonitor = new HealthMonitor({
      selectorService: this.selectorService,
      getActivePage: () => this.activePage,
      getActiveAccountId: () => this.activeAccountId,
      getResourceType: (id) => this.resources.get(id)?.type,
      getResourceProvider: (id) => this.resources.get(id)?.provider,
      emit: (event) => this.emit(event as WorkbenchEvent),
    });

    this.loginBrowser = new LoginBrowserManager({
      selectorService: this.selectorService,
      modelStore: this.modelStore,
      resources: this.resources,
      sink,
      closeBrowser: () => this.closeBrowser(),
    });
  }

  /** Custom selector overrides keyed by provider id. */

  private running = false;
  /** Manual/default chat mode exposed to the UI. */
  private defaultChatMode: ChatMode = 'new';
  private abortController: AbortController | null = null;

  private activeContext: BrowserContext | null = null;
  private activePage: Page | null = null;
  private activeAccountId: string | null = null;
  /** Tracks which logical chat session the active page currently represents. */
  private activeChatSessionId: string | null = null;

  private listeners: EventListener[] = [];

  /* -------------------------------------------------------------- */
  /*  Event helpers                                                  */
  /* -------------------------------------------------------------- */

  onEvent(fn: EventListener): () => void {
    this.listeners.push(fn);
    return () => {
      this.listeners = this.listeners.filter((l) => l !== fn);
    };
  }

  private emit(event: WorkbenchEvent): void {
    for (const fn of this.listeners) fn(event);
  }

  private emitState(): void {
    this.emit({ type: WB_EVENT.STATE, payload: this.getState() });
  }

  /* -------------------------------------------------------------- */
  /*  Selector cache persistence — delegated to SelectorService     */
  /* -------------------------------------------------------------- */

  getProviderList(): ProviderInfo[] {
    return this.customProviderStore.getProviderList();
  }

  addCustomProvider(id: string, label: string, selectors: ProviderSelectors): ProviderInfo {
    if (BUILTIN_PROVIDER_IDS.includes(id as BuiltinProviderId)) {
      throw new Error(`Cannot overwrite built-in provider "${id}"`);
    }
    this.customProviderStore.set(id, { label, selectors });
    this.emitState();
    return { id, label, builtin: false };
  }

  removeCustomProvider(id: string): boolean {
    if (!this.customProviderStore.remove(id)) return false;
    this.emitState();
    return true;
  }

  /**
   * Add a custom provider from just a Chat URL.
   *
   * Automatically:
   * 1. Derives provider ID and label from the URL domain
   * 2. Creates a browser profile directory
   * 3. Opens a login browser for the user
   * 4. After the page loads, auto-detects CSS selectors and models
   *
   * Returns the created account ID so the frontend can track it.
   */
  async addProviderFromUrl(chatUrl: string, typeOverride?: string): Promise<{ providerId: string; accountId: string }> {
    const url = new URL(chatUrl);
    const host = url.hostname.replace(/^www\./, '');
    // Derive provider ID from domain: "claude.ai" → "claude", "chat.deepseek.com" → "deepseek"
    const parts = host.split('.');
    const providerId = parts.length >= 2
      ? (parts[0] === 'chat' || parts[0] === 'app' ? parts[1] : parts[0])
      : parts[0];

    // Derive display label: capitalize first letter
    const label = providerId.charAt(0).toUpperCase() + providerId.slice(1);

    // Try to match a preset to determine the resource type and selectors
    const matchedPreset = matchPresetByUrl(chatUrl);
    // User override > preset > default 'chat'
    const validTypes: AiResourceType[] = ['chat', 'video', 'image', 'multi'];
    const resourceType: AiResourceType = (typeOverride && validTypes.includes(typeOverride as AiResourceType))
      ? typeOverride as AiResourceType
      : matchedPreset?.type ?? 'chat';

    // Check if this is a built-in provider — if so, skip provider creation
    const isBuiltin = BUILTIN_PROVIDER_IDS.includes(providerId as BuiltinProviderId);
    // Also check if already exists as custom
    const existingCustom = this.customProviderStore.get(providerId);

    if (!isBuiltin && !existingCustom) {
      // Create custom provider with placeholder selectors (will be auto-detected)
      const selectors: ProviderSelectors = {
        chatUrl,
        promptInput: 'textarea',
        responseBlock: '[class*="markdown"]',
        readyIndicator: 'textarea',
      };
      this.customProviderStore.set(providerId, { label, selectors });
    } else if (!isBuiltin && existingCustom) {
      // Update URL if provider already exists
      existingCustom.selectors.chatUrl = chatUrl;
      this.customProviderStore.persist();
    }

    // Auto-generate profile directory
    const dataDir = this.dataDir;
    const existingResources = this.resources.all().filter((a) => a.provider === providerId);
    const suffix = existingResources.length > 0 ? `-${existingResources.length + 1}` : '';
    const profileDir = join(dataDir, 'profiles', `${providerId}${suffix}`);

    // Create the resource with the detected type
    const resourceLabel = `${label}${suffix ? ' ' + (existingResources.length + 1) : ''}`;
    const capabilities: Record<string, boolean> = {};
    if (resourceType === 'chat' || resourceType === 'multi') capabilities.text = true;
    if (resourceType === 'video' || resourceType === 'multi') capabilities.video = true;
    if (resourceType === 'image' || resourceType === 'multi') capabilities.image = true;
    if (matchedPreset?.capabilities) {
      if (matchedPreset.capabilities.fileUpload) capabilities.fileUpload = true;
      if (matchedPreset.capabilities.webSearch) capabilities.webSearch = true;
    }

    // Convert SelectorChain arrays from preset to flat CSS strings for AiResource
    let flatSelectors: AiResource['selectors'] | undefined;
    if (matchedPreset?.selectors) {
      const pick = (chain?: { selector: string; method: string; priority: number }[]): string | undefined => {
        if (!chain || chain.length === 0) return undefined;
        const css = chain.filter((s) => s.method === 'css').sort((a, b) => b.priority - a.priority);
        return css.length > 0 ? css[0].selector : chain[0].selector;
      };
      const s = matchedPreset.selectors;
      flatSelectors = {
        promptInput: pick(s.promptInput),
        generateButton: pick(s.generateButton),
        sendButton: pick(s.sendButton),
        responseBlock: pick(s.responseBlock),
        readyIndicator: pick(s.readyIndicator),
        resultElement: pick(s.resultElement),
        progressIndicator: pick(s.progressIndicator),
        downloadButton: pick(s.downloadButton),
        imageUploadTrigger: pick(s.imageUploadTrigger),
      };
    }

    const resource = this.resources.addResource({
      type: resourceType,
      provider: providerId,
      label: resourceLabel,
      siteUrl: chatUrl,
      profileDir,
      capabilities,
      selectors: flatSelectors,
      timing: matchedPreset?.timing,
      queueDetection: matchedPreset?.queueDetection,
      dailyLimits: matchedPreset?.dailyLimits,
    });

    this.emitState();

    // Open login browser automatically
    await this.loginBrowser.openWithAutoDetect(resource.id, chatUrl, providerId, isBuiltin);

    return { providerId, accountId: resource.id };
  }

  /* -------------------------------------------------------------- */
  /*  State                                                         */
  /* -------------------------------------------------------------- */

  getState(): WorkbenchState {
    return {
      accounts: this.resources.allAccounts(),
      resources: this.resources.all(),
      tasks: this.tasks.all(),
      isRunning: this.running,
      chatMode: this.defaultChatMode,
      providers: this.getProviderList(),
      detectedModels: this.modelStore.getAll(),
      currentTaskId: this.tasks.all().find((t) => t.status === 'running')?.id,
      activeAccountId: this.activeAccountId ?? undefined,
      loginOpenAccountIds: [...this.loginBrowser.keys()],
    };
  }

  /* -------------------------------------------------------------- */
  /*  Chat mode                                                     */
  /* -------------------------------------------------------------- */

  setChatMode(mode: ChatMode): void {
    this.defaultChatMode = mode;
    this.emitState();
  }

  /* -------------------------------------------------------------- */
  /*  Model detection                                               */
  /* -------------------------------------------------------------- */

  /**
   * Detect available models for a provider by scanning the page DOM.
   *
   * **Best results**: open a Login browser first, navigate to the chat page,
   * manually click the model picker to open the dropdown, then call this.
   * The scraper will read whatever is currently visible on the page.
   *
   * If no login browser is open, a temporary browser is launched instead.
   */
  async detectModels(provider: ProviderId): Promise<readonly ModelOption[]> {
    const account = this.resources.all().find((a) => a.provider === provider);
    if (!account) throw new Error(`No account for provider "${provider}". Add one first.`);

    let ctx: BrowserContext | undefined;
    let needClose = false;

    if (this.loginBrowser.has(account.id)) {
      // Reuse the login session — but we need the BrowserContext.
      // detectModels must open a temporary browser if no login session exists.
      // Since login sessions are now private, launch a temp browser.
    }

    if (!ctx) {
      ctx = await launchWithRetry(account.profileDir, STEALTH_ARGS);
      needClose = true;
    }

    try {
      const selectors = this.getSelectors(provider);
      const page = ctx.pages()[0] ?? (await ctx.newPage());
      await page.goto(selectors.chatUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
      await page.waitForSelector(selectors.readyIndicator, { timeout: 15_000 }).catch((e: unknown) => {
        log.warn('ready_indicator_not_found', { context: 'model_detection', error: e instanceof Error ? e.message : String(e) });
      });
      await page.waitForTimeout(3_000);

      const scraped = await scrapeModels(page, selectors);
      if (scraped.length > 0) {
        const models: ModelOption[] = scraped.map((m) => ({
          id: m.id,
          label: m.label,
          selectSteps: selectors.modelPickerTrigger
            ? [selectors.modelPickerTrigger, `text=${m.label}`]
            : undefined,
        }));
        this.modelStore.set(provider, models);
        this.emit({ type: WB_EVENT.MODELS_DETECTED, payload: { provider, models } });
        this.emitState();
        return models;
      }

      log.warn('detect_models_empty', { provider });
      return this.getModels(provider);
    } finally {
      if (needClose) {
        await ctx.close().catch((e: unknown) => log.warn('browser_context_close_failed', { context: 'model_detection', error: String(e) }));
      }
    }
  }

  /* -------------------------------------------------------------- */
  /*  Selector overrides — delegated to SelectorService              */
  /* -------------------------------------------------------------- */

  setProviderSelectors(provider: ProviderId, overrides: Partial<ProviderSelectors>): void {
    this.selectorService.setProviderSelectors(provider, overrides);
  }

  getSelectors(provider: ProviderId): ProviderSelectors {
    return this.selectorService.getSelectors(provider);
  }

  getModels(provider: ProviderId): readonly ModelOption[] {
    return this.modelStore.get(provider) ?? PROVIDER_MODELS[provider] ?? [{ id: 'default', label: 'Default' }];
  }

  /* -------------------------------------------------------------- */
  /*  Login browser — delegated to LoginBrowserManager               */
  /* -------------------------------------------------------------- */

  async openLoginBrowser(accountId: string): Promise<void> {
    // Release profile lock: close the active browser if it uses the same profile
    if (this.activeAccountId === accountId) {
      await this.closeBrowser();
      await delay(500);
    }
    await this.loginBrowser.open(accountId);
  }

  async closeLoginBrowser(accountId: string): Promise<void> {
    await this.loginBrowser.close(accountId);
  }

  /* -------------------------------------------------------------- */
  /*  Browser lifecycle                                             */
  /* -------------------------------------------------------------- */

  private requiresFreshChat(task: TaskItem): boolean {
    const taskChatMode = task.chatMode ?? this.defaultChatMode;
    if (taskChatMode === 'new') return true;
    if (task.sessionId) {
      return this.activeChatSessionId !== task.sessionId;
    }
    return false;
  }

  private syncActiveTaskSession(task: TaskItem): void {
    this.activeChatSessionId = task.sessionId ?? null;
  }

  /**
   * Register crash/close listeners on the active page and context so the
   * workbench learns about browser failures immediately (milliseconds)
   * instead of waiting for a 120s timeout on the next Playwright operation.
   */
  private registerActivePageListeners(page: Page, context: BrowserContext): void {
    const onCrash = () => {
      if (this.activePage !== page) return; // stale listener
      const accountId = this.activeAccountId ?? 'unknown';
      log.warn('active_page_crashed', { accountId });
      // Force-close the page so any in-flight Playwright operations (e.g. sendPrompt)
      // throw immediately instead of hanging until timeout.
      page.close().catch(() => {});
      this.activePage = null;
      this.activeContext = null;
      this.activeAccountId = null;
      this.activeChatSessionId = null;
      this.emit({ type: WB_EVENT.ACTIVE_PAGE_CRASHED, payload: { accountId, reason: 'page_crash' } });
      this.emitState();
    };

    const onClose = () => {
      if (this.activeContext !== context) return; // stale listener
      const accountId = this.activeAccountId ?? 'unknown';
      log.warn('active_context_closed', { accountId });
      this.activePage = null;
      this.activeContext = null;
      this.activeAccountId = null;
      this.activeChatSessionId = null;
      this.emit({ type: WB_EVENT.ACTIVE_PAGE_CRASHED, payload: { accountId, reason: 'context_closed' } });
      this.emitState();
    };

    // Also listen for the page being closed (e.g. user closes tab in Electron)
    const onPageClose = () => {
      if (this.activePage !== page) return;
      const accountId = this.activeAccountId ?? 'unknown';
      log.warn('active_page_closed_externally', { accountId });
      this.activePage = null;
      this.activeContext = null;
      this.activeAccountId = null;
      this.activeChatSessionId = null;
      this.emit({ type: WB_EVENT.ACTIVE_PAGE_CRASHED, payload: { accountId, reason: 'page_closed' } });
      this.emitState();
    };

    page.on('crash', onCrash);
    page.on('close', onPageClose);
    context.on('close', onClose);
  }

  private async ensureBrowser(account: Account, task: TaskItem): Promise<Page> {
    // If we're already using this account, reuse context
    if (this.activeAccountId === account.id && this.activePage && this.activeContext) {
      // Verify the context/page is still alive before reusing
      try {
        await this.activePage.title();
      } catch {
        log.warn('browser_context_died');
        await this.closeBrowser();
        // Fall through to create a fresh browser below
      }

      if (this.activeContext) {
        // Use task-scoped chat semantics so queued requests can't overwrite one another.
        if (this.requiresFreshChat(task)) {
          const selectors = this.getSelectors(account.provider);
          try {
            if ((task.chatMode ?? this.defaultChatMode) === 'continue' && task.sessionId && this.activeChatSessionId !== task.sessionId) {
              log.warn('session_mismatch_fresh_chat', { requestedSession: task.sessionId });
            }
            this.activePage = await openChat(this.activeContext, selectors);
            this.syncActiveTaskSession(task);
          } catch (e) {
            // Browser may have crashed between title check and openChat
            log.warn('open_chat_failed_recreating', { error: e instanceof Error ? e.message : String(e) });
            await this.closeBrowser();
            // Fall through to create a fresh browser below
          }
        }
        if (this.activeContext) {
          return this.activePage!;
        }
      }
    }

    // Close previous context if switching accounts
    await this.closeBrowser();

    // Release profile lock: close login session if this account has one open
    if (this.loginBrowser.has(account.id)) {
      await this.closeLoginBrowser(account.id);
    }

    const selectors = this.getSelectors(account.provider);
    const context = await launchWithRetry(account.profileDir, STEALTH_ARGS);

    const page = await openChat(context, selectors);
    this.activeContext = context;
    this.activePage = page;
    this.activeAccountId = account.id;
    this.syncActiveTaskSession(task);

    // --- Register crash/close listeners for proactive cleanup ---
    this.registerActivePageListeners(page, context);

    if ((task.chatMode ?? this.defaultChatMode) === 'continue' && task.sessionId) {
      log.warn('session_no_reusable_page', { sessionId: task.sessionId });
    }

    // Auto-detect selectors + models in the background
    // Choose video vs chat detection based on the resource type
    const resource = this.resources.get(account.id);
    const resourceType = resource?.type;
    (async () => {
      try {
        if (resourceType === 'video' || resourceType === 'image') {
          const detected = await autoDetectVideoSelectors(page);
          log.info('video_selectors_auto_detected', { provider: account.provider });
          this.selectorService.applyDetectedVideoSelectors(account.provider, detected);
        } else {
          const detected = await autoDetectSelectors(page);
          log.info('selectors_auto_detected', { provider: account.provider });
          this.selectorService.applyDetectedSelectors(account.provider, detected);
        }
      } catch {
        // non-critical
      }
    })();

    // Auto-detect models in the background if not yet detected for this provider
    if (!this.modelStore.hasModels(account.provider)) {
      this.loginBrowser.autoDetectModels(page, account.provider).catch((e: unknown) => {
        log.warn('auto_detect_models_failed', { error: e instanceof Error ? e.message : String(e) });
      });
    }

    return page;
  }

  private async closeBrowser(): Promise<void> {
    if (this.activeContext) {
      // Capture profile dir before nulling state
      const account = this.activeAccountId ? this.resources.get(this.activeAccountId) : null;
      const profileDir = account?.profileDir;

      // Close page explicitly before context to avoid orphaned page handles
      if (this.activePage) {
        await this.activePage.close().catch((e: unknown) => log.warn('active_page_close_failed', { error: String(e) }));
      }
      // Guard: the page 'close' event handler may have already nulled activeContext
      if (this.activeContext) {
        await this.activeContext.close().catch((e: unknown) => log.warn('browser_context_close_failed', { context: 'active', error: String(e) }));
      }
      this.activeContext = null;
      this.activePage = null;
      this.activeAccountId = null;
      this.activeChatSessionId = null;

      // In Electron mode, also release the electronBridge tab cache so
      // stale entries don't cause "Target page has been closed" errors.
      if (isElectronShell() && profileDir) {
        try {
          const { releaseElectronContext } = await import('./electronBridge.js');
          await releaseElectronContext(profileDir);
        } catch {}
      } else if (!isElectronShell()) {
        // Give Chrome time to release profile locks
        await delay(2_000);

        // Kill any lingering Chrome processes still using the profile
        if (profileDir) {
          try {
            const pids = execSync(
              `lsof +D "${profileDir}" 2>/dev/null | grep Chrome | awk '{print $2}' | sort -u`,
              { encoding: 'utf8', timeout: 5000 },
            ).trim().split('\n').filter(Boolean);
            for (const pid of pids) {
              try { process.kill(Number(pid), 'SIGTERM'); } catch {}
            }
            if (pids.length) {
              log.warn('chrome_lingering_processes_killed', { pidCount: pids.length });
              await delay(2000);
            }
          } catch {}
          // Remove stale singleton lock
          await fs.unlink(path.join(profileDir, 'SingletonLock')).catch(() => {});
        }
      }
    }
  }

  /* -------------------------------------------------------------- */
  /*  Selector health monitoring — delegated to HealthMonitor       */
  /* -------------------------------------------------------------- */

  startHealthMonitor(): void { this.healthMonitor.start(); }
  stopHealthMonitor(): void { this.healthMonitor.stop(); }

  /* -------------------------------------------------------------- */
  /*  Main loop                                                     */
  /* -------------------------------------------------------------- */

  async start(): Promise<void> {
    if (this.running) return;

    // Close all login browser sessions to release profile locks
    for (const accountId of [...this.loginBrowser.keys()]) {
      await this.closeLoginBrowser(accountId);
    }

    this.running = true;
    this.abortController = new AbortController();
    this.startHealthMonitor();
    this.emitState();

    try {
      await this.processLoop();
    } finally {
      this.running = false;
      this.stopHealthMonitor();
      // Don't close browser immediately — callers (e.g. chatAdapter.generateImage)
      // may still need the active page for image extraction after submitAndWait returns.
      // The browser will be closed by ensureBrowser() when switching providers,
      // or by an explicit stop() call.
      this.emit({ type: WB_EVENT.STOPPED, payload: {} });
      this.emitState();
    }
  }

  stop(): void {
    this.abortController?.abort();
    this.stopHealthMonitor();
  }

  private async processLoop(): Promise<void> {
    while (!this.abortController?.signal.aborted) {
      const task = this.tasks.next();
      if (!task) break; // No more pending tasks

      log.info('task_start', { taskId: task.id, provider: task.preferredProvider, model: task.preferredModel, questionLength: task.question.length });

      const account = this.resources.pickAccount(task.preferredProvider);
      if (!account) {
        log.error('task_no_accounts', undefined, { taskId: task.id, provider: task.preferredProvider });
        this.tasks.markFailed(task.id, 'No accounts available with remaining quota');
        this.emit({ type: WB_EVENT.TASK_FAILED, payload: { taskId: task.id, error: 'No accounts available' } });
        this.emitState();
        break;
      }

      this.tasks.markRunning(task.id, account.id);
      log.info('task_account_selected', { taskId: task.id, accountId: account.id, provider: account.provider });
      this.emit({ type: WB_EVENT.TASK_STARTED, payload: { taskId: task.id, accountId: account.id } });
      this.emitState();

      try {
        const page = await this.ensureBrowser(account, task);

        // Check quota before sending
        const selectors = this.getSelectors(account.provider);
        if (await checkQuotaExhausted(page, selectors)) {
          log.warn('task_quota_exhausted_before_send', { taskId: task.id, accountId: account.id });
          await this.handleQuotaExhausted(account, task.id);
          continue; // retry with new account
        }

        // Select the requested model/mode if specified
        if (task.preferredModel) {
          const models = this.getModels(account.provider);
          const model = findModelMatch(models, task.preferredModel);
          log.info('task_selecting_model', { taskId: task.id, preferredModel: task.preferredModel, matchedId: model?.id });
          await selectModel(page, model);
        }

        // Upload attachments if any
        // Flow: type text FIRST → upload files → send (skip typing)
        // Gemini's send button only appears when BOTH text is present AND
        // the file upload is complete. By typing first, waitForUploadCompletion
        // can reliably detect the send button becoming ready.
        if (task.attachments?.length) {
          log.info('task_uploading_attachments', { taskId: task.id, attachmentCount: task.attachments.length });
          await typePromptText(page, task.question, selectors);
          await uploadFiles(page, task.attachments, selectors);
        }

        const result = await sendPrompt(page, task.question, selectors,
          task.attachments?.length
            ? { responseTimeout: 540_000, sendButtonTimeout: 600_000, textAlreadyTyped: true }
            : undefined);

        // Detect quota exhaustion from response text as well (covers cases where DOM indicator is missing)
        const quotaTextSignal = /usage cap|free plan limit|image generation requests|rate limit|too many requests/i.test(result.answer || '');
        if (quotaTextSignal && !result.quotaExhausted) {
          log.warn('task_quota_text_signal', { taskId: task.id, accountId: account.id });
          result.quotaExhausted = true;
        }

        if (result.quotaExhausted) {
          log.warn('task_quota_exhausted_after_response', { taskId: task.id, accountId: account.id });
          // Save partial answer if any, then switch account
          if (result.answer) {
            log.info('task_done_partial', { taskId: task.id, answerLength: result.answer.length });
            this.tasks.markDone(task.id, result.answer);
            this.emit({ type: WB_EVENT.TASK_DONE, payload: { taskId: task.id, answer: result.answer } });
            this.resolveWaiter(task.id, result.answer);
          } else {
            log.warn('task_failed_quota_no_answer', { taskId: task.id });
            this.tasks.markFailed(task.id, 'Quota exhausted before response');
            this.emit({ type: WB_EVENT.TASK_FAILED, payload: { taskId: task.id, error: 'Quota exhausted' } });
            this.rejectWaiter(task.id, 'Quota exhausted before response');
          }
          await this.handleQuotaExhausted(account, task.id);
        } else {
          log.info('task_done', { taskId: task.id, answerLength: result.answer.length });
          this.tasks.markDone(task.id, result.answer);
          this.emit({ type: WB_EVENT.TASK_DONE, payload: { taskId: task.id, answer: result.answer } });
          this.resolveWaiter(task.id, result.answer);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        log.error('task_error', err instanceof Error ? err : undefined, { taskId: task.id, error: message });
        this.tasks.markFailed(task.id, message);
        this.emit({ type: WB_EVENT.TASK_FAILED, payload: { taskId: task.id, error: message } });
        this.rejectWaiter(task.id, message);

        // If the page/context was closed or corrupted, reset so ensureBrowser creates a fresh one
        if (this.activePage) {
          try {
            // A lightweight probe: if the page is dead this will throw
            await this.activePage.title();
          } catch {
            log.warn('page_unusable_after_error', { taskId: task.id });
            await this.closeBrowser();
          }
        }
      }

      this.emitState();
    }
  }

  private async handleQuotaExhausted(account: Account, _taskId: string): Promise<void> {
    this.resources.markQuotaExhausted(account.id);
    this.emit({ type: WB_EVENT.QUOTA_EXHAUSTED, payload: { accountId: account.id } });

    // Broadcast to unified quota bus so image/video subsystems are aware
    quotaBus.emit({
      provider: account.provider,
      accountId: account.id,
      capability: 'text',
      exhausted: true,
      reason: `Account ${account.id} quota exhausted`,
    });

    // Try to switch to another account
    const next = this.resources.pickAccount();
    if (next) {
      this.emit({
        type: WB_EVENT.ACCOUNT_SWITCHED,
        payload: { fromAccountId: account.id, toAccountId: next.id },
      });
      await this.closeBrowser();
    }
    this.emitState();
  }

  /* -------------------------------------------------------------- */
  /*  Pipeline integration: submitAndWait                           */
  /* -------------------------------------------------------------- */

  /** Pending promise resolvers keyed by task id. */
  private waitResolvers = new Map<string, { resolve: (answer: string) => void; reject: (err: Error) => void }>();

  /**
   * Submit a single question and wait for the answer.
   * Used by ChatAdapter to bridge the pipeline's synchronous API calls
   * to the workbench's asynchronous chat automation.
   */
  async submitAndWait(opts: {
    question: string;
    preferredProvider?: ProviderId;
    preferredModel?: string;
    attachments?: string[];
    timeoutMs?: number;
    signal?: AbortSignal;
    /** If true, continue in the same chat (don't open a new page). */
    useSameChat?: boolean;
    /** Named session ID for grouping related requests. */
    sessionId?: string;
  }): Promise<string> {
    if (opts.signal?.aborted) {
      throw new Error('Chat request aborted before submission');
    }

    const taskChatMode: ChatMode = opts.useSameChat
      ? 'continue'
      : opts.sessionId
        ? 'new'
        : this.defaultChatMode;

    // Add the task to the queue
    const [task] = this.tasks.add(
      [opts.question],
      opts.preferredProvider,
      opts.preferredModel,
      opts.attachments,
      {
        chatMode: taskChatMode,
        sessionId: opts.sessionId,
      },
    );

    log.info('submit_and_wait', { taskId: task.id, chatMode: taskChatMode, sessionId: opts.sessionId, timeoutMs: opts.timeoutMs ?? 180_000 });

    // Create a promise that resolves when the task completes
    const promise = new Promise<string>((resolve, reject) => {
      this.waitResolvers.set(task.id, { resolve, reject });
    });

    // Set up timeout
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const timeoutId = setTimeout(() => {
      const resolver = this.waitResolvers.get(task.id);
      if (resolver) {
        log.error('submit_and_wait_timeout', undefined, { taskId: task.id, timeoutMs });
        this.waitResolvers.delete(task.id);
        resolver.reject(new Error(`Chat response timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    const onAbort = () => {
      const resolver = this.waitResolvers.get(task.id);
      if (resolver) {
        log.warn('submit_and_wait_aborted', { taskId: task.id });
        this.waitResolvers.delete(task.id);
        resolver.reject(new Error('Chat request aborted'));
      }
    };

    opts.signal?.addEventListener('abort', onAbort, { once: true });

    // If the workbench isn't running, start the processing loop
    if (!this.running) {
      this.start().catch((e: unknown) => log.warn('processing_loop_start_failed', { error: String(e) }));
    }

    try {
      const answer = await promise;
      return answer;
    } finally {
      clearTimeout(timeoutId);
      opts.signal?.removeEventListener('abort', onAbort);
    }
  }

  /**
   * Called internally when a task completes to resolve waiting promises.
   * Must be called after markDone/markFailed in processLoop.
   */
  private resolveWaiter(taskId: string, answer: string): void {
    const resolver = this.waitResolvers.get(taskId);
    if (resolver) {
      this.waitResolvers.delete(taskId);
      resolver.resolve(answer);
    }
  }

  private rejectWaiter(taskId: string, error: string): void {
    const resolver = this.waitResolvers.get(taskId);
    if (resolver) {
      this.waitResolvers.delete(taskId);
      resolver.reject(new Error(error));
    }
  }

  /* -------------------------------------------------------------- */
  /*  Pipeline integration: page access for image extraction        */
  /* -------------------------------------------------------------- */

  /**
   * Return the currently active Playwright page (if any).
   * Used by ChatAdapter to extract images from the latest chat response.
   */
  getActivePage(): Page | null {
    return this.activePage;
  }

  /**
   * Return the ID of the account currently driving the active browser.
   * Used by ChatAdapter to mark per-account quota exhaustion.
   */
  getActiveAccountId(): string | null {
    return this.activeAccountId;
  }

  /**
   * Return the selectors for the currently active account's provider.
   */
  getActiveSelectors(): ProviderSelectors | null {
    if (!this.activeAccountId) return null;
    const account = this.resources.get(this.activeAccountId);
    if (!account) return null;
    try {
      return this.getSelectors(account.provider);
    } catch {
      return null;
    }
  }

  /**
   * Return a SelectorChain for a specific field of the active provider.
   * Checks selectorChainCache first, then falls back to preset chains.
   */
  getActiveSelectorChain(field: string): SelectorChain | undefined {
    if (!this.activeAccountId) return undefined;
    const account = this.resources.get(this.activeAccountId);
    if (!account) return undefined;
    return this.selectorService.getSelectorChain(account.provider, field);
  }
}
