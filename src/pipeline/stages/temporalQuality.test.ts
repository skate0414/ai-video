import { describe, expect, it, vi } from 'vitest';

// Mock child_process
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn((p: string) => {
      // Mock frame files as existing after extraction
      if (typeof p === 'string' && (p.includes('last_') || p.includes('first_') || p.includes('.jpg'))) return true;
      if (typeof p === 'string' && p.includes('homebrew')) return false;
      return actual.existsSync(p);
    }),
    mkdirSync: vi.fn(),
  };
});

import { extractFrame, type TemporalMetrics } from './temporalQuality.js';

function mockExecFile(stdoutResult: string, stderrResult: string) {
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: object, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      cb(null, stdoutResult, stderrResult);
    },
  );
}

describe('extractFrame', () => {
  it('calls ffmpeg with correct timestamp', async () => {
    mockExecFile('', '');
    await extractFrame('/tmp/test.mp4', 5.0, '/tmp/frame.jpg');
    expect(execFileMock).toHaveBeenCalled();
    const args = execFileMock.mock.calls[0][1] as string[];
    expect(args).toContain('-ss');
    expect(args).toContain('5');
    expect(args).toContain('-frames:v');
    expect(args).toContain('1');
  });

  it('returns output path on success', async () => {
    mockExecFile('', '');
    const result = await extractFrame('/tmp/test.mp4', 1.0, '/tmp/frame.jpg');
    expect(result).toBe('/tmp/frame.jpg');
  });

  it('returns undefined on failure', async () => {
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(new Error('FFmpeg not found'), '', '');
      },
    );
    const result = await extractFrame('/tmp/test.mp4', 1.0, '/tmp/frame.jpg');
    expect(result).toBeUndefined();
  });

  it('clamps negative timestamps to 0', async () => {
    mockExecFile('', '');
    await extractFrame('/tmp/test.mp4', -1.0, '/tmp/frame.jpg');
    const args = execFileMock.mock.calls[0][1] as string[];
    const ssIdx = args.indexOf('-ss');
    expect(parseFloat(args[ssIdx + 1])).toBeGreaterThanOrEqual(0);
  });
});

describe('TemporalMetrics interface', () => {
  it('has correct structure', () => {
    const metrics: TemporalMetrics = {
      pairsChecked: 3,
      discontinuities: 1,
      boundarySsim: [0.8, 0.1, 0.5],
      passed: true,
      issues: [],
    };
    expect(metrics.pairsChecked).toBe(3);
    expect(metrics.boundarySsim).toHaveLength(3);
  });
});
