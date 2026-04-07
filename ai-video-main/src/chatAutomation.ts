import type { BrowserContext, Page } from 'playwright';
import { existsSync } from 'node:fs';
import type { ModelOption, ProviderSelectors } from './types.js';

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
}

const DEFAULTS: Required<ChatAutomationOptions> = {
  readyTimeout: 30_000,
  responseTimeout: 120_000,
  pollInterval: 2_000,
  sendButtonTimeout: 10_000,
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
        console.warn(`[openChat] page.goto attempt ${attempt + 1} failed: ${msg}`);
        if (attempt === MAX_NAV_RETRIES) throw navErr;
        // Wait briefly then retry — the page may be settling after a previous navigation
        await page.waitForTimeout(1500);
      }
    }
  } else {
    console.log(`[openChat] already on ${selectors.chatUrl}, skipping navigation`);
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
    console.warn(
      `[selectModel] failed to select model "${model.id}": ${err instanceof Error ? err.message : err}`,
    );
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
  const uploadFromComputerPattern = /upload.*file|upload.*computer|from.*computer|local.*file|从计算机|上传文件|本地文件|upload$/i;

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
          console.log(`[tryUploadFromMenu] Found menu item: "${text.trim() || ariaLabel}" (selector: ${menuSel}[${i}])`);

          // Try to intercept filechooser when clicking this menu item
          try {
            const [fileChooser] = await Promise.all([
              page.waitForEvent('filechooser', { timeout: 5_000 }),
              item.click({ timeout: 3_000 }),
            ]);
            await fileChooser.setFiles(files);
            console.log('[tryUploadFromMenu] filechooser intercepted via menu item');
            return true;
          } catch {
            // Menu item click didn't produce filechooser — check for input
            const fileInput = page.locator('input[type="file"]');
            if ((await fileInput.count()) > 0) {
              console.log('[tryUploadFromMenu] menu item revealed input[type="file"]');
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
    console.log(`[tryUploadFromMenu] Fallback: found matching item at DOM index ${menuItemIndex}`);
    const allClickable = page.locator('[role="menuitem"], [role="option"], li, a, button');
    const item = allClickable.nth(menuItemIndex);
    try {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5_000 }),
        item.click({ timeout: 3_000 }),
      ]);
      await fileChooser.setFiles(files);
      console.log('[tryUploadFromMenu] Fallback: filechooser intercepted');
      return true;
    } catch {
      const fileInput = page.locator('input[type="file"]');
      if ((await fileInput.count()) > 0) {
        console.log('[tryUploadFromMenu] Fallback: found input[type="file"] after menu click');
        await fileInput.first().setInputFiles(files);
        return true;
      }
    }
  }

  console.log('[tryUploadFromMenu] No matching upload-from-computer menu item found');
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

  console.log(`[uploadFiles] page URL: ${page.url()}`);
  console.log(`[uploadFiles] selectors.fileUploadTrigger: ${selectors.fileUploadTrigger || '(undefined)'}`);

  // Strategy 1: look for an existing <input type="file"> and set files directly
  {
    const fileInput = page.locator('input[type="file"]');
    const inputCount = await fileInput.count();
    console.log(`[uploadFiles] Strategy 1: input[type="file"] count=${inputCount}`);
    if (inputCount > 0) {
      console.log('[uploadFiles] Strategy 1: found existing input[type="file"]');
      await fileInput.first().setInputFiles(files);
      uploaded = true;
    }
  }

  // Strategy 2: click configured trigger selectors → intercept filechooser or handle two-step menu
  if (!uploaded && selectors.fileUploadTrigger) {
    const triggers = selectors.fileUploadTrigger.split(',').map((s) => s.trim());
    console.log(`[uploadFiles] Strategy 2: checking ${triggers.length} trigger selectors`);

    // Retry loop: page may still be loading on first navigation
    const maxRetries = 3;
    for (let attempt = 0; attempt <= maxRetries && !uploaded; attempt++) {
      if (attempt > 0) {
        console.log(`[uploadFiles] Strategy 2: retry ${attempt}/${maxRetries} — waiting 3s for page to load...`);
        await page.waitForTimeout(3_000);
      }

    for (const sel of triggers) {
      const loc = page.locator(sel);
      const count = await loc.count();
      console.log(`[uploadFiles] Strategy 2: selector "${sel}" → count=${count}`);
      if (count === 0) continue;

      console.log(`[uploadFiles] Strategy 2: trying selector "${sel}" (${count} matches)`);
      try {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 5_000 }),
          loc.first().click({ timeout: 3_000 }),
        ]);
        await fileChooser.setFiles(files);
        uploaded = true;
        console.log('[uploadFiles] Strategy 2: filechooser intercepted successfully');
        break;
      } catch {
        // No direct filechooser — check if a hidden input appeared
        const fileInput = page.locator('input[type="file"]');
        if ((await fileInput.count()) > 0) {
          console.log(`[uploadFiles] Strategy 2: click on "${sel}" revealed input[type="file"]`);
          await fileInput.first().setInputFiles(files);
          uploaded = true;
          break;
        }
        // No filechooser and no input — likely opened a submenu (Gemini pattern)
        console.log(`[uploadFiles] Strategy 2: "${sel}" opened a menu, trying two-step upload...`);
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
    console.log('[uploadFiles] Strategy 3: broad probe for upload-like buttons via Playwright locators');
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
      '[data-tooltip*="upload" i]',
      '[data-tooltip*="上传"]',
    ];

    const found: string[] = [];
    for (const ps of probeSelectors) {
      if ((await page.locator(ps).count()) > 0) found.push(ps);
    }
    console.log(`[uploadFiles] Strategy 3: found ${found.length} matching selectors: ${found.join(', ')}`);

    for (const sel of found) {
      try {
        const loc = page.locator(sel).first();
        console.log(`[uploadFiles] Strategy 3: trying "${sel}"`);
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 5_000 }),
          loc.click({ timeout: 3_000 }),
        ]);
        await fileChooser.setFiles(files);
        uploaded = true;
        console.log(`[uploadFiles] Strategy 3: "${sel}" worked (direct filechooser)`);
        break;
      } catch {
        // Check if clicking created a file input
        const fileInput = page.locator('input[type="file"]');
        if ((await fileInput.count()) > 0) {
          console.log(`[uploadFiles] Strategy 3: click on "${sel}" revealed input[type="file"]`);
          await fileInput.first().setInputFiles(files);
          uploaded = true;
          break;
        }
        // Try two-step menu pattern
        console.log(`[uploadFiles] Strategy 3: "${sel}" may have opened a menu, trying two-step...`);
        uploaded = await tryUploadFromMenu(page, files);
        if (uploaded) break;
        await page.keyboard.press('Escape').catch(() => {});
        await page.waitForTimeout(300);
      }
    }
  }

  if (!uploaded) {
    // Take diagnostic screenshot
    try {
      const screenshotPath = `/tmp/upload-fail-${Date.now()}.png`;
      await page.screenshot({ path: screenshotPath, fullPage: false });
      console.log(`[uploadFiles] DIAGNOSTIC: screenshot saved to ${screenshotPath}`);
      console.log(`[uploadFiles] DIAGNOSTIC: page title = ${await page.title().catch(() => '(error)')}`);
      console.log(`[uploadFiles] DIAGNOSTIC: page URL = ${page.url()}`);
    } catch (e) {
      console.log(`[uploadFiles] DIAGNOSTIC: screenshot failed: ${e}`);
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
 * Gemini removes the send button from the DOM during file upload, then
 * adds it back once the file is ready. We detect this disappear→reappear
 * pattern to know when the upload is finished.
 */
async function waitForUploadCompletion(
  page: Page,
  selectors: ProviderSelectors,
  maxWaitMs = 600_000,
): Promise<void> {
  if (selectors.sendButton) {
    const start = Date.now();
    const deadline = start + maxWaitMs;
    console.log(`[waitForUploadCompletion] Monitoring upload (max ${maxWaitMs / 1000}s)...`);

    // Give the upload a moment to start (file processing begins async)
    await page.waitForTimeout(15_000);

    const sendBtn = page.locator(selectors.sendButton);
    const initialCount = await sendBtn.count().catch(() => 0);
    const initiallyVisible = initialCount > 0
      ? await sendBtn.first().isVisible().catch(() => false)
      : false;

    // Helper: check if btn is visible AND enabled (ready to click)
    const isBtnReady = async (): Promise<{ visible: boolean; enabled: boolean }> => {
      const count = await sendBtn.count().catch(() => 0);
      if (count === 0) return { visible: false, enabled: false };
      const visible = await sendBtn.first().isVisible().catch(() => false);
      if (!visible) return { visible: false, enabled: false };
      const enabled = await sendBtn.first().isEnabled().catch(() => false);
      return { visible: true, enabled };
    };

    const initialState = initiallyVisible
      ? { visible: true, enabled: await sendBtn.first().isEnabled().catch(() => false) }
      : { visible: false, enabled: false };

    // Upload is in progress if: button hidden OR button visible but disabled
    const uploadInProgress = !initialState.visible || (initialState.visible && !initialState.enabled);

    if (uploadInProgress) {
      const reason = !initialState.visible ? 'send button hidden' : 'send button visible but disabled';
      console.log(`[waitForUploadCompletion] Upload in progress (${reason}), waiting for completion...`);
      let pollCount = 0;
      while (Date.now() < deadline) {
        pollCount++;
        const { visible, enabled } = await isBtnReady();
        if (visible && enabled) {
          const elapsed = Math.round((Date.now() - start) / 1000);
          console.log(`[waitForUploadCompletion] Upload complete — send button ready after ${elapsed}s`);
          await page.waitForTimeout(1_000); // settling time
          return;
        }
        if (pollCount % 12 === 0) {
          const elapsed = Math.round((Date.now() - start) / 1000);
          console.log(`[waitForUploadCompletion] Still uploading (${elapsed}s, visible=${visible}, enabled=${enabled})...`);
        }
        await page.waitForTimeout(5_000);
      }
      console.warn(`[waitForUploadCompletion] Upload did not complete within ${maxWaitMs / 1000}s — proceeding anyway`);
    } else {
      console.log('[waitForUploadCompletion] Send button visible and enabled — file ready');
    }
    return;
  }

  // Fallback for providers without a sendButton selector
  const progressSelectors = [
    '[class*="progress"]',
    '[class*="loading"]',
    '[class*="uploading"]',
    '[role="progressbar"]',
  ];
  await page.waitForTimeout(300);
  let hasProgress = false;
  for (const sel of progressSelectors) {
    if ((await page.locator(sel).count().catch(() => 0)) > 0) { hasProgress = true; break; }
  }
  if (hasProgress) {
    const fallbackDeadline = Date.now() + Math.min(maxWaitMs, 120_000);
    while (Date.now() < fallbackDeadline) {
      let anyActive = false;
      for (const sel of progressSelectors) {
        try {
          const loc = page.locator(sel);
          if ((await loc.count()) > 0 && await loc.first().isVisible().catch(() => false)) {
            anyActive = true; break;
          }
        } catch { /* ignore */ }
      }
      if (!anyActive) break;
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
    console.log(`[findBestResponseSelector] candidates: ${found.map(f => `${f.sel}(${f.count})`).join(', ')} → picked: ${found[0].sel}`);
    return found[0].sel;
  }
  // No selector matched — return full combined selector for waiting
  console.log(`[findBestResponseSelector] no matches yet, using full combined selector`);
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
  const { responseTimeout, pollInterval, sendButtonTimeout } = { ...DEFAULTS, ...opts };

  const sendStart = Date.now();
  console.log(`[sendPrompt] ▶ Sending prompt (${question.length} chars): ${question.slice(0, 120)}${question.length > 120 ? '...' : ''}`);

  // --- find best response block selector ---
  const responseSelector = await findBestResponseSelector(page, selectors.responseBlock);
  console.log(`[sendPrompt] Using response selector: ${responseSelector}`);

  // --- count existing response blocks so we know when a *new* one appears ---
  const beforeCount = await page.locator(responseSelector).count();
  console.log(`[sendPrompt] Existing response blocks: ${beforeCount}`);

  // --- type the question ---
  const input = page.locator(selectors.promptInput).first();
  await input.click();

  // Detect if the input is a contenteditable element (e.g. Gemini's rich editor)
  const isContentEditable = await input.evaluate(
    (el) => el.getAttribute('contenteditable') === 'true'
  ).catch(() => false);

  if (isContentEditable) {
    // For contenteditable: clear existing content, then insert text.
    // Use keyboard.insertText() for speed — dispatches a single 'input' event
    // instead of typing char-by-char (pressSequentially), which times out on long prompts.
    // Avoid innerHTML to comply with Trusted Types policy (Chrome 131+).
    await input.evaluate((el) => {
      el.textContent = '';
      while (el.firstChild) el.removeChild(el.firstChild);
    });
    console.log(`[sendPrompt] Input type: contenteditable — using insertText (${question.length} chars)`);
    await input.focus();
    await page.keyboard.insertText(question);
    // Dispatch events + small keypress to wake up Quill's internal state
    // (insertText may not trigger all framework event handlers)
    await input.dispatchEvent('input', { bubbles: true });
    await page.waitForTimeout(800);
  } else {
    console.log('[sendPrompt] Input type: standard — using fill()');
    // For standard inputs (textarea, input), use fill()
    await input.fill(question);
  }

  // --- send ---
  let sent = false;
  if (selectors.sendButton) {
    // Wait for the send button to become clickable — may take a while if files are uploading.
    // Gemini keeps the button in the DOM but disables it during upload.
    const sendDeadline = Date.now() + sendButtonTimeout;
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
              console.log(`[sendPrompt] Send button exists but disabled (visible=${visible}, enabled=${enabled}), waiting for upload... (attempt ${attempt}, ${remaining}s remaining)`);
            }
            await page.waitForTimeout(5_000);
          }
        } else {
          if (attempt % 20 === 0) {
            const remaining = Math.round((sendDeadline - Date.now()) / 1000);
            console.log(`[sendPrompt] Send button not in DOM (attempt ${attempt}, ${remaining}s remaining)...`);
          }
          await page.waitForTimeout(3_000);
        }
      } catch (e) {
        // Send button click failed — retry
        if (attempt % 10 === 0) {
          console.log(`[sendPrompt] Send button click failed: ${e instanceof Error ? e.message.slice(0, 100) : e}`);
        }
        await page.waitForTimeout(3_000);
      }
    }
  }
  if (!sent) {
    console.log(`[sendPrompt] Send button not clickable after ${sendButtonTimeout / 1000}s, pressing Enter`);
    await input.press('Enter');
  } else {
    console.log('[sendPrompt] Prompt sent via send button');
  }

  // --- wait for a *new* response block to appear ---
  const deadline = Date.now() + responseTimeout;
  console.log(`[sendPrompt] Waiting for new response (timeout: ${responseTimeout}ms)...`);

  // Wait for response count to increase
  while (Date.now() < deadline) {
    const currentCount = await page.locator(responseSelector).count();
    if (currentCount > beforeCount) break;
    await page.waitForTimeout(pollInterval);
  }

  console.log('[sendPrompt] New response block detected, polling for stability...');

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
        console.log(`[sendPrompt] Debug poll #${pollCount}: ${debugHtml}`);
      } catch { /* ignore */ }
      // Save a screenshot on first poll to help diagnose page state
      if (pollCount === 0) {
        try {
          const { mkdirSync } = await import('node:fs');
          const debugDir = '/tmp/chatgpt-debug';
          mkdirSync(debugDir, { recursive: true });
          await page.screenshot({ path: `${debugDir}/poll_${Date.now()}.png`, fullPage: false });
          console.log(`[sendPrompt] Debug screenshot saved to ${debugDir}/`);
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
      console.log(`[sendPrompt] Poll #${pollCount} (${elapsed}s): text=${currentText.length} chars, hasImage=${hasImage}${isMeaningfulText(currentText) && !isMeaningfulText(prevText) ? ' ← meaningful text appeared!' : ''}`);
    }

    // Image found → consider response complete immediately
    if (hasImage) {
      console.log(`[sendPrompt] Image detected in response after ${pollCount} polls`);
      break;
    }

    if (currentText === prevText && isMeaningfulText(currentText)) {
      stableCount++;
      if (stableCount >= STABLE_THRESHOLD) {
        console.log(`[sendPrompt] Response stabilized after ${pollCount} polls (${currentText.length} chars)`);
        break;
      }
    } else {
      stableCount = 0;
    }
    prevText = currentText;
    await page.waitForTimeout(pollInterval);
  }

  if (Date.now() >= deadline) {
    console.warn(`[sendPrompt] ⚠ Response polling timed out after ${responseTimeout}ms`);
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
  console.log(`[sendPrompt] ◀ Response received (${elapsed}ms, ${answer.length} chars, quota=${quotaExhausted}): ${answer.slice(0, 200)}${answer.length > 200 ? '...' : ''}`);

  return { answer, quotaExhausted };
}

