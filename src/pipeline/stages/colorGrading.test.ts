import { describe, expect, it } from 'vitest';
import { buildColorGradeFilter, hasColorGrading } from './colorGrading.js';

describe('buildColorGradeFilter', () => {
  it('returns warm colorbalance + eq for warm temperature', () => {
    const filter = buildColorGradeFilter('warm', 'generic');
    expect(filter).toContain('colorbalance=');
    expect(filter).toContain('rs=0.06');
    expect(filter).toContain('eq=contrast=1.03');
  });

  it('returns cool colorbalance for cool temperature', () => {
    const filter = buildColorGradeFilter('cool', 'generic');
    expect(filter).toContain('colorbalance=');
    expect(filter).toContain('bs=0.08');
    expect(filter).toContain('rs=-0.06');
  });

  it('returns empty for neutral temperature with no style match', () => {
    const filter = buildColorGradeFilter('neutral', 'unknown_style');
    expect(filter).toBe('');
  });

  it('returns cinematic style grade', () => {
    const filter = buildColorGradeFilter('neutral', 'cinematic');
    expect(filter).toContain('contrast=1.08');
    expect(filter).toContain('saturation=1.1');
    expect(filter).toContain('colorbalance=');
  });

  it('returns anime style grade', () => {
    const filter = buildColorGradeFilter('neutral', 'anime');
    expect(filter).toContain('saturation=1.25');
  });

  it('returns watercolor style grade', () => {
    const filter = buildColorGradeFilter('neutral', 'watercolor');
    expect(filter).toContain('saturation=0.85');
    expect(filter).toContain('contrast=0.92');
  });

  it('returns documentary style grade', () => {
    const filter = buildColorGradeFilter('neutral', 'documentary');
    expect(filter).toContain('saturation=0.9');
  });

  it('merges warm temperature with cinematic style', () => {
    const filter = buildColorGradeFilter('warm', 'cinematic');
    // warm colorbalance + cinematic highlight colorbalance + cinematic eq
    expect(filter).toContain('rs=0.06');
    expect(filter).toContain('contrast=1.08');
  });

  it('handles case-insensitive style matching', () => {
    const filter = buildColorGradeFilter('neutral', 'Cinematic Drama');
    expect(filter).toContain('contrast=1.08');
  });

  it('returns flat style grade', () => {
    const filter = buildColorGradeFilter('neutral', 'flat');
    expect(filter).toContain('contrast=0.95');
    expect(filter).toContain('saturation=1.15');
  });

  it('returns realistic style grade', () => {
    const filter = buildColorGradeFilter('neutral', 'realistic');
    expect(filter).toContain('contrast=1.02');
  });
});

describe('hasColorGrading', () => {
  it('returns true for warm temperature', () => {
    expect(hasColorGrading('warm', 'generic')).toBe(true);
  });

  it('returns true for neutral + cinematic', () => {
    expect(hasColorGrading('neutral', 'cinematic')).toBe(true);
  });

  it('returns false for neutral + unknown', () => {
    expect(hasColorGrading('neutral', 'unknown')).toBe(false);
  });
});
