/* ------------------------------------------------------------------ */
/*  SchemaValidator – runtime type-checking for backend responses     */
/*  Zero-dependency alternative to zod/joi for validating JSON output  */
/*  from compiler backends. Includes auto-repair for non-critical     */
/*  field omissions.                                                  */
/* ------------------------------------------------------------------ */

export type FieldType = 'string' | 'number' | 'boolean' | 'array' | 'object';

export interface FieldRule {
  type: FieldType;
  required?: boolean;
  /** Default value applied when field is missing AND required is false. */
  default?: unknown;
  /** Nested rules for object fields. */
  fields?: Record<string, FieldRule>;
  /** Rule applied to each array item. */
  items?: FieldRule;
  /** Custom validator — return error string or null if valid. */
  validate?: (value: unknown) => string | null;
}

export interface Schema {
  fields: Record<string, FieldRule>;
}

export interface ValidationResult<T = unknown> {
  valid: boolean;
  data: T;
  errors: string[];
  /** Fields that were auto-repaired with defaults. */
  repaired: string[];
}

/**
 * Validate and repair an object against a schema.
 * - Missing required fields → error
 * - Missing optional fields → filled with default if provided
 * - Wrong type → attempt coercion, error if impossible
 */
export function validateSchema<T>(data: unknown, schema: Schema, path = ''): ValidationResult<T> {
  const errors: string[] = [];
  const repaired: string[] = [];

  if (data === null || data === undefined || typeof data !== 'object' || Array.isArray(data)) {
    return { valid: false, data: data as T, errors: [`${path || 'root'}: expected object, got ${typeof data}`], repaired };
  }

  const obj: Record<string, unknown> = { ...(data as Record<string, unknown>) };

  for (const [key, rule] of Object.entries(schema.fields)) {
    const fieldPath = path ? `${path}.${key}` : key;
    let value = obj[key];

    // Missing field
    if (value === undefined || value === null) {
      if (rule.required) {
        errors.push(`${fieldPath}: required field is missing`);
        continue;
      }
      if (rule.default !== undefined) {
        obj[key] = structuredClone(rule.default);
        repaired.push(fieldPath);
      }
      continue;
    }

    // Type check & coercion
    const coerced = coerceType(value, rule.type, fieldPath);
    if (coerced.error) {
      errors.push(coerced.error);
    } else {
      value = coerced.value;
      obj[key] = value;
      if (coerced.coerced) repaired.push(fieldPath);
    }

    // Nested object validation
    if (rule.type === 'object' && rule.fields && typeof value === 'object' && value !== null && !Array.isArray(value)) {
      const nested = validateSchema<unknown>(value, { fields: rule.fields }, fieldPath);
      errors.push(...nested.errors);
      repaired.push(...nested.repaired);
      obj[key] = nested.data;
    }

    // Array item validation
    if (rule.type === 'array' && rule.items && Array.isArray(value)) {
      const items = value as unknown[];
      for (let i = 0; i < items.length; i++) {
        const itemPath = `${fieldPath}[${i}]`;
        if (rule.items.type === 'object' && rule.items.fields) {
          const nested = validateSchema<unknown>(items[i], { fields: rule.items.fields }, itemPath);
          errors.push(...nested.errors);
          repaired.push(...nested.repaired);
          items[i] = nested.data;
        } else {
          const itemCoerced = coerceType(items[i], rule.items.type, itemPath);
          if (itemCoerced.error) errors.push(itemCoerced.error);
          else items[i] = itemCoerced.value;
        }
      }
    }

    // Custom validation
    if (rule.validate) {
      const err = rule.validate(value);
      if (err) errors.push(`${fieldPath}: ${err}`);
    }
  }

  return { valid: errors.length === 0, data: obj as T, errors, repaired };
}

function coerceType(
  value: unknown,
  expected: FieldType,
  path: string,
): { value: unknown; error?: string; coerced?: boolean } {
  const actual = Array.isArray(value) ? 'array' : typeof value;

  if (actual === expected) return { value };

  // Coercion rules
  if (expected === 'string' && (actual === 'number' || actual === 'boolean')) {
    return { value: String(value), coerced: true };
  }
  if (expected === 'number' && actual === 'string') {
    const n = Number(value);
    if (!isNaN(n)) return { value: n, coerced: true };
  }
  if (expected === 'boolean' && actual === 'string') {
    const s = (value as string).toLowerCase();
    if (s === 'true' || s === '1') return { value: true, coerced: true };
    if (s === 'false' || s === '0') return { value: false, coerced: true };
  }
  if (expected === 'array' && actual === 'object' && value !== null) {
    // Some LLMs wrap single items in an object instead of array
    return { value: [value], coerced: true };
  }

  return { value, error: `${path}: expected ${expected}, got ${actual}` };
}

