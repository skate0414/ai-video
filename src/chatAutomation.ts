import type { BrowserContext, Page } from 'playwright';
import { existsSync } from 'node:fs';
import fs from 'node:fs/promises';
import path from 'node:path';
import type { ModelOption, ProviderSelectors } from './types.js';
import { FILE_UPLOAD_MAX_RETRIES, TEMP_DIR } from './constants.js';
import { createLogger } from './lib/logger.js';

const log = createLogger('ChatAutomation');

/** Result of scraping available models from a provider page. */
export interface ScrapedModel {
  id: string;
  label: string;
}

export interface ChatResult {
  answer: string;
  quotaExhausted: boolean;
}

export interface ChatAutomationOptions {
  /** Max ms to wait for the ready indicator after navigation. */
  readyTimeout?: number;
  /** Max ms to wait for the AI response to appear. */
  responseTimeout?: number;
  /** Interval (ms) to poll for response stability. */
  pollInterval?: number;
  /** Max ms to wait for the send button to appear (e.g. while files upload). */
  sendButtonTimeout?: number;
  /** If true, skip typing the question text (already typed via typePromptText). */
  textAlreadyTyped?: boolean;
}

const DEFAULTS: Required<ChatAutomationOptions> = {
  readyTimeout: 30_000,
  responseTimeout: 120_000,
  pollInterval: 2_000,
  sendButtonTimeout: 10_000,
  textAlreadyTyped: false,
};

/**
 * Drives a single prompt→response cycle on a live browser page.
 *
 * Lifecycle managed externally — this module only deals with one page
 * that is already attached to a persistent BrowserContext.
 */
export async function openChat(
  context: BrowserContext,
  selectors: ProviderSelectors,
  opts?: ChatAutomationOptions,
): Promise<Page> {
  const { readyTimeout } = { ...DEFAULTS, ...opts };
  const page = context.pages()[0] ?? (await context.newPage());

  // Verify the page is still alive before attempting to use it
  try {
    await page.title();
  } catch {
    // Page is dead — open a fresh one
    const freshPage = await context.newPage();
    await freshPage.goto(selectors.chatUrl, { waitUntil: 'domcontentloaded' });
    await freshPage.waitForSelector(selectors.readyIndicator, { timeout: readyTimeout });
    return freshPage;
  }

  // If already on the target URL (same origin+path), skip navigation to avoid ERR_ABORTED
  // on SPAs like Gemini that use service workers.
  const currentUrl = page.url();
  const targetUrl = new URL(selectors.chatUrl);
  const currentParsed = (() => { try { return new URL(currentUrl); } catch { return null; } })();
  const alreadyOnTarget = currentParsed
    && currentParsed.origin === targetUrl.origin
    && currentParsed.pathname === targetUrl.pathname;

  if (!alreadyOnTarget) {
    const MAX_NAV_RETRIES = 2;
    for (let attempt = 0; attempt <= MAX_NAV_RETRIES; attempt++) {
      try {
        await page.goto(selectors.chatUrl, { waitUntil: 'domcontentloaded' });
        break;
      } catch (navErr) {
        const msg = navErr instanceof Error ? navErr.message : String(navErr);
        log.warn('open_chat_nav_retry', { attempt: attempt + 1, error: msg });
        if (attempt === MAX_NAV_RETRIES) throw navErr;
        // Wait briefly then retry — the page may be settling after a previous navigation
        await page.waitForTimeout(1500);
      }
    }
  } else {
    log.debug('open_chat_skip_navigation', { url: selectors.chatUrl });
  }

  // Check for login redirects — if the page navigated away from the chat URL,
  // the user likely needs to log in
  const postNavUrl = page.url();
  const expectedHost = new URL(selectors.chatUrl).hostname;
  const actualHost = new URL(postNavUrl).hostname;
  if (actualHost !== expectedHost && !actualHost.endsWith('google.com')) {
    throw new Error(
      `Login required: page redirected from ${selectors.chatUrl} to ${postNavUrl}. ` +
      'Please open a Login browser first and log into the site.',
    );
  }

  // Detect common login/auth page indicators
  const loginIndicators = [
    'input[type="password"]',
    'input[type="email"][autocomplete*="username"]',
    '#identifierId',      // Google login
    '[name="identifier"]', // Google login
  ];
  for (const sel of loginIndicators) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) {
        throw new Error(
          `Login required: detected login form element (${sel}) on ${postNavUrl}. ` +
          'Please open a Login browser first and log into the site.',
        );
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith('Login required')) throw err;
      // selector check failed — continue
    }
  }

  await page.waitForSelector(selectors.readyIndicator, { timeout: readyTimeout });
  return page;
}

/**
 * Select a model/mode on the current page by clicking through the
 * model's `selectSteps`.  If the model has no steps (i.e. it's the
 * default), this is a no-op.
 *
 * Errors are caught and logged — a failed model switch should not
 * block the prompt from being sent (it will just use the default).
 */
export async function selectModel(
  page: Page,
  model: ModelOption | undefined,
): Promise<void> {
  if (!model?.selectSteps?.length) return;

  try {
    for (const step of model.selectSteps) {
      const locator = step.startsWith('text=')
        ? page.getByText(step.slice(5))
        : page.locator(step);
      await locator.click({ timeout: 5_000 });
      // short pause to let dropdown / animation settle
      await page.waitForTimeout(500);
    }
  } catch (err) {
    log.warn('select_model_failed', { modelId: model.id, error: err instanceof Error ? err.message : String(err) });
  }
}

/**
 * Scrape model options from the page.
 *
 * **Strategy 1 – Read visible menus/dropdowns**: Scans the DOM for already-open
 * dropdown/menu elements (the user can manually click the model picker before
 * triggering detection).
 *
 * **Strategy 2 – Auto-click trigger**: If Strategy 1 finds nothing and
 * `modelPickerTrigger` is configured, try clicking it then scan again.
 *
 * Uses `page.evaluate()` JS injection for robust DOM scanning instead of
 * fragile CSS selectors.
 */
export async function scrapeModels(
  page: Page,
  selectors: ProviderSelectors,
): Promise<ScrapedModel[]> {
  // Strategy 1: scan the current page for any open dropdown / menu / popover
  let models = await scanPageForModelOptions(page);
  if (models.length > 0) return models;

  // Strategy 2: try to click trigger, then scan
  if (selectors.modelPickerTrigger) {
    try {
      // Try each selector in the comma-separated list
      const triggers = selectors.modelPickerTrigger.split(',').map((s) => s.trim());
      for (const sel of triggers) {
        const loc = page.locator(sel);
        if ((await loc.count()) > 0) {
          await loc.first().click({ timeout: 3_000 });
          await page.waitForTimeout(1_500);
          models = await scanPageForModelOptions(page);
          if (models.length > 0) {
            await page.keyboard.press('Escape').catch(() => {});
            return models;
          }
        }
      }
    } catch {
      // trigger click failed, continue to strategy 3
    }
  }

  // Strategy 3: broad search for any element with model-like text
  models = await broadModelSearch(page);
  return models;
}

/**
 * Scan the DOM for currently visible dropdown/menu/popover model options.
 * Runs JavaScript inside the browser context.
 */
