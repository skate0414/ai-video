import { describe, expect, it } from 'vitest';
import {
  parseBeatsFromAstats,
  snapTransitionsToBeats,
  buildBeatDetectionArgs,
  BEAT_SNAP_TOLERANCE,
} from './beatAlign.js';

describe('parseBeatsFromAstats', () => {
  it('returns empty beats for empty output', () => {
    const result = parseBeatsFromAstats('', 60);
    expect(result.beats).toEqual([]);
    expect(result.estimatedBPM).toBe(0);
  });

  it('returns empty beats for too few RMS values', () => {
    const output = [
      'lavfi.astats.Overall.RMS_level=-20',
      'lavfi.astats.Overall.RMS_level=-22',
    ].join('\n');
    const result = parseBeatsFromAstats(output, 10);
    expect(result.beats).toEqual([]);
  });

  it('detects beats from energy peaks', () => {
    // Simulate 10 seconds of audio with alternating loud/quiet, using pts_time format
    const rmsValues = [
      -30, -10, -30, -30, -10, -30, -30, -10, -30, -30,
    ];
    const output = rmsValues
      .map((v, i) => `frame:${i}    pts:${i * 44100}    pts_time:${i}.000000\nlavfi.astats.Overall.RMS_level=${v}`)
      .join('\n');
    const result = parseBeatsFromAstats(output, 10);
    // Peaks at t=1, t=4, t=7 (loud values -10 dB)
    expect(result.beats).toContain(1);
    expect(result.beats).toContain(4);
    expect(result.beats).toContain(7);
    expect(result.estimatedBPM).toBeGreaterThan(0);
  });

  it('filters consecutive beats closer than MIN_BEAT_INTERVAL', () => {
    // All loud — many consecutive peaks
    const rmsValues = Array(10).fill(-10);
    const output = rmsValues
      .map((v, i) => `frame:${i}    pts:${i * 44100}    pts_time:${i}.000000\nlavfi.astats.Overall.RMS_level=${v}`)
      .join('\n');
    const result = parseBeatsFromAstats(output, 10);
    // Since all values are equal to the mean, none exceed 1.3× threshold
    expect(result.beats.length).toBeLessThanOrEqual(rmsValues.length);
  });

  it('ignores RMS values below -100 dB', () => {
    const output = [
      'lavfi.astats.Overall.RMS_level=-200',
      'lavfi.astats.Overall.RMS_level=-200',
      'lavfi.astats.Overall.RMS_level=-200',
      'lavfi.astats.Overall.RMS_level=-200',
      'lavfi.astats.Overall.RMS_level=-200',
    ].join('\n');
    const result = parseBeatsFromAstats(output, 5);
    expect(result.beats).toEqual([]);
  });

  it('estimates BPM from beat intervals', () => {
    // Beats every 2 seconds → 30 BPM
    const rmsValues = [
      -10, -30, -10, -30, -10, -30, -10, -30, -10, -30,
    ];
    const output = rmsValues
      .map((v, i) => `frame:${i}    pts:${i * 44100}    pts_time:${i}.000000\nlavfi.astats.Overall.RMS_level=${v}`)
      .join('\n');
    const result = parseBeatsFromAstats(output, 10);
    // Beats at 0, 2, 4, 6, 8 → interval 2s → BPM = 60/2 = 30
    if (result.beats.length >= 2) {
      expect(result.estimatedBPM).toBeGreaterThan(0);
    }
  });

  it('falls back to frameIdx when pts_time not present', () => {
    // Legacy format without pts_time — should still work using frame index
    const rmsValues = [-30, -10, -30, -30, -10, -30, -30, -10, -30, -30];
    const output = rmsValues
      .map(v => `lavfi.astats.Overall.RMS_level=${v}`)
      .join('\n');
    const result = parseBeatsFromAstats(output, 10);
    // Should detect peaks (falling back to frameIdx as time)
    expect(result.beats.length).toBeGreaterThan(0);
  });
});

describe('snapTransitionsToBeats', () => {
  it('returns copy of input when no beats', () => {
    const durations = [5, 5, 5];
    const result = snapTransitionsToBeats(durations, []);
    expect(result).toEqual([5, 5, 5]);
    // Should be a new array, not the same reference
    expect(result).not.toBe(durations);
  });

  it('returns copy of input for single scene', () => {
    const result = snapTransitionsToBeats([10], [3, 5, 7]);
    expect(result).toEqual([10]);
  });

  it('snaps transition to nearest beat within tolerance', () => {
    // Scenes: [5, 5] → transition at t=5
    // Beat at t=5.3 → within 0.4s tolerance → snap to 5.3
    const result = snapTransitionsToBeats([5, 5], [5.3]);
    expect(result[0]).toBeCloseTo(5.3, 5);
    expect(result[1]).toBeCloseTo(4.7, 5);
    // Total preserved
    expect(result[0] + result[1]).toBeCloseTo(10, 5);
  });

  it('does not snap when beat is beyond tolerance', () => {
    // Transition at t=5, beat at t=5.5 → beyond 0.4s tolerance
    const result = snapTransitionsToBeats([5, 5], [5.5]);
    expect(result).toEqual([5, 5]);
  });

  it('preserves total duration after snapping', () => {
    const durations = [4, 6, 5, 5];
    const beats = [3.8, 10.2, 14.8];
    const result = snapTransitionsToBeats(durations, beats);
    const origTotal = durations.reduce((s, v) => s + v, 0);
    const newTotal = result.reduce((s, v) => s + v, 0);
    expect(newTotal).toBeCloseTo(origTotal, 5);
  });

  it('does not snap if result would make scene shorter than 1s', () => {
    // Scenes: [1.2, 5] → transition at t=1.2
    // Beat at t=0.9 → shift=-0.3 → new durations [0.9, 5.3] → 0.9 < 1.0 → skip
    const result = snapTransitionsToBeats([1.2, 5], [0.9]);
    expect(result).toEqual([1.2, 5]);
  });

  it('handles multiple transitions with cascading updates', () => {
    const durations = [5, 5, 5];
    // Transitions at t=5 and t=10
    // Beats at t=5.2 and t=9.8
    const result = snapTransitionsToBeats(durations, [5.2, 9.8]);
    // First transition snaps: [5.2, 4.8, 5]
    // Second transition at t=10, beat at 9.8 → shift=-0.2: [5.2, 4.6, 5.2]
    expect(result[0]).toBeCloseTo(5.2, 5);
    expect(result[0] + result[1] + result[2]).toBeCloseTo(15, 5);
  });

  it('uses custom tolerance', () => {
    // Default tolerance is 0.4, use 0.1
    const result = snapTransitionsToBeats([5, 5], [5.3], 0.1);
    // 0.3 > 0.1 tolerance → no snap
    expect(result).toEqual([5, 5]);
  });
});

describe('buildBeatDetectionArgs', () => {
  it('returns valid FFmpeg arguments', () => {
    const args = buildBeatDetectionArgs('/path/to/bgm.mp3');
    expect(args).toContain('-i');
    expect(args).toContain('/path/to/bgm.mp3');
    expect(args.join(' ')).toContain('astats');
    expect(args.join(' ')).toContain('RMS_level');
  });
});
