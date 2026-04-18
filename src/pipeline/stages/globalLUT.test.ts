import { describe, expect, it } from 'vitest';
import {
  parseColorStats,
  buildColorCorrectionFilter,
  buildSignalstatsArgs,
  type ColorStats,
} from './globalLUT.js';

describe('parseColorStats', () => {
  it('returns undefined for empty output', () => {
    expect(parseColorStats('')).toBeUndefined();
  });

  it('returns undefined when no YAVG values found', () => {
    expect(parseColorStats('some random text')).toBeUndefined();
  });

  it('parses single-frame signalstats output', () => {
    const output = [
      'YAVG=128',
      'UAVG=128',
      'VAVG=128',
      'SATAVG=50',
    ].join('\n');
    const stats = parseColorStats(output);
    expect(stats).toBeDefined();
    // Y=128, U=0 (128-128), V=0 → R=128, G=128, B=128
    expect(stats!.avgR).toBe(128);
    expect(stats!.avgG).toBe(128);
    expect(stats!.avgB).toBe(128);
    expect(stats!.brightness).toBe(128);
    expect(stats!.saturation).toBe(50);
  });

  it('averages multiple frames', () => {
    const output = [
      'YAVG=100', 'UAVG=128', 'VAVG=128', 'SATAVG=40',
      'YAVG=200', 'UAVG=128', 'VAVG=128', 'SATAVG=60',
    ].join('\n');
    const stats = parseColorStats(output);
    expect(stats).toBeDefined();
    // avg Y=150, U=0, V=0 → R=G=B=150
    expect(stats!.avgR).toBe(150);
    expect(stats!.brightness).toBe(150);
    expect(stats!.saturation).toBe(50);
  });

  it('handles non-neutral chroma (warm tint)', () => {
    // Y=128, U=120 (blue-ish component less), V=140 (red-ish more)
    const output = 'YAVG=128\nUAVG=120\nVAVG=140\nSATAVG=80';
    const stats = parseColorStats(output);
    expect(stats).toBeDefined();
    // Y=128, u=120-128=-8, v=140-128=12
    // R = 128 + 1.402*12 = 144.824 → 145
    // G = 128 - 0.344*(-8) - 0.714*12 = 128 + 2.752 - 8.568 = 122.184 → 122
    // B = 128 + 1.772*(-8) = 128 - 14.176 = 113.824 → 114
    expect(stats!.avgR).toBe(145);
    expect(stats!.avgG).toBe(122);
    expect(stats!.avgB).toBe(114);
  });

  it('clamps RGB values to 0-255', () => {
    // Very high V value → R could exceed 255
    const output = 'YAVG=250\nUAVG=128\nVAVG=250\nSATAVG=100';
    const stats = parseColorStats(output);
    expect(stats).toBeDefined();
    // R = 250 + 1.402*(250-128) = 250 + 171 = 421 → clamped to 255
    expect(stats!.avgR).toBe(255);
  });

  it('defaults UV to 128 when not present', () => {
    const output = 'YAVG=128\nSATAVG=0';
    const stats = parseColorStats(output);
    expect(stats).toBeDefined();
    // U=128, V=128 → neutral → R=G=B=128
    expect(stats!.avgR).toBe(128);
    expect(stats!.avgG).toBe(128);
    expect(stats!.avgB).toBe(128);
  });
});

describe('buildColorCorrectionFilter', () => {
  const neutral: ColorStats = { avgR: 128, avgG: 128, avgB: 128, brightness: 128, saturation: 50 };

  it('returns empty string when scene matches reference', () => {
    expect(buildColorCorrectionFilter(neutral, neutral)).toBe('');
  });

  it('returns empty string when delta is below MIN_DELTA (5)', () => {
    const scene: ColorStats = { avgR: 130, avgG: 126, avgB: 128, brightness: 129, saturation: 50 };
    expect(buildColorCorrectionFilter(neutral, scene)).toBe('');
  });

  it('applies colorbalance for significant channel deltas', () => {
    const scene: ColorStats = { avgR: 100, avgG: 128, avgB: 128, brightness: 128, saturation: 50 };
    const filter = buildColorCorrectionFilter(neutral, scene);
    expect(filter).toContain('colorbalance');
    expect(filter).toContain('rm='); // midtone red adjustment
    // 28/255 ≈ 0.1098, within MAX_SHIFT (0.12)
    expect(filter).toMatch(/rm=0\.1\d+/);
  });

  it('clamps corrections to MAX_SHIFT', () => {
    // Massive delta: 128 - 0 = 128 → 128/255 = 0.502 → clamped to 0.12
    const scene: ColorStats = { avgR: 0, avgG: 128, avgB: 128, brightness: 128, saturation: 50 };
    const filter = buildColorCorrectionFilter(neutral, scene);
    expect(filter).toContain('rm=0.1200');
  });

  it('applies eq brightness correction for brightness deltas', () => {
    const scene: ColorStats = { avgR: 128, avgG: 128, avgB: 128, brightness: 100, saturation: 50 };
    const filter = buildColorCorrectionFilter(neutral, scene);
    expect(filter).toContain('eq=brightness=');
  });

  it('combines colorbalance and eq when both needed', () => {
    const scene: ColorStats = { avgR: 100, avgG: 100, avgB: 100, brightness: 100, saturation: 50 };
    const filter = buildColorCorrectionFilter(neutral, scene);
    expect(filter).toContain('colorbalance');
    expect(filter).toContain('eq=brightness');
    // Filters are comma-separated
    expect(filter.split(',').length).toBe(2);
  });

  it('handles negative corrections (scene brighter than reference)', () => {
    const ref: ColorStats = { avgR: 100, avgG: 100, avgB: 100, brightness: 100, saturation: 50 };
    const scene: ColorStats = { avgR: 130, avgG: 130, avgB: 130, brightness: 130, saturation: 50 };
    const filter = buildColorCorrectionFilter(ref, scene);
    // Negative corrections
    expect(filter).toMatch(/rm=-0\.\d+/);
  });
});

describe('buildSignalstatsArgs', () => {
  it('returns valid FFmpeg arguments', () => {
    const args = buildSignalstatsArgs('/path/to/video.mp4');
    expect(args).toContain('-i');
    expect(args).toContain('/path/to/video.mp4');
    expect(args).toContain('signalstats,metadata=print:file=-');
    expect(args).toContain('-frames:v');
    expect(args).toContain('30');
  });
});
