/* ------------------------------------------------------------------ */
/*  Tests for SchemaValidator                                         */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import {
  validateSchema,
  SAFETY_CHECK_SCHEMA,
  STYLE_PROFILE_SCHEMA,
  RESEARCH_DATA_SCHEMA,
  CALIBRATION_SCHEMA,
  STORYBOARD_SCHEMA,
  QA_REVIEW_SCHEMA,
  SCRIPT_OUTPUT_SCHEMA,
  NARRATIVE_MAP_SCHEMA,
  type Schema,
} from './schemaValidator.js';

describe('validateSchema', () => {
  /* ---- Basic validation ---- */

  it('validates a fully conforming object', () => {
    const schema: Schema = {
      fields: {
        name: { type: 'string', required: true },
        age: { type: 'number', required: true },
      },
    };
    const result = validateSchema({ name: 'Alice', age: 30 }, schema);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
    expect(result.data).toEqual({ name: 'Alice', age: 30 });
  });

  it('reports missing required fields', () => {
    const schema: Schema = {
      fields: { name: { type: 'string', required: true } },
    };
    const result = validateSchema({}, schema);
    expect(result.valid).toBe(false);
    expect(result.errors[0]).toContain('required');
  });

  it('fills default for missing optional fields', () => {
    const schema: Schema = {
      fields: { color: { type: 'string', required: false, default: 'blue' } },
    };
    const result = validateSchema({}, schema);
    expect(result.valid).toBe(true);
    expect((result.data as any).color).toBe('blue');
    expect(result.repaired).toContain('color');
  });

  it('returns error for non-object input', () => {
    const schema: Schema = { fields: { x: { type: 'number', required: true } } };
    expect(validateSchema('hello', schema).valid).toBe(false);
    expect(validateSchema(null, schema).valid).toBe(false);
    expect(validateSchema(42, schema).valid).toBe(false);
  });

  /* ---- Type coercion ---- */

  it('coerces string "42" to number 42', () => {
    const schema: Schema = { fields: { n: { type: 'number', required: true } } };
    const result = validateSchema({ n: '42' }, schema);
    expect(result.valid).toBe(true);
    expect((result.data as any).n).toBe(42);
    expect(result.repaired).toContain('n');
  });

  it('coerces number 42 to string "42"', () => {
    const schema: Schema = { fields: { s: { type: 'string', required: true } } };
    const result = validateSchema({ s: 42 }, schema);
    expect(result.valid).toBe(true);
    expect((result.data as any).s).toBe('42');
  });

  it('coerces "true" to boolean true', () => {
    const schema: Schema = { fields: { b: { type: 'boolean', required: true } } };
    const result = validateSchema({ b: 'true' }, schema);
    expect(result.valid).toBe(true);
    expect((result.data as any).b).toBe(true);
  });

  it('errors on un-coercible types', () => {
    const schema: Schema = { fields: { n: { type: 'number', required: true } } };
    const result = validateSchema({ n: 'not-a-number' }, schema);
    expect(result.valid).toBe(false);
  });

  /* ---- Nested objects ---- */

  it('validates nested objects', () => {
    const schema: Schema = {
      fields: {
        calibration: {
          type: 'object',
          required: true,
          fields: {
            target_word_count: { type: 'number', required: false, default: 300 },
          },
        },
      },
    };
    const result = validateSchema({ calibration: {} }, schema);
    expect(result.valid).toBe(true);
    expect((result.data as any).calibration.target_word_count).toBe(300);
  });

  /* ---- Array validation ---- */

  it('validates array items', () => {
    const schema: Schema = {
      fields: {
        tags: {
          type: 'array',
          required: true,
          items: { type: 'string' },
        },
      },
    };
    const result = validateSchema({ tags: ['a', 'b'] }, schema);
    expect(result.valid).toBe(true);
  });

  it('coerces a single object to an array', () => {
    const schema: Schema = {
      fields: {
        items: { type: 'array', required: true, items: { type: 'object' } },
      },
    };
    const result = validateSchema({ items: { id: 1 } }, schema);
    expect(result.valid).toBe(true);
    expect(Array.isArray((result.data as any).items)).toBe(true);
  });

  /* ---- Custom validation ---- */

  it('runs custom validator', () => {
    const schema: Schema = {
      fields: {
        score: {
          type: 'number',
          required: true,
          validate: (v) => (v as number) > 10 ? 'score must be <= 10' : null,
        },
      },
    };
    const ok = validateSchema({ score: 5 }, schema);
    expect(ok.valid).toBe(true);
    const bad = validateSchema({ score: 15 }, schema);
    expect(bad.valid).toBe(false);
    expect(bad.errors[0]).toContain('score must be <= 10');
  });
});

