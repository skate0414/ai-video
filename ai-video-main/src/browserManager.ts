/* ------------------------------------------------------------------ */
/*  BrowserManager – unified browser lifecycle for all automation      */
/*  Shared by Workbench (text/image chat) and VideoProvider (即梦).    */
/*  Single source of truth for stealth args, lock cleanup, and         */
/*  persistent context launching.                                      */
/* ------------------------------------------------------------------ */

import { chromium, type BrowserContext } from 'playwright';
import { execSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs/promises';
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';

/** Chrome launch args that disable automation-detection signals. */
export const STEALTH_ARGS = [
  '--disable-blink-features=AutomationControlled',
  '--disable-infobars',
  '--no-first-run',
  '--no-default-browser-check',
];

const delay = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Remove stale Chrome lock files that block persistent context relaunch.
 */
export function removeChromeLocks(profileDir: string): void {
  for (const name of ['SingletonLock', 'SingletonSocket', 'SingletonCookie']) {
    try { unlinkSync(path.join(profileDir, name)); } catch { /* ignore */ }
  }
}

/**
 * Fix Chrome "profile error" banner by resetting exit_type to Normal.
 */
export function fixCrashedProfile(profileDir: string): void {
  const prefsPath = path.join(profileDir, 'Default', 'Preferences');
  try {
    if (!existsSync(prefsPath)) return;
    const prefs = JSON.parse(readFileSync(prefsPath, 'utf-8'));
    if (prefs.profile?.exit_type !== 'Normal' || !prefs.profile?.exited_cleanly) {
      prefs.profile = { ...prefs.profile, exit_type: 'Normal', exited_cleanly: true };
      writeFileSync(prefsPath, JSON.stringify(prefs));
      console.log(`[BrowserManager] Fixed crashed profile: ${profileDir.split('/').pop()}`);
    }
  } catch { /* ignore parse errors */ }
}

/**
 * Kill any Chrome processes that are using a specific profile directory.
 */
export function killStaleChrome(profileDir: string): void {
  try {
    const result = execSync(
      `ps aux | grep -i chrome | grep ${JSON.stringify(profileDir)} | grep -v grep | awk '{print $2}'`,
      { encoding: 'utf8', timeout: 5000 },
    ).trim();
    if (result) {
      for (const pid of result.split('\n').filter(Boolean)) {
        try { process.kill(Number(pid), 'SIGTERM'); } catch { /* already dead */ }
      }
      console.log(`[BrowserManager] Killed stale Chrome processes for ${profileDir.split('/').pop()}: ${result.replace(/\n/g, ', ')}`);
    }
  } catch { /* ps/grep failed — not critical */ }
}

/**
 * Prepare a profile directory for launch: kill stale processes, remove locks, fix crash state.
 */
export async function prepareProfile(profileDir: string): Promise<void> {
  killStaleChrome(profileDir);
  removeChromeLocks(profileDir);
  fixCrashedProfile(profileDir);
  await delay(500);
}

/**
 * Launch a persistent browser context with retry.
 * Unified implementation used by both Workbench and VideoProvider.
 */
export async function launchPersistentContextWithRetry(
  profileDir: string,
  options?: { retries?: number; viewport?: { width: number; height: number } },
): Promise<BrowserContext> {
  const retries = options?.retries ?? 3;
  const viewport = options?.viewport ?? { width: 1440, height: 900 };

  for (let attempt = 1; attempt <= retries; attempt++) {
    try {
      // Remove Chrome's singleton lock if it exists
      await fs.unlink(path.join(profileDir, 'SingletonLock')).catch(() => {});

      // On retries, kill stale Chrome and wait
      if (attempt > 1) {
        killStaleChrome(profileDir);
        await delay(3000 * attempt);
      }

      const ctx = await chromium.launchPersistentContext(profileDir, {
        channel: 'chrome',
        headless: false,
        viewport,
        args: STEALTH_ARGS,
        ignoreDefaultArgs: ['--enable-automation'],
      });
      // Polyfill esbuild's __name helper so page.evaluate works with tsx-compiled code
      await ctx.addInitScript('if(typeof __name==="undefined"){window.__name=(fn,_)=>fn}');
      return ctx;
    } catch (err) {
      if (attempt >= retries) throw err;
      const msg = err instanceof Error ? err.message : String(err);
      console.warn(`[BrowserManager] launchPersistentContext attempt ${attempt} failed, retrying in ${3 * attempt}s...`, msg);
      await delay(3000 * attempt);
    }
  }
  throw new Error('launchPersistentContext failed after retries');
}

/* ---- Shared context cache (for VideoProvider multi-account) ---- */

const contextCache = new Map<string, { ctx: BrowserContext; refCount: number }>();
const contextLocks = new Map<string, Promise<BrowserContext>>();

/**
 * Acquire a cached browser context for a profile directory.
 * If one already exists and is alive, reuse it. Otherwise launch a new one.
 * Thread-safe via per-profile mutex.
 */
export async function acquireContext(profileDir: string): Promise<BrowserContext> {
  // Check cache first (fast path)
  const cached = contextCache.get(profileDir);
  if (cached) {
    cached.refCount++;
    try {
      cached.ctx.pages(); // verify alive
      return cached.ctx;
    } catch { /* dead, will relaunch below */ }
    contextCache.delete(profileDir);
  }

  // Serialize context creation per profile to prevent concurrent launches
  const existing = contextLocks.get(profileDir);
  if (existing) {
    const ctx = await existing;
    const entry = contextCache.get(profileDir);
    if (entry) {
      entry.refCount++;
      return ctx;
    }
  }

  const launchPromise = (async () => {
    await prepareProfile(profileDir);
    const ctx = await launchPersistentContextWithRetry(profileDir);
    contextCache.set(profileDir, { ctx, refCount: 1 });
    return ctx;
  })();

  contextLocks.set(profileDir, launchPromise);
  try {
    return await launchPromise;
  } finally {
    contextLocks.delete(profileDir);
  }
}

/**
 * Release a cached browser context. Closes it when refCount reaches 0.
 */
export async function releaseContext(profileDir: string): Promise<void> {
  const cached = contextCache.get(profileDir);
  if (!cached) return;
  cached.refCount--;
  if (cached.refCount <= 0) {
    contextCache.delete(profileDir);
    try {
      for (const page of cached.ctx.pages()) {
        await page.close().catch(() => {});
      }
    } catch { /* context may already be broken */ }
    await cached.ctx.close().catch(() => {});
  }
}
