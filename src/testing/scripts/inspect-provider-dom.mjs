#!/usr/bin/env node

import { chromium } from 'playwright';
import { join } from 'node:path';
import { parseCliArgs } from '../lib/backendApi.mjs';
import { DATA_DIR, PROFILES_DIR, resolveChromiumChannel } from '../lib/paths.mjs';

const PROVIDERS = {
  seedance: {
    prefix: 'seedance',
    url: 'https://jimeng.jianying.com/ai-tool/generate?workspace=0&type=video',
  },
  kling: {
    prefix: 'kling',
    url: 'https://klingai.com/app/video/new?trackName=image_to_video&ac=4',
  },
};

async function main() {
  const { flags } = parseCliArgs();
  const providerId = String(flags.get('--provider') || 'seedance');
  const index = Number(flags.get('--account') || '1');
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Unsupported provider: ${providerId}`);

  const profileDir = join(PROFILES_DIR, `${provider.prefix}-${index}`);
  const screenshotPath = join(DATA_DIR, `${providerId}-inspect.png`);

  const channel = await resolveChromiumChannel();
  const context = await chromium.launchPersistentContext(profileDir, {
    ...(channel ? { channel } : {}),
    headless: false,
    viewport: { width: 1280, height: 900 },
    args: ['--disable-blink-features=AutomationControlled'],
    ignoreDefaultArgs: ['--enable-automation'],
  });

  try {
    const page = context.pages()[0] || await context.newPage();
    await page.goto(provider.url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    await page.waitForTimeout(8000);

    const info = await page.evaluate(() => {
      const result = {
        url: location.href,
        title: document.title,
        textareas: [],
        editables: [],
        buttons: [],
      };
      document.querySelectorAll('textarea').forEach((element) => {
        result.textareas.push({
          placeholder: element.placeholder || '',
          className: String(element.className || '').slice(0, 240),
        });
      });
      document.querySelectorAll('[contenteditable="true"]').forEach((element) => {
        result.editables.push({
          role: element.getAttribute('role') || '',
          className: String(element.className || '').slice(0, 240),
          text: String(element.textContent || '').slice(0, 80),
        });
      });
      document.querySelectorAll('button').forEach((element) => {
        const rect = element.getBoundingClientRect();
        if (rect.width > 0 && rect.height > 0) {
          result.buttons.push({
            text: String(element.textContent || '').trim().slice(0, 80),
            disabled: element.disabled,
            className: String(element.className || '').slice(0, 240),
          });
        }
      });
      return result;
    });

    await page.screenshot({ path: screenshotPath, fullPage: true });
    console.log(JSON.stringify(info, null, 2));
    console.log(`screenshot saved: ${screenshotPath}`);
  } finally {
    await context.close();
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
