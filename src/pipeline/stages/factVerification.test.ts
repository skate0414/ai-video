import { describe, it, expect } from 'vitest';
import { runFactVerification } from './factVerification.js';
import type { AIAdapter } from '../types.js';

function makeAdapter(responseText: string): AIAdapter {
  return {
    provider: 'mock',
    async generateText() {
      return { text: responseText };
    },
    async generateImage() {
      throw new Error('not used');
    },
    async generateVideo() {
      throw new Error('not used');
    },
  };
}

describe('runFactVerification', () => {
  it('adds replacement suggestion for disputed facts', async () => {
    const adapter = makeAdapter(JSON.stringify({
      verifications: [
        {
          factId: 'fact-1',
          verdict: 'disputed',
          confidence: 0.2,
          correction: '受精成功概率通常以区间表述，避免固定绝对数字。',
          reason: '原说法过度简化',
        },
      ],
    }));

    const out = await runFactVerification(adapter, {
      topic: '测试主题',
      researchData: {
        facts: [
          {
            id: 'fact-1',
            content: '出生概率为 400 万亿分之一',
            aggConfidence: 0.9,
            sources: [{ url: 'https://example.com/source' }],
          },
        ],
      },
    });

    expect(out.verifiedFacts[0].type).toBe('disputed');
    expect(out.flaggedFacts).toHaveLength(1);
    expect(out.flaggedFacts[0].suggestedReplacement).toContain('区间');
    expect(out.flaggedFacts[0].sourceHint).toBe('https://example.com/source');
  });

  it('flags unverifiable facts with fallback suggestion', async () => {
    const adapter = makeAdapter(JSON.stringify({
      verifications: [
        {
          factId: 'fact-2',
          verdict: 'unverifiable',
          confidence: 0.3,
          reason: '缺少权威来源支撑',
        },
      ],
    }));

    const out = await runFactVerification(adapter, {
      topic: '测试主题',
      researchData: {
        facts: [
          {
            id: 'fact-2',
            content: '某惊人数值',
            aggConfidence: 0.8,
            sources: [{ url: 'https://example.com/weak' }],
          },
        ],
      },
    });

    expect(out.verifiedFacts[0].type).toBe('unverified');
    expect(out.flaggedFacts).toHaveLength(1);
    expect(out.flaggedFacts[0].suggestedReplacement).toContain('primary-source');
  });
});
