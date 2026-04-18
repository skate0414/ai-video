import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { ConfigStore, migrateConfig, CURRENT_SCHEMA_VERSION } from './configStore.js';

describe('ConfigStore validation', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `configstore-test-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('preserves geminiApiKey on load', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      geminiApiKey: 'valid-key',
    }));
    const store = new ConfigStore(testDir);
    const config = store.get();
    expect(config.geminiApiKey).toBe('valid-key');
  });

  it('accepts valid aivideomakerApiKey values', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      aivideomakerApiKey: 'test-key-123',
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().aivideomakerApiKey).toBe('test-key-123');
  });

  it('strips invalid fallbackPolicy values', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      fallbackPolicy: 'yolo',
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().fallbackPolicy).toBeUndefined();
  });

  it('strips non-integer productionConcurrency', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      productionConcurrency: 2.5,
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().productionConcurrency).toBeUndefined();
  });

  it('strips negative productionConcurrency', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      productionConcurrency: -1,
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().productionConcurrency).toBeUndefined();
  });

  it('validates on update', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({}));
    const store = new ConfigStore(testDir);
    // Valid update
    store.update({ productionConcurrency: 4 });
    expect(store.get().productionConcurrency).toBe(4);
  });

  it('handles missing config file gracefully', () => {
    const emptyDir = join(tmpdir(), `configstore-empty-${Date.now()}`);
    mkdirSync(emptyDir, { recursive: true });
    const store = new ConfigStore(emptyDir);
    expect(store.get()).toEqual({});
    rmSync(emptyDir, { recursive: true, force: true });
  });

  it('handles malformed JSON gracefully', () => {
    writeFileSync(join(testDir, 'config.json'), '{broken json!!!');
    const store = new ConfigStore(testDir);
    expect(store.get()).toEqual({});
  });
});

describe('ConfigStore schema versioning', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `configstore-schema-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('migrateConfig adds _schemaVersion to legacy v1 config', () => {
    const raw = { geminiApiKey: 'key123' };
    const migrated = migrateConfig(raw as Record<string, unknown>);
    expect(migrated._schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.geminiApiKey).toBe('key123');
  });

  it('migrateConfig is idempotent for current version', () => {
    const raw = { _schemaVersion: CURRENT_SCHEMA_VERSION, productionConcurrency: 3 };
    const migrated = migrateConfig(raw as Record<string, unknown>);
    expect(migrated._schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.productionConcurrency).toBe(3);
  });

  it('persisted file includes _schemaVersion', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({ geminiApiKey: 'abc' }));
    new ConfigStore(testDir);
    const onDisk = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
    expect(onDisk._schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('auto-migrates legacy config on load and re-persists', () => {
    // Write v1 config (no _schemaVersion)
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      productionConcurrency: 2,
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().productionConcurrency).toBe(2);
    // File should now have _schemaVersion
    const onDisk = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
    expect(onDisk._schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
  });

  it('update persists _schemaVersion', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({ _schemaVersion: CURRENT_SCHEMA_VERSION }));
    const store = new ConfigStore(testDir);
    store.update({ productionConcurrency: 3 });
    const onDisk = JSON.parse(readFileSync(join(testDir, 'config.json'), 'utf-8'));
    expect(onDisk._schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(onDisk.productionConcurrency).toBe(3);
  });

  it('handles unknown future schema version gracefully', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      _schemaVersion: 999,
      geminiApiKey: 'future-key',
    }));
    const store = new ConfigStore(testDir);
    // Should still load valid fields
    expect(store.get().geminiApiKey).toBe('future-key');
  });
});

