import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ModelStore } from './modelStore.js';

describe('ModelStore', () => {
  let tempDir: string;
  let savePath: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), 'modelstore-'));
    savePath = join(tempDir, 'models.json');
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it('starts empty', () => {
    const store = new ModelStore(savePath);
    expect(store.get('chatgpt' as any)).toBeUndefined();
    expect(store.hasModels('chatgpt' as any)).toBe(false);
  });

  it('sets and gets models', () => {
    const store = new ModelStore(savePath);
    const models = [{ id: 'gpt-4o', label: 'GPT-4o' }];
    store.set('chatgpt' as any, models as any);
    expect(store.get('chatgpt' as any)).toEqual(models);
    expect(store.hasModels('chatgpt' as any)).toBe(true);
  });

  it('persists models across instances', () => {
    const store1 = new ModelStore(savePath);
    store1.set('gemini' as any, [{ id: 'gemini-pro', label: 'Gemini Pro' }] as any);

    const store2 = new ModelStore(savePath);
    expect(store2.get('gemini' as any)).toEqual([{ id: 'gemini-pro', label: 'Gemini Pro' }]);
  });

  it('getAll returns all stored models', () => {
    const store = new ModelStore(savePath);
    store.set('chatgpt' as any, [{ id: 'gpt-4o', label: 'GPT-4o' }] as any);
    store.set('gemini' as any, [{ id: 'pro', label: 'Pro' }] as any);
    const all = store.getAll();
    expect(Object.keys(all)).toHaveLength(2);
  });

  it('handles corrupted save file', () => {
    writeFileSync(savePath, '{invalid json}');
    const store = new ModelStore(savePath);
    expect(store.getAll()).toEqual({});
  });

  it('handles empty save path', () => {
    const store = new ModelStore('');
    store.set('chatgpt' as any, [{ id: 'x', label: 'X' }] as any);
    expect(store.get('chatgpt' as any)).toEqual([{ id: 'x', label: 'X' }]);
  });
});
