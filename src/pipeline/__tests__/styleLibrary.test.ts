/* ------------------------------------------------------------------ */
/*  Tests: StyleLibrary – reusable style template CRUD                */
/* ------------------------------------------------------------------ */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { StyleLibrary } from '../styleLibrary.js';
import { mkdtempSync, rmSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('StyleLibrary', () => {
  let tmpDir: string;
  let lib: StyleLibrary;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'style-lib-'));
    lib = new StyleLibrary(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates the style-templates directory', () => {
    const entries = readdirSync(tmpDir);
    expect(entries).toContain('style-templates');
  });

  it('list() returns empty array initially', () => {
    expect(lib.list()).toEqual([]);
  });

  it('save() creates a template and returns it', () => {
    const profile = { visualStyle: 'cinematic', pacing: 'fast' };
    const result = lib.save('My Template', 'test topic', profile);
    expect(result.name).toBe('My Template');
    expect(result.topic).toBe('test topic');
    expect(result.id).toMatch(/^style_\d+$/);
    expect(result.styleProfile).toEqual(profile);
    expect(result.createdAt).toBeDefined();
  });

  it('list() returns saved templates without styleProfile', async () => {
    lib.save('Template A', 'topic A', { a: 1 });
    await new Promise(r => setTimeout(r, 5));
    lib.save('Template B', 'topic B', { b: 2 });
    const list = lib.list();
    expect(list).toHaveLength(2);
    expect(list[0]).not.toHaveProperty('styleProfile');
    expect(list.map(t => t.name)).toContain('Template A');
    expect(list.map(t => t.name)).toContain('Template B');
  });

  it('load() returns full template with styleProfile', () => {
    const saved = lib.save('Full', 'topic', { key: 'value' });
    const loaded = lib.load(saved.id);
    expect(loaded).not.toBeNull();
    expect(loaded!.styleProfile).toEqual({ key: 'value' });
    expect(loaded!.name).toBe('Full');
  });

  it('load() returns null for non-existent id', () => {
    expect(lib.load('nonexistent')).toBeNull();
  });

  it('delete() removes a template', () => {
    const saved = lib.save('To Delete', 'topic', {});
    expect(lib.list()).toHaveLength(1);
    const deleted = lib.delete(saved.id);
    expect(deleted).toBe(true);
    expect(lib.list()).toHaveLength(0);
  });

  it('delete() returns false for non-existent id', () => {
    expect(lib.delete('nonexistent')).toBe(false);
  });

  it('handles corrupted JSON files gracefully in list()', () => {
    const badFile = join(tmpDir, 'style-templates', 'bad.json');
    writeFileSync(badFile, 'NOT JSON');
    // Should not throw, should filter out the bad entry
    const list = lib.list();
    expect(list).toEqual([]);
  });

  it('handles corrupted JSON files gracefully in load()', () => {
    const badFile = join(tmpDir, 'style-templates', 'bad.json');
    writeFileSync(badFile, 'NOT JSON');
    expect(lib.load('bad')).toBeNull();
  });

  it('save() with formatSignature stores it', () => {
    const sig = { shotCount: 5, avgShotSec: 3 };
    const saved = lib.save('With Sig', 'topic', {}, sig as any);
    expect(saved.formatSignature).toEqual(sig);
    const loaded = lib.load(saved.id);
    expect(loaded!.formatSignature).toEqual(sig);
  });
});
