/* ------------------------------------------------------------------ */
/*  Visual Consistency Engine – G2                                    */
/*  Extracts visual fingerprints from generated images and scores    */
/*  inter-scene consistency against the reference sheet.             */
/* ------------------------------------------------------------------ */

import type { AIAdapter, LogEntry } from '../types.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';
import { readFileSync, existsSync } from 'node:fs';

const slog = createLogger('VisualConsistency');
const log = createStageLog('REFERENCE_IMAGE'); // Uses parent stage for log tagging

/* ================================================================== */
/*  VisualDNA – fingerprint extracted from a generated image          */
/* ================================================================== */

export interface VisualDNA {
  /** Dominant colors as hex strings (3-5 colors) */
  readonly dominantColors: readonly string[];
  /** Overall brightness: 'dark' | 'medium' | 'bright' */
  readonly brightness: 'dark' | 'medium' | 'bright';
  /** Color temperature: 'warm' | 'neutral' | 'cool' */
  readonly colorTemperature: 'warm' | 'neutral' | 'cool';
  /** Art style keywords (e.g. '3D animated', 'photorealistic') */
  readonly styleKeywords: readonly string[];
}

/* ================================================================== */
/*  AI-based visual feature extraction                                */
/* ================================================================== */

const EXTRACT_PROMPT = `Analyze this image and extract visual characteristics. Return ONLY a JSON object with these exact fields:
{
  "dominantColors": ["#hex1", "#hex2", "#hex3"],
  "brightness": "dark" | "medium" | "bright",
  "colorTemperature": "warm" | "neutral" | "cool",
  "styleKeywords": ["keyword1", "keyword2"]
}
Rules:
- dominantColors: 3-5 hex color codes that represent the main colors in the image
- brightness: overall brightness level
- colorTemperature: warm (reds/oranges/yellows), cool (blues/greens/purples), or neutral
- styleKeywords: 2-4 keywords describing the art style (e.g. "3D animated", "soft lighting", "cartoon")
Return ONLY the JSON object, no other text.`;

/**
 * Extract a VisualDNA fingerprint from an image using AI analysis.
 * Falls back to a neutral default if extraction fails.
 */
export async function extractVisualDNA(
  adapter: AIAdapter,
  imagePath: string,
  onLog?: (entry: LogEntry) => void,
): Promise<VisualDNA> {
  const emit = onLog ?? (() => {});

  if (!existsSync(imagePath)) {
    emit(log(`Image not found: ${imagePath}`, 'warning'));
    return DEFAULT_VISUAL_DNA;
  }

  try {
    const imageData = readFileSync(imagePath);
    const base64 = `data:image/png;base64,${imageData.toString('base64')}`;

    const result = await adapter.generateText('', [
      { type: 'image', source: base64 },
      { type: 'text', text: EXTRACT_PROMPT },
    ]);

    const text = result?.text ?? '';
    const parsed = extractJSON(text);

    if (parsed && typeof parsed === 'object') {
      return normalizeVisualDNA(parsed);
    }

    emit(log('Could not parse VisualDNA from AI response', 'warning'));
    return DEFAULT_VISUAL_DNA;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    slog.warn('extract_visual_dna_error', { error: msg });
    emit(log(`VisualDNA extraction failed: ${msg}`, 'warning'));
    return DEFAULT_VISUAL_DNA;
  }
}

/* ================================================================== */
/*  Pure scoring functions                                            */
/* ================================================================== */

/**
 * Score visual consistency between a candidate image's fingerprint and a
 * reference fingerprint (typically from the reference sheet).
 *
 * Returns a score from 0 (no consistency) to 100 (perfect match).
 * Pure function — no side effects.
 */
export function scoreVisualConsistency(
  candidate: VisualDNA,
  reference: VisualDNA,
): number {
  // Component weights
  const COLOR_WEIGHT = 0.45;
  const BRIGHTNESS_WEIGHT = 0.15;
  const TEMPERATURE_WEIGHT = 0.15;
  const STYLE_WEIGHT = 0.25;

  const colorScore = scoreColorSimilarity(candidate.dominantColors, reference.dominantColors);
  const brightnessScore = candidate.brightness === reference.brightness ? 100 : 40;
  const tempScore = candidate.colorTemperature === reference.colorTemperature ? 100 : 40;
  const styleScore = scoreStyleSimilarity(candidate.styleKeywords, reference.styleKeywords);

  return Math.round(
    colorScore * COLOR_WEIGHT +
    brightnessScore * BRIGHTNESS_WEIGHT +
    tempScore * TEMPERATURE_WEIGHT +
    styleScore * STYLE_WEIGHT,
  );
}

/**
 * Score color palette similarity using average minimum RGB distance.
 * Each candidate color is matched to its nearest reference color;
 * the average distance is converted to a 0-100 score.
 */
