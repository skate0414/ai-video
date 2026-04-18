import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { mkdtempSync, rmSync, mkdirSync, chmodSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir, platform } from 'node:os';

describe('resolveDataDir (B6 permission handling)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    // Clear relevant env vars so resolveDataDir uses a controlled path
    delete process.env.DATA_DIR;
    delete process.env.APPDATA_DIR;
    delete process.env.ELECTRON_SHELL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('wraps mkdirSync EACCES with a helpful error message', async () => {
    // Skip on Windows — chmod semantics differ
    if (platform() === 'win32') return;

    const tmpBase = mkdtempSync(join(tmpdir(), 'datadir-perm-'));
    // Create a read-only directory to trigger EACCES on child creation
    const readonlyDir = join(tmpBase, 'readonly');
    mkdirSync(readonlyDir);
    chmodSync(readonlyDir, 0o444);

    // Point DATA_DIR at a non-existent child inside the read-only dir
    process.env.DATA_DIR = join(readonlyDir, 'child');

    // Dynamic import to pick up changed env
    vi.resetModules();
    const { resolveDataDir } = await import('./dataDir.js');

    expect(() => resolveDataDir()).toThrow(/Failed to create data directory/);
    expect(() => resolveDataDir()).toThrow(/DATA_DIR/);

    // Cleanup
    chmodSync(readonlyDir, 0o755);
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('succeeds when directory can be created', async () => {
    const tmpBase = mkdtempSync(join(tmpdir(), 'datadir-ok-'));
    process.env.DATA_DIR = join(tmpBase, 'new-child');

    vi.resetModules();
    const { resolveDataDir } = await import('./dataDir.js');

    const dir = resolveDataDir();
    expect(dir).toContain('new-child');

    rmSync(tmpBase, { recursive: true, force: true });
  });
});

describe('resolveSubDir', () => {
  const originalEnv = { ...process.env };
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), 'subdir-test-'));
    delete process.env.DATA_DIR;
    delete process.env.APPDATA_DIR;
    delete process.env.ELECTRON_SHELL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('creates and returns subdirectory path', async () => {
    vi.resetModules();
    const { resolveSubDir } = await import('./dataDir.js');
    const sub = resolveSubDir(tmpBase, 'a', 'b');
    expect(sub).toBe(join(tmpBase, 'a', 'b'));
    // Directory should now exist
    const { existsSync } = await import('node:fs');
    expect(existsSync(sub)).toBe(true);
  });

  it('returns existing subdirectory without error', async () => {
    mkdirSync(join(tmpBase, 'existing'), { recursive: true });
    vi.resetModules();
    const { resolveSubDir } = await import('./dataDir.js');
    const sub = resolveSubDir(tmpBase, 'existing');
    expect(sub).toBe(join(tmpBase, 'existing'));
  });
});

describe('isElectronShell', () => {
  const originalEnv = { ...process.env };

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
  });

  it('returns false when ELECTRON_SHELL is not set', async () => {
    delete process.env.ELECTRON_SHELL;
    vi.resetModules();
    const { isElectronShell } = await import('./dataDir.js');
    expect(isElectronShell()).toBe(false);
  });

  it('returns true when ELECTRON_SHELL is set', async () => {
    process.env.ELECTRON_SHELL = '1';
    vi.resetModules();
    const { isElectronShell } = await import('./dataDir.js');
    expect(isElectronShell()).toBe(true);
  });
});

describe('resolveDataDir – APPDATA_DIR fallback', () => {
  const originalEnv = { ...process.env };
  let tmpBase: string;

  beforeEach(() => {
    tmpBase = mkdtempSync(join(tmpdir(), 'appdata-test-'));
    delete process.env.DATA_DIR;
    delete process.env.ELECTRON_SHELL;
  });

  afterEach(() => {
    process.env = { ...originalEnv };
    vi.restoreAllMocks();
    rmSync(tmpBase, { recursive: true, force: true });
  });

  it('uses APPDATA_DIR when DATA_DIR is not set', async () => {
    const appDataPath = join(tmpBase, 'appdata-child');
    process.env.APPDATA_DIR = appDataPath;
    vi.resetModules();
    const { resolveDataDir } = await import('./dataDir.js');
    const dir = resolveDataDir();
    expect(dir).toContain('appdata-child');
  });

  it('uses osAppDataDir when running in Electron shell', async () => {
    const fakeHome = mkdtempSync(join(tmpdir(), 'electron-home-'));
    delete process.env.DATA_DIR;
    delete process.env.APPDATA_DIR;
    process.env.ELECTRON_SHELL = '1';

    vi.resetModules();
    vi.doMock('node:os', async () => {
      const actual = await vi.importActual<typeof import('node:os')>('node:os');
      return {
        ...actual,
        homedir: () => fakeHome,
        platform: () => 'darwin',
      };
    });

    const { resolveDataDir } = await import('./dataDir.js');
    const dir = resolveDataDir();
    expect(dir).toContain('Library/Application Support/ai-video-pipeline');

    vi.doUnmock('node:os');
    rmSync(fakeHome, { recursive: true, force: true });
  });
});
