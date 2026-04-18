import { describe, it, expect } from 'vitest';
import { extractJSON, extractAndValidateJSON, isTruncated, mergeContinuation } from './responseParser.js';
import { SAFETY_CHECK_SCHEMA, STORYBOARD_SCHEMA } from './schemaValidator.js';

describe('extractJSON', () => {
  it('extracts JSON from fenced code block', () => {
    const text = 'Here is the result:\n```json\n{"name":"test","value":42}\n```\nDone.';
    const result = extractJSON(text);
    expect(result).toEqual({ name: 'test', value: 42 });
  });

  it('extracts JSON from code block without language tag', () => {
    const text = '```\n{"key":"value"}\n```';
    const result = extractJSON(text);
    expect(result).toEqual({ key: 'value' });
  });

  it('extracts raw JSON object', () => {
    const text = 'Some text before {"result":true,"count":5} and after';
    const result = extractJSON(text);
    expect(result).toEqual({ result: true, count: 5 });
  });

  it('extracts JSON array via bracket matching', () => {
    const text = 'Here is the list: [1, 2, 3]';
    const result = extractJSON(text);
    expect(result).toEqual([1, 2, 3]);
  });

  it('returns null for empty text', () => {
    expect(extractJSON('')).toBeNull();
  });

  it('returns null for text with no JSON', () => {
    expect(extractJSON('This is just plain text with no JSON at all.')).toBeNull();
  });

  it('handles trailing commas in JSON', () => {
    const text = '{"a":1,"b":2,}';
    const result = extractJSON(text);
    expect(result).toEqual({ a: 1, b: 2 });
  });

  it('handles nested JSON objects', () => {
    const text = '{"outer":{"inner":"value"},"list":[1,2]}';
    const result = extractJSON(text);
    expect(result).toEqual({ outer: { inner: 'value' }, list: [1, 2] });
  });

  it('prefers fenced block over raw JSON', () => {
    const text = 'prefix {"bad":true} ```json\n{"good":true}\n``` suffix {"also_bad":true}';
    const result = extractJSON(text);
    expect(result).toEqual({ good: true });
  });

  it('falls through to raw JSON when fenced block has invalid JSON', () => {
    const text = '```json\nnot valid json\n```\n{"fallback":true}';
    const result = extractJSON(text);
    expect(result).toEqual({ fallback: true });
  });
});

describe('isTruncated', () => {
  it('returns false for empty string', () => {
    expect(isTruncated('')).toBe(false);
  });

  it('returns false for complete JSON', () => {
    expect(isTruncated('{"complete":true}')).toBe(false);
  });

  it('returns true for unbalanced braces', () => {
    expect(isTruncated('{"key":"value"')).toBe(true);
  });

  it('returns true for unbalanced brackets', () => {
    expect(isTruncated('[1, 2, 3')).toBe(true);
  });

  it('returns true for text ending with comma', () => {
    expect(isTruncated('item1, item2,')).toBe(true);
  });

  it('returns true for text ending with colon', () => {
    expect(isTruncated('"key":')).toBe(true);
  });

  it('returns true for text ending with ellipsis', () => {
    expect(isTruncated('The story continues...')).toBe(true);
  });

  it('returns false for complete sentence', () => {
    expect(isTruncated('This is a complete sentence.')).toBe(false);
  });

  it('returns false for balanced nested JSON', () => {
    expect(isTruncated('{"a":{"b":[1,2,3]}}')).toBe(false);
  });
});

describe('mergeContinuation', () => {
  it('returns original when continuation is empty', () => {
    expect(mergeContinuation('original', '')).toBe('original');
  });

  it('concatenates when no overlap found', () => {
    expect(mergeContinuation('Hello', ' World')).toBe('Hello World');
  });

  it('merges with overlap detection', () => {
    const original = 'The quick brown fox jumps over';
    const continuation = 'fox jumps over the lazy dog';
    const result = mergeContinuation(original, continuation);
    expect(result).toBe('The quick brown fox jumps over the lazy dog');
  });

  it('handles exact overlap at end', () => {
    const original = 'Start of text middle of text';
    const continuation = 'middle of text end of text';
    const result = mergeContinuation(original, continuation);
    expect(result).toBe('Start of text middle of text end of text');
  });

  it('concatenates when overlap is too short (< 10 chars)', () => {
    const original = 'Hello World';
    const continuation = 'ld Extra';
    // Overlap "ld" is only 2 chars, below the 10-char threshold
    const result = mergeContinuation(original, continuation);
    expect(result).toBe('Hello Worldld Extra');
  });
});

/* ------------------------------------------------------------------ */
/*  extractAndValidateJSON integration tests                          */
/* ------------------------------------------------------------------ */

describe('extractAndValidateJSON', () => {
  it('extracts and validates JSON with schema', () => {
    const text = '```json\n{"safe": true, "reason": "looks good"}\n```';
    const result = extractAndValidateJSON<{ safe: boolean; reason: string }>(
      text,
      SAFETY_CHECK_SCHEMA,
      'test',
    );
    expect(result).toEqual({ safe: true, reason: 'looks good' });
  });

  it('repairs missing optional fields via schema defaults', () => {
    const text = '{"safe": false}';
    const result = extractAndValidateJSON<any>(text, SAFETY_CHECK_SCHEMA, 'test');
    expect(result).not.toBeNull();
    expect(result!.safe).toBe(false);
    expect(result!.reason).toBe(''); // default
  });

  it('returns null when no JSON found in text', () => {
    const result = extractAndValidateJSON<any>(
      'no json here',
      SAFETY_CHECK_SCHEMA,
      'test',
    );
    expect(result).toBeNull();
  });

  it('coerces types and still returns data', () => {
    // safe is string "true" instead of boolean → should be coerced
    const text = '{"safe": "true"}';
    const result = extractAndValidateJSON<any>(text, SAFETY_CHECK_SCHEMA, 'test');
    expect(result).not.toBeNull();
    expect(result!.safe).toBe(true);
  });

  it('validates nested storyboard scenes', () => {
    const text = JSON.stringify({
      scenes: [
        { visualPrompt: 'Earth from space', productionSpecs: { camera: 'wide' } },
        { visualPrompt: 'Sun close-up' },
      ],
    });
    const result = extractAndValidateJSON<any>(text, STORYBOARD_SCHEMA, 'test');
    expect(result).not.toBeNull();
    expect(result!.scenes).toHaveLength(2);
    // Second scene should have default empty productionSpecs
    expect(result!.scenes[1].productionSpecs).toEqual({});
  });
});
