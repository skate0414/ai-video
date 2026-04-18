/* ------------------------------------------------------------------ */
/*  confidenceFilter – confidence-aware field injection for prompts   */
/*  Fields with 'guess' confidence are excluded from hard constraints */
/*  and downgraded to soft guidance or omitted entirely.              */
/* ------------------------------------------------------------------ */

import type { StyleAnalysisCIR } from '../../cir/types.js';

export type ConfidenceLevel = 'confident' | 'inferred' | 'guess' | 'computed';

export interface FilteredField<T = unknown> {
  value: T;
  confidence: ConfidenceLevel;
  /** Whether to inject as hard constraint (false = soft guidance or omit) */
  isHard: boolean;
}

/**
 * Classify a field by its confidence level.
 * - `confident` / `computed` → hard constraint
 * - `inferred` → soft guidance (inject with "approximate" qualifier)
 * - `guess` → omit from prompt entirely
 */
export function classifyField<T>(
  value: T,
  confidence: ConfidenceLevel | undefined,
): FilteredField<T> {
  const conf = confidence ?? 'guess';
  return {
    value,
    confidence: conf,
    isHard: conf === 'confident' || conf === 'computed',
  };
}

/** Return true if field should be injected into the prompt at all. */
export function shouldInject(confidence: ConfidenceLevel | undefined): boolean {
  return confidence != null && confidence !== 'guess';
}

/**
 * Annotate a value with confidence metadata for template injection.
 * - `confident` / `computed` → value unchanged
 * - `inferred` → "approximately {value} (flexible — inferred from partial data)"
 * - `guess` / undefined → "{value} [LOW CONFIDENCE — use as rough guide only]"
 */
export function annotateValue(
  value: string | number,
  confidence: ConfidenceLevel | undefined,
): string {
  const conf = confidence ?? 'guess';
  if (conf === 'guess') return `${value} [LOW CONFIDENCE — use as rough guide only]`;
  if (conf === 'inferred') return `approximately ${value} (flexible — inferred from partial data)`;
  return String(value);
}

/**
 * Build a constraint line for the prompt.
 * Hard constraints use "MUST", soft use "approximately", guess fields are skipped.
 */
export function constraintLine(
  label: string,
  value: string | number,
  confidence: ConfidenceLevel | undefined,
): string | null {
  const conf = confidence ?? 'guess';
  if (conf === 'guess') return null;
  if (conf === 'confident' || conf === 'computed') {
    return `${label}: ${value} (HARD)`;
  }
  // inferred
  return `${label}: approximately ${value} (flexible — inferred from partial data)`;
}

/**
 * Extract only the confident/computed fields from StyleAnalysisCIR for hard constraints.
 * Returns a record of field names → { value, isHard } for prompt building.
 */
export function filterStyleFields(cir: StyleAnalysisCIR): {
  hardConstraints: Record<string, unknown>;
  softGuidance: Record<string, unknown>;
  skipped: string[];
} {
  const confidence = cir.confidence ?? {};
  const hardConstraints: Record<string, unknown> = {};
  const softGuidance: Record<string, unknown> = {};
  const skipped: string[] = [];

  const scriptFields: Record<string, unknown> = {
    hookStrategy: cir.scriptTrack.hookStrategy,
    sentenceLengthMax: cir.scriptTrack.sentenceLengthMax,
    sentenceLengthAvg: cir.scriptTrack.sentenceLengthAvg,
    narrativeArc: cir.scriptTrack.narrativeArc,
    emotionalToneArc: cir.scriptTrack.emotionalToneArc,
    rhetoricalCore: cir.scriptTrack.rhetoricalCore,
    metaphorCount: cir.scriptTrack.metaphorCount,
    interactionCuesCount: cir.scriptTrack.interactionCuesCount,
    ctaPattern: cir.scriptTrack.ctaPattern,
    jargonTreatment: cir.scriptTrack.jargonTreatment,
  };

  for (const [key, value] of Object.entries(scriptFields)) {
    const conf = confidence[key] as ConfidenceLevel | undefined;
    if (!shouldInject(conf)) {
      skipped.push(key);
    } else if (conf === 'confident' || conf === 'computed') {
      hardConstraints[key] = value;
    } else {
      // inferred
      softGuidance[key] = value;
    }
  }

  return { hardConstraints, softGuidance, skipped };
}