/** Result of auto-detecting page selectors. */
export interface DetectedSelectors {
  promptInput: string | null;
  sendButton: string | null;
  responseBlock: string | null;
  readyIndicator: string | null;
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
    // --- Prompt input ---
    let promptInput = null;
    // 1) visible textarea
    const textareas = [...document.querySelectorAll('textarea')].filter(
      (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
    );
    if (textareas.length > 0) {
      // Prefer one with large area (chat input, not search)
      const best = textareas.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
      promptInput = buildSelector(best);
    }
    // 2) contenteditable
    if (!promptInput) {
      const editables = [...document.querySelectorAll('[contenteditable="true"]')].filter(
        (el) => el.offsetParent !== null || getComputedStyle(el).position === 'fixed'
      );
      if (editables.length > 0) {
        const best = editables.sort((a, b) => (b.offsetWidth * b.offsetHeight) - (a.offsetWidth * a.offsetHeight))[0];
        promptInput = buildSelector(best);
      }
    }

    // --- Send button ---
    let sendButton = null;
    const buttonCandidates = [...document.querySelectorAll('button, [role="button"]')].filter(
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
      '[class*="markdown"]',
      '[class*="response"]',
      '[class*="message-content"]',
      '[class*="assistant"]',
      '[data-message-author-role="assistant"]',
      '[class*="chat-message"]',
      '[class*="answer"]',
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

    return { promptInput, sendButton, responseBlock, readyIndicator };

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
