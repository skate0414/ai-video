/* ------------------------------------------------------------------ */
/*  videoOptionSelector – click model / duration / resolution on page */
/* ------------------------------------------------------------------ */

import type { Page } from 'playwright';
import type { VideoGenRequest } from './videoProvider.js';

/**
 * Select video generation options (model, duration, resolution) on
 * 即梦 or 可灵 pages by clicking the corresponding DOM controls.
 *
 * This runs **before** prompt entry and generate-button click.
 * Failures are non-blocking: options that can't be found are logged
 * and skipped so the pipeline falls back to whatever the page defaults.
 */
export async function selectVideoOptions(
  page: Page,
  request: VideoGenRequest,
  isKling: boolean,
): Promise<void> {
  const logTag = isKling ? '可灵' : '即梦';

  // ---- Helper: click a tab/pill/radio that contains specific text ----
  const clickByText = async (
    label: string,
    text: string,
    containerSelectors: string[],
  ): Promise<boolean> => {
    // Strategy 1: Playwright text locator scoped to container
    for (const container of containerSelectors) {
      const scope = page.locator(container);
      if (await scope.count().catch(() => 0) === 0) continue;
      const target = scope.getByText(text, { exact: false }).first();
      if (await target.count().catch(() => 0) > 0) {
        try {
          await target.click({ timeout: 3_000 });
          await page.waitForTimeout(500);
          console.log(`[videoProvider] ${logTag} selected ${label}: "${text}" (container: ${container})`);
          return true;
        } catch { /* next strategy */ }
      }
    }
    // Strategy 2: broad DOM scan — click any visible button/tab/radio containing the text
    const clicked = await page.evaluate(`(function() {
      var text = ${JSON.stringify(text)};
      var lower = text.toLowerCase();
      var candidates = document.querySelectorAll(
        'button, [role="tab"], [role="radio"], [role="option"], ' +
        '[class*="tab"], [class*="option"], [class*="radio"], [class*="segment"], [class*="pill"], ' +
        'label, span[class*="item"], div[class*="item"]'
      );
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        if (el.offsetParent === null && getComputedStyle(el).position !== 'fixed') continue;
        var t = (el.textContent || '').trim();
        if (t.toLowerCase().includes(lower) && t.length < 40) {
          el.click();
          return true;
        }
      }
      return false;
    })()`).catch(() => false) as boolean;
    if (clicked) {
      await page.waitForTimeout(500);
      console.log(`[videoProvider] ${logTag} selected ${label}: "${text}" (broad scan)`);
      return true;
    }
    console.warn(`[videoProvider] ${logTag} could not find ${label} option: "${text}"`);
    return false;
  };

  // ================================================================
  // 1. Model selection
  // ================================================================
  if (request.model) {
    if (isKling) {
      await clickByText('model', request.model, [
        '[class*="model"]',
        '[class*="version"]',
        '[class*="tab"]',
        '[class*="header"]',
        'nav',
      ]);
    } else {
      await clickByText('model', request.model, [
        '[class*="model"]',
        '[class*="version"]',
        '[class*="tab"]',
        '[class*="mode"]',
        '[class*="header"]',
      ]);
    }
  }

  // ================================================================
  // 2. Duration selection
  // ================================================================
  if (request.duration) {
    const durationText = `${request.duration}s`;
    const altText = `${request.duration}秒`;
    const hit = await clickByText('duration', durationText, [
      '[class*="duration"]',
      '[class*="length"]',
      '[class*="time"]',
      '[class*="config"]',
      '[class*="param"]',
      '[class*="setting"]',
    ]);
    if (!hit) {
      await clickByText('duration', altText, [
        '[class*="duration"]',
        '[class*="length"]',
        '[class*="time"]',
        '[class*="config"]',
        '[class*="param"]',
        '[class*="setting"]',
      ]);
    }
  }

  // ================================================================
  // 3. Resolution / quality selection
  // ================================================================
  if (request.resolution) {
    const resText = request.resolution;
    if (isKling) {
      const hit = await clickByText('resolution', resText, [
        '[class*="resolution"]',
        '[class*="quality"]',
        '[class*="clarity"]',
        '[class*="config"]',
        '[class*="param"]',
        '[class*="setting"]',
      ]);
      if (!hit) {
        const cnLabel = resText === '1080p' ? '高清' : '标清';
        await clickByText('resolution', cnLabel, [
          '[class*="resolution"]',
          '[class*="quality"]',
          '[class*="config"]',
          '[class*="param"]',
          '[class*="setting"]',
        ]);
      }
    } else {
      const hit = await clickByText('resolution', resText.toUpperCase(), [
        '[class*="resolution"]',
        '[class*="quality"]',
        '[class*="clarity"]',
        '[class*="config"]',
        '[class*="param"]',
        '[class*="setting"]',
      ]);
      if (!hit) {
        const cnLabel = resText === '1080p' ? '高清' : '标清';
        await clickByText('resolution', cnLabel, [
          '[class*="resolution"]',
          '[class*="quality"]',
          '[class*="config"]',
          '[class*="param"]',
          '[class*="setting"]',
        ]);
      }
    }
  }
}
