/* ------------------------------------------------------------------ */
/*  Tests: validateShotCIR contract validation                        */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import { validateShotCIR } from './contracts.js';
import type { ShotCIR, ShotBoundary } from './types.js';

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
    subjectDescription: 'A red sphere',
    ...overrides,
  };
}

function makeShotCIR(overrides: Partial<ShotCIR> = {}): ShotCIR {
  const shots = (overrides.shots ?? [makeShot()]) as readonly ShotBoundary[];
  return {
    _cir: 'ShotAnalysis',
    version: 1,
    shots,
    totalShots: shots.length,
    avgShotDurationSec: 3,
    rhythmSignature: [1.0],
    videoDurationSec: 30,
    ...overrides,
  };
}

describe('validateShotCIR', () => {
  it('returns empty array for valid ShotCIR', () => {
    expect(validateShotCIR(makeShotCIR())).toEqual([]);
  });

  it('rejects null input', () => {
    const errors = validateShotCIR(null);
    expect(errors).toContain('CIR is null or not an object');
  });

  it('rejects non-object input', () => {
    const errors = validateShotCIR('not an object');
    expect(errors).toContain('CIR is null or not an object');
  });

  it('rejects wrong _cir tag', () => {
    const errors = validateShotCIR(makeShotCIR({ _cir: 'Wrong' as any }));
    expect(errors).toContain('_cir must be "ShotAnalysis"');
  });

  it('rejects non-array shots', () => {
    const errors = validateShotCIR({ ...makeShotCIR(), shots: 'not an array' });
    expect(errors).toContain('shots must be an array');
  });

  it('rejects negative totalShots', () => {
    const errors = validateShotCIR(makeShotCIR({ totalShots: -1 }));
    expect(errors).toContain('totalShots must be a non-negative number');
  });

  it('rejects zero videoDurationSec', () => {
    const errors = validateShotCIR(makeShotCIR({ videoDurationSec: 0 }));
    expect(errors).toContain('videoDurationSec must be positive');
  });

  it('rejects non-array rhythmSignature', () => {
    const errors = validateShotCIR({ ...makeShotCIR(), rhythmSignature: 42 });
    expect(errors).toContain('rhythmSignature must be an array');
  });

  it('accumulates multiple errors', () => {
    const errors = validateShotCIR({
      _cir: 'Wrong',
      shots: null,
      totalShots: -5,
      videoDurationSec: 0,
      rhythmSignature: null,
    });
    expect(errors.length).toBeGreaterThanOrEqual(4);
  });

  it('accepts zero totalShots (valid for no-shot fallback)', () => {
    const errors = validateShotCIR(makeShotCIR({ shots: [] as any, totalShots: 0 }));
    expect(errors).toEqual([]);
  });
});
