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
}

const DEFAULTS: Required<ChatAutomationOptions> = {
  readyTimeout: 30_000,
  responseTimeout: 120_000,
  pollInterval: 2_000,
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
  await page.goto(selectors.chatUrl, { waitUntil: 'domcontentloaded' });

  // Check for login redirects — if the page navigated away from the chat URL,
  // the user likely needs to log in
  const currentUrl = page.url();
  const expectedHost = new URL(selectors.chatUrl).hostname;
  const actualHost = new URL(currentUrl).hostname;
  if (actualHost !== expectedHost && !actualHost.endsWith('google.com')) {
    throw new Error(
      `Login required: page redirected from ${selectors.chatUrl} to ${currentUrl}. ` +
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
          `Login required: detected login form element (${sel}) on ${currentUrl}. ` +
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

  // Strategy 1: click the trigger and intercept the filechooser dialog
  if (selectors.fileUploadTrigger) {
    const triggers = selectors.fileUploadTrigger.split(',').map((s) => s.trim());

    for (const sel of triggers) {
      const loc = page.locator(sel);
      if ((await loc.count()) === 0) continue;

      try {
        const [fileChooser] = await Promise.all([
          page.waitForEvent('filechooser', { timeout: 5_000 }),
          loc.first().click({ timeout: 3_000 }),
        ]);
        await fileChooser.setFiles(files);
        uploaded = true;
        break;
      } catch {
        // This selector didn't produce a filechooser — try next
      }
    }
  }

  // Strategy 2: look for a hidden <input type="file"> and set files directly
  if (!uploaded) {
    const fileInput = page.locator('input[type="file"]');
    if ((await fileInput.count()) > 0) {
      await fileInput.first().setInputFiles(files);
      uploaded = true;
    }
  }

  if (!uploaded) {
    throw new Error(
      'Could not find a file upload trigger. ' +
      'Check the fileUploadTrigger selector in provider config.',
    );
  }

  // Wait for upload to complete: poll for progress indicators to disappear
  await waitForUploadCompletion(page);
}

/**
 * Wait for file upload to complete by:
 * 1. Detecting if a progress/loading indicator appears
 * 2. Waiting for it to disappear (upload finished)
 * 3. Ensuring file attachment chips/badges are visible
 *
 * Falls back to a generous static wait if no indicators are detected.
 */
async function waitForUploadCompletion(
  page: Page,
  maxWaitMs = 60_000,
): Promise<void> {
  const progressSelectors = [
    '[class*="progress"]',
    '[class*="loading"]',
    '[class*="uploading"]',
    '[class*="spinner"]',
    '[class*="spin"]',
    '[role="progressbar"]',
  ];

  // Check if any progress indicator appears shortly after upload
  let hasProgressIndicator = false;

  await page.waitForTimeout(300); // brief pause for indicator to render

  for (const sel of progressSelectors) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) {
        hasProgressIndicator = true;
        break;
      }
    } catch {
      // ignore
    }
  }

  if (hasProgressIndicator) {
    // Wait for progress indicators to disappear
    const deadline = Date.now() + maxWaitMs;
    while (Date.now() < deadline) {
      let anyActive = false;
      for (const sel of progressSelectors) {
        try {
          const locator = page.locator(sel);
          const count = await locator.count();
          if (count > 0 && await locator.first().isVisible().catch(() => false)) {
            anyActive = true;
            break;
          }
        } catch {
          // ignore
        }
      }
      if (!anyActive) break;
      await page.waitForTimeout(2_000);
    }

    // Extra settling time after progress indicator disappears
    await page.waitForTimeout(2_000);
  } else {
    // No progress indicator detected — use a generous static wait
    // Video files are large, so wait longer to be safe
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
  for (const sel of selectors) {
    try {
      const count = await page.locator(sel).count();
      if (count > 0) return sel;
    } catch {
      // invalid selector — skip
    }
  }
  // Fallback: return the full combined selector
  return responseBlockSelector;
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
  const { responseTimeout, pollInterval } = { ...DEFAULTS, ...opts };

  // --- find best response block selector ---
  const responseSelector = await findBestResponseSelector(page, selectors.responseBlock);

  // --- count existing response blocks so we know when a *new* one appears ---
  const beforeCount = await page.locator(responseSelector).count();

  // --- type the question ---
  const input = page.locator(selectors.promptInput).first();
  await input.click();

  // Detect if the input is a contenteditable element (e.g. Gemini's rich editor)
  const isContentEditable = await input.evaluate(
    (el) => el.getAttribute('contenteditable') === 'true'
  ).catch(() => false);

  if (isContentEditable) {
    // For contenteditable: clear existing content, then type character by character
    await input.evaluate((el) => {
      el.textContent = '';
      el.innerHTML = '';
    });
    await input.pressSequentially(question, { delay: 10 });
  } else {
    // For standard inputs (textarea, input), use fill()
    await input.fill(question);
  }

  // --- send ---
  let sent = false;
  if (selectors.sendButton) {
    try {
      const sendBtn = page.locator(selectors.sendButton);
      if ((await sendBtn.count()) > 0) {
        await sendBtn.first().click({ timeout: 5_000 });
        sent = true;
      }
    } catch {
      // Send button click failed — fall through to Enter key
    }
  }
  if (!sent) {
    await input.press('Enter');
  }

  // --- wait for a *new* response block to appear ---
  const deadline = Date.now() + responseTimeout;

  // Wait for response count to increase
  while (Date.now() < deadline) {
    const currentCount = await page.locator(responseSelector).count();
    if (currentCount > beforeCount) break;
    await page.waitForTimeout(pollInterval);
  }

  // --- poll until response text stabilises ---
  let prevText = '';
  let stableCount = 0;
  const STABLE_THRESHOLD = 2; // consecutive unchanged polls

  while (Date.now() < deadline) {
    const currentText = await page
      .locator(responseSelector)
      .last()
      .innerText()
      .catch(() => '');

    if (currentText === prevText && currentText.length > 0) {
      stableCount++;
      if (stableCount >= STABLE_THRESHOLD) break;
    } else {
      stableCount = 0;
    }
    prevText = currentText;
    await page.waitForTimeout(pollInterval);
  }

  // --- check for quota exhaustion ---
  let quotaExhausted = false;
  if (selectors.quotaExhaustedIndicator) {
    try {
      const indicator = selectors.quotaExhaustedIndicator.startsWith('text=')
        ? page.getByText(selectors.quotaExhaustedIndicator.slice(5))
        : page.locator(selectors.quotaExhaustedIndicator);
      quotaExhausted = (await indicator.count()) > 0;
    } catch {
      // ignore selector errors
    }
  }

  const answer = await page
    .locator(responseSelector)
    .last()
    .innerText()
    .catch(() => '');

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
  try {
    const indicator = selectors.quotaExhaustedIndicator.startsWith('text=')
      ? page.getByText(selectors.quotaExhaustedIndicator.slice(5))
      : page.locator(selectors.quotaExhaustedIndicator);
    return (await indicator.count()) > 0;
  } catch {
    return false;
  }
}