describe('ConfigStore validation – uncovered branches', () => {
  let testDir: string;

  beforeEach(() => {
    testDir = join(tmpdir(), `configstore-branches-${Date.now()}`);
    mkdirSync(testDir, { recursive: true });
  });

  afterEach(() => {
    if (existsSync(testDir)) rmSync(testDir, { recursive: true, force: true });
  });

  it('accepts valid videoProviderConfig object', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      videoProviderConfig: { url: 'https://jimeng.com', profileDir: '/tmp' },
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().videoProviderConfig).toEqual({ url: 'https://jimeng.com', profileDir: '/tmp' });
  });

  it('strips invalid videoProviderConfig (non-object)', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      videoProviderConfig: 'not-an-object',
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().videoProviderConfig).toBeUndefined();
  });

  it('strips videoProviderConfig when array', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      videoProviderConfig: [1, 2, 3],
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().videoProviderConfig).toBeUndefined();
  });

  it('accepts valid videoModel string', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      videoModel: 'jimeng-2.1',
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().videoModel).toBe('jimeng-2.1');
  });

  it('strips non-string videoModel', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      videoModel: 42,
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().videoModel).toBeUndefined();
  });

  it('accepts valid ttsConfig object', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      ttsConfig: { voice: 'en-US-AriaNeural', speed: 1.0 },
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().ttsConfig).toEqual({ voice: 'en-US-AriaNeural', speed: 1.0 });
  });

  it('strips invalid ttsConfig (non-object)', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      ttsConfig: 'bad',
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().ttsConfig).toBeUndefined();
  });

  /* ---- Migration edge cases ---- */
  it('migrateConfig handles unknown schema version gracefully', () => {
    const result = migrateConfig({ _schemaVersion: 999, geminiApiKey: 'key' });
    expect(result._schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(result.geminiApiKey).toBe('key');
  });

  /* ---- Validation edge cases ---- */
  it('strips non-string geminiApiKey', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      geminiApiKey: 12345,
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().geminiApiKey).toBeUndefined();
  });

  it('strips non-array aivideomakerApiKeys', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      aivideomakerApiKeys: 'not-array',
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().aivideomakerApiKeys).toBeUndefined();
  });

  it('strips aivideomakerApiKeys with non-string elements', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      aivideomakerApiKeys: ['valid', 42, null],
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().aivideomakerApiKeys).toBeUndefined();
  });

  it('strips non-positive-integer productionConcurrency', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      productionConcurrency: -5,
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().productionConcurrency).toBeUndefined();
  });

  it('strips float productionConcurrency', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      productionConcurrency: 2.5,
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().productionConcurrency).toBeUndefined();
  });

  it('accepts valid fallbackPolicy values', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      fallbackPolicy: 'confirm',
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().fallbackPolicy).toBe('confirm');
  });

  it('strips non-string aivideomakerApiKey', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      aivideomakerApiKey: 123,
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().aivideomakerApiKey).toBeUndefined();
  });

  it('accepts valid aivideomakerApiKeys array', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      aivideomakerApiKeys: ['k1', 'k2'],
    }));
    const store = new ConfigStore(testDir);
    expect(store.get().aivideomakerApiKeys).toEqual(['k1', 'k2']);
  });

  /* ---- Load error handling ---- */
  it('returns empty config when config.json has malformed JSON', () => {
    writeFileSync(join(testDir, 'config.json'), '{broken json!!!');
    const store = new ConfigStore(testDir);
    expect(store.get()).toEqual({});
  });

  /* ---- Update cleans undefined keys ---- */
  it('update() removes keys set to undefined', () => {
    writeFileSync(join(testDir, 'config.json'), JSON.stringify({
      geminiApiKey: 'key-1',
      videoModel: 'jimeng-2.0',
    }));
    const store = new ConfigStore(testDir);
    store.update({ geminiApiKey: undefined });
    const config = store.get();
    expect(config.geminiApiKey).toBeUndefined();
    expect(config.videoModel).toBe('jimeng-2.0');
  });

  it('persists config when parent directory does not exist yet', () => {
    const nestedDir = join(testDir, 'nested', 'app-data');
    const store = new ConfigStore(nestedDir);
    store.update({ geminiApiKey: 'abc' });
    expect(existsSync(join(nestedDir, 'config.json'))).toBe(true);
  });

  it('migrateConfig logs unknown schema path for legacy unsupported version', () => {
    const migrated = migrateConfig({ _schemaVersion: 0, geminiApiKey: 'k' });
    expect(migrated._schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(migrated.geminiApiKey).toBe('k');
  });
});
