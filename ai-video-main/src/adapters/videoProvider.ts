/* ------------------------------------------------------------------ */
/*  VideoProvider – browser automation for 即梦 video generation       */
/* ------------------------------------------------------------------ */

import type { Page, BrowserContext } from 'playwright';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import type { SelectorChain, SiteAutomationConfig } from '../types.js';
import { resolveSelector, selectorToChain, chainToSelector } from '../selectorResolver.js';
import { acquireContext, releaseContext } from '../browserManager.js';
import { quotaBus } from '../quotaBus.js';

export interface VideoGenRequest {
  prompt: string;
  imageUrl?: string;        // keyframe image path for img2video
  duration?: number;         // seconds
  aspectRatio?: string;
}

export interface VideoGenResult {
  localPath: string;
  durationMs?: number;
}

/**
 * Sanitize visual prompts for 即梦's content moderation.
 * 即梦 (especially agent mode) rejects prompts with medical/anatomical keywords
 * like "brain", "neural", "consciousness", "blood", etc.
 * Replace them with safe abstract/artistic equivalents.
 */
function sanitizePromptForJimeng(prompt: string): string {
  // Map of sensitive English/Chinese keywords to safe replacements
  const replacements: Array<[RegExp, string]> = [
    // Anatomical / medical terms → abstract visual equivalents
    [/\bbrain\b/gi, 'glowing sphere'],
    [/\bbrains\b/gi, 'glowing spheres'],
    [/\bneural\s*pathway[s]?\b/gi, 'flowing light streams'],
    [/\bneural\s*network[s]?\b/gi, 'interconnected light network'],
    [/\bneural\b/gi, 'luminous'],
    [/\bneuron[s]?\b/gi, 'glowing orb'],
    [/\bsynaps[ei]s?\b/gi, 'spark connections'],
    [/\bcortex\b/gi, 'layered dome structure'],
    [/\bhippocampus\b/gi, 'curved crystal structure'],
    [/\bamygdala\b/gi, 'almond-shaped gem'],
    [/\bcerebr\w+\b/gi, 'organic dome'],
    [/\bconsciousness\b/gi, 'inner awareness'],
    [/\bblood\s*vessel[s]?\b/gi, 'glowing channels'],
    [/\bblood\s*flow\b/gi, 'energy flow'],
    [/\bblood\b/gi, 'life energy'],
    [/\borgan[s]?\b/gi, 'core structure'],
    [/\bsurg\w+\b/gi, 'transformation'],
    [/\bdissect\w*\b/gi, 'reveal layers'],
    // Chinese anatomical terms
    [/大脑/g, '发光球体'],
    [/神经通路/g, '流光线条'],
    [/神经元/g, '光点'],
    [/神经/g, '光脉络'],
    [/意识/g, '内在感知'],
    [/血管/g, '能量通道'],
    [/血液/g, '生命能量'],
  ];

  let result = prompt;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Sanitize visual prompts for 可灵's content moderation.
 * 可灵 rejects prompts that mention chemicals, drugs, medical procedures,
 * violence, weapons, or anatomical details.
 */
function sanitizePromptForKling(prompt: string): string {
  const replacements: Array<[RegExp, string]> = [
    // Chemical / drug-related terms
    [/\bchemical\s*substance[s]?\b/gi, 'luminous essence'],
    [/\bchemical[s]?\b/gi, 'ethereal substance'],
    [/\bmolecule[s]?\b/gi, 'glowing particle'],
    [/\bcompound[s]?\b/gi, 'radiant element'],
    [/\bdrug[s]?\b/gi, 'healing light'],
    [/\btoxin[s]?\b/gi, 'dark mist'],
    [/\bpoison\w*\b/gi, 'shadow'],
    [/\binjection[s]?\b/gi, 'flow of light'],
    [/\bdose\b/gi, 'pulse'],
    [/\baddiction\b/gi, 'attachment'],
    // Medical / anatomical terms
    [/\bbrain\b/gi, 'glowing sphere'],
    [/\bneural\s*pathway[s]?\b/gi, 'flowing light streams'],
    [/\bneural\b/gi, 'luminous'],
    [/\bneuron[s]?\b/gi, 'glowing orb'],
    [/\bsynaps[ei]s?\b/gi, 'spark connections'],
    [/\bcortex\b/gi, 'layered dome'],
    [/\bcerebr\w+\b/gi, 'organic dome'],
    [/\bconsciousness\b/gi, 'inner awareness'],
    [/\bblood\s*vessel[s]?\b/gi, 'glowing channels'],
    [/\bblood\s*flow\b/gi, 'energy flow'],
    [/\bblood\b/gi, 'life energy'],
    [/\borgan[s]?\b/gi, 'core structure'],
    [/\bsurg\w+\b/gi, 'transformation'],
    [/\bbody\s*fluid[s]?\b/gi, 'flowing energy'],
    [/\bcancer\w*\b/gi, 'dark cluster'],
    [/\btumor[s]?\b/gi, 'shadow mass'],
    [/\bvirus\b/gi, 'dark spore'],
    [/\bbacteria\w*\b/gi, 'tiny drifting forms'],
    [/\binfect\w*\b/gi, 'spread'],
    [/\bdisease\b/gi, 'shadow'],
    [/\bdeath\b/gi, 'stillness'],
    [/\bdie[sd]?\b/gi, 'faded'],
    [/\bkill\w*\b/gi, 'vanquished'],
    [/\bweapon[s]?\b/gi, 'tool'],
    // Violence
    [/\bexplo[sd]\w*\b/gi, 'burst of light'],
    [/\bdestro\w+\b/gi, 'dissolving'],
    [/\battack\w*\b/gi, 'encounter'],
    [/\bwar\b/gi, 'conflict'],
    // Chinese terms
    [/化学物质/g, '发光精华'],
    [/化学/g, '光华'],
    [/分子/g, '光粒'],
    [/药物/g, '能量光束'],
    [/毒素/g, '暗雾'],
    [/癌[变细胞症]*/g, '暗簇'],
    [/肿瘤/g, '暗影'],
    [/病毒/g, '暗色浮尘'],
    [/细菌/g, '微浮形体'],
    [/感染/g, '蔓延'],
    [/疾病/g, '暗影'],
    [/死亡/g, '静止'],
    [/杀[死灭伤]*/g, '消散'],
    [/大脑/g, '发光球体'],
    [/神经通路/g, '流光线条'],
    [/神经元/g, '光点'],
    [/神经/g, '光脉络'],
    [/意识/g, '内在感知'],
    [/血管/g, '能量通道'],
    [/血液/g, '生命能量'],
    [/白细胞/g, '光之守卫'],
    [/红细胞/g, '暖光粒子'],
    [/器官/g, '核心结构'],
    [/心脏/g, '发光核心'],
    [/肺/g, '呼吸之穹'],
    [/肝/g, '深色琥珀'],
    [/饥饿/g, '能量匮乏'],
    [/人体/g, '光之形体'],
    [/生存/g, '延续'],
  ];

  let result = prompt;
  for (const [pattern, replacement] of replacements) {
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Aggressively rewrite a prompt after compliance rejection.
 * Strips all template framing (科普视频 instructions) and keeps only
 * the core visual description, replacing any remaining risky terms.
 */
function rewritePromptForCompliance(prompt: string): string {
  // Extract the visual description line (after "场景描述:") if present
  const descMatch = prompt.match(/场景描述[:：]\s*(.+?)(?:\n|风格要求|请直接|$)/s);
  let visual = descMatch ? descMatch[1].trim() : prompt;

  // Remove the Chinese template wrapper entirely
  visual = visual.replace(/请根据以下场景描述[^]*?场景描述[:：]\s*/s, '');
  visual = visual.replace(/风格要求[^]*$/s, '');
  visual = visual.replace(/请直接生成[^]*$/s, '');

  // Apply Kling sanitization again on the extracted part
  visual = sanitizePromptForKling(visual);

  // Rebuild as a minimal, safe, purely visual prompt
  return `Create a cinematic motion graphics animation: ${visual.trim()}. Smooth camera movement, professional lighting, 4K quality.`;
}

export type VideoProviderType = 'jimeng' | 'kling';

export interface VideoProviderConfig {
  /** Which video generation provider ('jimeng' or 'kling'). Defaults to 'jimeng'. */
  provider?: VideoProviderType;
  /** URL to navigate to */
  url: string;
  /** URL for agent mode (simpler interface, stricter moderation) */
  agentUrl?: string;
  /** Selector for the text prompt input */
  promptInput: string;
  /** Selector for the image upload trigger (optional, for img2video) */
  imageUploadTrigger?: string;
  /** Selector for the "generate" / "create" button */
  generateButton: string;
  /** Selector that appears when generation is in progress */
  progressIndicator?: string;
  /** Selector for the completed video element or download link */
  videoResult: string;
  /** Selector for download button (if separate from video element) */
  downloadButton?: string;
  /** Max wait time for generation in ms */
  maxWaitMs?: number;
  /** Profile directory for persistent login (single account) */
  profileDir: string;
  /** Multiple profile directories for account rotation */
  profileDirs?: string[];
}

// Browser management now delegated to ../browserManager.ts
// STEALTH_ARGS, removeChromeLocks, fixCrashedProfile, killStaleChrome,
// acquireContext, releaseContext are all imported from the unified module.

/**
 * Generate a video using a SiteAutomationConfig (SelectorChain-based).
 * This is the preferred method — uses resilient multi-strategy selectors.
 */
export async function generateVideoViaSiteConfig(
  config: SiteAutomationConfig,
  request: VideoGenRequest,
  outputDir: string,
  filename: string,
  _isComplianceRetry = false,
): Promise<VideoGenResult | null> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const profileName = config.profileDir.split('/').pop() ?? 'unknown';
  const isKling = config.siteUrl.includes('klingai.com') || config.siteUrl.includes('klingai.kuaishou.com');
  const providerLabel = isKling ? '可灵' : '即梦';

  // Helper: write diagnostic failure reason to a log file for debugging
  const writeFailure = (reason: string, details?: Record<string, unknown>) => {
    const logDir = join(outputDir, '..', 'ai-logs');
    try {
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
      const ts = new Date().toISOString().replace(/[:.]/g, '-');
      const logFile = join(logDir, `VIDEO_GEN_DIAG_${profileName}_${ts}.json`);
      writeFileSync(logFile, JSON.stringify({
        timestamp: new Date().toISOString(),
        profile: profileName,
        filename,
        prompt: request.prompt?.slice(0, 200),
        failureReason: reason,
        ...details,
      }, null, 2));
    } catch { /* best-effort */ }
    console.error(`[videoProvider] ❌ ${profileName}: ${reason}`);
  };

  let contextAcquired = false;
  try {
    const context = await acquireContext(config.profileDir);
    contextAcquired = true;

    const page = context.pages()[0] ?? (await context.newPage());

    // Navigate to site
    const currentUrl = page.url();
    const targetOrigin = new URL(config.siteUrl).origin;
    const needsNav = !currentUrl.startsWith(targetOrigin);
    if (needsNav) {
      await page.goto(config.siteUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    }
    await page.waitForTimeout(config.timing.hydrationDelayMs);

    // ---- Login check: detect if not logged in ----
    // 即梦 redirects to /ai-tool/home when not authenticated.
    // 可灵 shows a login modal or redirects to login page.
    const afterNavUrl = page.url();
    if (afterNavUrl.includes('/ai-tool/home')) {
      writeFailure('NOT_LOGGED_IN: redirected to /ai-tool/home (即梦)', { afterNavUrl });
      console.error('[videoProvider] Run: node open-seedance-login.mjs <account#>');
      return null;
    }
    if (isKling && (afterNavUrl.includes('/login') || afterNavUrl.includes('/passport'))) {
      writeFailure('NOT_LOGGED_IN: redirected to login page (可灵)', { afterNavUrl });
      console.error('[videoProvider] Run: node open-kling-login.mjs to log in');
      return null;
    }
    // Also check for kling login modal overlay
    if (isKling) {
      const hasLoginModal = await page.evaluate(`(function() {
        var t = document.body.innerText || '';
        return t.includes('登录') && (t.includes('手机号') || t.includes('验证码') || t.includes('扫码'));
      })()`).catch(() => false);
      if (hasLoginModal) {
        writeFailure('NOT_LOGGED_IN: login modal detected (可灵)', { afterNavUrl });
        console.error('[videoProvider] Run: node open-kling-login.mjs to log in');
        return null;
      }
    }

    // ---- Upload keyframe image ----
    let uploadedImageUri = '';
    if (request.imageUrl) {
      console.log(`[videoProvider] Uploading keyframe image: ${request.imageUrl}`);

      // Set up response interceptor to capture the CDN image URI.
      // Match provider-specific API domains, NOT CDN static asset URLs.
      const API_HOSTS = isKling
        ? ['klingai.com', 'api.klingai', 'ksyun.com', 'kuaishou.com']
        : ['jimeng.jianying.com', 'api.jimeng', 'tos-cn-'];
      const uploadRespHandler = async (response: import('playwright').Response) => {
        const url = response.url();
        const isProviderApi = API_HOSTS.some(h => url.includes(h));
        if (!isProviderApi) return; // skip CDN static assets
        if (response.status() !== 200) return;
        if (url.includes('/upload') || url.includes('/resource') || url.includes('/image') || url.includes('/aigc')) {
          try {
            const body = await response.text();
            console.log(`[videoProvider] ${providerLabel} API response (${url.split('?')[0]}): ${body.slice(0, 500)}`);
            try {
              const parsed = JSON.parse(body);
              const uri = parsed?.data?.uri || parsed?.data?.image_uri || parsed?.data?.url || parsed?.uri || '';
              if (uri) uploadedImageUri = uri;
            } catch { /* not JSON */ }
          } catch { /* response already consumed */ }
        }
      };
      page.on('response', uploadRespHandler);

      // Strategy 1: Use hidden file input directly.
      // 即梦 has 4 file inputs; the first two accept video/image/audio (for img2video),
      // the last two accept only images. Use the first one for img2video.
      // 可灵 uses .el-upload__input with accept=".jpg,.jpeg,.png".
      const fileInputSelector = isKling ? 'input.el-upload__input' : 'input[type="file"]';
      const fileInputs = page.locator(fileInputSelector);
      const fileInputCount = await fileInputs.count();
      console.log(`[videoProvider] Found ${fileInputCount} file input(s)`);
      const hiddenInput = fileInputs.first();
      if (fileInputCount > 0) {
        await hiddenInput.setInputFiles(request.imageUrl);
        console.log('[videoProvider] File set via setInputFiles');

        // Dispatch change + input events to trigger React/Vue handlers
        // setInputFiles alone may not fire the framework's synthetic events
        await hiddenInput.dispatchEvent('change', { bubbles: true });
        await hiddenInput.dispatchEvent('input', { bubbles: true });
        console.log('[videoProvider] Dispatched change+input events');

        // Wait for the actual image upload response from the provider's API
        try {
          await page.waitForResponse(
            resp => {
              const u = resp.url();
              if (isKling) {
                return resp.status() === 200 && (
                  u.includes('klingai.com') || u.includes('kuaishou.com') || u.includes('ksyun.com')
                ) && (u.includes('/upload') || u.includes('/resource') || u.includes('/image'));
              }
              return resp.status() === 200 && (
                (u.includes('jimeng.jianying.com') && (u.includes('/upload') || u.includes('/resource'))) ||
                u.includes('tos-cn-')
              );
            },
            { timeout: 30_000 },
          );
          console.log('[videoProvider] Image upload server response received');
        } catch {
          console.warn(`[videoProvider] No ${providerLabel} upload response within 30s, continuing...`);
        }
        await page.waitForTimeout(5_000); // extra UI settle time after upload
      } else if (config.selectors.imageUploadTrigger) {
        // Fallback: click upload trigger + fileChooser
        await uploadImageChain(page, config.selectors.imageUploadTrigger, request.imageUrl);
      }

      page.off('response', uploadRespHandler);

      // Check if an image preview appeared (indicating the upload was registered in UI state)
      const uploadState = await page.evaluate(`(() => {
        var state = { hasPreview: false, previewSrc: '', uploadedImages: 0 };
        // Look for image previews that appeared after upload
        document.querySelectorAll('img').forEach(function(img) {
          if (img.src && (img.src.includes('blob:') || img.src.includes('tos-') || img.src.includes('byteimg'))) {
            state.hasPreview = true;
            state.previewSrc = img.src.substring(0, 100);
            state.uploadedImages++;
          }
        });
        // Check for upload success indicators
        var successEl = document.querySelector('[class*="upload-success"], [class*="uploaded"], [class*="preview-image"], [class*="reference-image"]');
        if (successEl) state.hasPreview = true;
        return state;
      })()`).catch(() => ({ hasPreview: false })) as { hasPreview: boolean; previewSrc?: string; uploadedImages?: number };
      console.log(`[videoProvider] Post-upload UI state: ${JSON.stringify(uploadState)}`);
      if (uploadedImageUri) console.log(`[videoProvider] Captured CDN image URI: ${uploadedImageUri.slice(0, 100)}`);

      console.log(`[videoProvider] After image upload, page URL: ${page.url()}`);
    }

    // ---- Enter prompt (optional — 即梦 creation_agent mode may have no visible editor) ----
    // Try a broad set of selectors; if none match the prompt is skipped.
    const PROMPT_SELECTORS = [
      'div.tiptap.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"].ProseMirror',
      'div.ProseMirror[contenteditable="true"]',
      '[contenteditable="true"][role="textbox"]',
      '[contenteditable="true"]',
      '[role="textbox"]',
      'textarea[class*="prompt"]',
      'textarea[class*="input"]',
      'textarea',
      'input[type="text"][class*="prompt"]',
      'input[type="text"]',
    ];

    let promptLoc = null as import('playwright').Locator | null;
    const EDITOR_WAIT_TIMEOUT = 15_000;
    const editorWaitStart = Date.now();
    while (Date.now() - editorWaitStart < EDITOR_WAIT_TIMEOUT) {
      for (const sel of PROMPT_SELECTORS) {
        const loc = page.locator(sel).first();
        if (await loc.count().catch(() => 0) > 0) {
          promptLoc = loc;
          console.log(`[videoProvider] Found prompt editor with selector: ${sel}`);
          break;
        }
      }
      if (promptLoc) break;
      await page.waitForTimeout(1_000);
    }

    if (!promptLoc) {
      // Take a diagnostic screenshot for analysis (but do NOT abort)
      const screenshotPath = join(outputDir, '..', 'ai-logs', `VIDEO_GEN_DIAG_${profileName}_screenshot_${Date.now()}.png`);
      try {
        const logDir = join(outputDir, '..', 'ai-logs');
        if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
        await page.screenshot({ path: screenshotPath, fullPage: true });
        console.log(`[videoProvider] Diagnostic screenshot saved: ${screenshotPath}`);
      } catch { /* best-effort */ }

      // Dump page DOM structure for debugging
      const pageInfo = await page.evaluate(`(() => {
        var info = { url: location.href, title: document.title, editables: [], inputs: [], buttons: [] };
        document.querySelectorAll('[contenteditable]').forEach(function(el) {
          info.editables.push({ tag: el.tagName, classes: el.className.substring(0, 100), role: el.getAttribute('role') });
        });
        document.querySelectorAll('textarea, input[type="text"]').forEach(function(el) {
          info.inputs.push({ tag: el.tagName, classes: el.className.substring(0, 100), placeholder: el.getAttribute('placeholder') });
        });
        document.querySelectorAll('button').forEach(function(el) {
          if (el.getBoundingClientRect().width > 0) {
            info.buttons.push({ text: (el.textContent || '').trim().substring(0, 50), classes: el.className.substring(0, 150), disabled: el.disabled });
          }
        });
        return info;
      })()`).catch(() => ({}));

      console.warn('[videoProvider] ⚠️ No prompt editor found — continuing without prompt (creation_agent mode)');
      writeFailure('PROMPT_EDITOR_NOT_FOUND_CONTINUING', {
        pageUrl: page.url(),
        screenshotPath,
        pageInfo,
        triedSelectors: PROMPT_SELECTORS,
        note: 'Continuing without prompt — will try submit button directly',
      });
      // Do NOT return null — proceed to submit button
    } else {
      // Use clipboard paste instead of keyboard.type to avoid interleaving
      // when multiple browser instances run in parallel (OS-level keystrokes mix).
      const sanitizedPrompt = isKling ? sanitizePromptForKling(request.prompt) : sanitizePromptForJimeng(request.prompt);
      if (sanitizedPrompt !== request.prompt) {
        console.log(`[videoProvider] Prompt sanitized for ${providerLabel} compliance`);
      }
      await promptLoc.click();
      await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
      await page.keyboard.press('Backspace');
      // Inject text via ProseMirror DOM API + dispatch input event
      await promptLoc.evaluate((el: any, text: string) => {
        el.textContent = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
      }, sanitizedPrompt);
      // Small wait then click the editor once more to trigger TipTap's internal state update
      await page.waitForTimeout(300);
      // Verify the text was entered; fall back to clipboard paste if empty
      const enteredLen = await promptLoc.evaluate((el: any) => (el.textContent || '').length);
      if (enteredLen < sanitizedPrompt.length * 0.5) {
        console.log(`[videoProvider] DOM inject resulted in ${enteredLen} chars, falling back to clipboard paste`);
        await page.evaluate(async (text: string) => {
          await (navigator as any).clipboard.writeText(text);
        }, sanitizedPrompt);
        await promptLoc.click();
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+a' : 'Control+a');
        await page.keyboard.press('Backspace');
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+v' : 'Control+v');
        await page.waitForTimeout(500);
      }
      console.log(`[videoProvider] Prompt entered (${sanitizedPrompt.length} chars)`);
    }

    // ---- Wait for Generate button to become enabled, then click ----
    // 即梦's generate button: icon-only circle button with class containing "submit-"
    // 可灵's generate button: "生成" text button with class "generic-button critical big"
    const GEN_BTN_SELECTORS = isKling ? [
      'button.generic-button.critical.big',
      'button.generic-button.critical',
      'button:has-text("生成")',
      'button[class*="button-pay"]',
      'button[type="submit"]',
    ] : [
      'button[class*="submit-button"]:not([class*="collapsed"])',
      'button[class*="submit-"]',
      'button[class*="submit"]',
      'button[class*="generate"]',
      'button[type="submit"]',
    ];
    let genBtnLocator = null as import('playwright').Locator | null;
    let genBtnSelector = '';
    for (const sel of GEN_BTN_SELECTORS) {
      const loc = page.locator(sel).first();
      if (await loc.count().catch(() => 0) > 0) {
        genBtnLocator = loc;
        genBtnSelector = sel;
        console.log(`[videoProvider] Found submit button with selector: ${sel}`);
        break;
      }
    }
    if (!genBtnLocator) {
      writeFailure('SUBMIT_BUTTON_NOT_FOUND: No submit button on page', {
        pageUrl: page.url(),
        triedSelectors: GEN_BTN_SELECTORS,
      });
      return null;
    }

    // Wait up to 60s for the button to become clickable.
    // 即梦 uses BOTH html disabled property AND CSS class 'lv-btn-disabled'.
    // 可灵 uses html disabled or 'is-disabled' class (Element UI convention).
    const disabledClassPattern = isKling ? 'is-disabled' : 'lv-btn-disabled';
    const btnWaitStart = Date.now();
    const BTN_WAIT_TIMEOUT = 60_000;
    const escapedBtnSel = genBtnSelector.replace(/'/g, "\\'");
    const escapedDisabledClass = disabledClassPattern;
    while (Date.now() - btnWaitStart < BTN_WAIT_TIMEOUT) {
      const btnState = await page.evaluate(`(function() {
        var el = document.querySelector('${escapedBtnSel}');
        if (!el) return null;
        return {
          disabled: el.disabled,
          hasDisabledClass: el.className.includes('${escapedDisabledClass}'),
          classes: el.className.substring(0, 300),
          visible: el.getBoundingClientRect().width > 0,
        };
      })()`).catch(() => null) as { disabled: boolean; hasDisabledClass: boolean; classes: string; visible: boolean } | null;

      if (!btnState) {
        console.log('[videoProvider] Button not found in DOM, retrying...');
        await page.waitForTimeout(2_000);
        continue;
      }

      if (!btnState.disabled && !btnState.hasDisabledClass) {
        console.log(`[videoProvider] Button is enabled (classes: ${btnState.classes.slice(0, 100)})`);
        break;
      }
      console.log(`[videoProvider] Button not ready: disabled=${btnState.disabled}, hasDisabledClass=${btnState.hasDisabledClass}`);
      await page.waitForTimeout(2_000);
    }

    // Final state check
    const btnFinalState = await page.evaluate(`(function() {
      var el = document.querySelector('${escapedBtnSel}');
      if (!el) return null;
      return {
        disabled: el.disabled,
        hasDisabledClass: el.className.includes('${escapedDisabledClass}'),
        classes: el.className.substring(0, 300),
        rect: JSON.parse(JSON.stringify(el.getBoundingClientRect())),
      };
    })()`).catch(() => null) as { disabled: boolean; hasDisabledClass: boolean; classes: string; rect: Record<string, number> } | null;
    console.log(`[videoProvider] Button final state: ${JSON.stringify(btnFinalState)}`);

    if (!btnFinalState) {
      // evaluate() failed entirely — button may have been detached
      writeFailure('BUTTON_STATE_CHECK_FAILED: Could not evaluate button state', {
        pageUrl: page.url(),
      });
      // Try force-enabling anyway (same as disabled path)
    }

    if (!btnFinalState || btnFinalState.disabled || btnFinalState.hasDisabledClass) {
      // Force-remove the disabled class and try clicking anyway.
      // The image IS uploaded to the server (confirmed by upload response),
      // so the generation might still work even if the UI thinks the button is disabled.
      console.log('[videoProvider] ⚠️ Button still disabled — attempting force-enable...');

      // Take pre-force screenshot
      try {
        const logDir = join(outputDir, '..', 'ai-logs');
        if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
        await page.screenshot({ path: join(logDir, `VIDEO_GEN_BEFORE_FORCE_${profileName}_${Date.now()}.png`), fullPage: true });
      } catch { /* best-effort */ }

      // Force-remove disabled state from ALL submit buttons
      await page.evaluate(`(function() {
        var btnSel = '${isKling ? 'button.generic-button' : 'button[class*="submit"]'}';
        var disClass = '${escapedDisabledClass}';
        document.querySelectorAll(btnSel).forEach(function(btn) {
          btn.classList.remove(disClass);
          btn.disabled = false;
        });
      })()`);
      await page.waitForTimeout(500);

      // Now try clicking via JavaScript dispatch (more forceful than Playwright click)
      const forceClicked = await page.evaluate(`(function() {
        var btn = document.querySelector('${escapedBtnSel}');
        if (!btn) return false;
        btn.click();
        btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
        return true;
      })()`).catch(() => false);
      console.log(`[videoProvider] Force-clicked button: ${forceClicked}`);

      // Also try a fallback selector for the specific provider
      await page.evaluate(`(function() {
        var btn = ${isKling
          ? "document.querySelector('button.generic-button.critical.big') || document.querySelector('button:has-text(\"生成\")')"
          : "document.querySelector('button[class*=\"submit-button-s4a7XV\"]') || document.querySelector('button[class*=\"submit-button\"]:not([class*=\"collapsed\"])')"};
        if (btn) {
          btn.classList.remove('${escapedDisabledClass}');
          btn.disabled = false;
          btn.click();
        }
      })()`);
      console.log('[videoProvider] Force-enabled and clicked submit button, waiting for result...');
    }

    // ---- Set up network logging to capture API calls triggered by Generate click ----
    const apiLogs: Array<{ url: string; status: number; body?: string }> = [];
    const providerApiHosts = isKling
      ? ['klingai.com', 'kuaishou.com']
      : ['jimeng.jianying.com', 'tos-cn-'];
    const netHandler = async (response: import('playwright').Response) => {
      const url = response.url();
      // Only capture provider API calls, not CDN static assets
      if (!providerApiHosts.some(h => url.includes(h))) return;
      if (url.includes('/api/') || url.includes('/muse/') || url.includes('/generate') ||
          url.includes('/draft') || url.includes('/task') || url.includes('/aigc') ||
          url.includes('/submit') || url.includes('/create')) {
        try {
          const body = await response.text().catch(() => '');
          // For Kling task/status responses, keep more body to capture video resource URLs
          const maxBody = (isKling && (url.includes('/task/') || url.includes('/works/'))) ? 5000 : 500;
          apiLogs.push({ url: url.slice(0, 200), status: response.status(), body: body.slice(0, maxBody) });
        } catch {
          apiLogs.push({ url: url.slice(0, 200), status: response.status() });
        }
      }
    };
    page.on('response', netHandler);

    // If button was naturally enabled, click it normally (skip if we already force-clicked)
    if (btnFinalState && !btnFinalState.disabled && !btnFinalState.hasDisabledClass) {
      console.log('[videoProvider] Clicking Generate button...');
      await genBtnLocator.click({ timeout: 10_000 });
      console.log('[videoProvider] Generate clicked, waiting for video result...');
    }

    // ---- Poll for video generation result ----
    // After clicking Generate, 即梦 shows a loading state then reveals a result video.
    // We look for a NEW video element that appears (with a blob: or https: src).
    const maxWait = config.timing.maxWaitMs;
    const pollInterval = config.timing.pollIntervalMs;
    let elapsed = 0;

    // Minimum wait before polling — real video generation takes at least 30s
    const MIN_GENERATION_WAIT = 30_000;

    // Count existing video elements before generation starts (pierce Shadow DOM)
    // NOTE: Use string eval to prevent esbuild __name injection (breaks in-page context)
    const countVideos = () => page.evaluate(`(
      () => {
        var count = 0;
        var walk = function(root) {
          root.querySelectorAll('video').forEach(function(v) {
            if (v.src && (v.src.startsWith('blob:') || v.src.startsWith('http'))) count++;
            var src = v.querySelector('source');
            if (src && src.src) count++;
          });
          root.querySelectorAll('*').forEach(function(el) {
            if (el.shadowRoot) walk(el.shadowRoot);
          });
        };
        walk(document);
        return count;
      }
    )()`);

    // Check if video element has a real duration (not a placeholder)
    const getLatestVideoDuration = () => page.evaluate(`(
      () => {
        var maxDur = 0;
        var walk = function(root) {
          root.querySelectorAll('video').forEach(function(v) {
            if (v.duration && isFinite(v.duration) && v.duration > maxDur) maxDur = v.duration;
          });
          root.querySelectorAll('*').forEach(function(el) {
            if (el.shadowRoot) walk(el.shadowRoot);
          });
        };
        walk(document);
        return maxDur;
      }
    )()`);

    const preExistingVideoCount = await countVideos() as number;
    console.log(`[videoProvider] Pre-existing video elements: ${preExistingVideoCount}, waiting at least ${MIN_GENERATION_WAIT / 1000}s...`);

    // Take a screenshot 5s after click to see immediate reaction
    await page.waitForTimeout(5_000);
    elapsed += 5_000;
    try {
      const logDir = join(outputDir, '..', 'ai-logs');
      if (!existsSync(logDir)) mkdirSync(logDir, { recursive: true });
      await page.screenshot({ path: join(logDir, `VIDEO_GEN_POST_CLICK_${profileName}_${Date.now()}.png`), fullPage: true });
      console.log('[videoProvider] Post-click screenshot saved (5s)');
    } catch { /* best-effort */ }

    // Log API calls captured so far
    if (apiLogs.length > 0) {
      console.log(`[videoProvider] API calls after click (${apiLogs.length}):`);
      for (const log of apiLogs) {
        console.log(`  ${log.status} ${log.url}`);
        if (log.body) console.log(`    body: ${log.body.slice(0, 200)}`);
      }
    } else {
      console.log('[videoProvider] ⚠️ No API calls detected after clicking Generate — button click may have had no effect');
    }

    // ---- Detect subscription paywall popup ----
    // 即梦 shows "订阅即梦，解锁更多能力" modal when credits are exhausted.
    // 可灵 shows "灵感值不足" or "开通会员" when credits run out.
    // Detect it early and fail fast instead of waiting 360s.
    const paywallDetected = await page.evaluate(`(function() {
      var texts = document.body.innerText || '';
      if (${isKling}) {
        // 可灵 paywall detection
        if (texts.includes('灵感值不足') || texts.includes('开通会员') || texts.includes('升级套餐') || texts.includes('购买灵感值')) {
          return 'SUBSCRIPTION_REQUIRED';
        }
        return false;
      }
      // 即梦 paywall detection
      if (texts.includes('订阅即梦') || texts.includes('解锁更多能力') || texts.includes('购买积分')) {
        var hasPricing = texts.includes('基础会员') || texts.includes('高级会员') || texts.includes('标准会员');
        return hasPricing ? 'SUBSCRIPTION_REQUIRED' : false;
      }
      return false;
    })()`).catch(() => false);

    if (paywallDetected) {
      console.error(`[videoProvider] ❌ ${providerLabel} subscription paywall detected — account has insufficient credits!`);
      console.error('[videoProvider] Free accounts get daily free credits; they may be exhausted for today.');

      // Broadcast to unified quota bus
      quotaBus.emit({
        provider: isKling ? 'kling' : 'seedance',
        accountId: profileName,
        capability: 'video',
        exhausted: true,
        reason: `${providerLabel} paywall detected for profile ${profileName} — credits exhausted`,
      });

      // Try to close the popup and continue with next account
      await page.evaluate(`(function() {
        // Click the close button (X) on the modal
        var closeBtn = document.querySelector('[class*="modal"] [class*="close"]') ||
                       document.querySelector('[class*="dialog"] [class*="close"]') ||
                       document.querySelector('[aria-label="Close"]') ||
                       document.querySelector('[class*="icon-close"]');
        if (closeBtn) closeBtn.click();
        // Also try pressing Escape
      })()`).catch(() => {});
      await page.keyboard.press('Escape').catch(() => {});

      page.off('response', netHandler);
      writeFailure('INSUFFICIENT_CREDITS: Subscription paywall appeared after clicking Generate', {
        profileName,
        hint: 'Free account daily credits exhausted. Try another account or wait for reset.',
      });
      return null;
    }

    // Wait remaining minimum time
    const remainMin = MIN_GENERATION_WAIT - elapsed;
    if (remainMin > 0) {
      await page.waitForTimeout(remainMin);
      elapsed += remainMin;
    }

    // --- Queue-state detection helper ---
    // 即梦 shows "排队加速中" / "预计等待 X 分钟" while the task is queued.
    // Detecting this confirms generation was submitted and tells us how long to wait.
    const detectQueueState = () => page.evaluate(`(function() {
      var t = document.body.innerText || '';
      var state = { queued: false, estimatedMin: 0, text: '' };
      if (t.includes('排队') || t.includes('队列') || t.includes('排队加速中')) {
        state.queued = true;
        var m = t.match(/预计等待\\s*(\\d+)\\s*分钟/);
        if (m) state.estimatedMin = parseInt(m[1], 10);
        // Also try "约X分钟"
        if (!state.estimatedMin) {
          var m2 = t.match(/约\\s*(\\d+)\\s*分钟/);
          if (m2) state.estimatedMin = parseInt(m2[1], 10);
        }
      }
      // Also detect "生成中" (generating) or "取消生成" (cancel generation) as positive signals
      if (t.includes('生成中') || t.includes('取消生成')) {
        state.queued = true;
      }
      return state;
    })()`).catch(() => ({ queued: false, estimatedMin: 0 })) as Promise<{ queued: boolean; estimatedMin: number }>;

    let queueConfirmed = false;
    let lastQueueLog = 0;

    while (elapsed < maxWait) {
      await page.waitForTimeout(pollInterval);
      elapsed += pollInterval;

      // Check for subscription paywall popup (can appear late)
      const paywallInLoop = await page.evaluate(`(function() {
        var t = document.body.innerText || '';
        if (${isKling}) {
          return t.includes('灵感值不足') || t.includes('开通会员') || t.includes('升级套餐');
        }
        return (t.includes('订阅即梦') || t.includes('解锁更多能力')) && (t.includes('基础会员') || t.includes('高级会员'));
      })()`).catch(() => false);
      if (paywallInLoop) {
        console.error(`[videoProvider] ❌ ${providerLabel} paywall detected during wait — credits exhausted`);
        page.off('response', netHandler);
        writeFailure('INSUFFICIENT_CREDITS: Paywall detected during video wait', { elapsed });
        quotaBus.emit({
          provider: isKling ? 'kling' : 'seedance',
          accountId: profileName,
          capability: 'video',
          exhausted: true,
          reason: `${providerLabel} paywall in wait loop for profile ${profileName}`,
        });
        return null;
      }

      // Check queue state — confirms task was submitted
      const qState = await detectQueueState();
      if (qState.queued && !queueConfirmed) {
        queueConfirmed = true;
        const estMsg = qState.estimatedMin ? ` (estimated wait: ${qState.estimatedMin} min)` : '';
        console.log(`[videoProvider] ✅ Task confirmed in queue${estMsg} — will wait up to ${maxWait / 60_000} min`);
      }
      // Log queue updates every 60s
      if (qState.queued && elapsed - lastQueueLog >= 60_000) {
        lastQueueLog = elapsed;
        const estMsg = qState.estimatedMin ? `~${qState.estimatedMin}min remaining` : 'no ETA';
        console.log(`[videoProvider] ⏳ Still in queue: ${estMsg}, elapsed ${Math.round(elapsed / 1000)}s`);
      }

      // Check for content compliance rejection (specific moderation keywords only)
      const complianceCheck = await page.evaluate(`(function() {
        var t = document.body.innerText || '';
        var isCompliance = t.includes('内容不合规') || t.includes('不符合社区规范')
          || t.includes('内容违规') || t.includes('违反社区') || t.includes('审核未通过')
          || t.includes('content violation') || t.includes('violates our');
        var isGenericFail = !isCompliance && t.includes('生成失败');
        return { compliance: isCompliance, genericFail: isGenericFail };
      })()`).catch(() => ({ compliance: false, genericFail: false })) as { compliance: boolean; genericFail: boolean };

      // Also check Kling API for task failure with moderation reason
      if (isKling && !complianceCheck.compliance) {
        const klingTaskFail = apiLogs.some(l =>
          l.url.includes('/task/status') && l.body &&
          (l.body.includes('"status":50') || l.body.includes('审核') || l.body.includes('违规')),
        );
        if (klingTaskFail) complianceCheck.compliance = true;
      }

      // Generic "生成失败" without compliance keywords — log but continue waiting
      if (complianceCheck.genericFail && !complianceCheck.compliance && elapsed > 60_000) {
        console.warn(`[videoProvider] ⚠️ Generic generation failure detected at ${Math.round(elapsed / 1000)}s (not compliance)`);
      }

      if (complianceCheck.compliance) {
        console.error('[videoProvider] ❌ Content compliance rejection detected');
        page.off('response', netHandler);

        if (!_isComplianceRetry && isKling) {
          // Retry once with an aggressively rewritten prompt
          const rewritten = rewritePromptForCompliance(request.prompt);
          console.log(`[videoProvider] 🔄 Retrying with compliance-safe prompt (${rewritten.length} chars)`);
          writeFailure('CONTENT_COMPLIANCE_REJECTED: will retry with rewritten prompt', { elapsed, originalPrompt: request.prompt.slice(0, 200), rewrittenPrompt: rewritten.slice(0, 200) });
          // Release current context before retry
          releaseContext(config.profileDir);
          return generateVideoViaSiteConfig(config, { ...request, prompt: rewritten }, outputDir, filename, true);
        }

        writeFailure('CONTENT_COMPLIANCE_REJECTED: Prompt was rejected by content moderation', { elapsed });
        return null;
      }

      // Check for credit/quota exhaustion — fail fast instead of waiting 65 min
      const creditExhausted = await page.evaluate(`(function() {
        var t = document.body.innerText || '';
        if (${isKling}) {
          return t.includes('灵感值不足') || t.includes('灵感值余额') || t.includes('购买灵感值');
        }
        return t.includes('积分不足') || t.includes('额度不足') || t.includes('次数已用完')
          || t.includes('获取积分') || t.includes('购买积分');
      })()`).catch(() => false);
      if (creditExhausted && elapsed > 30_000) {
        console.error(`[videoProvider] ❌ Credit/quota exhaustion detected — ${providerLabel} credits insufficient`);
        page.off('response', netHandler);
        writeFailure(`CREDIT_EXHAUSTED: ${providerLabel} account credits insufficient for video generation`, { elapsed, profileName });
        return null;
      }

      // Check for newly appeared video elements (pierces Shadow DOM)
      const currentVideoCount = await countVideos() as number;
      if (currentVideoCount > preExistingVideoCount) {
        // Verify the video has a real duration (> 1s) to avoid false positives
        const videoDuration = await getLatestVideoDuration() as number;
        if (videoDuration > 1) {
          console.log(`[videoProvider] ✅ New video detected after ${elapsed / 1000}s (duration: ${videoDuration.toFixed(1)}s)`);
          break;
        } else {
          console.log(`[videoProvider] Video element found but duration=${videoDuration.toFixed(1)}s (too short/loading), continuing to wait...`);
        }
      }

      if (elapsed % 30_000 === 0) {
        console.log(`[videoProvider] Still waiting for video... ${Math.round(elapsed / 1000)}s / ${Math.round(maxWait / 1000)}s`);
        // Periodic screenshot every 120s (not too frequent for long waits)
        if (elapsed % 120_000 === 0) {
          try {
            const logDir = join(outputDir, '..', 'ai-logs');
            await page.screenshot({ path: join(logDir, `VIDEO_GEN_WAIT_${profileName}_${Math.round(elapsed / 1000)}s_${Date.now()}.png`) });
          } catch { /* best-effort */ }
        }
      }
    }

    // Clean up network listener
    page.off('response', netHandler);

    if (elapsed >= maxWait) {
      // Dump all captured API calls and page state for analysis
      const finalPageState = await page.evaluate(`(() => {
        var info = { url: location.href, videos: [], allMediaSrc: [] };
        document.querySelectorAll('video').forEach(function(v) {
          info.videos.push({ src: (v.src || '').substring(0, 100), duration: v.duration, paused: v.paused });
        });
        document.querySelectorAll('video source').forEach(function(s) {
          info.allMediaSrc.push(s.src ? s.src.substring(0, 100) : '');
        });
        document.querySelectorAll('a[href*="download"], a[download]').forEach(function(a) {
          info.allMediaSrc.push('download-link:' + (a.href || '').substring(0, 100));
        });
        return info;
      })()`).catch(() => ({}));

      writeFailure(`TIMEOUT: Video generation timed out after ${maxWait / 1000}s`, {
        elapsed, maxWait,
        apiCallsCount: apiLogs.length,
        apiCalls: apiLogs.slice(0, 20),
        finalPageState,
      });
      return null;
    }

    // Give a few extra seconds for the video to fully load
    await page.waitForTimeout(3_000);

    // ---- Download the generated video ----
    const outputPath = join(outputDir, filename);

    // Strategy 0 (Kling only): Extract direct CDN URL from captured API responses
    if (isKling && !existsSync(outputPath)) {
      for (const log of [...apiLogs].reverse()) {  // Check most recent responses first
        if (!log.body) continue;
        // Match Kling CDN video URLs in API responses (task/status, user/works)
        // Kling uses various CDN hosts: klingai.com, ksyun.com, kwaicdn.com, etc.
        const cdnMatch = log.body.match(/"resource"\s*:\s*"(https?:\/\/[^"]+(?:\.mp4|\/video\/[^"]+)[^"]*)"/);
        if (!cdnMatch) {
          // Also try matching any video-like URL in the response
          const videoUrlMatch = log.body.match(/"(https?:\/\/[^"]*(?:kcdn|ksyun|kwai|cos)[^"]*(?:\.mp4|video)[^"]*)"/);
          if (videoUrlMatch) {
            const cdnUrl = videoUrlMatch[1];
            console.log(`[videoProvider] Found Kling video URL in API response: ${cdnUrl.slice(0, 120)}...`);
            try {
              const { writeFileSync } = await import('node:fs');
              const { default: http } = await import('node:https');
              // Download via Node.js https instead of page.evaluate to avoid CORS
              const data = await new Promise<Buffer>((resolve, reject) => {
                http.get(cdnUrl, (res) => {
                  const chunks: Buffer[] = [];
                  res.on('data', (c: Buffer) => chunks.push(c));
                  res.on('end', () => resolve(Buffer.concat(chunks)));
                  res.on('error', reject);
                }).on('error', reject);
              });
              if (data.length > 10000) {
                writeFileSync(outputPath, data);
                console.log(`[videoProvider] Video saved from Kling CDN (node https): ${outputPath} (${(data.length / 1024 / 1024).toFixed(1)}MB)`);
              }
            } catch (e) {
              console.warn(`[videoProvider] Kling CDN download failed: ${e instanceof Error ? e.message : e}`);
            }
            if (existsSync(outputPath)) break;
          }
          continue;
        }
        const cdnUrl = cdnMatch[1];
        console.log(`[videoProvider] Found Kling CDN URL in API response: ${cdnUrl.slice(0, 120)}...`);
        try {
          const { writeFileSync } = await import('node:fs');
          const { default: http } = await import('node:https');
          const data = await new Promise<Buffer>((resolve, reject) => {
            http.get(cdnUrl, (res) => {
              const chunks: Buffer[] = [];
              res.on('data', (c: Buffer) => chunks.push(c));
              res.on('end', () => resolve(Buffer.concat(chunks)));
              res.on('error', reject);
            }).on('error', reject);
          });
          if (data.length > 10000) {
            writeFileSync(outputPath, data);
            console.log(`[videoProvider] Video saved from Kling CDN (node https): ${outputPath} (${(data.length / 1024 / 1024).toFixed(1)}MB)`);
          }
        } catch (e) {
          console.warn(`[videoProvider] Kling CDN download failed: ${e instanceof Error ? e.message : e}`);
        }
        if (existsSync(outputPath)) break;
      }
    }

    // Strategy 1: Look for a download button or link
    if (!existsSync(outputPath)) {
      const dlBtn = page.locator('a[download], button:has-text("下载"), button:has-text("Download"), a[href*="download" i]').first();
      if (await dlBtn.count() > 0 && await dlBtn.isVisible()) {
        try {
          const [download] = await Promise.all([
            page.waitForEvent('download', { timeout: 15_000 }),
            dlBtn.click(),
          ]);
          await download.saveAs(outputPath);
          console.log(`[videoProvider] Video downloaded via button to: ${outputPath}`);
        } catch (e) {
          console.warn(`[videoProvider] Download button failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    }

    // Strategy 2: Extract video URL directly from DOM (pierces Shadow DOM)
    if (!existsSync(outputPath)) {
      // NOTE: Use string eval to prevent esbuild __name injection
      const videoUrl = await page.evaluate(`(
        () => {
          var urls = [];
          var walk = function(root) {
            root.querySelectorAll('video').forEach(function(v) {
              if (v.src && (v.src.startsWith('blob:') || v.src.startsWith('http'))) urls.push(v.src);
              var src = v.querySelector('source');
              if (src && src.src) urls.push(src.src);
            });
            root.querySelectorAll('*').forEach(function(el) {
              if (el.shadowRoot) walk(el.shadowRoot);
            });
          };
          walk(document);
          return urls.length > 0 ? urls[urls.length - 1] : null;
        }
      )()`) as string | null;

      if (videoUrl) {
        console.log(`[videoProvider] Extracting video from URL: ${videoUrl.slice(0, 100)}...`);
        try {
          if (videoUrl.startsWith('blob:')) {
            // blob URL: use XMLHttpRequest to bypass custom fetch interceptors (e.g. Kling)
            // NOTE: Use string eval to avoid TS error for XMLHttpRequest in Node context
            const base64 = await page.evaluate(`(async () => {
              var url = ${JSON.stringify(videoUrl)};
              return new Promise(function(resolve, reject) {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.responseType = 'blob';
                xhr.onload = function() {
                  if (xhr.status >= 200 && xhr.status < 300) {
                    var reader = new FileReader();
                    reader.onload = function() { resolve(reader.result.split(',')[1] || ''); };
                    reader.onerror = function() { reject(new Error('FileReader failed')); };
                    reader.readAsDataURL(xhr.response);
                  } else { reject(new Error('XHR status ' + xhr.status)); }
                };
                xhr.onerror = function() { reject(new Error('XHR network error')); };
                xhr.send();
              });
            })()`) as string;
            if (base64) {
              const { writeFileSync } = await import('node:fs');
              writeFileSync(outputPath, Buffer.from(base64, 'base64'));
              console.log(`[videoProvider] Video saved from blob: ${outputPath}`);
            }
          } else {
            // HTTP URL: download directly via XHR
            const { writeFileSync } = await import('node:fs');
            const resp = await page.evaluate(`(async () => {
              var url = ${JSON.stringify(videoUrl)};
              return new Promise(function(resolve, reject) {
                var xhr = new XMLHttpRequest();
                xhr.open('GET', url, true);
                xhr.responseType = 'arraybuffer';
                xhr.onload = function() {
                  if (xhr.status >= 200 && xhr.status < 300) {
                    resolve(Array.from(new Uint8Array(xhr.response)));
                  } else { reject(new Error('XHR status ' + xhr.status)); }
                };
                xhr.onerror = function() { reject(new Error('XHR network error')); };
                xhr.send();
              });
            })()`) as number[];
            writeFileSync(outputPath, Buffer.from(resp));
            console.log(`[videoProvider] Video saved from URL: ${outputPath}`);
          }
        } catch (e) {
          console.warn(`[videoProvider] Video extraction failed: ${e instanceof Error ? e.message : e}`);
        }
      }
    }

    if (existsSync(outputPath)) {
      return { localPath: outputPath };
    }

    console.warn('[videoProvider] No video file produced');
    writeFailure('NO_VIDEO_FILE: All download strategies failed', { outputPath });
    return null;
  } catch (err) {
    writeFailure(`EXCEPTION: ${err instanceof Error ? err.message : String(err)}`, { stack: err instanceof Error ? err.stack : undefined });
    return null;
  } finally {
    if (contextAcquired) {
      await releaseContext(config.profileDir);
    }
  }
}

/**
 * Convert a legacy VideoProviderConfig to a SiteAutomationConfig.
 * Allows gradual migration from the old format.
 */
export function legacyConfigToSiteConfig(config: VideoProviderConfig, id = 'custom-video'): SiteAutomationConfig {
  const providerType = detectProvider(config);
  const label = providerType === 'kling' ? '可灵 AI（视频生成）' : '即梦（视频生成）';
  return {
    id,
    label,
    type: 'video',
    siteUrl: config.url,
    capabilities: { video: true, fileUpload: !!config.imageUploadTrigger },
    selectors: {
      promptInput: selectorToChain(config.promptInput),
      generateButton: selectorToChain(config.generateButton),
      resultElement: selectorToChain(config.videoResult),
      progressIndicator: config.progressIndicator ? selectorToChain(config.progressIndicator) : undefined,
      downloadButton: config.downloadButton ? selectorToChain(config.downloadButton) : undefined,
      imageUploadTrigger: config.imageUploadTrigger ? selectorToChain(config.imageUploadTrigger) : undefined,
    },
    timing: {
      maxWaitMs: config.maxWaitMs ?? 3_900_000,
      pollIntervalMs: 5_000,
      hydrationDelayMs: providerType === 'kling' ? 8_000 : 3_000,
    },
    profileDir: config.profileDir,
  };
}

/**
 * Detect the video provider type from config.
 */
function detectProvider(config: VideoProviderConfig): VideoProviderType {
  if (config.provider) return config.provider;
  if (config.url.includes('klingai.com') || config.url.includes('klingai.kuaishou.com')) return 'kling';
  return 'jimeng';
}

/**
 * Generate a video using browser automation.
 * Supports both 即梦 and 可灵 providers.
 * For 即梦: uses agentUrl (agent mode) as primary, falls back to standard url.
 * For 可灵: uses url directly (no agent mode).
 */
export async function generateVideoViaWeb(
  config: VideoProviderConfig,
  request: VideoGenRequest,
  outputDir: string,
  filename: string,
): Promise<VideoGenResult | null> {
  const providerType = detectProvider(config);

  if (providerType === 'kling') {
    // 可灵 has no agent mode — use standard url directly
    const siteConfig = legacyConfigToSiteConfig(config, 'kling-video');
    return generateVideoViaSiteConfig(siteConfig, request, outputDir, filename);
  }

  // 即梦: use agentUrl (agent mode) as primary, falls back to standard url
  const primaryUrl = config.agentUrl || config.url;
  const siteConfig = legacyConfigToSiteConfig({ ...config, url: primaryUrl });
  const result = await generateVideoViaSiteConfig(siteConfig, request, outputDir, filename);
  if (result) return result;

  // Fallback: try standard mode URL if agent mode failed and URLs differ
  if (config.agentUrl && config.url !== config.agentUrl) {
    console.log('[videoProvider] Agent mode failed — retrying with standard mode URL');
    const stdConfig = legacyConfigToSiteConfig(config, 'jimeng-standard');
    return generateVideoViaSiteConfig(stdConfig, request, outputDir, filename);
  }

  return null;
}

async function uploadImageChain(page: Page, chain: SelectorChain, imagePath: string): Promise<void> {
  try {
    const result = await resolveSelector(page, chain);
    if (result) {
      const [fileChooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 5_000 }),
        result.locator.first().click(),
      ]);
      await fileChooser.setFiles(imagePath);
      await page.waitForTimeout(2_000);
      return;
    }
  } catch {
    // fallback below
  }
  // fallback: try direct input[type=file]
  const input = page.locator('input[type="file"]').first();
  if (await input.count() > 0) {
    await input.setInputFiles(imagePath);
    await page.waitForTimeout(2_000);
  }
}

async function uploadImage(page: Page, triggerSelector: string, imagePath: string): Promise<void> {
  await uploadImageChain(page, selectorToChain(triggerSelector), imagePath);
}


