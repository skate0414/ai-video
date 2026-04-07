/* ------------------------------------------------------------------ */
/*  VideoProvider – browser automation for video generation sites      */
/*  (e.g. Seedance, Kling, Pika, etc.)                                */
/* ------------------------------------------------------------------ */

import type { Page, BrowserContext } from 'playwright';
import { chromium } from 'playwright';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import type { SelectorChain, SiteAutomationConfig } from '../types.js';
import { resolveSelector, selectorToChain, chainToSelector } from '../selectorResolver.js';

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

export interface VideoProviderConfig {
  /** URL to navigate to */
  url: string;
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
  /** Profile directory for persistent login */
  profileDir: string;
}

const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--no-first-run',
  '--no-default-browser-check',
];

/**
 * Generate a video using a SiteAutomationConfig (SelectorChain-based).
 * This is the preferred method — uses resilient multi-strategy selectors.
 */
export async function generateVideoViaSiteConfig(
  config: SiteAutomationConfig,
  request: VideoGenRequest,
  outputDir: string,
  filename: string,
): Promise<VideoGenResult | null> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  let context: BrowserContext | null = null;
  try {
    context = await chromium.launchPersistentContext(config.profileDir, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1440, height: 900 },
      args: STEALTH_ARGS,
      ignoreDefaultArgs: ['--enable-automation'],
    });

    const page = context.pages()[0] ?? (await context.newPage());
    await page.goto(config.siteUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });
    await page.waitForTimeout(config.timing.hydrationDelayMs);

    // Upload keyframe image if provided (img2video mode)
    if (request.imageUrl && config.selectors.imageUploadTrigger) {
      await uploadImageChain(page, config.selectors.imageUploadTrigger, request.imageUrl);
    }

    // Enter prompt using SelectorChain
    const promptResult = await resolveSelector(page, config.selectors.promptInput);
    if (!promptResult) {
      console.warn('[videoProvider] No prompt input found via SelectorChain');
      return null;
    }
    await promptResult.locator.first().fill(request.prompt);
    await page.waitForTimeout(500);

    // Click generate button using SelectorChain
    if (config.selectors.generateButton) {
      const btnResult = await resolveSelector(page, config.selectors.generateButton);
      if (btnResult) {
        await btnResult.locator.first().click({ timeout: 5_000 });
      } else {
        console.warn('[videoProvider] No generate button found via SelectorChain');
        return null;
      }
    }

    // Wait for generation to complete
    const maxWait = config.timing.maxWaitMs;
    const pollInterval = config.timing.pollIntervalMs;
    let elapsed = 0;

    const resultChain = config.selectors.resultElement ?? [];

    while (elapsed < maxWait) {
      if (resultChain.length > 0) {
        const resultCheck = await resolveSelector(page, resultChain);
        if (resultCheck) break;
      }
      await page.waitForTimeout(pollInterval);
      elapsed += pollInterval;
    }

    if (elapsed >= maxWait) {
      console.warn('[videoProvider] Generation timed out');
      return null;
    }

    // Download the video
    const outputPath = join(outputDir, filename);

    if (config.selectors.downloadButton) {
      const dlResult = await resolveSelector(page, config.selectors.downloadButton);
      if (dlResult) {
        const [download] = await Promise.all([
          page.waitForEvent('download', { timeout: 30_000 }),
          dlResult.locator.first().click(),
        ]);
        await download.saveAs(outputPath);
      }
    }

    if (!existsSync(outputPath) && resultChain.length > 0) {
      // Try to extract video URL from the result element
      const resultSelector = chainToSelector(resultChain);
      const videoUrl = await page.evaluate((selector: string) => {
        const el = (globalThis as any).document.querySelector(selector);
        if (el?.tagName === 'VIDEO') return el.src;
        const video = el?.querySelector('video');
        if (video) return video.src;
        const source = el?.querySelector('source');
        if (source) return source.src;
        return null;
      }, resultSelector);

      if (videoUrl) {
        const base64 = await page.evaluate(async (url: string) => {
          const resp = await fetch(url);
          const blob = await resp.blob();
          return new Promise<string>((resolve) => {
            const reader = new (globalThis as any).FileReader();
            reader.onload = () => resolve((reader.result as string).split(',')[1] ?? '');
            reader.readAsDataURL(blob);
          });
        }, videoUrl);

        if (base64) {
          const { writeFileSync } = await import('node:fs');
          writeFileSync(outputPath, Buffer.from(base64, 'base64'));
        }
      }
    }

    if (existsSync(outputPath)) {
      return { localPath: outputPath };
    }

    return null;
  } finally {
    if (context) {
      await context.close().catch(() => {});
    }
  }
}

/**
 * Convert a legacy VideoProviderConfig to a SiteAutomationConfig.
 * Allows gradual migration from the old format.
 */
export function legacyConfigToSiteConfig(config: VideoProviderConfig, id = 'custom-video'): SiteAutomationConfig {
  return {
    id,
    label: 'Custom Video',
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
      maxWaitMs: config.maxWaitMs ?? 300_000,
      pollIntervalMs: 5_000,
      hydrationDelayMs: 3_000,
    },
    profileDir: config.profileDir,
  };
}

/**
 * Generate a video using a browser-automated video generation site.
 *
 * This is a generic implementation that can be adapted to different
 * video generation platforms by providing appropriate selectors.
 */
export async function generateVideoViaWeb(
  config: VideoProviderConfig,
  request: VideoGenRequest,
  outputDir: string,
  filename: string,
): Promise<VideoGenResult | null> {
  // Convert to SiteAutomationConfig and use the new chain-based implementation
  const siteConfig = legacyConfigToSiteConfig(config);
  return generateVideoViaSiteConfig(siteConfig, request, outputDir, filename);
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

/** Default Seedance video provider config (placeholder selectors — need real ones) */
export function getSeedanceConfig(profileDir: string): VideoProviderConfig {
  return {
    url: 'https://seedance.ai',
    promptInput: 'textarea[placeholder*="prompt"], textarea[placeholder*="描述"]',
    imageUploadTrigger: 'button[aria-label*="upload"], [class*="upload"]',
    generateButton: 'button[type="submit"], button:has-text("Generate"), button:has-text("生成")',
    videoResult: 'video, [class*="result"] video, [class*="preview"] video',
    downloadButton: 'a[download], button:has-text("Download"), button:has-text("下载")',
    maxWaitMs: 300_000,
    profileDir,
  };
}
