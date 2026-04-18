/* ------------------------------------------------------------------ */
/*  TEMPORAL_PLANNING – pure computation pass                         */
/*  Allocates per-sentence durations using semantic weight, emotion   */
/*  intensity, and pacing constraints.  Zero AI calls.               */
/*                                                                    */
/*  Algorithm:                                                        */
/*    w_i = α·len_i + β·sem_i + γ·emo_i + δ·trans_i                 */
/*    d_i = D × (w_i / Σw_j)                                         */
/*  Clamped to [MIN_SCENE, MAX_SCENE], then re-normalised to hit     */
/*  the target total.  API durations snapped to valid grid.           */
/* ------------------------------------------------------------------ */

import type {
  ScriptCIR,
  StyleAnalysisCIR,
  FormatSignature,
  ShotCIR,
  TemporalPlanCIR,
  TemporalSceneCIR,
  NarrativePhase,
  Emphasis,
} from '../../cir/types.js';

/* ---- duration bounds ---- */
const MIN_SCENE_SEC = 3;
const MAX_SCENE_SEC = 20;

/* ---- API duration grids ---- */
const API_GRID_V1V2 = [5, 8] as const;
const API_GRID_V3 = [5, 10, 15, 20] as const;
const DEFAULT_API_GRID = [...API_GRID_V3, ...API_GRID_V1V2].filter(
  (v, i, a) => a.indexOf(v) === i,
).sort((a, b) => a - b); // [5, 8, 10, 15, 20]

/* ---- pacing coefficient presets ---- */
interface PacingCoeffs {
  /** character-length weight */
  alpha: number;
  /** semantic importance */
  beta: number;
  /** emotion intensity */
  gamma: number;
  /** transition boost */
  delta: number;
}

const PACING_PRESETS: Record<'slow' | 'medium' | 'fast', PacingCoeffs> = {
  slow:   { alpha: 0.3,  beta: 0.2,  gamma: 0.35, delta: 0.15 },
  medium: { alpha: 0.4,  beta: 0.25, gamma: 0.25, delta: 0.1  },
  fast:   { alpha: 0.5,  beta: 0.25, gamma: 0.15, delta: 0.1  },
};

/* ================================================================== */
/*  Public API                                                        */
/* ================================================================== */

export interface TemporalPlanInput {
  scriptCIR: ScriptCIR;
  styleCIR: StyleAnalysisCIR;
  formatSignature?: FormatSignature;
  /** Shot-level rhythm from reference video (optional). When present,
   *  the algorithm blends ShotCIR duration ratios into the weight calculation. */
  shotCIR?: ShotCIR;
  /** Override total duration (seconds). Default: scriptCIR.totalDurationSec. */
  totalDurationOverride?: number;
}

/**
 * Compute a per-sentence temporal plan.
 * Pure function — deterministic, no side effects.
 */
export function computeTemporalPlan(input: TemporalPlanInput): TemporalPlanCIR {
  const { scriptCIR, styleCIR, formatSignature, shotCIR } = input;
  const pacing = styleCIR.pacing;
  const coeffs = PACING_PRESETS[pacing];

  const totalDuration = input.totalDurationOverride ?? scriptCIR.totalDurationSec;
  const sentences = scriptCIR.sentences;
  const n = sentences.length;

  if (n === 0) {
    return emptyPlan(pacing, totalDuration);
  }

  // ── 1. Compute raw features ──
  const emotionArc = formatSignature?.emotionalArcShape ?? [];
  const transitionSet = new Set(formatSignature?.transitionPositions ?? []);
  const arcAlloc = formatSignature?.arcSentenceAllocation ?? [];
  const arcLabels = formatSignature?.arcStageLabels ?? [];

  const maxCharCount = Math.max(...sentences.map(s => s.text.length), 1);

  const features = sentences.map((s, i) => {
    const charCount = s.text.length;
    const lenNorm = charCount / maxCharCount;                       // 0-1
    const semWeight = clamp01(s.factReferences.length > 0 ? 0.7 + s.factReferences.length * 0.1 : 0.3);
    const emotionVal = i < emotionArc.length ? clamp01(emotionArc[i]) : 0.5;
    const isTrans = transitionSet.has(i);
    const transVal = isTrans ? 1 : 0;

    return { charCount, lenNorm, semWeight, emotionVal, isTrans, transVal };
  });

  // ── 2. Weighted allocation ──
  // When ShotCIR rhythm is available, interpolate it with the feature-based weights.
  // Shot rhythm provides the reference video's actual pacing pattern.
  const rhythmSig = shotCIR?.rhythmSignature ?? [];
  const hasRhythm = rhythmSig.length > 0;

  const weights = features.map((f, i) => {
    let w =
      coeffs.alpha * f.lenNorm +
      coeffs.beta * f.semWeight +
      coeffs.gamma * f.emotionVal +
      coeffs.delta * f.transVal;

    // Blend with shot rhythm: interpolate the nearest rhythm value
    if (hasRhythm) {
      const rhythmIdx = Math.min(
        Math.floor((i / n) * rhythmSig.length),
        rhythmSig.length - 1,
      );
      const rhythmWeight = rhythmSig[rhythmIdx] * rhythmSig.length; // Scale to ~1.0 average
      // 30% rhythm influence (preserves semantic weighting as primary)
      w = w * 0.7 + rhythmWeight * 0.3;
    }

    return w;
  });
  const weightSum = weights.reduce((a, b) => a + b, 0) || 1;

  let rawDurations = weights.map(w => totalDuration * (w / weightSum));

  // ── 3. Clamp ──
  rawDurations = rawDurations.map(d => Math.max(MIN_SCENE_SEC, Math.min(MAX_SCENE_SEC, d)));

  // ── 4. Re-normalise to hit total ──
  rawDurations = renormalize(rawDurations, totalDuration);

  // ── 5. Snap to API grid ──
  const apiDurations = rawDurations.map(d => snapToGrid(d, DEFAULT_API_GRID));

  // ── 6. Build scene descriptors ──
  const scenes: TemporalSceneCIR[] = sentences.map((s, i) => {
    const phase = inferNarrativePhase(i, n, arcAlloc, arcLabels);
    const emphasis = inferEmphasis(rawDurations[i], totalDuration / n);
    return {
      sentenceIndex: i,
      text: s.text,
      charCount: features[i].charCount,
      semanticWeight: round2(features[i].semWeight),
      emotionIntensity: round2(features[i].emotionVal),
      narrativePhase: phase,
      isTransition: features[i].isTrans,
      rawDurationSec: round2(rawDurations[i]),
      apiDurationSec: apiDurations[i],
      ttsBudgetSec: round2(rawDurations[i]),
      emphasis,
    };
  });

  const allocated = apiDurations.reduce((a, b) => a + b, 0);

  return {
    _cir: 'TemporalPlan',
    version: 1,
    totalDurationSec: round2(totalDuration),
    totalSentences: n,
    pacing,
    scenes,
    durationBudget: {
      allocated: round2(allocated),
      target: round2(totalDuration),
      deviation: round2(Math.abs(1 - allocated / totalDuration)),
    },
  };
}