export function scoreColorSimilarity(
  candidateColors: readonly string[],
  referenceColors: readonly string[],
): number {
  if (candidateColors.length === 0 || referenceColors.length === 0) return 50;

  const candRGB = candidateColors.map(hexToRGB).filter(Boolean) as RGB[];
  const refRGB = referenceColors.map(hexToRGB).filter(Boolean) as RGB[];

  if (candRGB.length === 0 || refRGB.length === 0) return 50;

  // For each candidate color, find minimum distance to any reference color
  let totalDist = 0;
  for (const c of candRGB) {
    let minDist = Infinity;
    for (const r of refRGB) {
      const dist = rgbDistance(c, r);
      if (dist < minDist) minDist = dist;
    }
    totalDist += minDist;
  }

  const avgDist = totalDist / candRGB.length;
  // Max possible distance is ~441 (√(255²+255²+255²))
  // Score: 100 when distance=0, 0 when distance >= 300
  return Math.round(Math.max(0, 100 * (1 - avgDist / 300)));
}

/**
 * Score style keyword similarity using Jaccard-like overlap.
 */
export function scoreStyleSimilarity(
  candidateKeywords: readonly string[],
  referenceKeywords: readonly string[],
): number {
  if (candidateKeywords.length === 0 || referenceKeywords.length === 0) return 50;

  const candSet = new Set(candidateKeywords.map(k => k.toLowerCase().trim()));
  const refSet = new Set(referenceKeywords.map(k => k.toLowerCase().trim()));

  let matches = 0;
  for (const k of candSet) {
    for (const r of refSet) {
      // Partial match: one contains the other
      if (k.includes(r) || r.includes(k)) {
        matches++;
        break;
      }
    }
  }

  const union = new Set([...candSet, ...refSet]).size;
  return Math.round((matches / union) * 100);
}

/* ================================================================== */
/*  Consistency summary for a set of scenes                           */
/* ================================================================== */

export interface ConsistencyReport {
  /** Per-scene consistency scores (0-100) */
  readonly scores: readonly number[];
  /** Overall average score */
  readonly averageScore: number;
  /** Indices of scenes below the consistency threshold */
  readonly outlierIndices: readonly number[];
}

/**
 * Build a consistency report for a set of scene fingerprints.
 */
export function buildConsistencyReport(
  sceneDNAs: readonly VisualDNA[],
  referenceDNA: VisualDNA,
  threshold = 50,
): ConsistencyReport {
  const scores = sceneDNAs.map(dna => scoreVisualConsistency(dna, referenceDNA));
  const averageScore = scores.length > 0
    ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length)
    : 0;
  const outlierIndices = scores
    .map((s, i) => s < threshold ? i : -1)
    .filter(i => i >= 0);

  return { scores, averageScore, outlierIndices };
}

/* ================================================================== */
/*  Style anchor text generation for VIDEO_GEN                        */
/* ================================================================== */

/**
 * Build a style anchor text string from a VisualDNA fingerprint.
 * Used by VIDEO_GEN to inject visual consistency context into video prompts.
 */
export function buildStyleAnchor(dna: VisualDNA): string {
  const parts: string[] = [];
  if (dna.styleKeywords.length > 0) {
    parts.push(`Style: ${dna.styleKeywords.join(', ')}`);
  }
  if (dna.dominantColors.length > 0) {
    parts.push(`Palette: ${dna.dominantColors.join(', ')}`);
  }
  parts.push(`Lighting: ${dna.brightness}, ${dna.colorTemperature}`);
  return parts.join('. ') + '.';
}

/* ================================================================== */
/*  Internal helpers                                                  */
/* ================================================================== */

type RGB = [number, number, number];

/**
 * Parse a hex color string to RGB tuple.
 * @internal Exported for testing.
 */
export function hexToRGB(hex: string): RGB | null {
  const match = hex.match(/^#?([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})$/);
  if (!match) return null;
  return [parseInt(match[1], 16), parseInt(match[2], 16), parseInt(match[3], 16)];
}

/** Euclidean distance in RGB space. */
function rgbDistance(a: RGB, b: RGB): number {
  return Math.sqrt(
    (a[0] - b[0]) ** 2 +
    (a[1] - b[1]) ** 2 +
    (a[2] - b[2]) ** 2,
  );
}

/** Normalize raw AI output to VisualDNA with defaults. */
function normalizeVisualDNA(raw: Record<string, unknown>): VisualDNA {
  const dominantColors = Array.isArray(raw.dominantColors)
    ? (raw.dominantColors as string[]).filter(c => typeof c === 'string' && /^#[0-9a-fA-F]{6}$/.test(c))
    : [];

  const brightness = (['dark', 'medium', 'bright'] as const).includes(raw.brightness as any)
    ? (raw.brightness as VisualDNA['brightness'])
    : 'medium';

  const colorTemperature = (['warm', 'neutral', 'cool'] as const).includes(raw.colorTemperature as any)
    ? (raw.colorTemperature as VisualDNA['colorTemperature'])
    : 'neutral';

  const styleKeywords = Array.isArray(raw.styleKeywords)
    ? (raw.styleKeywords as string[]).filter(k => typeof k === 'string').slice(0, 5)
    : [];

  return { dominantColors, brightness, colorTemperature, styleKeywords };
}

/** Default VisualDNA when extraction fails. */
const DEFAULT_VISUAL_DNA: VisualDNA = {
  dominantColors: [],
  brightness: 'medium',
  colorTemperature: 'neutral',
  styleKeywords: [],
};