async function scanPageForModelOptions(page: Page): Promise<ScrapedModel[]> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (page as any).evaluate(`(() => {
    const candidates = [];
    const seen = new Set();

    const selectors = [
      '[role="option"]',
      '[role="menuitem"]',
      '[role="menuitemradio"]',
      '[role="listbox"] > *',
      '[data-testid*="model"]',
      '[class*="model"][class*="option"]',
      '[class*="model"][class*="item"]',
      '[class*="Model"][class*="Option"]',
      '[class*="Model"][class*="Item"]',
      'mat-option',
      'mat-list-item',
    ];

    for (const sel of selectors) {
      document.querySelectorAll(sel).forEach((el) => {
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') return;
        const text = (el.innerText || el.textContent || '').trim();
        if (!text || text.length > 80 || text.length < 2) return;
        if (text.includes('\\n') && text.split('\\n').length > 3) return;
        const label = text.split('\\n')[0].trim();
        if (!label || seen.has(label)) return;
        seen.add(label);
        const id = label.toLowerCase().replace(/\\s+/g, '-').replace(/[^a-z0-9\\u4e00-\\u9fff\\-_.]/g, '');
        if (id) candidates.push({ id, label });
      });
    }

    return candidates;
  })()`);
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Broad search for model-related elements on the page by looking at
 * buttons, selects, and other interactive elements near the top of the
 * page that might represent a model selector.
 */
async function broadModelSearch(page: Page): Promise<ScrapedModel[]> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (page as any).evaluate(`(() => {
    const candidates = [];
    const seen = new Set();

    const allButtons = document.querySelectorAll('button, [role="button"], [role="combobox"], select');
    for (const btn of allButtons) {
      if (btn.offsetParent === null && getComputedStyle(btn).position !== 'fixed') continue;
      const text = (btn.innerText || btn.textContent || '').trim();
      const modelPatterns = /gpt|gemini|claude|deepseek|kimi|flash|pro|mini|think|turbo|reasoning|4o|o[1-9]/i;
      if (text && text.length < 60 && modelPatterns.test(text)) {
        const label = text.split('\\n')[0].trim();
        if (label && !seen.has(label)) {
          seen.add(label);
          const id = label.toLowerCase().replace(/\\s+/g, '-').replace(/[^a-z0-9\\u4e00-\\u9fff\\-_.]/g, '');
          if (id) candidates.push({ id, label });
        }
      }
    }

    return candidates;
  })()`);
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Upload files to the chat via the site's attachment/upload button ("+").
 *
 * Uses Playwright's `filechooser` event to intercept the native file dialog
 * and inject the file paths programmatically.  Falls back to finding a hidden
 * `<input type="file">` and setting files directly if the trigger selector
 * does not produce a filechooser event.
 *
 * After uploading, waits for upload indicators to settle (progress spinners
 * disappear, file chips/badges appear) to ensure the upload is complete.
 *
 * @param page    The active chat page
 * @param files   Array of absolute file paths on the server filesystem
 * @param selectors Provider selectors (must include `fileUploadTrigger`)
 */

/**
 * Handle Gemini-style two-step upload menus.
 *
 * After clicking an upload button that opens a submenu instead of a filechooser,
 * this scans the newly appeared menu for an "Upload from computer" option,
 * clicks it, then intercepts the filechooser or sets files on a revealed input.
 *
 * @returns true if files were uploaded successfully, false otherwise
 */
async function tryUploadFromMenu(
  page: Page,
  files: string[],
): Promise<boolean> {
  // Wait briefly for the submenu/popover to render
  await page.waitForTimeout(800);

  // Pattern to match "upload from computer" menu items in multiple languages
  const uploadFromComputerPattern = /upload.*file|upload.*computer|from.*computer|local.*file|choose.*file|browse.*file|files?$|photos?|images?|videos?|media|从计算机|上传文件|本地文件|选择文件|浏览文件|文件|图片|照片|视频|媒体|upload$/i;

  // Selectors for menu items in a recently-appeared popover/menu
  const menuItemSelectors = [
    '[role="menuitem"]',
    '[role="option"]',
    '[role="listbox"] > *',
    'menu li',
    'menu a',
    'menu button',
    '[class*="menu"] li',
    '[class*="menu"] a',
    '[class*="menu"] button',
    '[class*="popover"] li',
    '[class*="popover"] button',
    '[class*="dropdown"] li',
    '[class*="dropdown"] button',
  ];

  for (const menuSel of menuItemSelectors) {
    try {
      const items = page.locator(menuSel);
      const count = await items.count();
      if (count === 0) continue;

      for (let i = 0; i < count; i++) {
        const item = items.nth(i);
        const isVisible = await item.isVisible().catch(() => false);
        if (!isVisible) continue;

        const text = await item.innerText().catch(() => '');
        const ariaLabel = await item.getAttribute('aria-label').catch(() => '') || '';
        const combined = text + ' ' + ariaLabel;

        if (uploadFromComputerPattern.test(combined)) {
          log.debug('upload_menu_item_found', { text: text.trim() || ariaLabel, index: i });

          // Try to intercept filechooser when clicking this menu item
          try {
            const [fileChooser] = await Promise.all([
              page.waitForEvent('filechooser', { timeout: 5_000 }),
              item.click({ timeout: 3_000 }),
            ]);
            await fileChooser.setFiles(files);
            log.debug('upload_filechooser_intercepted', { source: 'menu_item' });
            return true;
          } catch {
            // Menu item click didn't produce filechooser — check for input
            const fileInput = page.locator('input[type="file"]');
            if ((await fileInput.count()) > 0) {
              log.debug('upload_input_revealed', { source: 'menu_item' });
              await fileInput.first().setInputFiles(files);
              return true;
            }
          }
        }
      }
    } catch {
      // selector failed, continue
    }
  }

  // Fallback: run page.evaluate to find menu items across shadow DOM
  /* eslint-disable @typescript-eslint/no-explicit-any */
  const menuItemIndex: number = await (page as any).evaluate(`(() => {
    const pattern = /upload.*file|upload.*computer|from.*computer|local.*file|\u4ece\u8ba1\u7b97\u673a|\u4e0a\u4f20\u6587\u4ef6|\u672c\u5730\u6587\u4ef6|upload$/i;
    const allClickable = document.querySelectorAll('[role="menuitem"], [role="option"], li, a, button');
    for (let i = 0; i < allClickable.length; i++) {
      const el = allClickable[i];
      if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
      const text = (el.innerText || el.textContent || '').trim();
      const aria = el.getAttribute('aria-label') || '';
      if (pattern.test(text + ' ' + aria)) return i;
    }
    return -1;
  })()`);
  /* eslint-enable @typescript-eslint/no-explicit-any */

  if (menuItemIndex >= 0) {
    log.debug('upload_menu_fallback_found', { domIndex: menuItemIndex });
    const allClickable = page.locator('[role="menuitem"], [role="option"], li, a, button');
    const item = allClickable.nth(menuItemIndex);
    try {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5_000 }),
        item.click({ timeout: 3_000 }),
      ]);
      await fileChooser.setFiles(files);
      log.debug('upload_filechooser_intercepted', { source: 'fallback' });
      return true;
    } catch {
      const fileInput = page.locator('input[type="file"]');
      if ((await fileInput.count()) > 0) {
        log.debug('upload_input_revealed', { source: 'fallback' });
        await fileInput.first().setInputFiles(files);
        return true;
      }
    }
  }

  log.debug('upload_menu_no_match');
  return false;
}