/* ------------------------------------------------------------------ */
/*  Pre-built schemas for each pipeline stage's expected LLM output   */
/* ------------------------------------------------------------------ */

export const SAFETY_CHECK_SCHEMA = {
  fields: {
    safe: { type: 'boolean', required: true },
    reason: { type: 'string', required: false, default: '' },
  },
} as const satisfies Schema;

export const STYLE_PROFILE_SCHEMA = {
  fields: {
    visualStyle: { type: 'string', required: true },
    pacing: { type: 'string', required: false, default: 'medium' },
    tone: { type: 'string', required: false, default: 'informative' },
    colorPalette: { type: 'array', required: false, default: [], items: { type: 'string' } },
    narrativeStructure: { type: 'array', required: false, default: [], items: { type: 'string' } },
    wordCount: { type: 'number', required: false },
    wordsPerMinute: { type: 'number', required: false },
    emotionalIntensity: { type: 'number', required: false },
    hookType: { type: 'string', required: false },
    callToActionType: { type: 'string', required: false },
  },
} as const satisfies Schema;

export const RESEARCH_DATA_SCHEMA = {
  fields: {
    facts: {
      type: 'array', required: true,
      items: {
        type: 'object',
        fields: {
          id: { type: 'string', required: false, default: '' },
          content: { type: 'string', required: true },
          sources: { type: 'array', required: false, default: [] },
          aggConfidence: { type: 'number', required: false, default: 0.7 },
        },
      },
    },
    myths: { type: 'array', required: false, default: [] },
    glossary: { type: 'array', required: false, default: [] },
  },
} as const satisfies Schema;

export const CALIBRATION_SCHEMA = {
  fields: {
    calibration: {
      type: 'object', required: true,
      fields: {
        reference_total_words: { type: 'number', required: false, default: 300 },
        reference_duration_sec: { type: 'number', required: false, default: 60 },
        target_word_count: { type: 'number', required: false, default: 300 },
      },
    },
    verified_facts: { type: 'array', required: false, default: [] },
  },
} as const satisfies Schema;

export const NARRATIVE_MAP_SCHEMA = {
  fields: {
    // NarrativeMap is an array wrapped in {narrative_map: [...]}
    narrative_map: {
      type: 'array', required: false,
      items: {
        type: 'object',
        fields: {
          sectionTitle: { type: 'string', required: false, default: '' },
          stage_title: { type: 'string', required: false },
          description: { type: 'string', required: false, default: '' },
          estimatedDuration: { type: 'number', required: false, default: 10 },
        },
      },
    },
  },
} as const satisfies Schema;

export const SCRIPT_OUTPUT_SCHEMA = {
  fields: {
    script: { type: 'string', required: false },
    scriptText: { type: 'string', required: false },
    sentence_list: { type: 'array', required: false },
    usedFactIDs: { type: 'array', required: false, default: [] },
    factUsage: { type: 'array', required: false, default: [] },
    totalWordCount: { type: 'number', required: false },
  },
} as const satisfies Schema;

export const QA_REVIEW_SCHEMA = {
  fields: {
    approved: { type: 'boolean', required: false },
    score: { type: 'number', required: false },
    overall_score: { type: 'number', required: false },
    issues: { type: 'array', required: false, default: [] },
    feedback: { type: 'string', required: false, default: '' },
  },
} as const satisfies Schema;

export const STORYBOARD_SCHEMA = {
  fields: {
    scenes: {
      type: 'array', required: true,
      items: {
        type: 'object',
        fields: {
          visualPrompt: { type: 'string', required: false, default: '' },
          productionSpecs: {
            type: 'object', required: false, default: {},
            fields: {
              camera: { type: 'string', required: false, default: '' },
              lighting: { type: 'string', required: false, default: '' },
              sound: { type: 'string', required: false, default: '' },
              notes: { type: 'string', required: false, default: '' },
            },
          },
        },
      },
    },
  },
} as const satisfies Schema;
