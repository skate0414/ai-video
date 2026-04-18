/* ------------------------------------------------------------------ */
/*  Tests: cvPreprocess – G1 shot analysis pure functions             */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import { normalizeTransition, buildShotCIR } from './cvPreprocess.js';
import type { ShotBoundary } from '../../cir/types.js';

/* ================================================================== */
/*  normalizeTransition                                               */
/* ================================================================== */
describe('normalizeTransition', () => {
  it('maps "dissolve" variants', () => {
    expect(normalizeTransition('dissolve')).toBe('dissolve');
    expect(normalizeTransition('cross-dissolve')).toBe('dissolve');
    expect(normalizeTransition('DISSOLVE')).toBe('dissolve');
  });

  it('maps "fade" variants', () => {
    expect(normalizeTransition('fade')).toBe('fade');
    expect(normalizeTransition('fade out')).toBe('fade');
    expect(normalizeTransition('Fade In')).toBe('fade');
  });

  it('maps "wipe" variants', () => {
    expect(normalizeTransition('wipe')).toBe('wipe');
    expect(normalizeTransition('wipe left')).toBe('wipe');
  });

  it('maps "zoom" variants', () => {
    expect(normalizeTransition('zoom')).toBe('zoom');
    expect(normalizeTransition('zoom in')).toBe('zoom');
  });

  it('maps "none"', () => {
    expect(normalizeTransition('none')).toBe('none');
  });

  it('defaults to "cut" for unknown strings', () => {
    expect(normalizeTransition('random transition')).toBe('cut');
    expect(normalizeTransition('hard cut')).toBe('cut');
    expect(normalizeTransition('')).toBe('cut');
  });

  it('handles null/undefined input', () => {
    expect(normalizeTransition(null)).toBe('cut');
    expect(normalizeTransition(undefined)).toBe('cut');
  });

  it('handles numeric input', () => {
    expect(normalizeTransition(42)).toBe('cut');
  });

  // Priority: dissolve checked before fade (e.g. "dissolve-fade" → dissolve)
  it('dissolve takes priority over fade', () => {
    expect(normalizeTransition('dissolve-fade')).toBe('dissolve');
  });
});

/* ================================================================== */
/*  buildShotCIR                                                      */
/* ================================================================== */

function makeShot(overrides: Partial<ShotBoundary> = {}): ShotBoundary {
  return {
    index: 0,
    startSec: 0,
    endSec: 3,
    durationSec: 3,
    keyframePath: '/tmp/shot_0.jpg',
    cameraMotion: 'pan',
    transitionToNext: 'cut',
    dominantColors: ['#FF0000'],
    subjectDescription: 'A sphere',
    ...overrides,
  };
}

describe('buildShotCIR', () => {
  it('creates valid ShotCIR from shots', () => {
    const shots = [
      makeShot({ index: 0, startSec: 0, endSec: 3, durationSec: 3 }),
      makeShot({ index: 1, startSec: 3, endSec: 7, durationSec: 4 }),
    ];
    const cir = buildShotCIR(shots, 10);

    expect(cir._cir).toBe('ShotAnalysis');
    expect(cir.version).toBe(1);
    expect(cir.totalShots).toBe(2);
    expect(cir.videoDurationSec).toBe(10);
  });

  it('computes avgShotDurationSec', () => {
    const shots = [
      makeShot({ durationSec: 2 }),
      makeShot({ durationSec: 4 }),
      makeShot({ durationSec: 6 }),
    ];
    const cir = buildShotCIR(shots, 12);
    expect(cir.avgShotDurationSec).toBe(4); // (2+4+6)/3 = 4
  });

  it('computes rhythmSignature summing to ~1.0', () => {
    const shots = [
      makeShot({ durationSec: 2 }),
      makeShot({ durationSec: 3 }),
      makeShot({ durationSec: 5 }),
    ];
    const cir = buildShotCIR(shots, 10);
    const sum = cir.rhythmSignature.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1.0, 2);
    expect(cir.rhythmSignature[0]).toBeCloseTo(0.2, 3);
    expect(cir.rhythmSignature[1]).toBeCloseTo(0.3, 3);
    expect(cir.rhythmSignature[2]).toBeCloseTo(0.5, 3);
  });

  it('handles empty shots array', () => {
    const cir = buildShotCIR([], 10);
    expect(cir.totalShots).toBe(0);
    expect(cir.rhythmSignature).toEqual([]);
    expect(cir.videoDurationSec).toBe(10);
  });

  it('handles single shot', () => {
    const shots = [makeShot({ durationSec: 5 })];
    const cir = buildShotCIR(shots, 5);
    expect(cir.totalShots).toBe(1);
    expect(cir.rhythmSignature).toEqual([1.0]);
    expect(cir.avgShotDurationSec).toBe(5);
  });

  it('rhythmSignature values are rounded to 3 decimals', () => {
    const shots = [
      makeShot({ durationSec: 1 }),
      makeShot({ durationSec: 2 }),
      makeShot({ durationSec: 3.333 }),
    ];
    const cir = buildShotCIR(shots, 10);
    for (const r of cir.rhythmSignature) {
      // Check: has at most 3 decimal places
      const decimals = (r.toString().split('.')[1] || '').length;
      expect(decimals).toBeLessThanOrEqual(3);
    }
  });
});
