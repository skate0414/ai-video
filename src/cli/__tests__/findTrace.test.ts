import { describe, it, expect, beforeEach } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { TraceReplayBundle } from '../../pipeline/trace/traceEvents.js';
import { findTraceBundle, listProjectTraces } from '../findTrace.js';

describe('findTrace', () => {
  let tmpDir: string;
  let projectDir: string;
  let traceDir: string;
  const traceId = 'a'.repeat(32);

  function makeBundlePath(id: string = traceId): string {
    return join(traceDir, `trace-${id}.json`);
  }

  function writeBundle(id: string = traceId, overrides: Partial<TraceReplayBundle> = {}): string {
    const bundle: TraceReplayBundle = {
      v: 1,
      traceId: id,
      projectId: 'test-proj',
      topic: 'test topic',
      qualityTier: 'free',
      startedAt: new Date().toISOString(),
      outcome: 'success',
      events: [],
      stageSummary: {},
      totals: { stagesCompleted: 1, stagesFailed: 0, llmCalls: 1, costUsd: 0.01, retries: 0 },
      ...overrides,
    };
    const path = makeBundlePath(id);
    writeFileSync(path, JSON.stringify(bundle, null, 2));
    return path;
  }

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'find-trace-test-'));
    projectDir = join(tmpDir, 'projects', 'test-proj');
    traceDir = join(projectDir, 'trace');
    mkdirSync(traceDir, { recursive: true });
    // Override DATA_DIR so findTraceBundle uses our temp dir
    process.env.DATA_DIR = tmpDir;
  });

  describe('findTraceBundle', () => {
    it('resolves a direct file path', () => {
      const path = writeBundle();
      const found = findTraceBundle(path);
      expect(found).toBe(path);
    });

    it('throws for non-existent file path', () => {
      expect(() => findTraceBundle('/nonexistent/path/trace.json'))
        .toThrow('Trace file not found');
    });

    it('resolves by project ID (finds latest trace)', () => {
      writeBundle();
      const found = findTraceBundle('test-proj');
      expect(found).toBe(makeBundlePath());
    });

    it('resolves by trace ID (32 hex chars)', () => {
      writeBundle();
      const found = findTraceBundle(traceId);
      expect(found).toBe(makeBundlePath());
    });

    it('throws when project has no traces', () => {
      rmSync(join(traceDir, `trace-${traceId}.json`), { force: true });
      expect(() => findTraceBundle('test-proj'))
        .toThrow('No trace bundles found');
    });

    it('throws when trace ID not found anywhere', () => {
      const nonExistentId = 'b'.repeat(32);
      expect(() => findTraceBundle(nonExistentId))
        .toThrow('No trace bundle found for traceId');
    });
  });

  describe('listProjectTraces', () => {
    it('returns empty array when no traces exist', () => {
      const emptyDir = mkdtempSync(join(tmpdir(), 'empty-'));
      const traces = listProjectTraces(emptyDir);
      expect(traces).toEqual([]);
    });

    it('lists all trace bundles in a project', () => {
      const id1 = 'a'.repeat(32);
      const id2 = 'b'.repeat(32);
      writeBundle(id1, { startedAt: '2025-01-01T00:00:00Z' });
      writeBundle(id2, { startedAt: '2025-01-02T00:00:00Z' });

      const traces = listProjectTraces(projectDir);
      expect(traces).toHaveLength(2);
      // sorted by startedAt descending
      expect(traces[0].traceId).toBe(id2);
      expect(traces[1].traceId).toBe(id1);
    });

    it('includes outcome and duration fields', () => {
      writeBundle(traceId, { outcome: 'error', durationMs: 5000 });
      const traces = listProjectTraces(projectDir);
      expect(traces[0].outcome).toBe('error');
      expect(traces[0].durationMs).toBe(5000);
    });
  });
});
