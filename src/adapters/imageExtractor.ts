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
): Promise<ExtractedImage | null> {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  // Find the last response block's images
  // Note: page.evaluate callback runs in browser context
  const imageData = await page.evaluate((selector: string) => {
    const blocks = (globalThis as any).document.querySelectorAll(selector);
    if (blocks.length === 0) return null;

    const lastBlock = blocks[blocks.length - 1];
    const images = lastBlock.querySelectorAll('img');

    // Find the largest image (most likely the generated one, not an icon)
    let bestImg: any = null;
    let bestArea = 0;
    for (const img of images) {
      const w = (img as any).naturalWidth || (img as any).width;
      const h = (img as any).naturalHeight || (img as any).height;
      const area = w * h;
      if (area > bestArea) {
        bestArea = area;
        bestImg = img;
      }
    }

    if (!bestImg) return null;

    // Try to get the image data as base64 via canvas
    try {
      const canvas = (globalThis as any).document.createElement('canvas');
      canvas.width = bestImg.naturalWidth || bestImg.width;
      canvas.height = bestImg.naturalHeight || bestImg.height;
      const ctx = canvas.getContext('2d');
      if (ctx) {
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
      // CORS might block canvas — fall back to src URL
    }

    return {
      base64: null,
      sourceUrl: bestImg.src,
      width: bestImg.naturalWidth || bestImg.width,
      height: bestImg.naturalHeight || bestImg.height,
    };
  }, responseBlockSelector);

  if (!imageData) return null;

  const localPath = join(outputDir, filename);

  if (imageData.base64) {
    // Save base64 data directly
    writeFileSync(localPath, Buffer.from(imageData.base64, 'base64'));
    return {
      localPath,
      sourceUrl: imageData.sourceUrl ?? undefined,
      width: imageData.width ?? undefined,
      height: imageData.height ?? undefined,
    };
  }

  if (imageData.sourceUrl) {
    // Download via page context (avoids CORS issues)
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
      // Fallback: take a screenshot of the image element
    }
  }

  // Fallback: screenshot the last response block's largest image
  try {
    const img = page.locator(`${responseBlockSelector}:last-child img`).last();
    if (await img.count() > 0) {
      await img.screenshot({ path: localPath, type: 'png' });
      return { localPath };
    }
  } catch {
    // give up
  }

  return null;
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
