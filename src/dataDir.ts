/* ------------------------------------------------------------------ */
/*  Data directory resolution                                         */
/*                                                                    */
/*  Priority:                                                         */
/*  1. DATA_DIR environment variable (explicit override)              */
/*  2. APPDATA_DIR env var (set by Tauri sidecar at launch)           */
/*  3. OS-specific app data directory via platform conventions        */
/*  4. Fallback: ./data (development mode)                            */
/* ------------------------------------------------------------------ */

import { resolve, join } from 'node:path';
import { mkdirSync, existsSync } from 'node:fs';
import { homedir, platform } from 'node:os';

const APP_NAME = 'ai-video-pipeline';

/**
 * Determine the OS-appropriate app data directory.
 */
function osAppDataDir(): string {
  const home = homedir();
  switch (platform()) {
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), APP_NAME);
    case 'darwin':
      return join(home, 'Library', 'Application Support', APP_NAME);
    default:
      // Linux / FreeBSD — XDG Base Directory Specification
      return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), APP_NAME);
  }
}

/** Whether we're running inside a Tauri sidecar (detected by env var). */
export function isTauriSidecar(): boolean {
  return !!process.env.TAURI_SIDECAR;
}

/**
 * Resolve and ensure the data directory exists.
 */
export function resolveDataDir(): string {
  let dir: string;

  if (process.env.DATA_DIR) {
    dir = resolve(process.env.DATA_DIR);
  } else if (process.env.APPDATA_DIR) {
    dir = resolve(process.env.APPDATA_DIR);
  } else if (isTauriSidecar()) {
    dir = osAppDataDir();
  } else {
    // Development mode — use ./data relative to working directory
    dir = resolve('data');
  }

  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Subdirectory helper — resolves and ensures subdirectory exists.
 */
export function resolveSubDir(base: string, ...segments: string[]): string {
  const dir = join(base, ...segments);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}
