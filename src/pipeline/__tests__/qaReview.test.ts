import { describe, it, expect, vi } from 'vitest';
import { QaReviewParseError, runQaReview, type QaReviewInput, type QaReviewOutput } from '../stages/qaReview.js';
import type { AIAdapter, LogEntry } from '../types.js';
import type { StyleAnalysisCIR } from '../../cir/types.js';

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
  styleCIR: {
    _cir: 'StyleAnalysis',
    version: 1,
    visualStyle: '3D animation',
    tone: 'informative',
    pacing: 'medium',
    colorPalette: ['#FFD700'],
    meta: { videoDurationSec: 60, videoLanguage: 'Chinese', videoType: 'science' },
    scriptTrack: {
      hookStrategy: '', sentenceLengthMax: 30, sentenceLengthAvg: 15,
      sentenceLengthUnit: 'characters', narrativeArc: [],
      emotionalToneArc: '', rhetoricalCore: '', metaphorCount: 0,
      interactionCuesCount: 0, ctaPattern: '', jargonTreatment: '',
    },
    visualTrack: {
      baseMedium: 'stock_footage', lightingStyle: '', cameraMotion: '',
      colorTemperature: '', sceneAvgDurationSec: 5, transitionStyle: '',
      visualMetaphorMapping: { rule: '', examples: [] }, bRollRatio: 0, compositionStyle: '',
    },
    audioTrack: { bgmGenre: '', bgmMood: '', bgmTempo: '', bgmRelativeVolume: 0, voiceStyle: '' },
    packagingTrack: {
      subtitlePosition: 'bottom', subtitleHasShadow: true, subtitleHasBackdrop: false,
      subtitleFontSize: 'medium', subtitlePrimaryColor: '#FFFFFF', subtitleOutlineColor: '#000000',
      subtitleFontCategory: 'sans-serif', transitionDominantStyle: 'cut',
      transitionEstimatedDurationSec: 0.5, hasIntroCard: false, introCardDurationSec: 0,
      hasFadeIn: false, fadeInDurationSec: 0, hasOutroCard: false, outroCardDurationSec: 0,
      hasFadeOut: false, fadeOutDurationSec: 0,
    },
    computed: { wordCount: 300, wordsPerMinute: 300, fullTranscript: '' },
    confidence: {},
    contractScore: 85,
  } as StyleAnalysisCIR,
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

  it('fails closed when AI response is not parseable', async () => {
    const adapter = makeMockAdapter('This is not valid JSON at all.');

    const logs: LogEntry[] = [];
    await expect(runQaReview(adapter, baseInput, (e) => logs.push(e))).rejects.toBeInstanceOf(QaReviewParseError);
    const warningLog = logs.find(l => l.type === 'warning');
    expect(warningLog).toBeDefined();
  });

  it('infers approved from overall_score >= 8', async () => {
    const adapter = makeMockAdapter(JSON.stringify({
      overall_score: 8,
      summary: 'Good script.',
    }));

    const result = await runQaReview(adapter, baseInput);
    expect(result.approved).toBe(true);
  });

  it('infers not approved from overall_score < 8', async () => {
    const adapter = makeMockAdapter(JSON.stringify({
      overall_score: 5,
      summary: 'Needs work.',
    }));

    const result = await runQaReview(adapter, baseInput);
    expect(result.approved).toBe(false);
  });

  /* ---- B2: Score outlier detection ---- */

  it('B2: overrides approval when a sub-score < 5 but overall >= 8', async () => {
    const adapter = makeMockAdapter(JSON.stringify({
      approved: true,
      feedback: 'Looks good overall.',
      scores: { accuracy: 3, styleConsistency: 9, productionReadiness: 9, engagement: 9, overall: 9 },
      issues: [],
    }));

    const logs: LogEntry[] = [];
    const result = await runQaReview(adapter, baseInput, (e) => logs.push(e));

    expect(result.approved).toBe(false);
    expect(result.issues?.some(i => i.includes('Score outlier detected'))).toBe(true);
  });

  it('B2: does not override when all sub-scores >= 5', async () => {
    const adapter = makeMockAdapter(JSON.stringify({
      approved: true,
      feedback: 'All good.',
      scores: { accuracy: 8, styleConsistency: 8, productionReadiness: 7, engagement: 8, overall: 8 },
      issues: [],
    }));

    const result = await runQaReview(adapter, baseInput);
    expect(result.approved).toBe(true);
  });

  it('B2: adds spread warning when sub-score range > 4', async () => {
    const adapter = makeMockAdapter(JSON.stringify({
      approved: false,
      feedback: 'Mixed quality.',
      scores: { accuracy: 3, styleConsistency: 8, productionReadiness: 7, engagement: 6, overall: 5 },
      issues: [],
    }));

    const logs: LogEntry[] = [];
    const result = await runQaReview(adapter, baseInput, (e) => logs.push(e));

    expect(result.issues?.some(i => i.includes('Score spread warning'))).toBe(true);
  });

  it('B2: overrides LLM rejection when all scores indicate high quality', async () => {
    const adapter = makeMockAdapter(JSON.stringify({
      approved: false,
      feedback: 'High quality script overall.',
      scores: { accuracy: 9, styleConsistency: 9, productionReadiness: 9, engagement: 10, overall: 9.4 },
      issues: [],
    }));

    const logs: LogEntry[] = [];
    const result = await runQaReview(adapter, baseInput, (e) => logs.push(e));

    expect(result.approved).toBe(true);
    expect(result.issues?.some(i => i.includes('Score-based approval override'))).toBe(true);
  });

  it('B2: does not override LLM rejection when a sub-score < 5', async () => {
    const adapter = makeMockAdapter(JSON.stringify({
      approved: false,
      feedback: 'Accuracy needs work.',
      scores: { accuracy: 4, styleConsistency: 9, productionReadiness: 9, engagement: 9, overall: 8 },
      issues: [],
    }));

    const result = await runQaReview(adapter, baseInput);
    expect(result.approved).toBe(false);
  });
});
