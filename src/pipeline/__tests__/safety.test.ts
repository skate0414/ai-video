import { describe, it, expect } from 'vitest';
import { BodyTooLargeError } from '../../routes/helpers.js';
import { runSafetyMiddleware } from '../safety.js';

/* ================================================================== */
/*  helpers.ts unit tests                                             */
/* ================================================================== */

describe('BodyTooLargeError', () => {
  it('has correct name and message', () => {
    const err = new BodyTooLargeError(1024);
    expect(err.name).toBe('BodyTooLargeError');
    expect(err.message).toContain('1024');
    expect(err).toBeInstanceOf(Error);
  });
});

/* ================================================================== */
/*  safety.ts unit tests                                              */
/* ================================================================== */

describe('runSafetyMiddleware', () => {
  it('reports clean text as safe', () => {
    const report = runSafetyMiddleware('太阳是一颗恒星');
    expect(report.numericIssues).toHaveLength(0);
    expect(report.absoluteIssues).toHaveLength(0);
    expect(report.suicideDetected).toBe(false);
    expect(report.medicalClaimDetected).toBe(false);
    expect(report.requiresManualReview).toBe(false);
    expect(report.categories).toHaveLength(0);
    expect(report.finalText).toBe('太阳是一颗恒星');
  });

  it('softens absolute Chinese statements', () => {
    const report = runSafetyMiddleware('这一定会发生，永远不会改变');
    expect(report.softened).toBe(true);
    expect(report.absoluteIssues.length).toBeGreaterThan(0);
    expect(report.finalText).not.toContain('一定');
    expect(report.finalText).not.toContain('永远');
    expect(report.categories).toContain('absolute_statement');
  });

  it('softens absolute English statements', () => {
    const report = runSafetyMiddleware('This is absolutely guaranteed to work');
    expect(report.softened).toBe(true);
    expect(report.finalText).not.toMatch(/absolutely/i);
    expect(report.finalText).not.toMatch(/guaranteed/i);
  });

  it('detects unrealistic numeric magnitudes', () => {
    const report = runSafetyMiddleware(`The number is ${1e15}`);
    expect(report.numericIssues.length).toBeGreaterThan(0);
    expect(report.categories).toContain('numeric_exaggeration');
  });

  it('passes reasonable numbers', () => {
    const report = runSafetyMiddleware('人体有206块骨头');
    expect(report.numericIssues).toHaveLength(0);
  });

  it('detects suicide keywords (Chinese)', () => {
    const report = runSafetyMiddleware('有人想要自杀');
    expect(report.suicideDetected).toBe(true);
    expect(report.requiresManualReview).toBe(true);
    expect(report.categories).toContain('suicide_risk');
    expect(report.excerptSpans.some((s: { category: string }) => s.category === 'suicide_risk')).toBe(true);
  });

  it('detects suicide keywords (English)', () => {
    const report = runSafetyMiddleware('I want to kill myself');
    expect(report.suicideDetected).toBe(true);
    expect(report.requiresManualReview).toBe(true);
  });

  it('detects medical claim patterns (Chinese)', () => {
    const report = runSafetyMiddleware('这种药可以治愈所有癌症');
    expect(report.medicalClaimDetected).toBe(true);
    expect(report.requiresManualReview).toBe(true);
    expect(report.categories).toContain('medical_claim');
  });

  it('detects medical claim patterns (English)', () => {
    const report = runSafetyMiddleware('A miracle cure for all diseases');
    expect(report.medicalClaimDetected).toBe(true);
  });

  it('handles combined issues', () => {
    const report = runSafetyMiddleware('这一定可以治愈癌症，100% certain');
    expect(report.softened).toBe(true);
    expect(report.medicalClaimDetected).toBe(true);
    expect(report.categories.length).toBeGreaterThanOrEqual(2);
  });

  it('handles empty string', () => {
    const report = runSafetyMiddleware('');
    expect(report.numericIssues).toHaveLength(0);
    expect(report.suicideDetected).toBe(false);
    expect(report.medicalClaimDetected).toBe(false);
    expect(report.finalText).toBe('');
  });

  it('returns correct excerpt spans with positions', () => {
    const text = 'Start 自杀 end';
    const report = runSafetyMiddleware(text);
    const span = report.excerptSpans.find((s: { category: string }) => s.category === 'suicide_risk');
    expect(span).toBeDefined();
    expect(span!.start).toBeGreaterThanOrEqual(0);
    expect(span!.end).toBeGreaterThan(span!.start);
    expect(text.slice(span!.start, span!.end)).toBe('自杀');
  });
});
