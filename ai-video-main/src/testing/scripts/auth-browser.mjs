#!/usr/bin/env node

import { chromium } from 'playwright';
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseCliArgs } from '../lib/backendApi.mjs';
import { PROFILES_DIR } from '../lib/paths.mjs';

const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--no-first-run',
  '--no-default-browser-check',
];

const PROVIDERS = {
  seedance: {
    label: '即梦',
    url: 'https://jimeng.jianying.com/ai-tool/generate?workspace=0&type=video',
    prefix: 'seedance',
    total: 3,
  },
  kling: {
    label: '可灵',
    url: 'https://klingai.com/app/video/new?trackName=image_to_video&ac=4',
    prefix: 'kling',
    total: 1,
  },
};

function ensureProfileHealthy(profileDir, label) {
  if (!existsSync(profileDir)) {
    mkdirSync(profileDir, { recursive: true });
  }

  for (const fileName of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try {
      unlinkSync(join(profileDir, fileName));
    } catch {}
  }

  const prefsPath = join(profileDir, 'Default', 'Preferences');
  try {
    if (existsSync(prefsPath)) {
      const prefs = JSON.parse(readFileSync(prefsPath, 'utf-8'));
      if (prefs.profile?.exit_type !== 'Normal' || !prefs.profile?.exited_cleanly) {
        prefs.profile = { ...prefs.profile, exit_type: 'Normal', exited_cleanly: true };
        writeFileSync(prefsPath, JSON.stringify(prefs));
        console.log(`  fixed crashed profile: ${label}`);
      }
    }
  } catch {}
}

async function loginAccount(providerId, index) {
  const provider = PROVIDERS[providerId];
  const label = `${provider.label} ${index}`;
  const profileDir = join(PROFILES_DIR, `${provider.prefix}-${index}`);

  ensureProfileHealthy(profileDir, label);

  console.log('\n========================================');
  console.log(`  Opening browser for: ${label}`);
  console.log(`  Profile: ${profileDir}`);
  console.log('========================================');
  console.log(`→ Please log in to ${provider.label}.`);
  console.log('→ After logging in, close the browser window to continue.\n');

  const context = await chromium.launchPersistentContext(profileDir, {
    channel: 'chrome',
    headless: false,
    viewport: { width: 1440, height: 900 },
    args: STEALTH_ARGS,
    ignoreDefaultArgs: ['--enable-automation'],
  });

  const page = context.pages()[0] ?? await context.newPage();
  await page.goto(provider.url, { waitUntil: 'domcontentloaded' });

  await new Promise((resolve) => {
    context.on('close', resolve);
  });

  console.log(`✅ ${label} — browser closed, cookies saved.`);
}

async function main() {
  const { positionals, flags } = parseCliArgs();
  const providerId = String(flags.get('--provider') || positionals[0] || 'seedance');
  const provider = PROVIDERS[providerId];
  if (!provider) {
    throw new Error(`Unsupported provider: ${providerId}. Use one of: ${Object.keys(PROVIDERS).join(', ')}`);
  }

  const target = String(flags.get('--account') || positionals[1] || '1');
  if (target === 'all') {
    for (let index = 1; index <= provider.total; index += 1) {
      await loginAccount(providerId, index);
    }
    return;
  }

  const index = Number(target);
  if (!Number.isInteger(index) || index < 1 || index > provider.total) {
    throw new Error(`Invalid account index: ${target}. Valid range is 1-${provider.total} or 'all'.`);
  }

  await loginAccount(providerId, index);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.stack : String(error));
  process.exit(1);
});
