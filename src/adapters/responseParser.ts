/* ------------------------------------------------------------------ */
/*  ResponseParser – extracts structured CIR data from backend output */
/* ------------------------------------------------------------------ */

import { Schema, validateSchema, ValidationResult } from './schemaValidator.js';

/**
 * Extract JSON from text and validate against a schema.
 * Returns validated (and possibly auto-repaired) data, or null if
 * extraction or critical validation fails.
 */
export function extractAndValidateJSON<T>(
  text: string,
  schema: Schema,
  label = 'unknown',
): T | null {
  const raw = extractJSON<T>(text);
  if (raw === null) return null;

  const result: ValidationResult<T> = validateSchema<T>(raw, schema, label);

  if (result.repaired.length > 0) {
    console.log(`[responseParser] schema auto-repaired fields for "${label}": ${result.repaired.join(', ')}`);
  }
  if (!result.valid) {
    console.warn(`[responseParser] schema validation errors for "${label}": ${result.errors.join('; ')}`);
  }

  // Return repaired data even when there are non-critical errors –
  // the pipeline stages already have fallback logic.
  return result.data;
}

/**
 * Attempt to extract a JSON object from an AI chat response.
 *
 * Strategies (in order):
 * 1. Detect ```json ... ``` or ``` ... ``` fenced code block
 * 2. Detect raw JSON (first { to last })
 * 3. Return null if no JSON found
 */
export function extractJSON<T = any>(text: string): T | null {
  if (!text) {
    console.warn('[responseParser] extractJSON called with empty text');
    return null;
  }

  // Strategy 1: fenced code block
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      const parsed = JSON.parse(fenceMatch[1].trim()) as T;
      console.log(`[responseParser] extractJSON: matched via fenced code block`);
      return parsed;
    } catch {
      console.log('[responseParser] extractJSON: fenced block found but JSON.parse failed, trying next strategy');
      // fall through to strategy 2
    }
  }

  // Strategy 2: raw JSON — find outermost { ... }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate) as T;
      console.log(`[responseParser] extractJSON: matched via raw JSON braces`);
      return parsed;
    } catch {
      // Try to fix common issues: trailing commas, single quotes
      try {
        const fixed = candidate
          .replace(/,\s*([}\]])/g, '$1')      // remove trailing commas
          .replace(/'/g, '"');                  // single to double quotes
        const parsed = JSON.parse(fixed) as T;
        console.log(`[responseParser] extractJSON: matched via fixed JSON (trailing commas / quotes)`);
        return parsed;
      } catch {
        console.warn(`[responseParser] extractJSON: raw JSON braces found but parse failed. Candidate: ${candidate.slice(0, 200)}`);
      }
    }
  }

  // Strategy 3: try array [ ... ]
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = text.slice(firstBracket, lastBracket + 1);
    try {
      const parsed = JSON.parse(candidate) as T;
      console.log(`[responseParser] extractJSON: matched via array brackets`);
      return parsed;
    } catch {
      console.warn(`[responseParser] extractJSON: array brackets found but parse failed`);
    }
  }

  console.warn(`[responseParser] extractJSON: no JSON found in text (${text.length} chars): ${text.slice(0, 150)}`);
  return null;
}

/**
 * Check if a response appears truncated (cut off mid-sentence/JSON).
 * Useful for deciding whether to send a "continue" follow-up.
 */
export function isTruncated(text: string): boolean {
  if (!text) return false;
  const trimmed = text.trimEnd();

  // JSON truncation: unbalanced braces/brackets
  const opens = (trimmed.match(/{/g) || []).length;
  const closes = (trimmed.match(/}/g) || []).length;
  if (opens > closes) return true;

  const openBrackets = (trimmed.match(/\[/g) || []).length;
  const closeBrackets = (trimmed.match(/]/g) || []).length;
  if (openBrackets > closeBrackets) return true;

  // Sentence truncation: ends with incomplete patterns
  if (/[,:]\s*$/.test(trimmed)) return true;
  if (/\.\.\.\s*$/.test(trimmed)) return true;

  return false;
}

/**
 * Merge a "continuation" response with the original.
 * The continuation may repeat some overlap text.
 */
export function mergeContinuation(original: string, continuation: string): string {
  if (!continuation) return original;

  // Try to find overlap (last 50 chars of original in start of continuation)
  const overlapSearch = original.slice(-100);
  for (let len = Math.min(50, overlapSearch.length); len >= 10; len--) {
    const tail = overlapSearch.slice(-len);
    const idx = continuation.indexOf(tail);
    if (idx !== -1 && idx < 50) {
      return original + continuation.slice(idx + tail.length);
    }
  }

  // No overlap found — just concatenate
  return original + continuation;
}


