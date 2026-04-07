/* ------------------------------------------------------------------ */
/*  ResponseParser – extracts structured data from chat responses      */
/* ------------------------------------------------------------------ */

/**
 * Attempt to extract a JSON object from an AI chat response.
 *
 * Strategies (in order):
 * 1. Detect ```json ... ``` or ``` ... ``` fenced code block
 * 2. Detect raw JSON (first { to last })
 * 3. Return null if no JSON found
 */
export function extractJSON<T = any>(text: string): T | null {
  if (!text) return null;

  // Strategy 1: fenced code block
  const fenceMatch = text.match(/```(?:json)?\s*\n?([\s\S]*?)```/);
  if (fenceMatch) {
    try {
      return JSON.parse(fenceMatch[1].trim()) as T;
    } catch {
      // fall through to strategy 2
    }
  }

  // Strategy 2: raw JSON — find outermost { ... }
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace !== -1 && lastBrace > firstBrace) {
    const candidate = text.slice(firstBrace, lastBrace + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // Try to fix common issues: trailing commas, single quotes
      try {
        const fixed = candidate
          .replace(/,\s*([}\]])/g, '$1')      // remove trailing commas
          .replace(/'/g, '"');                  // single to double quotes
        return JSON.parse(fixed) as T;
      } catch {
        // give up
      }
    }
  }

  // Strategy 3: try array [ ... ]
  const firstBracket = text.indexOf('[');
  const lastBracket = text.lastIndexOf(']');
  if (firstBracket !== -1 && lastBracket > firstBracket) {
    const candidate = text.slice(firstBracket, lastBracket + 1);
    try {
      return JSON.parse(candidate) as T;
    } catch {
      // give up
    }
  }

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


