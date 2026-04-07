/* ------------------------------------------------------------------ */
/*  ImageExtractor – extracts AI-generated images from chat DOM        */
/*  NOTE: page.evaluate() callbacks run in browser context (DOM APIs) */
/* ------------------------------------------------------------------ */

/* eslint-disable @typescript-eslint/no-explicit-any */

import type { Page } from 'playwright';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

export interface ExtractedImage {
  /** Local file path where the image was saved */
  localPath: string;
  /** Original source URL (if any) */
  sourceUrl?: string;
  /** Image dimensions if detected */
  width?: number;
  height?: number;
}

/**
 * Extract the most recently generated image from an AI chat page.
 *
 * Strategy:
 * 1. Find the last response block
 * 2. Locate <img> elements within it
 * 3. Download the image data (via page.evaluate or screenshot)
 * 4. Save to the local assets directory
 */
export async function extractLatestImage(
  page: Page,
  responseBlockSelector: string,
  outputDir: string,
  filename: string,
  /** Max time (ms) to poll for an image to appear after response stabilizes. */
  waitTimeoutMs = 30_000,
): Promise<ExtractedImage | null> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Build a list of selectors to try — the specific responseBlock first,
  // then broader containers where different providers place generated images.
  const broadSelectors = [
    responseBlockSelector,
    // ChatGPT selectors
    '[data-message-author-role="assistant"]',
    '[data-testid="conversation-turn-"] .markdown',
    // Gemini selectors
    '.response-content',
    '.response-container-content',
    '.presented-response-container',
    '.model-response-text',
    // Generic fallback
    '[class*="response"]',
  ];

  // Poll for images: Gemini may take several seconds to render an image
  // after the text response has already stabilized.
  const deadline = Date.now() + waitTimeoutMs;
  const pollInterval = 2_000;
  let imageData: any = null;

  while (Date.now() < deadline) {
    try {
      imageData = await findBestImageInPage(page, broadSelectors);
    } catch (err) {
      console.log(`[ImageExtractor] Error during image search: ${err instanceof Error ? err.message : err}`);
      break;
    }
    // If result has debug info but no actual image, log and continue polling
    if (imageData?.debug && imageData.width === 0) {
      console.log(`[ImageExtractor] Images in DOM but too small: ${imageData.debug}`);
      imageData = null;
    }
    // Image found but still loading (height=0) — wait for it to finish
    if (imageData && (imageData.height === 0 || (!imageData.base64 && !imageData.sourceUrl))) {
      console.log(`[ImageExtractor] Image found but still loading (${imageData.width}x${imageData.height}, src=${imageData.sourceUrl?.slice(0, 60) ?? '(none)'}), waiting...`);
      imageData = null;
    }
    if (imageData) break;
    console.log(`[ImageExtractor] No image found yet, polling... (${Math.round((deadline - Date.now()) / 1000)}s remaining)`);
    try {
      await page.waitForTimeout(pollInterval);
    } catch {
      console.log('[ImageExtractor] Page closed during polling');
      break;
    }
  }

  // If we found an image with dimensions but no base64/src, try screenshot approach
  if (!imageData) {
    console.log('[ImageExtractor] Trying screenshot fallback for any large image on page...');
    try {
      for (const sel of broadSelectors) {
        // Use locator (pierces Shadow DOM) to find images
        const imgLoc = page.locator(`${sel} img`).last();
        if (await imgLoc.count() > 0) {
          const box = await imgLoc.boundingBox();
          if (box && box.width > 64 && box.height > 64) {
            const localPath = join(outputDir, filename);
            await imgLoc.screenshot({ path: localPath, type: 'png' });
            console.log(`[ImageExtractor] Saved via screenshot: ${box.width}x${box.height}`);
            return { localPath, width: Math.round(box.width), height: Math.round(box.height) };
          }
        }
      }
      // Also try any img on the page with decent size
      const allImgs = page.locator('img');
      const count = await allImgs.count();
      for (let i = count - 1; i >= Math.max(0, count - 5); i--) {
        const img = allImgs.nth(i);
        const box = await img.boundingBox();
        if (box && box.width > 100 && box.height > 100) {
          const localPath = join(outputDir, filename);
          await img.screenshot({ path: localPath, type: 'png' });
          console.log(`[ImageExtractor] Saved page img via screenshot: ${box.width}x${box.height}`);
          return { localPath, width: Math.round(box.width), height: Math.round(box.height) };
        }
      }
    } catch (err) {
      console.log(`[ImageExtractor] Screenshot fallback failed: ${err instanceof Error ? err.message : err}`);
    }
    console.log('[ImageExtractor] No image found after polling');
    return null;
  }

  if (!imageData) {
    console.log('[ImageExtractor] No image found after polling');
    return null;
  }

  console.log(`[ImageExtractor] Image found: src=${imageData.sourceUrl?.slice(0, 100) ?? '(canvas)'} ${imageData.width}x${imageData.height}`);
  const localPath = join(outputDir, filename);

  if (imageData.base64) {
    writeFileSync(localPath, Buffer.from(imageData.base64, 'base64'));
    return {
      localPath,
      sourceUrl: imageData.sourceUrl ?? undefined,
      width: imageData.width ?? undefined,
      height: imageData.height ?? undefined,
    };
  }

  if (imageData.sourceUrl) {
    try {
      const buffer = await downloadImageViaPage(page, imageData.sourceUrl);
      if (buffer) {
        writeFileSync(localPath, buffer);
        return {
          localPath,
          sourceUrl: imageData.sourceUrl,
          width: imageData.width ?? undefined,
          height: imageData.height ?? undefined,
        };
      }
    } catch {
      // Fallback: screenshot
    }
  }

  // Fallback: screenshot the largest image on the page
  try {
    for (const sel of broadSelectors) {
      const img = page.locator(`${sel} img`).last();
      if (await img.count() > 0) {
        const box = await img.boundingBox();
        if (box && box.width > 64 && box.height > 64) {
          await img.screenshot({ path: localPath, type: 'png' });
          console.log(`[ImageExtractor] Saved image via screenshot fallback`);
          return { localPath };
        }
      }
    }
  } catch {
    // give up
  }

  return null;
}

