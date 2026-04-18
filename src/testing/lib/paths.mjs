import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(CURRENT_DIR, '../../..');
export const DATA_DIR = process.env.DATA_DIR || join(REPO_ROOT, 'data');
export const PROJECTS_DIR = join(DATA_DIR, 'projects');
export const PROFILES_DIR = join(DATA_DIR, 'profiles');
export const DEFAULT_SERVER_URL = process.env.BACKEND_BASE_URL || `http://localhost:${process.env.PORT || 3220}`;

export function resolveFromRepo(...parts) {
  return join(REPO_ROOT, ...parts);
}

/**
 * Resolve the Chromium channel for Playwright.
 * Returns undefined if Playwright's bundled Chromium is installed (use default),
 * or 'chrome' to fall back to system-installed Chrome.
 */
export async function resolveChromiumChannel() {
  try {
    const { chromium } = await import('playwright');
    const execPath = chromium.executablePath();
    if (execPath && existsSync(execPath)) return undefined;
  } catch { /* ignore */ }
  return 'chrome';
}
