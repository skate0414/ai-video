/* ------------------------------------------------------------------ */
/*  Tests: scriptGeneration – two-step skeleton → writing pipeline    */
/* ------------------------------------------------------------------ */
import { describe, it, expect, vi } from 'vitest';
import { generateSkeleton, generateWriting } from '../stages/scriptGeneration.js';
import type { AIAdapter, LogEntry, ScriptSkeleton } from '../types.js';

function makeAdapter(responses: string[]): AIAdapter {
  let callIdx = 0;
  return {
    provider: 'test',
    generateText: vi.fn(async () => ({ text: responses[callIdx++] ?? '' })),
    generateImage: vi.fn(async () => ({ text: '' })),
    generateVideo: vi.fn(async () => ({ text: '' })),
  };
}

const noop = (_entry: LogEntry) => {};

describe('generateSkeleton', () => {
  const baseInput = {
    topic: 'black holes',
    videoLanguage: 'Chinese',
    targetWordCount: 300,
    targetWordCountMin: '270',
    targetWordCountMax: '330',
    targetSentenceCount: 15,
    narrativeArcExpanded: 'Stage 1: Hook\nStage 2: Body\nStage 3: Climax',
    hookStrategy: 'data_anchor',
    sentenceLengthMax: 30,
    metaphorCount: 3,
    minFacts: 3,
    confidenceNotes: '',
  };

  it('parses a valid skeleton response', async () => {
    const skeletonJson = JSON.stringify({
      sentences: [
        { index: 1, stage: 'hook', targetLength: 20, purposeTag: 'data_anchor', hasFact: true, hasMetaphor: false },
        { index: 2, stage: 'hook', targetLength: 18, purposeTag: 'hook', hasFact: false, hasMetaphor: false },
        { index: 3, stage: 'hook', targetLength: 22, purposeTag: 'curiosity_gap', hasFact: false, hasMetaphor: false },
        { index: 4, stage: 'body', targetLength: 25, purposeTag: 'exposition', hasFact: true, hasMetaphor: false },
        { index: 5, stage: 'body', targetLength: 15, purposeTag: 'exposition', hasFact: false, hasMetaphor: true },
      ],
      totalTargetWords: 100,
      hookIndices: [1, 2, 3],
      ctaIndices: [5],
      stageBreakdown: { hook: [1, 2, 3], body: [4, 5] },
    });

    const adapter = makeAdapter([skeletonJson]);
    const result = await generateSkeleton(adapter, baseInput, noop);

    expect(result.sentences).toHaveLength(5);
    expect(result.sentences[0].purposeTag).toBe('data_anchor');
    expect(result.totalTargetWords).toBe(100);
    expect(result.hookIndices).toEqual([1, 2, 3]);
  });

  it('falls back to linear skeleton on parse failure', async () => {
    const adapter = makeAdapter(['not valid json at all']);
    const result = await generateSkeleton(adapter, baseInput, noop);

    expect(result.sentences).toHaveLength(baseInput.targetSentenceCount);
    expect(result.sentences[0].purposeTag).toBe('data_anchor');
    expect(result.totalTargetWords).toBe(baseInput.targetWordCount);
  });

  it('falls back when response is empty object', async () => {
    const adapter = makeAdapter(['{}']);
    const result = await generateSkeleton(adapter, baseInput, noop);

    // extractAndValidateJSON might return null on missing required fields
    expect(result.sentences.length).toBeGreaterThan(0);
  });
});

describe('generateWriting', () => {
  const baseSkeleton: ScriptSkeleton = {
    sentences: [
      { index: 1, stage: 'hook', targetLength: 20, purposeTag: 'data_anchor', hasFact: true, hasMetaphor: false },
      { index: 2, stage: 'hook', targetLength: 18, purposeTag: 'hook', hasFact: false, hasMetaphor: false },
      { index: 3, stage: 'body', targetLength: 25, purposeTag: 'exposition', hasFact: true, hasMetaphor: true },
    ],
    totalTargetWords: 63,
    hookIndices: [1, 2],
    ctaIndices: [3],
    stageBreakdown: { hook: [1, 2], body: [3] },
  };

  const baseInput = {
    topic: 'black holes',
    videoLanguage: 'Chinese',
    skeleton: baseSkeleton,
    targetAudience: 'general audience',
    emotionalToneArc: 'rising → climax → resolution',
    factsListStr: '[Fact 1] Black holes bend light',
    baseMedium: '3D animation',
    transcriptExcerpt: '(no reference)',
    styleGuidance: '## Style Guidance\nRhetorical devices: rhetorical question (HARD)',
    formatSignatureSection: '(No FormatSignature available)',
  };

  it('parses a valid writing response', async () => {
    const writingJson = JSON.stringify({
      script: '这是第一句。\n这是第二句。\n这是第三句。',
      sentence_list: [
        { index: 1, text: '这是第一句。', length: 5, stage: 'hook', has_metaphor: false, visual_note: 'scene 1', factReferences: ['fact-1'] },
        { index: 2, text: '这是第二句。', length: 5, stage: 'hook', has_metaphor: false, visual_note: 'scene 2', factReferences: [] },
        { index: 3, text: '这是第三句。', length: 5, stage: 'body', has_metaphor: true, visual_note: 'scene 3', factReferences: ['fact-1'] },
      ],
      total_length: 15,
      hook_text: '这是第一句。这是第二句。',
      cta_text: '这是第三句。',
      metaphors_identified: ['concept → visual'],
    });

    const adapter = makeAdapter([writingJson]);
    const result = await generateWriting(adapter, baseInput, noop);

    expect(result.script).toContain('这是第一句');
    expect(result.sentence_list).toHaveLength(3);
    expect(result.total_length).toBe(15);
  });

  it('returns fallback on parse failure', async () => {
    const adapter = makeAdapter(['garbled nonsense']);
    const result = await generateWriting(adapter, baseInput, noop);

    // Fallback returns raw text
    expect(result).toHaveProperty('script');
  });

  it('injects validation feedback when provided', async () => {
    const adapter = makeAdapter([JSON.stringify({ script: 'test', sentence_list: [], total_length: 4 })]);
    await generateWriting(adapter, { ...baseInput, validationFeedback: 'Word count too low' }, noop);

    const call = (adapter.generateText as any).mock.calls[0];
    expect(call[1]).toContain('CRITICAL: Word count too low');
  });
});
