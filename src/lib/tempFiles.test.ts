import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { TempFileTracker } from './tempFiles.js';
import { mkdtempSync, writeFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('TempFileTracker', () => {
  let tracker: TempFileTracker;
  let testDir: string;

  beforeEach(() => {
    tracker = new TempFileTracker();
    testDir = mkdtempSync(join(tmpdir(), 'temptracker-test-'));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it('tracks and cleans up files', () => {
    const f = join(testDir, 'tmp.txt');
    writeFileSync(f, 'data');
    tracker.trackFile(f);
    expect(existsSync(f)).toBe(true);

    const result = tracker.cleanup();
    expect(existsSync(f)).toBe(false);
    expect(result.removed).toBe(1);
    expect(result.errors).toBe(0);
  });

  it('tracks and cleans up directories', () => {
    const d = join(testDir, 'subdir');
    mkdirSync(d);
    writeFileSync(join(d, 'inner.txt'), 'data');
    tracker.trackDir(d);

    const result = tracker.cleanup();
    expect(existsSync(d)).toBe(false);
    expect(result.removed).toBe(1);
  });

  it('returns path for chaining', () => {
    const f = join(testDir, 'chain.txt');
    const returned = tracker.trackFile(f);
    expect(returned).toBe(f);
  });

  it('ignores already-deleted files', () => {
    tracker.trackFile(join(testDir, 'nonexistent.txt'));
    const result = tracker.cleanup();
    expect(result.removed).toBe(0);
    expect(result.errors).toBe(0);
  });

  it('clears internal state after cleanup', () => {
    const f = join(testDir, 'once.txt');
    writeFileSync(f, 'data');
    tracker.trackFile(f);
    tracker.cleanup();

    // Second cleanup should be a no-op
    writeFileSync(f, 'recreated');
    const result = tracker.cleanup();
    expect(result.removed).toBe(0);
    expect(existsSync(f)).toBe(true);
  });
});
