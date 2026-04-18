/* ------------------------------------------------------------------ */
/*  Trace bundle discovery – resolve CLI args to trace file paths     */
/* ------------------------------------------------------------------ */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { join, resolve, isAbsolute } from 'node:path';
import { resolveDataDir } from '../dataDir.js';

export interface TraceSummaryEntry {
  traceId: string;
  projectId: string;
  path: string;
  startedAt: string;
  outcome: string;
  durationMs?: number;
}

/**
 * Resolve a CLI argument to the absolute path of a trace bundle JSON file.
 *
 * Accepts:
 * - A file path (absolute or containing '/' or ending in '.json')
 * - A project ID — finds the latest trace in that project
 * - A 32-char hex trace ID — searches all projects
 */
export function findTraceBundle(arg: string): string {
  // Case 1: File path
  if (arg.includes('/') || arg.includes('\\') || arg.endsWith('.json')) {
    const resolved = isAbsolute(arg) ? arg : resolve(arg);
    if (!existsSync(resolved)) {
      throw new Error(`Trace file not found: ${resolved}`);
    }
    return resolved;
  }

  const dataDir = resolveDataDir();
  const projectsDir = join(dataDir, 'projects');

  if (!existsSync(projectsDir)) {
    throw new Error(`Projects directory not found: ${projectsDir}`);
  }

  // Case 2: 32-char hex string → trace ID, search all projects
  if (/^[0-9a-f]{32}$/i.test(arg)) {
    return findByTraceId(projectsDir, arg);
  }

  // Case 3: Project ID → find latest trace in that project
  return findLatestInProject(projectsDir, arg);
}

function findByTraceId(projectsDir: string, traceId: string): string {
  const projects = safeReaddir(projectsDir);
  for (const proj of projects) {
    const traceDir = join(projectsDir, proj, 'trace');
    const bundlePath = join(traceDir, `trace-${traceId}.json`);
    if (existsSync(bundlePath)) {
      return bundlePath;
    }
  }
  throw new Error(`No trace bundle found for traceId: ${traceId}`);
}

function findLatestInProject(projectsDir: string, projectId: string): string {
  const projectDir = join(projectsDir, projectId);
  const traceDir = join(projectDir, 'trace');

  if (!existsSync(traceDir)) {
    throw new Error(`No trace directory found for project: ${projectId}`);
  }

  const bundles = safeReaddir(traceDir)
    .filter(f => f.startsWith('trace-') && f.endsWith('.json'))
    .map(f => {
      const path = join(traceDir, f);
      const mtime = statSync(path).mtimeMs;
      return { path, mtime };
    })
    .sort((a, b) => b.mtime - a.mtime);

  if (bundles.length === 0) {
    throw new Error(`No trace bundles found in project: ${projectId}`);
  }

  return bundles[0].path;
}

/**
 * List all trace bundles across all projects (for browsing).
 */
export function listAllTraces(): TraceSummaryEntry[] {
  const dataDir = resolveDataDir();
  const projectsDir = join(dataDir, 'projects');
  if (!existsSync(projectsDir)) return [];

  const results: TraceSummaryEntry[] = [];
  const projects = safeReaddir(projectsDir);

  for (const proj of projects) {
    const traceDir = join(projectsDir, proj, 'trace');
    if (!existsSync(traceDir)) continue;

    const files = safeReaddir(traceDir)
      .filter(f => f.startsWith('trace-') && f.endsWith('.json'));

    for (const f of files) {
      const path = join(traceDir, f);
      try {
        const raw = readFileSync(path, 'utf-8');
        const bundle = JSON.parse(raw);
        results.push({
          traceId: bundle.traceId ?? f.replace('trace-', '').replace('.json', ''),
          projectId: bundle.projectId ?? proj,
          path,
          startedAt: bundle.startedAt ?? '',
          outcome: bundle.outcome ?? 'unknown',
          durationMs: bundle.durationMs,
        });
      } catch {
        // Skip corrupt bundles
      }
    }
  }

  return results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

/**
 * List trace bundles for a specific project.
 */
export function listProjectTraces(projectDir: string): TraceSummaryEntry[] {
  const traceDir = join(projectDir, 'trace');
  if (!existsSync(traceDir)) return [];

  const results: TraceSummaryEntry[] = [];
  const files = safeReaddir(traceDir)
    .filter(f => f.startsWith('trace-') && f.endsWith('.json'));

  for (const f of files) {
    const path = join(traceDir, f);
    try {
      const raw = readFileSync(path, 'utf-8');
      const bundle = JSON.parse(raw);
      results.push({
        traceId: bundle.traceId ?? f.replace('trace-', '').replace('.json', ''),
        projectId: bundle.projectId ?? '',
        path,
        startedAt: bundle.startedAt ?? '',
        outcome: bundle.outcome ?? 'unknown',
        durationMs: bundle.durationMs,
      });
    } catch {
      // Skip corrupt bundles
    }
  }

  return results.sort((a, b) => b.startedAt.localeCompare(a.startedAt));
}

function safeReaddir(dir: string): string[] {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}
