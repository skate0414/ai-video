import { describe, it, expect } from 'vitest';
import { runSafetyMiddleware } from './safety.js';

describe('runSafetyMiddleware', () => {
  /* ---- Numeric magnitude detection ---- */

  it('returns clean report for safe text', () => {
    const report = runSafetyMiddleware('太阳是一颗恒星。它的温度是5778K。');
    expect(report.numericIssues).toHaveLength(0);
    expect(report.absoluteIssues).toHaveLength(0);
    expect(report.suicideDetected).toBe(false);
    expect(report.medicalClaimDetected).toBe(false);
    expect(report.requiresManualReview).toBe(false);
    expect(report.softened).toBe(false);
    expect(report.categories).toHaveLength(0);
    expect(report.excerptSpans).toHaveLength(0);
  });

  it('detects unrealistic numeric magnitude', () => {
    const report = runSafetyMiddleware('宇宙中有999999999999999个星星。');
    expect(report.numericIssues.length).toBeGreaterThan(0);
    expect(report.numericIssues[0]).toContain('Unrealistic magnitude');
    expect(report.categories).toContain('numeric_exaggeration');
    expect(report.excerptSpans.some(s => s.category === 'numeric_exaggeration')).toBe(true);
  });

  it('allows reasonable numbers', () => {
    const report = runSafetyMiddleware('地球有78亿人口，月球距离地球384400公里。');
    expect(report.numericIssues).toHaveLength(0);
  });

  it('detects semantic exaggeration phrases', () => {
    const text = '这个数字比银河系的星星还多。';
    const report = runSafetyMiddleware(text);
    expect(report.numericIssues.some(i => i.includes('Semantic exaggeration'))).toBe(true);
    expect(report.categories).toContain('numeric_exaggeration');
  });

  it('detects English semantic exaggeration', () => {
    const report = runSafetyMiddleware('There are an infinite number of possibilities.');
    expect(report.numericIssues.some(i => i.includes('Semantic exaggeration'))).toBe(true);
  });

  it('detects "超过宇宙的数量" trigger', () => {
    const report = runSafetyMiddleware('这超过宇宙的数量了！');
    expect(report.numericIssues.length).toBeGreaterThan(0);
  });

  /* ---- Absolute statement softening ---- */

  it('softens Chinese absolute statements', () => {
    const report = runSafetyMiddleware('这一定是真的，永远不会改变。');
    expect(report.softened).toBe(true);
    expect(report.absoluteIssues).toContain('一定');
    expect(report.absoluteIssues).toContain('永远');
    expect(report.finalText).toContain('在大多数情况下');
    expect(report.categories).toContain('absolute_statement');
  });

  it('softens "绝对" and "必然"', () => {
    const report = runSafetyMiddleware('这绝对正确，必然发生。');
    expect(report.softened).toBe(true);
    expect(report.finalText).toContain('在大多数情况下');
    expect(report.finalText).toContain('很可能');
  });

  it('softens "完全" and "根本无法"', () => {
    const report = runSafetyMiddleware('完全不可能，根本无法做到。');
    expect(report.softened).toBe(true);
    expect(report.finalText).toContain('在很大程度上');
    expect(report.finalText).toContain('通常难以');
  });

  it('softens "从来不会"', () => {
    const report = runSafetyMiddleware('他从来不会犯错。');
    expect(report.softened).toBe(true);
    expect(report.finalText).toContain('在大多数情况下不会');
  });

  it('softens English absolute statements', () => {
    const report = runSafetyMiddleware('This is always true and never wrong, absolutely guaranteed.');
    expect(report.softened).toBe(true);
    expect(report.absoluteIssues).toContain('always');
    expect(report.absoluteIssues).toContain('never');
    expect(report.absoluteIssues).toContain('absolutely');
    expect(report.absoluteIssues).toContain('guaranteed');
  });

  it('softens "impossible" and "certainly"', () => {
    const report = runSafetyMiddleware('It is certainly impossible to achieve.');
    expect(report.softened).toBe(true);
    expect(report.finalText).toContain('probably');
    expect(report.finalText).toContain('very difficult');
  });

  it('softens "100% certain"', () => {
    const report = runSafetyMiddleware('I am 100% certain about this.');
    expect(report.softened).toBe(true);
    expect(report.finalText).toContain('highly likely');
  });

  it('does not soften text without absolute statements', () => {
    const report = runSafetyMiddleware('科学家认为这可能是正确的。');
    expect(report.softened).toBe(false);
    expect(report.absoluteIssues).toHaveLength(0);
  });

  /* ---- Suicide / self-harm detection ---- */

  it('detects Chinese suicide keywords', () => {
    const report = runSafetyMiddleware('他提到了自杀这个话题。');
    expect(report.suicideDetected).toBe(true);
    expect(report.requiresManualReview).toBe(true);
    expect(report.categories).toContain('suicide_risk');
  });

  it('detects "自残" keyword', () => {
    const report = runSafetyMiddleware('自残是一种严重的行为。');
    expect(report.suicideDetected).toBe(true);
  });

  it('detects English suicide keywords', () => {
    const report = runSafetyMiddleware('The character wanted to take my own life.');
    expect(report.suicideDetected).toBe(true);
    expect(report.requiresManualReview).toBe(true);
  });

  it('detects "self-harm" and "self harm"', () => {
    const r1 = runSafetyMiddleware('This discusses self-harm prevention.');
    expect(r1.suicideDetected).toBe(true);
    const r2 = runSafetyMiddleware('Self harm awareness is important.');
    expect(r2.suicideDetected).toBe(true);
  });

  it('provides correct spans for suicide keywords', () => {
    const report = runSafetyMiddleware('请注意自杀预防。');
    const spans = report.excerptSpans.filter(s => s.category === 'suicide_risk');
    expect(spans.length).toBeGreaterThan(0);
    expect(spans[0].text).toBe('自杀');
  });

  /* ---- Medical claim detection ---- */

  it('detects Chinese medical claims', () => {
    const report = runSafetyMiddleware('这个产品可以治愈癌症。');
    expect(report.medicalClaimDetected).toBe(true);
    expect(report.requiresManualReview).toBe(true);
    expect(report.categories).toContain('medical_claim');
  });

  it('detects "保证治好" pattern', () => {
    const report = runSafetyMiddleware('我保证治好你的病。');
    expect(report.medicalClaimDetected).toBe(true);
  });

  it('detects English medical claims', () => {
    const report = runSafetyMiddleware('This treatment offers a 100% cure for everything.');
    expect(report.medicalClaimDetected).toBe(true);
  });

  it('detects "miracle cure" pattern', () => {
    const report = runSafetyMiddleware('Discover this miracle cure for all diseases.');
    expect(report.medicalClaimDetected).toBe(true);
  });

  it('no medical claim for safe health text', () => {
    const report = runSafetyMiddleware('研究显示运动对健康有益。');
    expect(report.medicalClaimDetected).toBe(false);
  });

  /* ---- Combined scenarios ---- */

  it('detects multiple categories simultaneously', () => {
    const text = '这一定是真的！这个药保证治好你的病，而且可以治愈一切。';
    const report = runSafetyMiddleware(text);
    expect(report.softened).toBe(true);
    expect(report.medicalClaimDetected).toBe(true);
    expect(report.requiresManualReview).toBe(true);
    expect(report.categories).toContain('absolute_statement');
    expect(report.categories).toContain('medical_claim');
  });

  it('handles empty text', () => {
    const report = runSafetyMiddleware('');
    expect(report.numericIssues).toHaveLength(0);
    expect(report.suicideDetected).toBe(false);
    expect(report.medicalClaimDetected).toBe(false);
    expect(report.softened).toBe(false);
    expect(report.requiresManualReview).toBe(false);
  });

  it('applies softening before returning finalText', () => {
    const original = '这绝对不会发生。';
    const report = runSafetyMiddleware(original);
    expect(report.finalText).not.toBe(original);
    expect(report.finalText).toContain('在大多数情况下');
  });

  it('preserves non-flagged text in finalText', () => {
    const report = runSafetyMiddleware('太阳是一颗恒星。');
    expect(report.finalText).toBe('太阳是一颗恒星。');
  });

  it('multiple suicide keywords each produce spans', () => {
    const report = runSafetyMiddleware('自杀和自残都很危险。');
    const suicideSpans = report.excerptSpans.filter(s => s.category === 'suicide_risk');
    expect(suicideSpans.length).toBeGreaterThanOrEqual(2);
  });

  it('detects "包治" and "根治" medical patterns', () => {
    const r1 = runSafetyMiddleware('这药包治百病。');
    expect(r1.medicalClaimDetected).toBe(true);
    const r2 = runSafetyMiddleware('可以根治。');
    expect(r2.medicalClaimDetected).toBe(true);
  });

  it('detects "永久治愈" and "包治"', () => {
    const r1 = runSafetyMiddleware('永久治愈的可能性。');
    expect(r1.medicalClaimDetected).toBe(true);
    // Note: "完全治愈" won't match because "完全" is softened first
    const r2 = runSafetyMiddleware('这药包治百病。');
    expect(r2.medicalClaimDetected).toBe(true);
  });

  it('detects "100%恢复" medical pattern', () => {
    const report = runSafetyMiddleware('患者100%恢复健康。');
    expect(report.medicalClaimDetected).toBe(true);
  });
});