/* ---- Pipeline-specific schema tests ---- */

describe('Pipeline schemas', () => {
  it('SAFETY_CHECK_SCHEMA validates typical LLM safety response', () => {
    const r = validateSchema({ safe: true, reason: 'No issues' }, SAFETY_CHECK_SCHEMA);
    expect(r.valid).toBe(true);
  });

  it('SAFETY_CHECK_SCHEMA repairs missing optional reason', () => {
    const r = validateSchema({ safe: false }, SAFETY_CHECK_SCHEMA);
    expect(r.valid).toBe(true);
    expect((r.data as any).reason).toBe('');
    expect(r.repaired).toContain('reason');
  });

  it('SAFETY_CHECK_SCHEMA errors on missing safe field', () => {
    const r = validateSchema({}, SAFETY_CHECK_SCHEMA);
    expect(r.valid).toBe(false);
  });

  it('STYLE_PROFILE_SCHEMA validates and repairs partial data', () => {
    const r = validateSchema({ visualStyle: 'cinematic' }, STYLE_PROFILE_SCHEMA);
    expect(r.valid).toBe(true);
    expect((r.data as any).pacing).toBe('medium');
    expect((r.data as any).colorPalette).toEqual([]);
  });

  it('RESEARCH_DATA_SCHEMA validates research with facts array', () => {
    const r = validateSchema(
      { facts: [{ content: 'Earth is round', sources: [] }] },
      RESEARCH_DATA_SCHEMA,
    );
    expect(r.valid).toBe(true);
    expect((r.data as any).facts[0].content).toBe('Earth is round');
    expect((r.data as any).myths).toEqual([]);
  });

  it('CALIBRATION_SCHEMA fills defaults for empty calibration object', () => {
    const r = validateSchema({ calibration: {} }, CALIBRATION_SCHEMA);
    expect(r.valid).toBe(true);
    expect((r.data as any).calibration.target_word_count).toBe(300);
    expect((r.data as any).verified_facts).toEqual([]);
  });

  it('STORYBOARD_SCHEMA validates scenes array', () => {
    const r = validateSchema(
      { scenes: [{ narrative: 'Open shot', visualPrompt: 'space zoom', estimatedDuration: 5 }] },
      STORYBOARD_SCHEMA,
    );
    expect(r.valid).toBe(true);
  });

  it('STORYBOARD_SCHEMA errors when scenes is missing', () => {
    const r = validateSchema({}, STORYBOARD_SCHEMA);
    expect(r.valid).toBe(false);
  });

  it('QA_REVIEW_SCHEMA validates review data with defaults', () => {
    const r = validateSchema({ approved: true, score: 8 }, QA_REVIEW_SCHEMA);
    expect(r.valid).toBe(true);
    expect((r.data as any).issues).toEqual([]);
    expect((r.data as any).feedback).toBe('');
  });

  it('SCRIPT_OUTPUT_SCHEMA validates script data', () => {
    const r = validateSchema({ script: 'narration text', totalWordCount: 100 }, SCRIPT_OUTPUT_SCHEMA);
    expect(r.valid).toBe(true);
  });

  it('NARRATIVE_MAP_SCHEMA validates narrative map array', () => {
    const r = validateSchema(
      { narrative_map: [{ stage_title: 'Hook', description: 'opening', estimatedDuration: 10 }] },
      NARRATIVE_MAP_SCHEMA,
    );
    expect(r.valid).toBe(true);
  });
});