/**
 * Search multiple container selectors for the best (largest) image.
 * Returns image data if found, null otherwise.
 */
async function findBestImageInPage(
  page: Page,
  selectors: string[],
): Promise<{ base64: string | null; sourceUrl: string | null; width: number; height: number } | null> {
  // Deduplicate selectors
  const uniqueSelectors = [...new Set(selectors)];

  return page.evaluate((sels: string[]) => {
    const doc = (globalThis as any).document as any;
    let bestImg: any | null = null;
    let bestArea = 0;
    const debugInfo: string[] = [];

    for (const sel of sels) {
      try {
        const blocks = doc.querySelectorAll(sel);
        if (blocks.length === 0) continue;
        // Check last two blocks (the latest response might be second-to-last
        // if a new empty block has already appeared)
        const startIdx = Math.max(0, blocks.length - 2);
        for (let b = startIdx; b < blocks.length; b++) {
          const imgs = blocks[b].querySelectorAll('img');
          for (const img of imgs as any) {
            const w = (img as any).naturalWidth || img.width;
            const h = (img as any).naturalHeight || img.height;
            debugInfo.push(`img: ${w}x${h} src=${(img as any).src?.slice(0, 80)}`);
            const area = Math.max(w, 1) * Math.max(h, 1);
            // Accept if EITHER dimension > 64 (image may still be loading)
            if (w < 64 && h < 64) continue;
            if (area > bestArea) {
              bestArea = area;
              bestImg = img as any;
            }
          }
        }
      } catch {
        // selector parse error — skip
      }
    }

    if (!bestImg) {
      // Return debug info as a special "no image" result
      if (debugInfo.length > 0) {
        return { base64: null, sourceUrl: null, width: 0, height: 0, debug: debugInfo.join('; ') };
      }
      return null;
    }

    // Try canvas extraction
    try {
      const canvas = doc.createElement('canvas');
      canvas.width = bestImg.naturalWidth || bestImg.width || 1;
      canvas.height = bestImg.naturalHeight || bestImg.height || 1;
      const ctx = canvas.getContext('2d');
      if (ctx && canvas.width > 1 && canvas.height > 1) {
        ctx.drawImage(bestImg, 0, 0);
        const dataUrl = canvas.toDataURL('image/png');
        return {
          base64: dataUrl.split(',')[1],
          sourceUrl: bestImg.src,
          width: canvas.width,
          height: canvas.height,
        };
      }
    } catch {
      // CORS block — fall back to src URL
    }

    return {
      base64: null,
      sourceUrl: bestImg.src,
      width: bestImg.naturalWidth || bestImg.width,
      height: bestImg.naturalHeight || bestImg.height,
    };
  }, uniqueSelectors);
}

/**
 * Download an image via the page's fetch context (bypasses CORS).
 */
async function downloadImageViaPage(page: Page, url: string): Promise<Buffer | null> {
  const base64 = await page.evaluate(async (imgUrl: string) => {
    try {
      const resp = await fetch(imgUrl);
      const blob = await resp.blob();
      return new Promise<string | null>((resolve) => {
        const reader = new (globalThis as any).FileReader();
        reader.onload = () => {
          const result = reader.result as string;
          resolve(result.split(',')[1] ?? null);
        };
        reader.onerror = () => resolve(null);
        reader.readAsDataURL(blob);
      });
    } catch {
      return null;
    }
  }, url);

  if (!base64) return null;
  return Buffer.from(base64, 'base64');
}

/**
 * Extract ALL images from the last response block.
 * Useful when the AI generates multiple variants.
 */
export async function extractAllImages(
  page: Page,
  responseBlockSelector: string,
  outputDir: string,
  filenamePrefix: string,
): Promise<ExtractedImage[]> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  const imageUrls = await page.evaluate((selector: string) => {
    const blocks = (globalThis as any).document.querySelectorAll(selector);
    if (blocks.length === 0) return [];

    const lastBlock = blocks[blocks.length - 1];
    const images = lastBlock.querySelectorAll('img');

    return Array.from(images)
      .filter((img: any) => ((img as any).naturalWidth || (img as any).width) > 64) // skip icons
      .map((img: any) => (img as any).src);
  }, responseBlockSelector);

  const results: ExtractedImage[] = [];
  for (let i = 0; i < imageUrls.length; i++) {
    const filename = `${filenamePrefix}_${i}.png`;
    const localPath = join(outputDir, filename);
    try {
      const buffer = await downloadImageViaPage(page, imageUrls[i]);
      if (buffer) {
        writeFileSync(localPath, buffer);
        results.push({ localPath, sourceUrl: imageUrls[i] });
      }
    } catch {
      // skip failed downloads
    }
  }
  return results;
}
