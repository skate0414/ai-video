import { describe, it, expect } from 'vitest';
import { sanitizeTranscriptForStyle, detectContentContamination } from './sanitize.js';

describe('sanitizeTranscriptForStyle', () => {
  it('returns empty for falsy input', () => {
    expect(sanitizeTranscriptForStyle(undefined)).toEqual({ sanitized: '', replaceMap: {} });
    expect(sanitizeTranscriptForStyle('')).toEqual({ sanitized: '', replaceMap: {} });
  });

  it('masks numbers with <NUM_n> placeholders', () => {
    const { sanitized, replaceMap } = sanitizeTranscriptForStyle('月入5万元');
    expect(sanitized).not.toContain('5万');
    expect(sanitized).toContain('<NUM_');
    expect(Object.values(replaceMap)).toContain('5万');
  });

  it('masks multiple numbers in order', () => {
    const { sanitized } = sanitizeTranscriptForStyle('他减了30kg，跑了10次');
    const nums = sanitized.match(/<NUM_\d+>/g) ?? [];
    expect(nums.length).toBe(2);
  });

  it('masks domain-specific entities from built-in list', () => {
    const { sanitized, replaceMap } = sanitizeTranscriptForStyle('心脏通过血液供氧到大脑');
    expect(sanitized).not.toContain('心脏');
    expect(sanitized).not.toContain('血液');
    expect(sanitized).not.toContain('大脑');
    expect(Object.values(replaceMap)).toEqual(expect.arrayContaining(['心脏', '血液', '大脑']));
  });

  it('masks extra blacklisted words', () => {
    const { sanitized } = sanitizeTranscriptForStyle('今天的主题是苹果', ['苹果']);
    expect(sanitized).not.toContain('苹果');
    expect(sanitized).toContain('<MASK_');
  });

  it('preserves hookText prefix intact', () => {
    const hook = '你知道吗？';
    const text = '你知道吗？心脏每天跳10万次';
    const { sanitized } = sanitizeTranscriptForStyle(text, [], hook);
    expect(sanitized).toMatch(/^你知道吗？/);
    // But the body should be masked
    expect(sanitized).not.toContain('心脏');
  });

  it('handles hookText not found gracefully', () => {
    const { sanitized } = sanitizeTranscriptForStyle('hello world', [], '不存在');
    // Should still proceed without error
    expect(sanitized).toBeTruthy();
  });
});

describe('detectContentContamination', () => {
  it('returns empty for falsy / empty inputs', () => {
    expect(detectContentContamination('', ['foo'])).toEqual([]);
    expect(detectContentContamination('hello', [])).toEqual([]);
    expect(detectContentContamination('', [])).toEqual([]);
  });

  it('detects leaked entities (case-insensitive)', () => {
    const found = detectContentContamination(
      'The Brain controls the body through Blood flow',
      ['brain', 'blood', 'unknown'],
    );
    expect(found).toContain('brain');
    expect(found).toContain('blood');
    expect(found).not.toContain('unknown');
  });

  it('skips short numeric entities to avoid false positives', () => {
    // Short numbers (<4 digits) are skipped
    const found = detectContentContamination('The value is 42 and 12345', ['42', '12345']);
    expect(found).not.toContain('42');
    expect(found).toContain('12345');
  });

  it('deduplicates results', () => {
    const found = detectContentContamination('brain brain brain', ['brain', 'brain']);
    expect(found).toEqual(['brain']);
  });

  it('filters out falsy entities', () => {
    const found = detectContentContamination('hello', [null as any, '', undefined as any]);
    expect(found).toEqual([]);
  });
});