export async function uploadFiles(
  page: Page,
  files: string[],
  selectors: ProviderSelectors,
): Promise<void> {
  if (!files.length) return;

  // Validate that all files exist
  const missing = files.filter((f) => !existsSync(f));
  if (missing.length) {
    throw new Error(`Files not found: ${missing.join(', ')}`);
  }

  let uploaded = false;

  log.debug('upload_files_start', { pageUrl: page.url() });
  log.debug('upload_files_trigger', { fileUploadTrigger: selectors.fileUploadTrigger });

  // Strategy 1: look for an existing <input type="file"> and set files directly
  {
    const fileInput = page.locator('input[type="file"]');
    const inputCount = await fileInput.count();
    log.debug('upload_s1_probe', { inputCount });
    if (inputCount > 0) {
      log.debug('upload_s1_found');
      await fileInput.first().setInputFiles(files);
      uploaded = true;
    }
  }

  // Strategy 2: click configured trigger selectors → intercept filechooser or handle two-step menu
  if (!uploaded && selectors.fileUploadTrigger) {
    const triggers = selectors.fileUploadTrigger.split(',').map((s) => s.trim());
    log.debug('upload_s2_start', { triggerCount: triggers.length });

    // Retry loop: page may still be loading on first navigation
    const maxRetries = FILE_UPLOAD_MAX_RETRIES;
    for (let attempt = 0; attempt <= maxRetries && !uploaded; attempt++) {
      if (attempt > 0) {
        log.debug('upload_s2_retry', { attempt, maxRetries });
        await page.waitForTimeout(3_000);
      }

    for (const sel of triggers) {
      const loc = page.locator(sel);
      const count = await loc.count();
      log.debug('upload_s2_selector_probe', { selector: sel, count });
      if (count === 0) continue;

      log.debug('upload_s2_try', { selector: sel, count });
      try {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 5_000 }),
          loc.first().click({ timeout: 3_000 }),
        ]);
        await fileChooser.setFiles(files);
        uploaded = true;
        log.debug('upload_s2_success', { method: 'filechooser' });
        break;
      } catch {
        // No direct filechooser — check if a hidden input appeared
        const fileInput = page.locator('input[type="file"]');
        if ((await fileInput.count()) > 0) {
          log.debug('upload_s2_success', { method: 'revealed_input', selector: sel });
          await fileInput.first().setInputFiles(files);
          uploaded = true;
          break;
        }
        // No filechooser and no input — likely opened a submenu (Gemini pattern)
        log.debug('upload_s2_menu_detected', { selector: sel });
        uploaded = await tryUploadFromMenu(page, files);
        if (uploaded) break;
        // Dismiss any remaining popover
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
      }
    } // end for (triggers)
    } // end retry loop
  }

  // Strategy 3: broad probe — use Playwright locators (shadow-DOM-aware) to find
  // upload/attach buttons by common aria-label patterns.
  if (!uploaded) {
    log.debug('upload_s3_start');
    // These selectors use no tag-name prefix so they match custom web components
    // (e.g. <md-icon-button>) as well as regular <button>.
    const probeSelectors = [
      '[aria-label*="upload" i]',
      '[aria-label*="attach" i]',
      '[aria-label*="上传"]',
      '[aria-label*="添加"]',
      '[aria-label*="附件"]',
      '[aria-label*="Add file" i]',
      '[aria-label*="Add image" i]',
      '[aria-label*="Insert" i]',
      '[aria-label*="tool" i]',
      '[aria-label*="asset" i]',
      '[aria-label*="plus" i]',
      'button:has-text("Tools")',
      'button:has-text("工具")',
      '[data-tooltip*="upload" i]',
      '[data-tooltip*="上传"]',
      '[data-tooltip*="tool" i]',
      '[title*="upload" i]',
      '[title*="tool" i]',
    ];

    const found: string[] = [];
    for (const ps of probeSelectors) {
      if ((await page.locator(ps).count()) > 0) found.push(ps);
    }
    log.debug('upload_s3_probe', { matchCount: found.length, selectors: found });

    for (const sel of found) {
      try {
        const loc = page.locator(sel).first();
        log.debug('upload_s3_try', { selector: sel });
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 5_000 }),
          loc.click({ timeout: 3_000 }),
        ]);
        await fileChooser.setFiles(files);
        uploaded = true;
        log.debug('upload_s3_success', { selector: sel, method: 'filechooser' });
        break;
      } catch {
        // Check if clicking created a file input
        const fileInput = page.locator('input[type="file"]');
        if ((await fileInput.count()) > 0) {
          log.debug('upload_s3_success', { selector: sel, method: 'revealed_input' });
          await fileInput.first().setInputFiles(files);
          uploaded = true;
          break;
        }
        // Try two-step menu pattern
        log.debug('upload_s3_menu_detected', { selector: sel });
        uploaded = await tryUploadFromMenu(page, files);
        if (uploaded) break;
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  }

  // Strategy 4: auto-detect upload trigger from live DOM
  if (!uploaded) {
    log.debug('upload_s4_start');
    const detected = await autoDetectSelectors(page);
    if (detected.fileUploadTrigger) {
      log.debug('upload_s4_detected', { trigger: detected.fileUploadTrigger });
      const loc = page.locator(detected.fileUploadTrigger);
      const count = await loc.count();
      if (count > 0) {
        try {
          const [fileChooser] = await Promise.all([
            page.waitForEvent('filechooser', { timeout: 5_000 }),
            loc.first().click({ timeout: 3_000 }),
          ]);
          await fileChooser.setFiles(files);
          uploaded = true;
          log.debug('upload_s4_success', { method: 'filechooser' });
        } catch {
          const fileInput = page.locator('input[type="file"]');
          if ((await fileInput.count()) > 0) {
            log.debug('upload_s4_success', { method: 'revealed_input' });
            await fileInput.first().setInputFiles(files);
            uploaded = true;
          } else {
            uploaded = await tryUploadFromMenu(page, files);
            if (uploaded) {
              log.debug('upload_s4_success', { method: 'two_step_menu' });
            }
            await page.keyboard.press('Escape').catch(() => {});
          }
        }
      }
    } else {
      log.debug('upload_s4_no_trigger');
    }
  }

  if (!uploaded) {
    // Take diagnostic screenshot
    try {
      const screenshotPath = `${TEMP_DIR}/upload-fail-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
      log.warn('upload_diagnostic', { screenshotPath });
      log.warn('upload_diagnostic_page', { pageTitle: await page.title().catch(() => '(error)'), pageUrl: page.url() });
      // page URL already logged above;
    } catch (e) {
      log.warn('upload_diagnostic_screenshot_failed', { error: String(e) });
    }
    throw new Error(
      'Could not find a file upload trigger. ' +
      'Check the fileUploadTrigger selector in provider config.',
    );
  }

  // Wait for upload to complete: poll for progress indicators to disappear
  await waitForUploadCompletion(page, selectors);
}

/**
 * Wait for file upload to complete.
 *
 * Uses multiple signals to detect upload completion:
 * 1. Send button: Gemini hides/disables it during upload, re-enables when ready.
 *    NOTE: In Gemini, the send button only appears when BOTH text is typed
 *    AND the file is ready.  Call typePromptText() BEFORE uploadFiles() so
 *    the send button signal works reliably.
 * 2. Progress indicators: spinners, progress bars, loading animations.
 * 3. File attachment chips: file thumbnails/chips becoming stable in the DOM.
 */
async function waitForUploadCompletion(
  page: Page,
  selectors: ProviderSelectors,
  maxWaitMs = 600_000,
): Promise<void> {
  const start = Date.now();
  const deadline = start + maxWaitMs;
  log.debug('upload_completion_monitoring', { maxWaitSeconds: maxWaitMs / 1000 });

  // Give the upload a moment to start (file processing begins async)
  await page.waitForTimeout(5_000);

  // --- Gemini-specific upload progress selectors ---
  const uploadProgressSelectors = [
    '[class*="progress"]',
    '[class*="loading"]',
    '[class*="uploading"]',
    '[role="progressbar"]',
    '[class*="spinner"]',
    '[class*="processing"]',
    // Gemini shows a loading animation on the file chip during upload
    '[class*="file-chip"] [class*="loading"]',
    '[class*="upload-chip"] [class*="loading"]',
    'circular-progress',
    'mat-spinner',
    '[class*="CircularProgress"]',
  ];

  // Helper: check if any upload progress indicator is visible
  const hasActiveProgress = async (): Promise<boolean> => {
    for (const sel of uploadProgressSelectors) {
      try {
        const loc = page.locator(sel);
        const count = await loc.count().catch(() => 0);
        if (count > 0) {
          const visible = await loc.first().isVisible().catch(() => false);
          if (visible) return true;
        }
      } catch { /* ignore invalid selectors */ }
    }
    return false;
  };

  // --- Phase 1: Wait for upload progress to finish ---
  const initialProgress = await hasActiveProgress();
  if (initialProgress) {
    log.debug('upload_progress_detected');
    let pollCount = 0;
    while (Date.now() < deadline) {
      pollCount++;
      const stillActive = await hasActiveProgress();
      if (!stillActive) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        log.info('upload_progress_finished', { elapsedSeconds: elapsed, pollCount });
        break;
      }
      if (pollCount % 12 === 0) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        log.debug('upload_progress_still_active', { elapsedSeconds: elapsed });
      }
      await page.waitForTimeout(5_000);
    }
    // Extra settling time after progress disappears
    await page.waitForTimeout(2_000);
  }

  // --- Phase 2: Wait for send button to become ready (most reliable signal) ---
  if (selectors.sendButton) {
    const sendBtn = page.locator(selectors.sendButton);

    const isBtnReady = async (): Promise<{ visible: boolean; enabled: boolean }> => {
      const count = await sendBtn.count().catch(() => 0);
      if (count === 0) return { visible: false, enabled: false };
      const visible = await sendBtn.first().isVisible().catch(() => false);
      if (!visible) return { visible: false, enabled: false };
      const enabled = await sendBtn.first().isEnabled().catch(() => false);
      return { visible: true, enabled };
    };

    const { visible, enabled } = await isBtnReady();
    if (visible && enabled) {
      const elapsed = Math.round((Date.now() - start) / 1000);
      log.info('upload_complete', { elapsedSeconds: elapsed, signal: 'send_button_ready' });
      await page.waitForTimeout(1_000);
      return;
    }

    // Poll for send button to become ready
    log.debug('upload_waiting_for_send_button', {
      visible, enabled,
      note: 'Ensure text was typed before upload so Gemini shows the send button',
    });
    let pollCount = 0;
    while (Date.now() < deadline) {
      pollCount++;
      const state = await isBtnReady();
      if (state.visible && state.enabled) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        log.info('upload_complete', { elapsedSeconds: elapsed, signal: 'send_button_ready', pollCount });
        await page.waitForTimeout(1_000);
        return;
      }
      if (pollCount % 12 === 0) {
        const elapsed = Math.round((Date.now() - start) / 1000);
        log.debug('upload_still_in_progress', { elapsedSeconds: elapsed, ...state });
        // Take a diagnostic screenshot periodically
        try {
          const { mkdirSync } = await import('node:fs');
          const debugDir = `${TEMP_DIR}/chatgpt-debug`;
          mkdirSync(debugDir, { recursive: true });
          await page.screenshot({ path: `${debugDir}/upload_wait_${Date.now()}.png`, fullPage: false });
        } catch { /* ignore */ }
      }
      await page.waitForTimeout(5_000);
    }
    log.warn('upload_completion_timeout', { maxWaitSeconds: maxWaitMs / 1000 });
    return;
  }

  // --- Fallback: providers without sendButton selector ---
  if (await hasActiveProgress()) {
    while (Date.now() < deadline) {
      if (!(await hasActiveProgress())) break;
      await page.waitForTimeout(2_000);
    }
    await page.waitForTimeout(2_000);
  } else {
    await page.waitForTimeout(5_000);
  }
}

/**
 * Find the best-matching response block selector from a comma-separated list.
 * Tries each selector individually in order and returns the first one that
 * has at least one match, falling back to the full combined selector.
 */
async function findBestResponseSelector(
  page: Page,
  responseBlockSelector: string,
): Promise<string> {
  const selectors = responseBlockSelector.split(',').map((s) => s.trim()).filter(Boolean);
  const found: { sel: string; count: number }[] = [];
  for (const sel of selectors) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) found.push({ sel, count });
    } catch {
      // invalid selector — skip
    }
  }
  if (found.length > 0) {
    // Prefer the selector with the fewest matches (most specific to actual responses)
    found.sort((a, b) => a.count - b.count);
    log.debug('response_selector_picked', { picked: found[0].sel, candidateCount: found.length });
    return found[0].sel;
  }
  // No selector matched — return full combined selector for waiting
  log.debug('response_selector_fallback');
  return responseBlockSelector;
}

/**
 * Extract text from the last matching response element, crossing Shadow DOM
 * boundaries via page.evaluate().  Falls back through three strategies:
 *   1. el.innerText  (works for light-DOM elements)
 *   2. el.textContent (works when innerText is empty but textContent exists)
 *   3. Recursive walker that descends into shadow roots
 */
async function extractResponseText(
  page: Page,
  selector: string,
): Promise<string> {
  // Use page.locator().last() so Playwright auto-pierces Shadow DOM to find
  // the element, then run evaluate ON that element for text extraction.
  const loc = page.locator(selector).last();
  if ((await loc.count()) === 0) return '';

  const text = await loc.evaluate((el) => {
    // Strategy 1: innerText (fast, respects layout)
    const inner = (el as any).innerText?.trim();
    if (inner) return inner;

    // Strategy 2: textContent (includes hidden text)
    const tc = el.textContent?.trim();
    if (tc) return tc;

    // Strategy 3: recursive walk into shadow roots
    function walkText(node: any): string {
      let result = '';
      if (node.nodeType === 3 /* TEXT_NODE */) {
        result += node.textContent || '';
      }
      if (node.shadowRoot) {
        result += walkText(node.shadowRoot);
      }
      const children = node.childNodes;
      for (let i = 0; i < children.length; i++) {
        result += walkText(children[i]);
      }
      return result;
    }
    return walkText(el).trim();
  });

  return text ?? '';
}

/**
 * Type the prompt text into the input field WITHOUT sending.
 * Call this before uploadFiles() so Gemini's send button can appear
 * once the file upload completes (Gemini requires both text + file ready).
 */
export async function typePromptText(
  page: Page,
  question: string,
  selectors: ProviderSelectors,
): Promise<void> {
  const chatGptRichEditor = page
    .locator('div#prompt-textarea[contenteditable="true"], div[role="textbox"][contenteditable="true"]')
    .first();

  let input = page.locator(selectors.promptInput).first();
  // ChatGPT now often renders a hidden textarea plus a visible contenteditable div.
  // Prefer the visible rich editor when available.
  if (selectors.promptInput.includes('ChatGPT') && (await chatGptRichEditor.count()) > 0) {
    input = chatGptRichEditor;
  }
  try {
    await input.click({ timeout: 8000 });
  } catch {
    // Fall back to the visible textbox when click is intercepted.
    const fallback = chatGptRichEditor;
    if ((await fallback.count()) > 0) {
      input = fallback;
      await input.click({ timeout: 8000 });
    } else {
      throw new Error(`Prompt input not interactable: ${selectors.promptInput}`);
    }
  }

  const isContentEditable = await input.evaluate(
    (el) => el.getAttribute('contenteditable') === 'true'
  ).catch(() => false);

  if (isContentEditable) {
    await input.evaluate((el) => {
      el.textContent = '';
      while (el.firstChild) el.removeChild(el.firstChild);
    });
    log.debug('type_prompt_text', { type: 'contenteditable', length: question.length });
    await input.focus();
    await page.keyboard.insertText(question);
    await input.dispatchEvent('input', { bubbles: true });
    await page.waitForTimeout(800);
  } else {
    log.debug('type_prompt_text', { type: 'standard', length: question.length });
    await input.fill(question);
  }
}

/**
 * Send a prompt and wait for the AI response to stabilize.
 *
 * "Stabilize" means the response text has not changed for two consecutive
 * poll intervals.
 */
export async function sendPrompt(
  page: Page,
  question: string,
  selectors: ProviderSelectors,
  opts?: ChatAutomationOptions,
): Promise<ChatResult> {
  const { responseTimeout, pollInterval, sendButtonTimeout, textAlreadyTyped } = { ...DEFAULTS, ...opts };

  const sendStart = Date.now();
  log.info('send_prompt_start', { promptLength: question.length, textAlreadyTyped });

  // --- find best response block selector ---
  const responseSelector = await findBestResponseSelector(page, selectors.responseBlock);
  log.debug('send_prompt_selector', { responseSelector });

  // --- count existing response blocks so we know when a *new* one appears ---
  const beforeCount = await page.locator(responseSelector).count();
  log.debug('send_prompt_existing_blocks', { beforeCount });

  // --- type the question (skip if already typed via typePromptText) ---
  const input = page.locator(selectors.promptInput).first();
  if (!textAlreadyTyped) {
  const chatGptRichEditor = page
    .locator('div#prompt-textarea[contenteditable="true"], div[role="textbox"][contenteditable="true"]')
    .first();
  let activeInput = input;
  if (selectors.promptInput.includes('ChatGPT') && (await chatGptRichEditor.count()) > 0) {
    activeInput = chatGptRichEditor;
  }
  try {
    await activeInput.click({ timeout: 8000 });
  } catch {
    const fallback = chatGptRichEditor;
    if ((await fallback.count()) > 0) {
      activeInput = fallback;
      await activeInput.click({ timeout: 8000 });
    } else {
      throw new Error(`Prompt input not interactable: ${selectors.promptInput}`);
    }
  }

  // Detect if the input is a contenteditable element (e.g. Gemini's rich editor)
  const isContentEditable = await activeInput.evaluate(
    (el) => el.getAttribute('contenteditable') === 'true'
  ).catch(() => false);

  if (isContentEditable) {
    // For contenteditable: clear existing content, then insert text.
    // Use keyboard.insertText() for speed — dispatches a single 'input' event
    // instead of typing char-by-char (pressSequentially), which times out on long prompts.
    // Avoid innerHTML to comply with Trusted Types policy (Chrome 131+).
    await activeInput.evaluate((el) => {
      el.textContent = '';
      while (el.firstChild) el.removeChild(el.firstChild);
    });
    log.debug('send_prompt_input_type', { type: 'contenteditable', length: question.length });
    await activeInput.focus();
    await page.keyboard.insertText(question);
    // Dispatch events + small keypress to wake up Quill's internal state
    // (insertText may not trigger all framework event handlers)
    await input.dispatchEvent('input', { bubbles: true });
    await page.waitForTimeout(800);
  } else {
    log.debug('send_prompt_input_type', { type: 'standard' });
    // For standard inputs (textarea, input), use fill()
    await activeInput.fill(question);
  }
  } // end if (!textAlreadyTyped)

  // --- send ---
  let sent = false;
  if (selectors.sendButton) {
    // Quick pre-check: if send button selector has zero matches now,
    // don't waste the full sendButtonTimeout waiting for it.
    // Exception: when textAlreadyTyped (attachment flow), the send button
    // will appear once the file upload finishes — use full timeout.
    const initialSendCount = await page.locator(selectors.sendButton).count().catch(() => 0);
    const maxInitialWaitMs = textAlreadyTyped
      ? sendButtonTimeout
      : (initialSendCount > 0 ? sendButtonTimeout : 30_000);

    if (initialSendCount === 0 && !textAlreadyTyped) {
      log.debug('send_button_not_found_initially', { sendButtonTimeout, reducedTimeoutMs: maxInitialWaitMs });
    }

    // Wait for the send button to become clickable — may take a while if files are uploading.
    // Gemini keeps the button in the DOM but disables it during upload.
    const sendDeadline = Date.now() + maxInitialWaitMs;
    let attempt = 0;
    while (!sent && Date.now() < sendDeadline) {
      attempt++;
      try {
        const sendBtn = page.locator(selectors.sendButton).first();
        const count = await page.locator(selectors.sendButton).count();
        if (count > 0) {
          const visible = await sendBtn.isVisible().catch(() => false);
          const enabled = await sendBtn.isEnabled().catch(() => false);
          if (visible && enabled) {
            await sendBtn.click({ timeout: 5_000 });
            sent = true;
          } else {
            // Button exists but not clickable (disabled during upload)
            if (attempt % 10 === 0) {
              const remaining = Math.round((sendDeadline - Date.now()) / 1000);
              log.debug('send_button_not_ready', { visible, enabled, attempt, remainingSeconds: remaining });
            }
            await page.waitForTimeout(5_000);
          }
        } else {
          if (attempt % 20 === 0) {
            const remaining = Math.round((sendDeadline - Date.now()) / 1000);
            log.debug('send_button_missing', { attempt, remainingSeconds: remaining });
          }
          await page.waitForTimeout(3_000);
        }
      } catch (e) {
        // Send button click failed — retry
        if (attempt % 10 === 0) {
          log.warn('send_button_click_failed', { error: e instanceof Error ? e.message.slice(0, 100) : String(e) });
        }
        await page.waitForTimeout(3_000);
      }
    }
  }
  if (!sent) {
    log.warn('send_prompt_fallback_enter', { timeoutSeconds: sendButtonTimeout / 1000 });
    await input.press('Enter');
  } else {
    log.debug('send_prompt_sent', { method: 'send_button' });
  }

  // --- take a diagnostic screenshot right after send ---
  try {
    const { mkdirSync } = await import('node:fs');
    const debugDir = `${TEMP_DIR}/chatgpt-debug`;
    mkdirSync(debugDir, { recursive: true });
    await page.screenshot({ path: `${debugDir}/after_send_${Date.now()}.png`, fullPage: false });
    log.debug('send_prompt_post_send_screenshot', { debugDir, pageUrl: page.url() });
  } catch { /* ignore */ }

  // --- wait for a *new* response block to appear ---
  const deadline = Date.now() + responseTimeout;
  log.debug('send_prompt_waiting', { responseTimeoutMs: responseTimeout });

  // Wait for response count to increase
  let waitPollCount = 0;
  let adjustedBeforeCount = beforeCount;
  while (Date.now() < deadline) {
    let currentCount: number;
    try {
      currentCount = await page.locator(responseSelector).count();
    } catch (e) {
      // Page crashed or was closed mid-poll — fail fast instead of waiting 120s
      const msg = e instanceof Error ? e.message : String(e);
      log.warn('send_prompt_page_crashed', { error: msg, waitedMs: Date.now() - sendStart });
      throw new Error(`send_prompt_page_crashed: ${msg}`);
    }
    if (currentCount > adjustedBeforeCount) break;

    // Handle count regression: if the page re-renders (e.g. Gemini SPA
    // navigation or DOM restructuring), existing response blocks can
    // disappear.  Reset the baseline so we can still detect the new response.
    if (currentCount < adjustedBeforeCount) {
      log.warn('send_prompt_count_regression', {
        adjustedBeforeCount,
        currentCount,
        responseSelector,
      });
      adjustedBeforeCount = currentCount;
    }

    // Take a diagnostic screenshot early in the wait so we can see page state
    // when the response never arrives
    if (waitPollCount === 5) { // ~10 seconds after send
      try {
        const { mkdirSync } = await import('node:fs');
        const debugDir = `${TEMP_DIR}/chatgpt-debug`;
        mkdirSync(debugDir, { recursive: true });
        await page.screenshot({ path: `${debugDir}/wait_response_${Date.now()}.png`, fullPage: false });
        log.warn('send_prompt_no_response_yet', {
          debugDir,
          pageUrl: page.url(),
          waitedMs: Date.now() - sendStart,
          responseSelector,
          beforeCount,
          currentCount,
        });
      } catch { /* ignore */ }
    }

    waitPollCount++;
    try {
      await page.waitForTimeout(pollInterval);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      log.warn('send_prompt_page_crashed', { error: msg, phase: 'response_wait' });
      throw new Error(`send_prompt_page_crashed: ${msg}`);
    }
  }

  if (Date.now() >= deadline && waitPollCount > 0) {
    log.warn('send_prompt_response_never_appeared', {
      pageUrl: page.url(),
      totalWaitMs: Date.now() - sendStart,
      responseSelector,
      beforeCount,
      finalCount: await page.locator(responseSelector).count().catch(() => -1),
    });
  }

  log.debug('send_prompt_response_detected');

  // --- poll until response text stabilises ---
  let prevText = '';
  let stableCount = 0;
  let pollCount = 0;
  const STABLE_THRESHOLD = 2; // consecutive unchanged polls

  // Known static prefixes that appear immediately in response containers
  // before the actual AI response loads. These should NOT count as "text appeared".
  const STATIC_PREFIXES = ['gemini said', 'chatgpt said', 'model said', 'gemini 说'];
  const MIN_MEANINGFUL_LENGTH = 20; // responses shorter than this are likely just prefixes

  function isMeaningfulText(text: string): boolean {
    if (!text || text.trim().length === 0) return false;
    if (text.length < MIN_MEANINGFUL_LENGTH) {
      const lower = text.toLowerCase().trim();
      return !STATIC_PREFIXES.some(prefix => lower === prefix || lower.startsWith(prefix));
    }
    return true;
  }

  while (Date.now() < deadline) {
    const currentText = (await extractResponseText(page, responseSelector).catch(() => '')) ?? '';

    // Debug: capture page state on first few polls and every 30 polls to diagnose issues
    if (pollCount === 0 || pollCount === 2 || pollCount % 30 === 0) {
      try {
        const debugHtml = await page.evaluate((sel: string) => {
          const doc = (globalThis as any).document as any;
          const blocks = doc.querySelectorAll(sel.split(',')[0].trim());
          const last = blocks[blocks.length - 1];
          if (!last) return '(no block found)';
          const childInfo = Array.from(last.children).map((c: any) => `<${c.tagName.toLowerCase()} class="${c.className?.toString().slice(0,60)}">`).join(', ');
          return `block: ${last.tagName} children=[${childInfo}] innerText(${(last as any).innerText?.length ?? 0}) textContent(${last.textContent?.length ?? 0})`;
        }, responseSelector).catch(() => '(eval failed)');
        log.debug('send_prompt_debug_poll', { pollCount });
      } catch { /* ignore */ }
      // Save a screenshot on first poll to help diagnose page state
      if (pollCount === 0) {
        try {
          const { mkdirSync } = await import('node:fs');
          const debugDir = `${TEMP_DIR}/chatgpt-debug`;
          mkdirSync(debugDir, { recursive: true });
          await page.screenshot({ path: `${debugDir}/poll_${Date.now()}.png`, fullPage: false });
          log.debug('send_prompt_debug_screenshot', { debugDir });
        } catch { /* ignore */ }
      }
    }

    // Also check for images in the response (for image-only responses like Gemini Imagen)
    const hasImage = await page.evaluate((sel: string) => {
      const doc = (globalThis as any).document as any;
      const selectors = sel.split(',').map(s => s.trim());
      for (const s of selectors) {
        try {
          const blocks = doc.querySelectorAll(s);
          for (let i = Math.max(0, blocks.length - 2); i < blocks.length; i++) {
            const imgs = blocks[i].querySelectorAll('img');
            for (const img of imgs as any) {
              if ((img as any).naturalWidth > 64 || img.width > 64) return true;
            }
          }
        } catch { /* skip */ }
      }
      return false;
    }, responseSelector).catch(() => false);

    pollCount++;
    // Log progress every 15 polls (~30s at 2s interval) or when text first appears meaningfully
    if (pollCount % 15 === 0 || (isMeaningfulText(currentText) && !isMeaningfulText(prevText))) {
      const elapsed = Math.round((Date.now() - sendStart) / 1000);
      log.debug('send_prompt_poll_progress', { pollCount, elapsedSeconds: elapsed, textLength: currentText.length, hasImage });
    }

    // Image found → consider response complete immediately
    if (hasImage) {
      log.info('send_prompt_image_detected', { pollCount });
      break;
    }

    if (currentText === prevText && isMeaningfulText(currentText)) {
      stableCount++;
      if (stableCount >= STABLE_THRESHOLD) {
        log.info('send_prompt_response_stable', { pollCount, responseLength: currentText.length });
        break;
      }
    } else {
      stableCount = 0;
    }
    prevText = currentText;
    await page.waitForTimeout(pollInterval);
  }

  if (Date.now() >= deadline) {
    log.warn('send_prompt_response_timeout', { responseTimeoutMs: responseTimeout });
  }

  // --- check for quota exhaustion ---
  let quotaExhausted = false;
  if (selectors.quotaExhaustedIndicator) {
    // Support multiple comma-separated indicators (e.g. "text=foo, text=bar")
    const indicators = selectors.quotaExhaustedIndicator.split(',').map(s => s.trim()).filter(Boolean);
    for (const ind of indicators) {
      try {
        const locator = ind.startsWith('text=')
          ? page.getByText(ind.slice(5))
          : page.locator(ind);
        if ((await locator.count()) > 0) {
          quotaExhausted = true;
          break;
        }
      } catch {
        // ignore selector errors
      }
    }
  }

  const answer = (await extractResponseText(page, responseSelector).catch(() => '')) ?? '';

  const elapsed = Date.now() - sendStart;
  log.info('send_prompt_response_received', { elapsedMs: elapsed, answerLength: answer.length, quotaExhausted });

  return { answer, quotaExhausted };
}

/** Result of auto-detecting page selectors. */
export interface DetectedSelectors {
  promptInput: string | null;
  sendButton: string | null;
  responseBlock: string | null;
  readyIndicator: string | null;
  fileUploadTrigger: string | null;
}

export interface DetectedVideoSelectors {
  promptInput: string | null;
  generateButton: string | null;
  imageUploadTrigger: string | null;
  videoResult: string | null;
  progressIndicator: string | null;
  downloadButton: string | null;
}

/**
 * Auto-detect CSS selectors for a chat page by probing common patterns.
 *
 * Uses heuristic rules to find the prompt input, send button, response
 * block, and ready indicator on an arbitrary AI chat page.
 */
export async function autoDetectSelectors(page: Page): Promise<DetectedSelectors> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (page as any).evaluate(`(() => {
    // Shadow DOM traversal helper: querySelectorAll that also searches shadow roots
    function querySelectorAllDeep(selector, root) {
      root = root || document;
      var results = [...root.querySelectorAll(selector)];
      // Also search inside shadow roots
      var allElements = root.querySelectorAll('*');
      for (var i = 0; i < allElements.length; i++) {
        if (allElements[i].shadowRoot) {
          results = results.concat([...allElements[i].shadowRoot.querySelectorAll(selector)]);
        }
      }
      return results;
    }

    // --- Prompt input ---
    let promptInput = null;
    // 1) visible textarea (including shadow DOM)
    const textareas = querySelectorAllDeep('textarea').filter(
      (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
    );
    if (textareas.length > 0) {
      // Prefer one with large area (chat input, not search)
      const best = textareas.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
      promptInput = buildSelector(best);
    }
    // 2) contenteditable (including shadow DOM)
    if (!promptInput) {
      const editables = querySelectorAllDeep('[contenteditable="true"]').filter(
        (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
      );
      if (editables.length > 0) {
        const best = editables.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
        promptInput = buildSelector(best);
      }
    }

    // --- Send button ---
    let sendButton = null;
    const buttonCandidates = querySelectorAllDeep('button, [role="button"]').filter(
      (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
    );
    // Look for buttons with send-like attributes
    for (const btn of buttonCandidates) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
      const text = (btn.textContent || '').trim().toLowerCase();
      const cls = (btn.className || '').toLowerCase();
      if (
        aria.includes('send') || aria.includes('submit') || aria.includes('发送') ||
        testId.includes('send') || testId.includes('submit') ||
        text === 'send' || text === '发送' || text === 'submit' ||
        cls.includes('send')
      ) {
        sendButton = buildSelector(btn);
        break;
      }
    }
    // Fallback: button[type="submit"]
    if (!sendButton) {
      const submitBtn = document.querySelector('button[type="submit"]');
      if (submitBtn && (submitBtn.offsetParent !== null || getComputedStyle(submitBtn).position === 'fixed')) {
        sendButton = buildSelector(submitBtn);
      }
    }
    // Fallback: find a button near the prompt input area
    if (!sendButton && promptInput) {
      const inputEl = document.querySelector(promptInput);
      if (inputEl) {
        const parent = inputEl.closest('form') || inputEl.parentElement?.parentElement?.parentElement;
        if (parent) {
          const nearBtn = parent.querySelector('button');
          if (nearBtn) sendButton = buildSelector(nearBtn);
        }
      }
    }

    // --- Response block ---
    let responseBlock = null;
    const responseSelectors = [
      '[data-message-author-role="assistant"]',
      'message-content [class*="markdown"]',
      '.model-response-text',
      '.ds-markdown',
      '[class*="response-container"] [class*="markdown"]',
      '[class*="chat-message"]',
      '.prose',
    ];
    for (const sel of responseSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        responseBlock = sel;
        break;
      }
    }
    // Broad fallback
    if (!responseBlock) {
      const divs = [...document.querySelectorAll('div[class]')].filter((el) => {
        const cls = el.className.toLowerCase();
        return cls.includes('message') || cls.includes('response') || cls.includes('reply');
      });
      if (divs.length > 0) {
        const cls = divs[0].className.split(/\\s+/).find((c) =>
          c.toLowerCase().includes('message') || c.toLowerCase().includes('response')
        );
        if (cls) responseBlock = '.' + cls;
      }
    }

    // --- Ready indicator (same as prompt input) ---
    const readyIndicator = promptInput;

    // --- File upload trigger ---
    let fileUploadTrigger = null;
    // 1) Look for buttons with upload/attach/file-related attributes
    for (const btn of buttonCandidates) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
      const tooltip = (btn.getAttribute('data-tooltip') || btn.getAttribute('title') || '').toLowerCase();
      const cls = (btn.className || '').toString().toLowerCase();
      const text = (btn.textContent || '').trim().toLowerCase();
      if (
        aria.includes('upload') || aria.includes('attach') || aria.includes('file') ||
        aria.includes('上传') || aria.includes('附件') || aria.includes('添加文件') ||
        aria.includes('tool') || aria.includes('add') || aria.includes('insert') || aria.includes('asset') || aria.includes('media') ||
        testId.includes('upload') || testId.includes('attach') || testId.includes('file') ||
        tooltip.includes('upload') || tooltip.includes('attach') || tooltip.includes('上传') || tooltip.includes('tool') ||
        cls.includes('upload') || cls.includes('attach') || cls.includes('tool') || cls.includes('plus') ||
        text === '+' || text === 'tools' || text === '工具'
      ) {
        fileUploadTrigger = buildSelector(btn);
        break;
      }
    }
    // 2) Fallback: any input[type="file"] on the page
    if (!fileUploadTrigger) {
      const fileInputs = document.querySelectorAll('input[type="file"]');
      if (fileInputs.length > 0) {
        fileUploadTrigger = 'input[type="file"]';
      }
    }
    // 3) Fallback: icon-only button near the prompt input (not the send button)
    if (!fileUploadTrigger && promptInput) {
      const inputEl = document.querySelector(promptInput);
      if (inputEl) {
        const container = inputEl.closest('form') || inputEl.parentElement?.parentElement?.parentElement?.parentElement;
        if (container) {
          const nearbyBtns = [...container.querySelectorAll('button, [role="button"]')];
          for (const btn of nearbyBtns) {
            if (sendButton && btn.matches(sendButton)) continue;
            const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
            if (aria.includes('send') || aria.includes('submit') || aria.includes('发送') ||
                aria.includes('stop') || aria.includes('cancel') || aria.includes('voice') ||
                aria.includes('mic') || aria.includes('new') || aria.includes('settings') ||
                aria.includes('menu') || aria.includes('main') || aria.includes('mode') ||
                aria.includes('picker') || aria.includes('more') || aria.includes('share') ||
                aria.includes('copy') || aria.includes('redo') || aria.includes('good') ||
                aria.includes('bad') || aria.includes('thumbs')) continue;
            if (btn.querySelector('svg')) {
              fileUploadTrigger = buildSelector(btn);
              break;
            }
          }
        }
      }
    }

    return { promptInput, sendButton, responseBlock, readyIndicator, fileUploadTrigger };

    // Helper: build a CSS selector for an element
    function buildSelector(el) {
      // Prefer id
      if (el.id) return '#' + CSS.escape(el.id);
      // Prefer data-testid
      const testId = el.getAttribute('data-testid');
      if (testId) return '[data-testid="' + testId + '"]';
      // Prefer aria-label
      const aria = el.getAttribute('aria-label');
      if (aria) return el.tagName.toLowerCase() + '[aria-label="' + aria.replace(/"/g, '\\\\"') + '"]';
      // Unique class combo
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\\s+/).filter((c) => c.length > 2).slice(0, 3);
        if (classes.length > 0) {
          const sel = el.tagName.toLowerCase() + '.' + classes.join('.');
          if (document.querySelectorAll(sel).length === 1) return sel;
        }
      }
      // Fallback: tag name
      return el.tagName.toLowerCase();
    }
  })()`);
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/**
 * Check whether the page currently shows a quota-exhausted indicator.
 */
export async function checkQuotaExhausted(
  page: Page,
  selectors: ProviderSelectors,
): Promise<boolean> {
  if (!selectors.quotaExhaustedIndicator) return false;
  const indicators = selectors.quotaExhaustedIndicator.split(',').map(s => s.trim()).filter(Boolean);
  for (const ind of indicators) {
    try {
      const locator = ind.startsWith('text=')
        ? page.getByText(ind.slice(5))
        : page.locator(ind);
      if ((await locator.count()) > 0) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

/**
 * Auto-detect CSS selectors for a video/image generation page.
 *
 * Uses heuristic rules to find the prompt input, generate button,
 * image upload trigger, video result element, progress indicator,
 * and download button on an arbitrary AI video generation page.
 */
export async function autoDetectVideoSelectors(page: Page): Promise<DetectedVideoSelectors> {
  /* eslint-disable @typescript-eslint/no-explicit-any */
  return (page as any).evaluate(`(() => {
    // Shadow DOM traversal helper
    function querySelectorAllDeep(selector, root) {
      root = root || document;
      var results = [...root.querySelectorAll(selector)];
      var allElements = root.querySelectorAll('*');
      for (var i = 0; i < allElements.length; i++) {
        if (allElements[i].shadowRoot) {
          results = results.concat([...allElements[i].shadowRoot.querySelectorAll(selector)]);
        }
      }
      return results;
    }

    // --- Prompt input (textarea / contenteditable) ---
    let promptInput = null;
    const textareas = querySelectorAllDeep('textarea').filter(
      (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
    );
    if (textareas.length > 0) {
      const best = textareas.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
      promptInput = buildSelector(best);
    }
    if (!promptInput) {
      const editables = querySelectorAllDeep('[contenteditable="true"]').filter(
        (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
      );
      if (editables.length > 0) {
        const best = editables.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
        promptInput = buildSelector(best);
      }
    }

    // --- Generate button ---
    let generateButton = null;
    const buttonCandidates = querySelectorAllDeep('button, [role="button"]').filter(
      (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
    );
    for (const btn of buttonCandidates) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
      const text = (btn.textContent || '').trim().toLowerCase();
      const cls = (btn.className || '').toLowerCase();
      if (
        text.includes('生成') || text.includes('generate') || text.includes('create') ||
        text.includes('开始') || text.includes('start') ||
        aria.includes('generate') || aria.includes('create') || aria.includes('生成') ||
        testId.includes('generate') || testId.includes('create') ||
        cls.includes('generate') || cls.includes('create') || cls.includes('submit')
      ) {
        generateButton = buildSelector(btn);
        break;
      }
    }
    if (!generateButton) {
      const submitBtn = document.querySelector('button[type="submit"]');
      if (submitBtn && (submitBtn.offsetParent !== null || getComputedStyle(submitBtn).position === 'fixed')) {
        generateButton = buildSelector(submitBtn);
      }
    }

    // --- Image upload trigger ---
    let imageUploadTrigger = null;
    const fileInputs = [...document.querySelectorAll('input[type="file"]')];
    const imageInput = fileInputs.find((el) => {
      const accept = (el.getAttribute('accept') || '').toLowerCase();
      return accept.includes('image') || accept.includes('png') || accept.includes('jpg') || accept.includes('jpeg');
    });
    if (imageInput) {
      imageUploadTrigger = buildSelector(imageInput);
    }
    if (!imageUploadTrigger && fileInputs.length > 0) {
      imageUploadTrigger = 'input[type="file"]';
    }
    if (!imageUploadTrigger) {
      for (const btn of buttonCandidates) {
        const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
        const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
        const tooltip = (btn.getAttribute('data-tooltip') || btn.getAttribute('title') || '').toLowerCase();
        const text = (btn.textContent || '').trim().toLowerCase();
        const cls = (btn.className || '').toString().toLowerCase();
        if (
          aria.includes('upload') || aria.includes('上传') || aria.includes('image') || aria.includes('图片') ||
          testId.includes('upload') || testId.includes('image') ||
          tooltip.includes('upload') || tooltip.includes('上传') ||
          text.includes('上传') || text.includes('upload') ||
          cls.includes('upload') || cls.includes('image-upload')
        ) {
          imageUploadTrigger = buildSelector(btn);
          break;
        }
      }
    }

    // --- Video result element ---
    let videoResult = null;
    const videos = [...document.querySelectorAll('video')].filter(
      (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
    );
    if (videos.length > 0) {
      videoResult = buildSelector(videos[videos.length - 1]);
    }
    if (!videoResult) {
      const resultSelectors = [
        '[class*="result"]',
        '[class*="output"]',
        '[class*="preview"]',
        '[class*="video-container"]',
        '[class*="player"]',
        '[class*="generation-result"]',
      ];
      for (const sel of resultSelectors) {
        const els = document.querySelectorAll(sel);
        if (els.length > 0) {
          videoResult = sel;
          break;
        }
      }
    }

    // --- Progress indicator ---
    let progressIndicator = null;
    const progressSelectors = [
      '[class*="progress"]',
      '[role="progressbar"]',
      '[class*="loading"]',
      '[class*="generating"]',
      '[class*="spinner"]',
      '[class*="pending"]',
    ];
    for (const sel of progressSelectors) {
      const els = document.querySelectorAll(sel);
      if (els.length > 0) {
        progressIndicator = sel;
        break;
      }
    }

    // --- Download button ---
    let downloadButton = null;
    for (const btn of buttonCandidates) {
      const aria = (btn.getAttribute('aria-label') || '').toLowerCase();
      const testId = (btn.getAttribute('data-testid') || '').toLowerCase();
      const text = (btn.textContent || '').trim().toLowerCase();
      const cls = (btn.className || '').toLowerCase();
      if (
        text.includes('下载') || text.includes('download') || text.includes('save') || text.includes('保存') ||
        aria.includes('download') || aria.includes('下载') ||
        testId.includes('download') ||
        cls.includes('download')
      ) {
        downloadButton = buildSelector(btn);
        break;
      }
    }
    if (!downloadButton) {
      const downloadLinks = [...document.querySelectorAll('a[download]')];
      if (downloadLinks.length > 0) {
        downloadButton = buildSelector(downloadLinks[downloadLinks.length - 1]);
      }
    }

    return { promptInput, generateButton, imageUploadTrigger, videoResult, progressIndicator, downloadButton };

    function buildSelector(el) {
      if (el.id) return '#' + CSS.escape(el.id);
      const testId = el.getAttribute('data-testid');
      if (testId) return '[data-testid="' + testId + '"]';
      const aria = el.getAttribute('aria-label');
      if (aria) return el.tagName.toLowerCase() + '[aria-label="' + aria.replace(/"/g, '\\\\"') + '"]';
      if (el.className && typeof el.className === 'string') {
        const classes = el.className.trim().split(/\\s+/).filter((c) => c.length > 2).slice(0, 3);
        if (classes.length > 0) {
          const sel = el.tagName.toLowerCase() + '.' + classes.join('.');
          if (document.querySelectorAll(sel).length === 1) return sel;
        }
      }
      return el.tagName.toLowerCase();
    }
  })()`);
  /* eslint-enable @typescript-eslint/no-explicit-any */
}

/* ------------------------------------------------------------------ */
/*  Debug screenshot cleanup                                          */
/* ------------------------------------------------------------------ */

const DEBUG_SCREENSHOT_MAX_AGE_MS = 3_600_000; // 1 hour

/**
 * Remove stale debug screenshots from TEMP_DIR.
 * Deletes `.png` files older than `maxAgeMs` from the temp root and the
 * `chatgpt-debug/` subdirectory.  Safe to call periodically — ignores
 * missing files and non-critical errors.
 */
export async function cleanupDebugScreenshots(maxAgeMs = DEBUG_SCREENSHOT_MAX_AGE_MS): Promise<number> {
  const dirs = [TEMP_DIR, path.join(TEMP_DIR, 'chatgpt-debug')];
  const cutoff = Date.now() - maxAgeMs;
  let removed = 0;

  for (const dir of dirs) {
    let entries: string[];
    try {
      entries = await fs.readdir(dir);
    } catch {
      continue; // directory may not exist
    }
    for (const entry of entries) {
      if (!entry.endsWith('.png')) continue;
      const filePath = path.join(dir, entry);
      try {
        const stat = await fs.stat(filePath);
        if (stat.mtimeMs < cutoff) {
          await fs.unlink(filePath);
          removed++;
        }
      } catch {
        // file may have been deleted concurrently
      }
    }
  }

  if (removed > 0) {
    log.info('debug_screenshots_cleanup', { removedCount: removed });
  }
  return removed;
}