/* ================================================================== */
/*  Helpers (exported for testing)                                    */
/* ================================================================== */

/** Snap a value to the nearest value in a sorted grid. */
export function snapToGrid(value: number, grid: readonly number[]): number {
  let best = grid[0];
  let bestDist = Math.abs(value - best);
  for (let i = 1; i < grid.length; i++) {
    const dist = Math.abs(value - grid[i]);
    if (dist < bestDist) {
      best = grid[i];
      bestDist = dist;
    }
  }
  return best;
}

/** Re-normalise an array of durations so they sum to `target`. */
export function renormalize(durations: number[], target: number): number[] {
  const sum = durations.reduce((a, b) => a + b, 0) || 1;
  const ratio = target / sum;
  return durations.map(d => {
    const scaled = d * ratio;
    return Math.max(MIN_SCENE_SEC, Math.min(MAX_SCENE_SEC, scaled));
  });
}

/** Infer narrative phase from sentence index and arc allocation. */
export function inferNarrativePhase(
  idx: number,
  total: number,
  arcAlloc: number[],
  arcLabels: string[],
): NarrativePhase {
  // If FormatSignature provides explicit arc, use it
  if (arcAlloc.length > 0 && arcLabels.length === arcAlloc.length) {
    let cursor = 0;
    for (let a = 0; a < arcAlloc.length; a++) {
      cursor += arcAlloc[a];
      if (idx < cursor) {
        return mapLabelToPhase(arcLabels[a]);
      }
    }
    // Past the end — treat as last labelled phase
    return mapLabelToPhase(arcLabels[arcLabels.length - 1]);
  }

  // Default 5-phase split based on position ratio
  const ratio = idx / Math.max(total - 1, 1);
  if (ratio < 0.1) return 'hook';
  if (ratio < 0.35) return 'build';
  if (ratio < 0.65) return 'climax';
  if (ratio < 0.9) return 'resolution';
  return 'cta';
}

/** Map a free-form arc label string to a canonical NarrativePhase. */
function mapLabelToPhase(label: string): NarrativePhase {
  const l = label.toLowerCase();
  if (/hook|开头|引入|开场/.test(l)) return 'hook';
  if (/build|铺垫|发展|展开/.test(l)) return 'build';
  if (/climax|高潮|核心|转折/.test(l)) return 'climax';
  if (/resol|收尾|总结|结论/.test(l)) return 'resolution';
  if (/cta|号召|互动|结尾/.test(l)) return 'cta';
  return 'build'; // safe default
}

/** Determine TTS emphasis based on deviation from average duration. */
function inferEmphasis(duration: number, avgDuration: number): Emphasis {
  const ratio = duration / avgDuration;
  if (ratio > 1.25) return 'slow';
  if (ratio < 0.8) return 'fast';
  return 'normal';
}

function clamp01(v: number): number {
  return Math.max(0, Math.min(1, v));
}

function round2(v: number): number {
  return Math.round(v * 100) / 100;
}

function emptyPlan(pacing: 'slow' | 'medium' | 'fast', totalDurationSec: number): TemporalPlanCIR {
  return {
    _cir: 'TemporalPlan',
    version: 1,
    totalDurationSec,
    totalSentences: 0,
    pacing,
    scenes: [],
    durationBudget: { allocated: 0, target: totalDurationSec, deviation: 1 },
  };
}
