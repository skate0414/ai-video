/* ------------------------------------------------------------------ */
/*  Tests: videoCompress – compressVideoForUpload                     */
/* ------------------------------------------------------------------ */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import path from 'node:path';

// Mock fs/promises.stat
const mockStat = vi.fn();
vi.mock('node:fs/promises', () => ({
  stat: (...args: any[]) => mockStat(...args),
}));

// Mock child_process.execFile
const mockExecFile = vi.fn();
vi.mock('node:child_process', () => ({
  execFile: (...args: any[]) => mockExecFile(...args),
}));

// Import after mocks
const { compressVideoForUpload } = await import('./videoCompress.js');

describe('compressVideoForUpload', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns original path when file is under 30 MB', async () => {
    mockStat.mockResolvedValueOnce({ size: 20 * 1024 * 1024 }); // 20 MB
    const result = await compressVideoForUpload('/videos/small.mp4');
    expect(result).toBe('/videos/small.mp4');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('returns original path when file is exactly 30 MB', async () => {
    mockStat.mockResolvedValueOnce({ size: 30 * 1024 * 1024 }); // 30 MB
    const result = await compressVideoForUpload('/videos/exact.mp4');
    expect(result).toBe('/videos/exact.mp4');
  });

  it('uses cached compressed file when available and fresh', async () => {
    // Input file: 50 MB, mtime 1000
    mockStat.mockResolvedValueOnce({ size: 50 * 1024 * 1024, mtimeMs: 1000 });
    // Compressed file exists: 10 MB, mtime 2000 (newer)
    mockStat.mockResolvedValueOnce({ size: 10 * 1024 * 1024, mtimeMs: 2000 });

    const result = await compressVideoForUpload('/videos/big.mp4');
    expect(result).toBe('/videos/big_compressed.mp4');
    expect(mockExecFile).not.toHaveBeenCalled();
  });

  it('compresses when cached file is stale', async () => {
    // Input file: 50 MB, mtime 3000
    mockStat.mockResolvedValueOnce({ size: 50 * 1024 * 1024, mtimeMs: 3000 });
    // Compressed file exists but older: mtime 1000
    mockStat.mockResolvedValueOnce({ size: 10 * 1024 * 1024, mtimeMs: 1000 });

    // Mock execFile: call the callback with success
    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      // After "compression", stat the output
      mockStat.mockResolvedValueOnce({ size: 8 * 1024 * 1024 });
      cb(null, '', '');
    });

    const result = await compressVideoForUpload('/videos/big.mp4');
    expect(result).toBe('/videos/big_compressed.mp4');
    expect(mockExecFile).toHaveBeenCalled();
  });

  it('compresses when no cached file exists', async () => {
    // Input file: 50 MB
    mockStat.mockResolvedValueOnce({ size: 50 * 1024 * 1024, mtimeMs: 1000 });
    // Compressed file does not exist
    mockStat.mockRejectedValueOnce(new Error('ENOENT'));

    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      mockStat.mockResolvedValueOnce({ size: 9 * 1024 * 1024 });
      cb(null, '', '');
    });

    const result = await compressVideoForUpload('/videos/big.avi');
    expect(result).toBe(path.join('/videos', 'big_compressed.mp4'));
  });

  it('returns original path when ffmpeg fails', async () => {
    mockStat.mockResolvedValueOnce({ size: 50 * 1024 * 1024, mtimeMs: 1000 });
    mockStat.mockRejectedValueOnce(new Error('ENOENT'));

    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      cb(new Error('ffmpeg not found'), '', '');
    });

    const result = await compressVideoForUpload('/videos/big.mp4');
    expect(result).toBe('/videos/big.mp4');
  });

  it('returns original path when stat of output fails after compression', async () => {
    mockStat.mockResolvedValueOnce({ size: 50 * 1024 * 1024, mtimeMs: 1000 });
    mockStat.mockRejectedValueOnce(new Error('ENOENT'));

    mockExecFile.mockImplementation((_cmd: string, _args: string[], _opts: any, cb: Function) => {
      // stat of output fails
      mockStat.mockRejectedValueOnce(new Error('cannot stat'));
      cb(null, '', '');
    });

    const result = await compressVideoForUpload('/videos/big.mp4');
    expect(result).toBe('/videos/big.mp4');
  });

  it('passes custom compression options to ffmpeg', async () => {
    mockStat.mockResolvedValueOnce({ size: 50 * 1024 * 1024, mtimeMs: 1000 });
    mockStat.mockRejectedValueOnce(new Error('ENOENT'));

    mockExecFile.mockImplementation((_cmd: string, args: string[], _opts: any, cb: Function) => {
      // Verify custom options in args
      expect(args).toContain('2000k'); // targetBitrate
      expect(args).toContain('3000k'); // maxRate
      expect(args).toContain('scale=-2:1080');
      mockStat.mockResolvedValueOnce({ size: 15 * 1024 * 1024 });
      cb(null, '', '');
    });

    await compressVideoForUpload('/videos/big.mp4', {
      targetBitrate: '2000k',
      maxRate: '3000k',
      scaleHeight: 1080,
    });
  });
});
