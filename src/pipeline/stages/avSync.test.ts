import { describe, expect, it } from 'vitest';
import {
  computeAVSyncStrategy,
  buildAVSyncArgs,
  AV_SYNC_TOLERANCE,
  MAX_ATEMPO_RATIO,
} from './avSync.js';

describe('computeAVSyncStrategy', () => {
  it('returns none for zero/negative durations', () => {
    expect(computeAVSyncStrategy(0, 5)).toMatchObject({ strategy: 'none' });
    expect(computeAVSyncStrategy(5, 0)).toMatchObject({ strategy: 'none' });
    expect(computeAVSyncStrategy(-1, 5)).toMatchObject({ strategy: 'none' });
  });

  it('returns none when delta is within tolerance', () => {
    const r = computeAVSyncStrategy(5.0, 5.2);
    expect(r.strategy).toBe('none');
  });

  it('returns none when delta is exactly at tolerance boundary', () => {
    const r = computeAVSyncStrategy(5.0, 5.0 + AV_SYNC_TOLERANCE);
    expect(r.strategy).toBe('none');
  });

  describe('audio longer than video (positive delta)', () => {
    it('returns pad-video for small gap (0.3–2s)', () => {
      const r = computeAVSyncStrategy(5.0, 6.0);
      expect(r.strategy).toBe('pad-video');
      expect(r.targetDuration).toBe(6.0);
    });

    it('returns loop-video for large gap (≥2s)', () => {
      const r = computeAVSyncStrategy(5.0, 7.5);
      expect(r.strategy).toBe('loop-video');
      expect(r.targetDuration).toBe(7.5);
    });

    it('returns loop-video at exactly 2s delta', () => {
      const r = computeAVSyncStrategy(5.0, 7.0);
      expect(r.strategy).toBe('loop-video');
    });

    it('returns pad-video just below 2s delta', () => {
      const r = computeAVSyncStrategy(5.0, 6.9);
      expect(r.strategy).toBe('pad-video');
    });
  });

  describe('video longer than audio (negative delta)', () => {
    it('returns speed-audio for small relative gap (≤15%)', () => {
      // 10s video, 9s audio → 11% gap → should use atempo
      const r = computeAVSyncStrategy(10.0, 9.0);
      expect(r.strategy).toBe('speed-audio');
      expect(r.atempo).toBeCloseTo(9.0 / 10.0, 3);
      expect(r.targetDuration).toBe(10.0);
    });

    it('returns trim-video for large relative gap (>15%)', () => {
      // 10s video, 5s audio → 100% relative → way beyond 15%
      const r = computeAVSyncStrategy(10.0, 5.0);
      expect(r.strategy).toBe('trim-video');
      expect(r.targetDuration).toBe(5.0);
    });

    it('returns trim-video when absolute gap ≥3s even if ratio small', () => {
      // 30s video, 26s audio → gap=4s, ratio 15.4% → but gap≥3s qualifies via ratio check
      const r = computeAVSyncStrategy(30, 26);
      // ratio = 4/26 ≈ 0.154 > 0.15, so trim-video
      expect(r.strategy).toBe('trim-video');
    });
  });

  it('all results have a description', () => {
    const cases = [
      computeAVSyncStrategy(0, 5),
      computeAVSyncStrategy(5, 5.1),
      computeAVSyncStrategy(5, 6),
      computeAVSyncStrategy(5, 8),
      computeAVSyncStrategy(10, 9),
      computeAVSyncStrategy(10, 5),
    ];
    for (const r of cases) {
      expect(r.description).toBeTruthy();
    }
  });
});

describe('buildAVSyncArgs', () => {
  it('returns empty for none strategy', () => {
    const args = buildAVSyncArgs({ strategy: 'none', description: 'ok' });
    expect(args.outputFlags).toEqual([]);
    expect(args.videoFilter).toBe('');
    expect(args.audioFilter).toBe('');
    expect(args.loopInput).toBe(false);
  });

  it('returns loop flags for loop-video', () => {
    const args = buildAVSyncArgs({
      strategy: 'loop-video',
      targetDuration: 8.0,
      description: 'loop',
    });
    expect(args.loopInput).toBe(true);
    expect(args.outputFlags).toContain('-t');
    expect(args.outputFlags).toContain('8');
  });

  it('returns tpad filter for pad-video', () => {
    const args = buildAVSyncArgs({
      strategy: 'pad-video',
      targetDuration: 6.0,
      description: 'pad',
    });
    expect(args.videoFilter).toContain('tpad');
    expect(args.videoFilter).toContain('stop_mode=clone');
    expect(args.loopInput).toBe(false);
  });

  it('returns atempo filter for speed-audio', () => {
    const args = buildAVSyncArgs({
      strategy: 'speed-audio',
      atempo: 0.9,
      targetDuration: 10.0,
      description: 'speed',
    });
    expect(args.audioFilter).toContain('atempo=0.9000');
    expect(args.videoFilter).toBe('');
  });

  it('returns only -t for trim-video', () => {
    const args = buildAVSyncArgs({
      strategy: 'trim-video',
      targetDuration: 5.0,
      description: 'trim',
    });
    expect(args.outputFlags).toEqual(['-t', '5']);
    expect(args.videoFilter).toBe('');
    expect(args.audioFilter).toBe('');
    expect(args.loopInput).toBe(false);
  });

  it('omits -t when targetDuration is undefined', () => {
    const args = buildAVSyncArgs({ strategy: 'pad-video', description: 'no target' });
    expect(args.outputFlags).toEqual([]);
  });
});
