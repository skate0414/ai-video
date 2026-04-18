import { normalize, resolve, sep } from 'node:path';

const CONTROL_CHAR_RE = /[\0-\x1f\x7f]/;

export function sanitizeFileSystemPath(filePath: string, label = 'path'): string {
  if (typeof filePath !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = filePath.trim();
  if (!trimmed) {
    throw new Error(`${label} is required`);
  }
  if (CONTROL_CHAR_RE.test(trimmed)) {
    throw new Error(`${label} contains control characters`);
  }
  return resolve(normalize(trimmed));
}

export function sanitizePathSegment(segment: string, label = 'path segment'): string {
  if (typeof segment !== 'string') {
    throw new Error(`${label} must be a string`);
  }
  const trimmed = segment.trim();
  if (!trimmed || trimmed === '.' || trimmed === '..') {
    throw new Error(`${label} is invalid`);
  }
  if (CONTROL_CHAR_RE.test(trimmed) || /[/\\]/.test(trimmed)) {
    throw new Error(`${label} contains path separators or control characters`);
  }
  return trimmed;
}

export function sanitizeFileName(name: string, fallback = 'file'): string {
  const trimmed = typeof name === 'string' ? name.trim() : '';
  const safe = trimmed
    .replace(/[^\p{L}\p{N}_.-]+/gu, '_')
    .replace(/_+/g, '_')
    .replace(/^[_ .-]+|[_ .-]+$/g, '');
  return safe || fallback;
}

export function ensurePathWithinBase(baseDir: string, candidate: string, label = 'path'): string {
  const safeBase = sanitizeFileSystemPath(baseDir, 'baseDir');
  const safeCandidate = sanitizeFileSystemPath(candidate, label);
  const prefix = safeBase.endsWith(sep) ? safeBase : `${safeBase}${sep}`;
  if (safeCandidate !== safeBase && !safeCandidate.startsWith(prefix)) {
    throw new Error(`${label} escapes base directory`);
  }
  return safeCandidate;
}