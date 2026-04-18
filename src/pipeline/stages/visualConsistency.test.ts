/* ------------------------------------------------------------------ */
/*  Tests: Visual Consistency Engine (G2) – pure scoring functions    */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import {
  scoreVisualConsistency,
  scoreColorSimilarity,
  scoreStyleSimilarity,
  hexToRGB,
  buildConsistencyReport,
  buildStyleAnchor,
  type VisualDNA,
} from './visualConsistency.js';

/* ================================================================== */
/*  hexToRGB                                                          */
/* ================================================================== */
describe('hexToRGB', () => {
  it('parses standard hex color', () => {
    expect(hexToRGB('#FF0000')).toEqual([255, 0, 0]);
    expect(hexToRGB('#00FF00')).toEqual([0, 255, 0]);
    expect(hexToRGB('#0000FF')).toEqual([0, 0, 255]);
  });

  it('parses hex without # prefix', () => {
    expect(hexToRGB('FF8800')).toEqual([255, 136, 0]);
  });

  it('is case-insensitive', () => {
    expect(hexToRGB('#ff0000')).toEqual([255, 0, 0]);
    expect(hexToRGB('#aaBBcc')).toEqual([170, 187, 204]);
  });

  it('returns null for invalid hex', () => {
    expect(hexToRGB('not-a-color')).toBeNull();
    expect(hexToRGB('#GG0000')).toBeNull();
    expect(hexToRGB('#FFF')).toBeNull(); // 3-char hex not supported
  });

  it('returns null for empty string', () => {
    expect(hexToRGB('')).toBeNull();
  });
});

/* ================================================================== */
/*  scoreColorSimilarity                                              */
/* ================================================================== */
describe('scoreColorSimilarity', () => {
  it('returns 100 for identical palettes', () => {
    const colors = ['#FF0000', '#00FF00', '#0000FF'];
    expect(scoreColorSimilarity(colors, colors)).toBe(100);
  });

  it('returns low score for opposite palettes', () => {
    const warm = ['#FF0000', '#FF8800', '#FFFF00'];
    const cool = ['#0000FF', '#0088FF', '#00FFFF'];
    const score = scoreColorSimilarity(warm, cool);
    expect(score).toBeLessThan(50);
  });

  it('returns 50 for empty candidate array', () => {
    expect(scoreColorSimilarity([], ['#FF0000'])).toBe(50);
  });

  it('returns 50 for empty reference array', () => {
    expect(scoreColorSimilarity(['#FF0000'], [])).toBe(50);
  });

  it('handles single color comparison', () => {
    // Same color → distance 0 → score 100
    expect(scoreColorSimilarity(['#FF0000'], ['#FF0000'])).toBe(100);
  });

  it('gives high score for similar colors', () => {
    // Close shades of red
    const score = scoreColorSimilarity(['#FF0000'], ['#EE1111']);
    expect(score).toBeGreaterThan(85);
  });
});

/* ================================================================== */
/*  scoreStyleSimilarity                                              */
/* ================================================================== */
describe('scoreStyleSimilarity', () => {
  it('returns 100 for identical keywords', () => {
    const kw = ['3D animated', 'soft lighting'];
    expect(scoreStyleSimilarity(kw, kw)).toBe(100);
  });

  it('returns 50 for no overlap', () => {
    expect(scoreStyleSimilarity(['cartoon'], ['photorealistic'])).toBeLessThan(50);
  });

  it('supports partial matching (contains)', () => {
    // "3D animated" contains "3D" → match
    const score = scoreStyleSimilarity(['3D animated'], ['3D']);
    expect(score).toBeGreaterThan(0);
  });

  it('is case-insensitive', () => {
    expect(scoreStyleSimilarity(['Cartoon'], ['cartoon'])).toBe(100);
  });

  it('returns 50 for empty arrays', () => {
    expect(scoreStyleSimilarity([], ['cartoon'])).toBe(50);
    expect(scoreStyleSimilarity(['cartoon'], [])).toBe(50);
  });
});

