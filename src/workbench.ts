import { chromium, type BrowserContext, type Page } from 'playwright';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { TaskQueue } from './taskQueue.js';
import { AccountManager } from './accountManager.js';
import { DEFAULT_PROVIDERS, PROVIDER_MODELS, BUILTIN_PROVIDER_IDS, BUILTIN_PROVIDER_LABELS } from './providers.js';
import { openChat, sendPrompt, selectModel, scrapeModels, checkQuotaExhausted, uploadFiles, autoDetectSelectors } from './chatAutomation.js';
import type { Account, WorkbenchEvent, WorkbenchState, ProviderSelectors, ProviderId, BuiltinProviderId, ChatMode, ModelOption, ProviderInfo } from './types.js';

export type EventListener = (event: WorkbenchEvent) => void;

/** Chrome launch args that disable automation-detection signals. */
const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--no-first-run',
  '--no-default-browser-check',
];

/** Small helper to wait for Chrome to release a profile directory lock. */
const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Launch a persistent browser context with retry.
 *
 * Playwright's `launchPersistentContext` fails when the Chrome profile
 * directory is still locked by a recently-closed browser process.  This
 * wrapper retries up to 3 times with a short back-off to handle the race.
 */
async function launchWithRetry(profileDir: string, stealthArgs: string[], retries = 3): Promise<BrowserContext> {
  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      return await chromium.launchPersistentContext(profileDir, {
        channel: 'chrome',
        headless: false,
        viewport: { width: 1440, height: 900 },
        args: stealthArgs,
        ignoreDefaultArgs: ['--enable-automation'],
      });
    } catch (err) {
      if (attempt >= retries) throw err;
      console.warn(`[Workbench] launchPersistentContext attempt ${attempt} failed, retrying...`, err instanceof Error ? err.message : err);
      await delay(1000 * attempt);
    }
  }
  // Unreachable, but satisfies TypeScript
  throw new Error('launchPersistentContext failed after retries');
}

/**
 * The core automation engine.
 *
 * Coordinates the task queue, account manager, and Playwright sessions
 * to process batch questions through free-tier AI chat websites.
 */
export class Workbench {
  readonly tasks = new TaskQueue();
  readonly accounts: AccountManager;

  private modelsSavePath: string;
  private providersSavePath: string;

  constructor(accountSavePath?: string, skipSeed?: boolean) {
    this.accounts = new AccountManager(accountSavePath, skipSeed);
    const dataDir = dirname(accountSavePath ?? join(process.cwd(), 'data', 'accounts.json'));
    this.modelsSavePath = skipSeed ? '' : join(dataDir, 'models.json');
    this.providersSavePath = skipSeed ? '' : join(dataDir, 'providers.json');
    this.loadModels();
    this.loadCustomProviders();
  }

  /** Custom selector overrides keyed by provider id. */
  private selectorOverrides: Partial<Record<ProviderId, Partial<ProviderSelectors>>> = {};

  private running = false;
  private chatMode: ChatMode = 'new';
  private abortController: AbortController | null = null;

  /** Dynamically detected models per provider (populated by detectModels). */
  private detectedModels: Partial<Record<ProviderId, ModelOption[]>> = {};

  /** User-added custom providers (persisted to data/providers.json). */
  private customProviders: Record<string, { label: string; selectors: ProviderSelectors }> = {};

  private activeContext: BrowserContext | null = null;
  private activePage: Page | null = null;
  private activeAccountId: string | null = null;
  /** Tracks the current named session for chat context reuse. */
  private activeSessionId: string | null = null;

