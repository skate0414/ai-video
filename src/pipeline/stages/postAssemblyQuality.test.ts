import { describe, expect, it, vi, beforeEach } from 'vitest';

// Mock child_process before importing module
const execFileMock = vi.hoisted(() => vi.fn());
vi.mock('node:child_process', () => ({
  execFile: execFileMock,
}));

// Mock fs.existsSync for FFmpeg binary resolution
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(() => false),
  };
});

import { computePostAssemblyMetrics, type PostAssemblyMetrics } from './postAssemblyQuality.js';

/**
 * Helper to simulate execFile call results.
 * FFmpeg outputs diagnostic info on stderr.
 */
function mockExecFile(stderrResults: string[]) {
  let callIndex = 0;
  execFileMock.mockImplementation(
    (_cmd: string, _args: string[], _opts: object, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
      const stderr = stderrResults[callIndex] ?? '';
      callIndex++;
      cb(null, '', stderr);
    },
  );
}

describe('computePostAssemblyMetrics', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('returns passed=true when no issues detected', async () => {
    mockExecFile([
      // blackdetect: no black frames
      '',
      // silencedetect: no silence
      '',
      // loudnorm: normal levels
      'Input True Peak: -6.0\nInput Integrated: -18.0',
    ]);

    const metrics = await computePostAssemblyMetrics('/tmp/test.mp4');
    expect(metrics.passed).toBe(true);
    expect(metrics.issues).toHaveLength(0);
    expect(metrics.blackFrameCount).toBe(0);
    expect(metrics.silenceGapCount).toBe(0);
    expect(metrics.peakAudioLevel).toBe(-6.0);
    expect(metrics.integratedLoudness).toBe(-18.0);
  });

  it('detects black frames', async () => {
    const blackDetectOutput = [
      '[blackdetect @ 0x1234] black_start:0.5 black_end:0.8 black_duration:0.3',
      '[blackdetect @ 0x1234] black_start:2.0 black_end:2.3 black_duration:0.3',
      '[blackdetect @ 0x1234] black_start:5.0 black_end:5.2 black_duration:0.2',
      '[blackdetect @ 0x1234] black_start:8.0 black_end:8.1 black_duration:0.1',
    ].join('\n');

    mockExecFile([
      blackDetectOutput,
      '',
      'Input True Peak: -6.0\nInput Integrated: -18.0',
    ]);

    const metrics = await computePostAssemblyMetrics('/tmp/test.mp4');
    expect(metrics.blackFrameCount).toBe(4);
    expect(metrics.passed).toBe(false);
    expect(metrics.issues.some(i => i.includes('black frames'))).toBe(true);
  });

  it('detects silence gaps', async () => {
    const silenceOutput = [
      'silence_start: 1.0',
      'silence_end: 2.5',
      'silence_start: 5.0',
      'silence_end: 6.0',
      'silence_start: 10.0',
      'silence_end: 11.5',
    ].join('\n');

    mockExecFile([
      '',
      silenceOutput,
      'Input True Peak: -6.0\nInput Integrated: -18.0',
    ]);

    const metrics = await computePostAssemblyMetrics('/tmp/test.mp4');
    expect(metrics.silenceGapCount).toBe(3);
    expect(metrics.passed).toBe(false);
    expect(metrics.issues.some(i => i.includes('silence gaps'))).toBe(true);
  });

  it('detects audio clipping', async () => {
    mockExecFile([
      '',
      '',
      'Input True Peak: -0.2\nInput Integrated: -14.0',
    ]);

    const metrics = await computePostAssemblyMetrics('/tmp/test.mp4');
    expect(metrics.peakAudioLevel).toBe(-0.2);
    expect(metrics.passed).toBe(false);
    expect(metrics.issues.some(i => i.includes('clipping'))).toBe(true);
  });

  it('handles FFmpeg errors gracefully', async () => {
    execFileMock.mockImplementation(
      (_cmd: string, _args: string[], _opts: object, cb: (err: Error | null, stdout: string, stderr: string) => void) => {
        cb(new Error('FFmpeg not found'), '', '');
      },
    );

    const metrics = await computePostAssemblyMetrics('/tmp/test.mp4');
    // Should return default values, not throw
    expect(metrics.blackFrameCount).toBe(0);
    expect(metrics.silenceGapCount).toBe(0);
    expect(metrics.peakAudioLevel).toBeUndefined();
  });

  it('reports multiple issues simultaneously', async () => {
    const blackDetectOutput = [
      '[blackdetect @ 0x1] black_start:0',
      '[blackdetect @ 0x1] black_start:1',
      '[blackdetect @ 0x1] black_start:2',
      '[blackdetect @ 0x1] black_start:3',
    ].join('\n');
    const silenceOutput = [
      'silence_start: 1.0',
      'silence_start: 5.0',
      'silence_start: 10.0',
    ].join('\n');

    mockExecFile([
      blackDetectOutput,
      silenceOutput,
      'Input True Peak: -0.3\nInput Integrated: -12.0',
    ]);

    const metrics = await computePostAssemblyMetrics('/tmp/test.mp4');
    expect(metrics.passed).toBe(false);
    expect(metrics.issues.length).toBe(3); // black + silence + clipping
  });

  it('passes when values are at thresholds', async () => {
    // Exactly 3 black frames (max is 3), 2 silence gaps (max is 2), peak at -0.5 (threshold)
    const blackDetectOutput = [
      '[blackdetect @ 0x1] black_start:0 black_end:0.1 black_duration:0.1',
      '[blackdetect @ 0x1] black_start:2 black_end:2.1 black_duration:0.1',
      '[blackdetect @ 0x1] black_start:5 black_end:5.1 black_duration:0.1',
    ].join('\n');
    const silenceOutput = [
      'silence_start: 1.0',
      'silence_start: 5.0',
    ].join('\n');

    mockExecFile([
      blackDetectOutput,
      silenceOutput,
      'Input True Peak: -0.5\nInput Integrated: -16.0',
    ]);

    const metrics = await computePostAssemblyMetrics('/tmp/test.mp4');
    expect(metrics.passed).toBe(true);
    expect(metrics.blackFrameCount).toBe(3);
    expect(metrics.silenceGapCount).toBe(2);
    expect(metrics.peakAudioLevel).toBe(-0.5);
  });

  it('handles missing loudnorm output gracefully', async () => {
    mockExecFile([
      '',
      '',
      'Some other output without peak or loudness',
    ]);

    const metrics = await computePostAssemblyMetrics('/tmp/test.mp4');
    expect(metrics.peakAudioLevel).toBeUndefined();
    expect(metrics.integratedLoudness).toBeUndefined();
    expect(metrics.passed).toBe(true);
  });
});
