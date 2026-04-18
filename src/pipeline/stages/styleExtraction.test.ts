/* ------------------------------------------------------------------ */
/*  Tests: styleExtraction – runStyleExtractionManual                 */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import { runStyleExtractionManual } from './styleExtraction.js';

describe('runStyleExtractionManual', () => {
  const validStyleJSON = JSON.stringify({
    visualStyle: 'cinematic',
    pacing: 'fast',
    tone: 'dramatic',
    colorPalette: ['#FF0000', '#00FF00'],
    narrativeStructure: ['Hook', 'Body', 'CTA'],
  });

  it('parses valid JSON pasted text into a StyleProfile', () => {
    const result = runStyleExtractionManual(validStyleJSON, 'test topic');
    expect(result.styleProfile).toBeDefined();
    expect(result.styleProfile.visualStyle).toBe('cinematic');
    expect(result.styleProfile.pacing).toBe('fast');
    expect(result.styleProfile.tone).toBe('dramatic');
  });

  it('extracts colorPalette and narrativeStructure', () => {
    const result = runStyleExtractionManual(validStyleJSON, 'test');
    expect(result.styleProfile.colorPalette).toEqual(['#FF0000', '#00FF00']);
    expect(result.styleProfile.narrativeStructure).toEqual(['Hook', 'Body', 'CTA']);
  });

  it('applies default values for missing fields', () => {
    const minimal = JSON.stringify({ visualStyle: 'documentary' });
    const result = runStyleExtractionManual(minimal, 'test');
    expect(result.styleProfile.visualStyle).toBe('documentary');
    expect(result.styleProfile.pacing).toBe('medium'); // default
    expect(result.styleProfile.tone).toBe('informative'); // default
  });

  it('handles JSON wrapped in markdown code block', () => {
    const wrapped = '```json\n' + validStyleJSON + '\n```';
    const result = runStyleExtractionManual(wrapped, 'test');
    expect(result.styleProfile.visualStyle).toBe('cinematic');
  });

  it('throws for invalid / non-JSON text', () => {
    expect(() => runStyleExtractionManual('not json at all', 'test')).toThrow();
  });

  it('throws for empty string', () => {
    expect(() => runStyleExtractionManual('', 'test')).toThrow();
  });

  it('preserves optional fields when present', () => {
    const full = JSON.stringify({
      visualStyle: 'cinematic',
      pacing: 'slow',
      tone: 'inspirational',
      hookType: 'question',
      callToActionType: 'subscribe',
      wordCount: 500,
      wordsPerMinute: 150,
      emotionalIntensity: 'high',
      audioStyle: 'dramatic music',
    });
    const result = runStyleExtractionManual(full, 'test');
    expect(result.styleProfile.hookType).toBe('question');
    expect(result.styleProfile.callToActionType).toBe('subscribe');
    expect(result.styleProfile.wordCount).toBe(500);
    expect(result.styleProfile.wordsPerMinute).toBe(150);
  });
});
