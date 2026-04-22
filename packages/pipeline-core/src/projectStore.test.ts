import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
// Side-effect: registers video stage definitions so ProjectStore initialises stage status maps correctly.
import '@ai-video/pipeline-video/stageDefinitions.js';
import { ProjectStore } from './projectStore.js';
import { ARTIFACT } from './constants.js';

describe('ProjectStore', () => {
  let store: ProjectStore;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = mkdtempSync(join(tmpdir(), 'projstore-test-'));
    store = new ProjectStore(tmpDir);
  });

  afterEach(() => {
    rmSync(tmpDir, { recursive: true, force: true });
  });

  describe('create / load', () => {
    it('creates a project with default fields', () => {
      const p = store.create('test topic');
      expect(p.id).toMatch(/^proj_/);
      expect(p.topic).toBe('test topic');
      expect(p.title).toBe('test topic');
      expect(p.stageStatus).toBeDefined();
      expect(p.stageStatus.CAPABILITY_ASSESSMENT).toBe('pending');
    });

    it('uses custom title when provided', () => {
      const p = store.create('topic', 'My Title');
      expect(p.title).toBe('My Title');
    });

    it('round-trips through save/load', () => {
      const p = store.create('round-trip test');
      const loaded = store.load(p.id);
      expect(loaded).not.toBeNull();
      expect(loaded!.id).toBe(p.id);
      expect(loaded!.topic).toBe('round-trip test');
    });

    it('returns null for unknown project', () => {
      expect(store.load('nonexistent')).toBeNull();
    });
  });

  describe('save', () => {
    it('persists updated fields', () => {
      const p = store.create('save test');
      p.error = 'something broke';
      store.save(p);
      const loaded = store.load(p.id);
      expect(loaded!.error).toBe('something broke');
    });
  });

  describe('delete', () => {
    it('removes a project', () => {
      const p = store.create('delete test');
      expect(store.delete(p.id)).toBe(true);
      expect(store.load(p.id)).toBeNull();
    });

    it('returns false for unknown project', () => {
      expect(store.delete('nonexistent')).toBe(false);
    });
  });

  describe('list', () => {
    it('returns empty list when no projects exist', () => {
      expect(store.list()).toEqual([]);
    });

    it('lists all created projects', async () => {
      store.create('one');
      await new Promise(r => setTimeout(r, 5));
      store.create('two');
      const projects = store.list();
      expect(projects).toHaveLength(2);
    });
  });

  describe('artifacts', () => {
    it('saves and loads an artifact', () => {
      const p = store.create('artifact test');
      const data = { scenes: [{ id: 's1' }] };
      store.saveArtifact(p.id, ARTIFACT.SCENES, data);
      const loaded = store.loadArtifact<typeof data>(p.id, ARTIFACT.SCENES);
      expect(loaded).toEqual(data);
    });

    it('returns undefined for missing artifact', () => {
      const p = store.create('missing artifact');
      expect(store.loadArtifact(p.id, 'nope.json')).toBeUndefined();
    });
  });

  describe('getProjectDir / getAssetsDir', () => {
    it('returns consistent paths', () => {
      const dir = store.getProjectDir('p1');
      expect(dir).toBe(join(tmpDir, 'projects', 'p1'));
    });

    it('creates assets dir on first access', () => {
      const p = store.create('assets test');
      const assetsDir = store.getAssetsDir(p.id);
      expect(assetsDir).toContain('assets');
    });
  });
});