/* ================================================================== */
/*  scoreVisualConsistency                                            */
/* ================================================================== */
describe('scoreVisualConsistency', () => {
  const baseDNA: VisualDNA = {
    dominantColors: ['#FF0000', '#00FF00', '#0000FF'],
    brightness: 'medium',
    colorTemperature: 'warm',
    styleKeywords: ['3D animated', 'soft lighting'],
  };

  it('returns 100 for identical fingerprints', () => {
    expect(scoreVisualConsistency(baseDNA, baseDNA)).toBe(100);
  });

  it('returns lower score when brightness differs', () => {
    const dark: VisualDNA = { ...baseDNA, brightness: 'dark' };
    const same = scoreVisualConsistency(baseDNA, baseDNA);
    const diff = scoreVisualConsistency(dark, baseDNA);
    expect(diff).toBeLessThan(same);
  });

  it('returns lower score when temperature differs', () => {
    const cool: VisualDNA = { ...baseDNA, colorTemperature: 'cool' };
    const same = scoreVisualConsistency(baseDNA, baseDNA);
    const diff = scoreVisualConsistency(cool, baseDNA);
    expect(diff).toBeLessThan(same);
  });

  it('returns lower score when colors differ', () => {
    const diffColors: VisualDNA = {
      ...baseDNA,
      dominantColors: ['#000000', '#111111', '#222222'],
    };
    const score = scoreVisualConsistency(diffColors, baseDNA);
    expect(score).toBeLessThan(80);
  });

  it('returns lower score when style keywords differ', () => {
    const diffStyle: VisualDNA = {
      ...baseDNA,
      styleKeywords: ['photorealistic', 'cinematic'],
    };
    const score = scoreVisualConsistency(diffStyle, baseDNA);
    expect(score).toBeLessThan(100);
  });

  it('handles empty VisualDNA gracefully', () => {
    const empty: VisualDNA = {
      dominantColors: [],
      brightness: 'medium',
      colorTemperature: 'neutral',
      styleKeywords: [],
    };
    // Should not throw; produces a reasonable score
    const score = scoreVisualConsistency(empty, baseDNA);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

/* ================================================================== */
/*  buildConsistencyReport                                            */
/* ================================================================== */
describe('buildConsistencyReport', () => {
  const refDNA: VisualDNA = {
    dominantColors: ['#FF0000', '#00FF00'],
    brightness: 'medium',
    colorTemperature: 'warm',
    styleKeywords: ['cartoon'],
  };

  it('reports all scores and average', () => {
    const scenes: VisualDNA[] = [refDNA, refDNA];
    const report = buildConsistencyReport(scenes, refDNA);
    expect(report.scores.length).toBe(2);
    expect(report.averageScore).toBe(100);
    expect(report.outlierIndices).toEqual([]);
  });

  it('identifies outliers below threshold', () => {
    const outlier: VisualDNA = {
      dominantColors: ['#000000'],
      brightness: 'dark',
      colorTemperature: 'cool',
      styleKeywords: ['photorealistic'],
    };
    const report = buildConsistencyReport([refDNA, outlier], refDNA, 80);
    expect(report.outlierIndices).toContain(1);
  });

  it('returns zero average for empty scenes', () => {
    const report = buildConsistencyReport([], refDNA);
    expect(report.averageScore).toBe(0);
    expect(report.scores).toEqual([]);
  });
});

/* ================================================================== */
/*  buildStyleAnchor                                                  */
/* ================================================================== */
describe('buildStyleAnchor', () => {
  it('builds anchor text from VisualDNA', () => {
    const dna: VisualDNA = {
      dominantColors: ['#FF0000', '#00FF00'],
      brightness: 'medium',
      colorTemperature: 'warm',
      styleKeywords: ['3D animated', 'soft lighting'],
    };
    const anchor = buildStyleAnchor(dna);
    expect(anchor).toContain('3D animated');
    expect(anchor).toContain('#FF0000');
    expect(anchor).toContain('medium');
    expect(anchor).toContain('warm');
  });

  it('handles empty colors and keywords', () => {
    const dna: VisualDNA = {
      dominantColors: [],
      brightness: 'bright',
      colorTemperature: 'cool',
      styleKeywords: [],
    };
    const anchor = buildStyleAnchor(dna);
    expect(anchor).toContain('bright');
    expect(anchor).toContain('cool');
    expect(anchor).not.toContain('Palette');
    expect(anchor).not.toContain('Style:');
  });
});
