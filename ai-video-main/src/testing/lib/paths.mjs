import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CURRENT_DIR = dirname(fileURLToPath(import.meta.url));

export const REPO_ROOT = resolve(CURRENT_DIR, '../../..');
export const DATA_DIR = process.env.DATA_DIR || join(REPO_ROOT, 'data');
export const PROJECTS_DIR = join(DATA_DIR, 'projects');
export const PROFILES_DIR = join(DATA_DIR, 'profiles');
export const DEFAULT_SERVER_URL = process.env.BACKEND_BASE_URL || 'http://localhost:3220';

export function resolveFromRepo(...parts) {
  return join(REPO_ROOT, ...parts);
}
