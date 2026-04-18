/* ------------------------------------------------------------------ */
/*  Tests: xfade filter graph construction + min-duration guard       */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import { buildXfadeFilterGraph, XFADE_MAP, XFADE_DURATION } from './ffmpegAssembler.js';

describe('XFADE_MAP', () => {
  it('maps dissolve, fade, wipe, zoom to FFmpeg names', () => {
    expect(XFADE_MAP.dissolve).toBe('dissolve');
    expect(XFADE_MAP.fade).toBe('fade');
    expect(XFADE_MAP.wipe).toBe('wipeleft');
    expect(XFADE_MAP.zoom).toBe('zoomin');
  });

  it('does not map cut or none', () => {
    expect(XFADE_MAP['cut']).toBeUndefined();
    expect(XFADE_MAP['none']).toBeUndefined();
  });
});

describe('XFADE_DURATION', () => {
  it('is 0.5 seconds', () => {
    expect(XFADE_DURATION).toBe(0.5);
  });
});

describe('buildXfadeFilterGraph', () => {
  it('returns empty filters for fewer than 2 clips', () => {
    const result = buildXfadeFilterGraph([5], ['dissolve']);
    expect(result.vFilters).toEqual([]);
    expect(result.aFilters).toEqual([]);
  });

  it('builds xfade filter for dissolve transition', () => {
    const { vFilters, aFilters } = buildXfadeFilterGraph([5, 5], ['dissolve']);
    expect(vFilters).toHaveLength(1);
    expect(aFilters).toHaveLength(1);
    expect(vFilters[0]).toContain('xfade=transition=dissolve');
    expect(vFilters[0]).toContain('[vout]');
    expect(aFilters[0]).toContain('acrossfade');
    expect(aFilters[0]).toContain('[aout]');
  });

  it('builds concat filter for hard cut', () => {
    const { vFilters, aFilters } = buildXfadeFilterGraph([5, 5], ['cut']);
    expect(vFilters[0]).toContain('concat=n=2:v=1:a=0');
    expect(aFilters[0]).toContain('concat=n=2:v=0:a=1');
  });

  it('builds concat filter for "none" transition', () => {
    const { vFilters } = buildXfadeFilterGraph([5, 5], ['none']);
    expect(vFilters[0]).toContain('concat=n=2');
  });

  it('chains multiple clips with intermediate labels', () => {
    const { vFilters, aFilters } = buildXfadeFilterGraph(
      [5, 5, 5],
      ['dissolve', 'fade'],
    );
    expect(vFilters).toHaveLength(2);
    expect(aFilters).toHaveLength(2);
    // First transition: intermediate label [v1]
    expect(vFilters[0]).toContain('[v1]');
    // Second transition: final label [vout]
    expect(vFilters[1]).toContain('[vout]');
  });

  it('computes correct xfade offset', () => {
    // clip0=5s, clip1=5s, dissolve transition
    // offset = cumulativeOffset(5) - XFADE_DURATION(0.5) = 4.5
    const { vFilters } = buildXfadeFilterGraph([5, 5], ['dissolve']);
    expect(vFilters[0]).toContain('offset=4.500');
  });

  it('maps wipe to wipeleft', () => {
    const { vFilters } = buildXfadeFilterGraph([5, 5], ['wipe']);
    expect(vFilters[0]).toContain('xfade=transition=wipeleft');
  });

  it('maps zoom to zoomin', () => {
    const { vFilters } = buildXfadeFilterGraph([5, 5], ['zoom']);
    expect(vFilters[0]).toContain('xfade=transition=zoomin');
  });

  // ---- Min-duration guard tests ----

  it('downgrades to concat when outgoing clip < 2×XFADE_DURATION', () => {
    // clip0=0.8s < 1.0 (2×0.5), should downgrade dissolve to concat
    const { vFilters } = buildXfadeFilterGraph([0.8, 5], ['dissolve']);
    expect(vFilters[0]).toContain('concat=n=2');
    expect(vFilters[0]).not.toContain('xfade');
  });

  it('downgrades to concat when incoming clip < 2×XFADE_DURATION', () => {
    // clip1=0.3s < 1.0, should downgrade
    const { vFilters } = buildXfadeFilterGraph([5, 0.3], ['fade']);
    expect(vFilters[0]).toContain('concat=n=2');
    expect(vFilters[0]).not.toContain('xfade');
  });

  it('keeps xfade when both clips are exactly 2×XFADE_DURATION', () => {
    const { vFilters } = buildXfadeFilterGraph([1.0, 1.0], ['dissolve']);
    expect(vFilters[0]).toContain('xfade=transition=dissolve');
  });

  it('handles null durations (uses 5s default)', () => {
    const { vFilters } = buildXfadeFilterGraph([null, null], ['dissolve']);
    expect(vFilters[0]).toContain('xfade=transition=dissolve');
    expect(vFilters[0]).toContain('offset=4.500');
  });

  it('handles mix of normal and short clips', () => {
    // clip0=5s, clip1=0.4s (short), clip2=5s
    // transition 0 (5→0.4): downgraded (incoming short)
    // transition 1 (0.4→5): downgraded (outgoing short)
    const { vFilters } = buildXfadeFilterGraph([5, 0.4, 5], ['dissolve', 'fade']);
    expect(vFilters[0]).toContain('concat=n=2'); // downgraded
    expect(vFilters[1]).toContain('concat=n=2'); // downgraded
  });

  it('does not affect already-cut transitions', () => {
    // short clips with 'cut' transition — should still be concat
    const { vFilters } = buildXfadeFilterGraph([0.3, 0.3], ['cut']);
    expect(vFilters[0]).toContain('concat=n=2');
  });
});
