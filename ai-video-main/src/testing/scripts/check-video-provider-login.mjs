#!/usr/bin/env node

import { chromium } from 'playwright';
import { join } from 'node:path';
import { parseCliArgs } from '../lib/backendApi.mjs';
import { PROFILES_DIR } from '../lib/paths.mjs';

const PROVIDERS = {
  seedance: {
    label: '即梦',
    prefix: 'seedance',
    total: 3,
    url: 'https://jimeng.jianying.com/ai-tool/generate?workspace=0&type=video',
    isLoggedIn(url) {
      return !url.includes('/ai-tool/home');
    },
  },
  kling: {
    label: '可灵',
    prefix: 'kling',
    total: 1,
    url: 'https://klingai.com/app/video/new?trackName=image_to_video&ac=4',
    isLoggedIn(url) {
      return !/login|signin/i.test(url);
    },
  },
};

async function checkOne(providerId, index) {
  const provider = PROVIDERS[providerId];
  const dir = join(PROFILES_DIR, `${provider.prefix}-${index}`);
  let context;
  let finalUrl = '';
  try {
    context = await chromium.launchPersistentContext(dir, {
      channel: 'chrome',
      headless: false,
      viewport: { width: 1440, height: 900 },
      args: ['--disable-blink-features=AutomationControlled', '--disable-infobars', '--no-first-run', '--no-default-browser-check'],
      ignoreDefaultArgs: ['--enable-automation'],
    });
    const page = context.pages()[0] || await context.newPage();
    await page.goto(provider.url, { waitUntil: 'networkidle', timeout: 30000 });
    await page.waitForTimeout(3000);
    finalUrl = page.url();
    const loggedIn = provider.isLoggedIn(finalUrl);
    console.log(`${provider.label}-${index}: ${loggedIn ? 'LOGGED_IN ✅' : 'NOT_LOGGED_IN ❌'}`);
    console.log(`  Final URL: ${finalUrl}`);
    await context.close();
  } catch (error) {
    console.log(`${provider.label}-${index}: ERROR - ${error instanceof Error ? error.message : String(error)}`);
    console.log(`  Final URL: ${finalUrl}`);
    await context?.close().catch(() => {});
  }
}

async function main() {
  const { flags } = parseCliArgs();
  const providerId = String(flags.get('--provider') || 'seedance');
  const provider = PROVIDERS[providerId];
  if (!provider) throw new Error(`Unsupported provider: ${providerId}`);

  for (let index = 1; index <= provider.total; index += 1) {
    await checkOne(providerId, index);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