  /** Login browser sessions keyed by account id (for manual login). */
  private loginSessions = new Map<string, BrowserContext>();

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
    this.emit({ type: 'state', payload: this.getState() });
  }

  /* -------------------------------------------------------------- */
  /*  Model persistence                                             */
  /* -------------------------------------------------------------- */

  private loadModels(): void {
    if (!this.modelsSavePath) return;
    try {
      if (existsSync(this.modelsSavePath)) {
        const raw = readFileSync(this.modelsSavePath, 'utf-8');
        this.detectedModels = JSON.parse(raw) as Partial<Record<ProviderId, ModelOption[]>>;
      }
    } catch {
      // corrupted file – start fresh
    }
  }

  private persistModels(): void {
    if (!this.modelsSavePath) return;
    try {
      const dir = dirname(this.modelsSavePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.modelsSavePath, JSON.stringify(this.detectedModels, null, 2));
    } catch {
      // non-critical – ignore write errors
    }
  }

  /* -------------------------------------------------------------- */
  /*  Custom provider persistence                                   */
  /* -------------------------------------------------------------- */

  private loadCustomProviders(): void {
    if (!this.providersSavePath) return;
    try {
      if (existsSync(this.providersSavePath)) {
        const raw = readFileSync(this.providersSavePath, 'utf-8');
        this.customProviders = JSON.parse(raw) as Record<string, { label: string; selectors: ProviderSelectors }>;
      }
    } catch {
      // corrupted file – start fresh
    }
  }

  private persistCustomProviders(): void {
    if (!this.providersSavePath) return;
    try {
      const dir = dirname(this.providersSavePath);
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
      writeFileSync(this.providersSavePath, JSON.stringify(this.customProviders, null, 2));
    } catch {
      // non-critical – ignore write errors
    }
  }

  getProviderList(): ProviderInfo[] {
    const builtins: ProviderInfo[] = BUILTIN_PROVIDER_IDS.map((id) => ({
      id,
      label: BUILTIN_PROVIDER_LABELS[id],
      builtin: true,
    }));
    const custom: ProviderInfo[] = Object.entries(this.customProviders).map(([id, cfg]) => ({
      id,
      label: cfg.label,
      builtin: false,
    }));
    return [...builtins, ...custom];
  }

  addCustomProvider(id: string, label: string, selectors: ProviderSelectors): ProviderInfo {
    if (BUILTIN_PROVIDER_IDS.includes(id as BuiltinProviderId)) {
      throw new Error(`Cannot overwrite built-in provider "${id}"`);
    }
    this.customProviders[id] = { label, selectors };
    this.persistCustomProviders();
    this.emitState();
    return { id, label, builtin: false };
  }

  removeCustomProvider(id: string): boolean {
    if (!this.customProviders[id]) return false;
    delete this.customProviders[id];
    this.persistCustomProviders();
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
  async addProviderFromUrl(chatUrl: string): Promise<{ providerId: string; accountId: string }> {
    const url = new URL(chatUrl);
    const host = url.hostname.replace(/^www\./, '');
    // Derive provider ID from domain: "claude.ai" → "claude", "chat.deepseek.com" → "deepseek"
    const parts = host.split('.');
    const providerId = parts.length >= 2
      ? (parts[0] === 'chat' || parts[0] === 'app' ? parts[1] : parts[0])
      : parts[0];

    // Derive display label: capitalize first letter
    const label = providerId.charAt(0).toUpperCase() + providerId.slice(1);

    // Check if this is a built-in provider — if so, skip provider creation
    const isBuiltin = BUILTIN_PROVIDER_IDS.includes(providerId as BuiltinProviderId);
    // Also check if already exists as custom
    const existingCustom = this.customProviders[providerId];

    if (!isBuiltin && !existingCustom) {
      // Create custom provider with placeholder selectors (will be auto-detected)
      const selectors: ProviderSelectors = {
        chatUrl,
        promptInput: 'textarea',
        responseBlock: '[class*="markdown"]',
        readyIndicator: 'textarea',
      };
      this.customProviders[providerId] = { label, selectors };
      this.persistCustomProviders();
    } else if (!isBuiltin && existingCustom) {
      // Update URL if provider already exists
      existingCustom.selectors.chatUrl = chatUrl;
      this.persistCustomProviders();
    }

    // Auto-generate profile directory
    const dataDir = dirname(this.providersSavePath || join(process.cwd(), 'data', 'providers.json'));
    const existingAccounts = this.accounts.all().filter((a) => a.provider === providerId);
    const suffix = existingAccounts.length > 0 ? `-${existingAccounts.length + 1}` : '';
    const profileDir = join(dataDir, 'profiles', `${providerId}${suffix}`);

    // Create the account
    const accountLabel = `${label} Account${suffix ? ' ' + (existingAccounts.length + 1) : ''}`;
    const account = this.accounts.addAccount(providerId, accountLabel, profileDir);

    this.emitState();

    // Open login browser automatically
    await this.openLoginBrowserWithAutoDetect(account.id, chatUrl, providerId, isBuiltin);

    return { providerId, accountId: account.id };
  }

  /**
   * Open a login browser and, after the page loads, auto-detect selectors
   * and models in the background.
   */
  private async openLoginBrowserWithAutoDetect(
    accountId: string,
    chatUrl: string,
    providerId: string,
    isBuiltin: boolean,
  ): Promise<void> {
    if (this.loginSessions.has(accountId)) return;

    const account = this.accounts.get(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);

    const context = await chromium.launchPersistentContext(account.profileDir, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1440, height: 900 },
      args: STEALTH_ARGS,
      ignoreDefaultArgs: ['--enable-automation'],
    });

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(chatUrl, { waitUntil: 'domcontentloaded' });

    context.on('close', () => {
      this.loginSessions.delete(accountId);
      this.emit({ type: 'login_browser_closed', payload: { accountId } });
      this.emitState();
    });

    this.loginSessions.set(accountId, context);
    this.emit({ type: 'login_browser_opened', payload: { accountId } });
    this.emitState();

    // Background: wait for page to settle, then auto-detect selectors + models
    (async () => {
      try {
        await page.waitForTimeout(5_000);

        // Auto-detect selectors for custom providers
        if (!isBuiltin) {
          const detected = await autoDetectSelectors(page);
          const custom = this.customProviders[providerId];
          if (custom) {
            if (detected.promptInput) custom.selectors.promptInput = detected.promptInput;
            if (detected.sendButton) custom.selectors.sendButton = detected.sendButton;
            if (detected.responseBlock) custom.selectors.responseBlock = detected.responseBlock;
            if (detected.readyIndicator) custom.selectors.readyIndicator = detected.readyIndicator;
            this.persistCustomProviders();
            this.emitState();
          }
        }

        // Auto-detect models
        await this.autoDetectModels(page, providerId);
      } catch {
        // non-critical
      }
    })();
  }

  /**
   * Run model detection on a page that is already open and ready.
   * Non-blocking: errors are caught and logged.  Results are stored
   * in `detectedModels` and emitted via SSE.
   */
  private async autoDetectModels(page: Page, provider: ProviderId): Promise<void> {
    try {
      const selectors = this.getSelectors(provider);
      const scraped = await scrapeModels(page, selectors);
      if (scraped.length > 0) {
        const models: ModelOption[] = scraped.map((m) => ({
          id: m.id,
          label: m.label,
          selectSteps: selectors.modelPickerTrigger
            ? [selectors.modelPickerTrigger, `text=${m.label}`]
            : undefined,
        }));
        this.detectedModels[provider] = models;
        this.persistModels();
        this.emit({ type: 'models_detected', payload: { provider, models } });
        this.emitState();
      }
    } catch (err) {
      console.warn(
        `[autoDetectModels] failed for "${provider}": ${err instanceof Error ? err.message : err}`,
      );
    }
  }

  /* -------------------------------------------------------------- */
  /*  State                                                         */
  /* -------------------------------------------------------------- */

  getState(): WorkbenchState {
    return {
      accounts: this.accounts.all(),
      tasks: this.tasks.all(),
      isRunning: this.running,
      chatMode: this.chatMode,
      providers: this.getProviderList(),
      detectedModels: { ...this.detectedModels },
      currentTaskId: this.tasks.all().find((t) => t.status === 'running')?.id,
      activeAccountId: this.activeAccountId ?? undefined,
      loginOpenAccountIds: [...this.loginSessions.keys()],
    };
  }

  /* -------------------------------------------------------------- */
  /*  Chat mode                                                     */
  /* -------------------------------------------------------------- */

  setChatMode(mode: ChatMode): void {
    this.chatMode = mode;
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
  async detectModels(provider: ProviderId): Promise<ModelOption[]> {
    // Find an account for this provider
    const account = this.accounts.all().find((a) => a.provider === provider);
    if (!account) throw new Error(`No account for provider "${provider}". Add one first.`);

    // Prefer reusing an already-open login session (user can interact with it)
    let ctx = this.loginSessions.get(account.id);
    let needClose = false;

    if (!ctx) {
      // Open a temporary browser session
      ctx = await launchWithRetry(account.profileDir, STEALTH_ARGS);
      needClose = true;
    }

    try {
      const selectors = this.getSelectors(provider);
      const page = ctx.pages()[0] ?? (await ctx.newPage());

      // Always navigate to the chat page to ensure we're on the right page
      await page.goto(selectors.chatUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

      // Wait for the page to be fully ready
      await page.waitForSelector(selectors.readyIndicator, { timeout: 15_000 }).catch((e: unknown) => {
        console.warn('[Workbench] Ready indicator not found during model detection:', e instanceof Error ? e.message : e);
      });

      // Give the page extra time to hydrate JS frameworks and render UI
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

        this.detectedModels[provider] = models;
        this.persistModels();
        this.emit({ type: 'models_detected', payload: { provider, models } });
        this.emitState();
        return models;
      }

      // If nothing was detected, log a helpful message
      console.warn(
        `[detectModels] No models found for "${provider}". ` +
        `Tip: open a Login browser, click the model picker to open the dropdown, then try again.`,
      );
      return this.getModels(provider); // fall back to defaults
    } finally {
      if (needClose) {
        await ctx.close().catch((e: unknown) => console.warn('[Workbench] Failed to close browser context:', e));
      }
    }
  }

  /* -------------------------------------------------------------- */
  /*  Selector overrides                                            */
  /* -------------------------------------------------------------- */

  setProviderSelectors(provider: ProviderId, overrides: Partial<ProviderSelectors>): void {
    this.selectorOverrides[provider] = overrides;
  }

  getSelectors(provider: ProviderId): ProviderSelectors {
    const base = DEFAULT_PROVIDERS[provider as BuiltinProviderId] ?? this.customProviders[provider]?.selectors;
    if (!base) throw new Error(`Unknown provider "${provider}". Add it as a custom provider first.`);
    return { ...base, ...this.selectorOverrides[provider] };
  }

  getModels(provider: ProviderId): ModelOption[] {
    return this.detectedModels[provider] ?? PROVIDER_MODELS[provider] ?? [{ id: 'default', label: 'Default' }];
  }

  /* -------------------------------------------------------------- */
  /*  Login browser (manual login)                                  */
  /* -------------------------------------------------------------- */

  /**
   * Open a persistent browser for a given account so the user can
   * manually log into the AI chat site.  Session cookies are saved in
   * the account's profileDir and reused by the automation later.
   */
  async openLoginBrowser(accountId: string): Promise<void> {
    if (this.loginSessions.has(accountId)) return; // already open

    const account = this.accounts.get(accountId);
    if (!account) throw new Error(`Account ${accountId} not found`);

    // Release profile lock: close the active browser if it uses the same profile
    if (this.activeAccountId === accountId) {
      await this.closeBrowser();
      await delay(500);
    }

    const selectors = this.getSelectors(account.provider);
    const context = await launchWithRetry(account.profileDir, STEALTH_ARGS);

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(selectors.chatUrl, { waitUntil: 'domcontentloaded' });

    // When the user closes the browser window, clean up automatically
    context.on('close', () => {
      this.loginSessions.delete(accountId);
      this.emit({ type: 'login_browser_closed', payload: { accountId } });
      this.emitState();
    });

    this.loginSessions.set(accountId, context);
    this.emit({ type: 'login_browser_opened', payload: { accountId } });
    this.emitState();

    // Auto-detect models in the background after the page has loaded
    page.waitForSelector(selectors.readyIndicator, { timeout: 15_000 })
      .catch((e: unknown) => {
        console.warn('[Workbench] Ready indicator not found during login:', e instanceof Error ? e.message : e);
      })
      .then(() => page.waitForTimeout(3_000))
      .then(() => this.autoDetectModels(page, account.provider))
      .catch((e: unknown) => {
        console.warn('[Workbench] Auto-detect models failed during login:', e instanceof Error ? e.message : e);
      }); // fire-and-forget
  }

  /**
   * Close a login browser session for a given account.
   */
  async closeLoginBrowser(accountId: string): Promise<void> {
    const ctx = this.loginSessions.get(accountId);
    if (!ctx) return;
    this.loginSessions.delete(accountId);
    await ctx.close().catch((e: unknown) => console.warn('[Workbench] Failed to close login browser context:', e));
    // Give Chrome time to fully release the profile directory lock
    await delay(500);
    this.emit({ type: 'login_browser_closed', payload: { accountId } });
    this.emitState();
  }

  /* -------------------------------------------------------------- */
  /*  Browser lifecycle                                             */
  /* -------------------------------------------------------------- */

  private async ensureBrowser(account: Account): Promise<Page> {
    // If we're already using this account, reuse context
    if (this.activeAccountId === account.id && this.activePage && this.activeContext) {
      // In "new chat" mode, navigate to a fresh chat page for each task
      if (this.chatMode === 'new') {
        const selectors = this.getSelectors(account.provider);
        this.activePage = await openChat(this.activeContext, selectors);
      }
      return this.activePage;
    }

    // Close previous context if switching accounts
    await this.closeBrowser();

    // Release profile lock: close login session if this account has one open
    if (this.loginSessions.has(account.id)) {
      await this.closeLoginBrowser(account.id);
    }

    const selectors = this.getSelectors(account.provider);
    const context = await launchWithRetry(account.profileDir, STEALTH_ARGS);

    const page = await openChat(context, selectors);
    this.activeContext = context;
    this.activePage = page;
    this.activeAccountId = account.id;

    // Auto-detect models in the background if not yet detected for this provider
    if (!this.detectedModels[account.provider]?.length) {
      this.autoDetectModels(page, account.provider).catch((e: unknown) => {
        console.warn('[Workbench] Auto-detect models failed:', e instanceof Error ? e.message : e);
      });
    }

    return page;
  }

  private async closeBrowser(): Promise<void> {
    if (this.activeContext) {
      await this.activeContext.close().catch((e: unknown) => console.warn('[Workbench] Failed to close active context:', e));
      this.activeContext = null;
      this.activePage = null;
      this.activeAccountId = null;
    }
  }

  /* -------------------------------------------------------------- */
  /*  Main loop                                                     */
  /* -------------------------------------------------------------- */

  async start(): Promise<void> {
    if (this.running) return;

    // Close all login browser sessions to release profile locks
    for (const accountId of [...this.loginSessions.keys()]) {
      await this.closeLoginBrowser(accountId);
    }

    this.running = true;
    this.abortController = new AbortController();
    this.emitState();

    try {
      await this.processLoop();
    } finally {
      this.running = false;
      await this.closeBrowser();
      this.emit({ type: 'stopped', payload: {} });
      this.emitState();
    }
  }

  stop(): void {
    this.abortController?.abort();
  }

  private async processLoop(): Promise<void> {
    while (!this.abortController?.signal.aborted) {
      const task = this.tasks.next();
      if (!task) break; // No more pending tasks

      const account = this.accounts.pickAccount(task.preferredProvider);
      if (!account) {
        this.tasks.markFailed(task.id, 'No accounts available with remaining quota');
        this.emit({ type: 'task_failed', payload: { taskId: task.id, error: 'No accounts available' } });
        this.emitState();
        break;
      }

      this.tasks.markRunning(task.id, account.id);
      this.emit({ type: 'task_started', payload: { taskId: task.id, accountId: account.id } });
      this.emitState();

      try {
        const page = await this.ensureBrowser(account);

        // Check quota before sending
        const selectors = this.getSelectors(account.provider);
        if (await checkQuotaExhausted(page, selectors)) {
          await this.handleQuotaExhausted(account, task.id);
          continue; // retry with new account
        }

        // Select the requested model/mode if specified
        if (task.preferredModel) {
          const models = this.getModels(account.provider);
          const model = models.find((m) => m.id === task.preferredModel);
          await selectModel(page, model);
        }

        // Upload attachments if any
        if (task.attachments?.length) {
          await uploadFiles(page, task.attachments, selectors);
        }

        const result = await sendPrompt(page, task.question, selectors);

        if (result.quotaExhausted) {
          // Save partial answer if any, then switch account
          if (result.answer) {
            this.tasks.markDone(task.id, result.answer);
            this.emit({ type: 'task_done', payload: { taskId: task.id, answer: result.answer } });
            this.resolveWaiter(task.id, result.answer);
          } else {
            this.tasks.markFailed(task.id, 'Quota exhausted before response');
            this.emit({ type: 'task_failed', payload: { taskId: task.id, error: 'Quota exhausted' } });
            this.rejectWaiter(task.id, 'Quota exhausted before response');
          }
          await this.handleQuotaExhausted(account, task.id);
        } else {
          this.tasks.markDone(task.id, result.answer);
          this.emit({ type: 'task_done', payload: { taskId: task.id, answer: result.answer } });
          this.resolveWaiter(task.id, result.answer);
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        this.tasks.markFailed(task.id, message);
        this.emit({ type: 'task_failed', payload: { taskId: task.id, error: message } });
        this.rejectWaiter(task.id, message);
      }

      this.emitState();
    }
  }

  private async handleQuotaExhausted(account: Account, _taskId: string): Promise<void> {
    this.accounts.markQuotaExhausted(account.id);
    this.emit({ type: 'quota_exhausted', payload: { accountId: account.id } });

    // Try to switch to another account
    const next = this.accounts.pickAccount();
    if (next) {
      this.emit({
        type: 'account_switched',
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
    /** If true, continue in the same chat (don't open a new page). */
    useSameChat?: boolean;
    /** Named session ID for grouping related requests. */
    sessionId?: string;
  }): Promise<string> {
    const prevChatMode = this.chatMode;

    // Set chat mode based on request — session or explicit useSameChat
    if (opts.useSameChat || (opts.sessionId && this.activeSessionId === opts.sessionId)) {
      this.chatMode = 'continue';
    } else if (opts.sessionId) {
      // New session, open fresh chat but save session ID
      this.chatMode = 'new';
      this.activeSessionId = opts.sessionId;
    }

    // Add the task to the queue
    const [task] = this.tasks.add(
      [opts.question],
      opts.preferredProvider,
      opts.preferredModel,
      opts.attachments,
    );

    // Create a promise that resolves when the task completes
    const promise = new Promise<string>((resolve, reject) => {
      this.waitResolvers.set(task.id, { resolve, reject });
    });

    // Set up timeout
    const timeoutMs = opts.timeoutMs ?? 180_000;
    const timeoutId = setTimeout(() => {
      const resolver = this.waitResolvers.get(task.id);
      if (resolver) {
        this.waitResolvers.delete(task.id);
        resolver.reject(new Error(`Chat response timed out after ${timeoutMs}ms`));
      }
    }, timeoutMs);

    // If the workbench isn't running, start the processing loop
    if (!this.running) {
      this.start().catch((e: unknown) => console.warn('[Workbench] Failed to start processing loop:', e));
    }

    try {
      const answer = await promise;
      return answer;
    } finally {
      clearTimeout(timeoutId);
      // Restore chat mode
      this.chatMode = prevChatMode;
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
   * Return the selectors for the currently active account's provider.
   */
  getActiveSelectors(): ProviderSelectors | null {
    if (!this.activeAccountId) return null;
    const account = this.accounts.get(this.activeAccountId);
    if (!account) return null;
    try {
      return this.getSelectors(account.provider);
    } catch {
      return null;
    }
  }
}
