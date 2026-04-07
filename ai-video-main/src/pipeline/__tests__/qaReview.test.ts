import { describe, it, expect, vi } from 'vitest';
import { runQaReview, type QaReviewInput, type QaReviewOutput } from '../stages/qaReview.js';
import type { AIAdapter, LogEntry } from '../types.js';

function makeMockAdapter(responseText: string): AIAdapter {
  return {
    provider: 'mock',
    generateText: vi.fn().mockResolvedValue({ text: responseText }),
    generateImage: vi.fn().mockResolvedValue({ text: '' }),
    generateVideo: vi.fn().mockResolvedValue({ text: '' }),
  };
}

const baseInput: QaReviewInput = {
  scriptOutput: {
    scriptText: '太阳是一颗恒星，提供光和热。',
    usedFactIDs: [],
    factUsage: [],
  },
  topic: '太阳',
  styleProfile: {
    visualStyle: '3D animation',
    tone: 'informative',
    pacing: 'moderate',
    colorPalette: ['#FFD700'],
    narrativeStructure: [],
    keyMoments: [],
  },
};

describe('runQaReview', () => {
  it('parses a passing review from AI response', async () => {
    const adapter = makeMockAdapter(JSON.stringify({
      approved: true,
      feedback: 'Script is accurate and engaging.',
      scores: { accuracy: 9, styleConsistency: 8, engagement: 8, overall: 8 },
      issues: [],
    }));

    const logs: LogEntry[] = [];
    const result = await runQaReview(adapter, baseInput, (e) => logs.push(e));

    expect(result.approved).toBe(true);
    expect(result.scores?.overall).toBe(8);
    expect(result.issues).toEqual([]);
    expect(logs.length).toBeGreaterThanOrEqual(1);
  });

  it('parses a failing review with issues', async () => {
    const adapter = makeMockAdapter(JSON.stringify({
      approved: false,
      feedback: 'Multiple factual errors found.',
      scores: { accuracy: 3, styleConsistency: 7, engagement: 5, overall: 4 },
      issues: ['Incorrect temperature claim', 'Missing citation'],
    }));

    const result = await runQaReview(adapter, baseInput);

    expect(result.approved).toBe(false);
    expect(result.issues).toHaveLength(2);
    expect(result.scores?.accuracy).toBe(3);
  });

  it('auto-approves when AI response is not parseable', async () => {
    const adapter = makeMockAdapter('This is not valid JSON at all.');

    const logs: LogEntry[] = [];
    const result = await runQaReview(adapter, baseInput, (e) => logs.push(e));

    expect(result.approved).toBe(true);
    expect(result.feedback).toContain('Auto-approved');
    const warningLog = logs.find(l => l.type === 'warning');
    expect(warningLog).toBeDefined();
  });

  it('infers approved from overall_score >= 7', async () => {
    const adapter = makeMockAdapter(JSON.stringify({
      overall_score: 8,
      summary: 'Good script.',
    }));

    const result = await runQaReview(adapter, baseInput);
    expect(result.approved).toBe(true);
  });

  it('infers not approved from overall_score < 7', async () => {
    const adapter = makeMockAdapter(JSON.stringify({
      overall_score: 5,
      summary: 'Needs work.',
    }));

    const result = await runQaReview(adapter, baseInput);
    expect(result.approved).toBe(false);
  });
});
