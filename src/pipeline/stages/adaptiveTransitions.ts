/* ------------------------------------------------------------------ */
/*  Adaptive Transition Selection                                     */
/*  Selects transition type and duration based on emotion delta        */
/*  between adjacent scenes and narrative phase context.              */
/* ------------------------------------------------------------------ */

import type { VideoIRScene, NarrativePhase } from '../../cir/types.js';

/** Transition type constants matching VideoIRScene.transitionToNext */
export type TransitionType = 'cut' | 'dissolve' | 'fade' | 'wipe' | 'zoom' | 'none';

export interface AdaptiveTransitionResult {
  type: TransitionType;
  /** Duration in seconds, clamped to [0.2, 1.5] */
  duration: number;
}

/** Minimum transition duration in seconds */
export const MIN_TRANSITION_DURATION = 0.2;
/** Maximum transition duration in seconds */
export const MAX_TRANSITION_DURATION = 1.5;

/**
 * Compute adaptive transition between two adjacent scenes.
 *
 * Strategy:
 * - High emotion delta (|ΔE| > 0.5) → hard cut or fast wipe (dramatic shift)
 * - Low emotion delta (|ΔE| < 0.2) → dissolve with longer duration (smooth flow)
 * - Medium delta → fade or dissolve with medium duration
 * - Narrative phase transitions (e.g. build→climax) get special treatment
 * - Duration scales inversely with emotion delta: calm transitions are longer
 */
export function selectAdaptiveTransition(
  current: Pick<VideoIRScene, 'emotionIntensity' | 'narrativePhase'>,
  next: Pick<VideoIRScene, 'emotionIntensity' | 'narrativePhase'>,
): AdaptiveTransitionResult {
  const emotionDelta = Math.abs(next.emotionIntensity - current.emotionIntensity);
  const phaseTransition = getPhaseTransitionWeight(current.narrativePhase, next.narrativePhase);

  // Blend emotion delta with phase transition weight
  const intensity = Math.min(1, emotionDelta * 0.7 + phaseTransition * 0.3);

  // Select type based on intensity
  const type = selectTransitionType(intensity, current.narrativePhase, next.narrativePhase);

  // Duration: high intensity → short (snappy), low intensity → long (smooth)
  // Linear interpolation: intensity 0 → MAX, intensity 1 → MIN
  const rawDuration = MAX_TRANSITION_DURATION - intensity * (MAX_TRANSITION_DURATION - MIN_TRANSITION_DURATION);
  const duration = clampDuration(rawDuration);

  return { type, duration };
}

/**
 * Apply adaptive transition selection to all scenes in a VideoIR.
 * Returns arrays of transition types and durations aligned with scene indices.
 * transitionTypes[i] = transition AFTER scene i (before scene i+1).
 */
export function computeAdaptiveTransitions(
  scenes: readonly Pick<VideoIRScene, 'emotionIntensity' | 'narrativePhase' | 'transitionToNext'>[],
): { types: TransitionType[]; durations: number[] } {
  const types: TransitionType[] = [];
  const durations: number[] = [];

  for (let i = 0; i < scenes.length; i++) {
    if (i === scenes.length - 1) {
      // Last scene: no transition
      types.push('none');
      durations.push(0);
      continue;
    }
    const result = selectAdaptiveTransition(scenes[i], scenes[i + 1]);
    types.push(result.type);
    durations.push(result.duration);
  }

  return { types, durations };
}

/* ---- Internal helpers ---- */

/** Weight for narrative phase transitions. Higher = more dramatic. */
const PHASE_TRANSITION_WEIGHTS: Record<string, number> = {
  'hook→build': 0.2,
  'build→climax': 0.8,
  'climax→resolution': 0.6,
  'resolution→cta': 0.3,
  'hook→climax': 0.9,
  'build→resolution': 0.4,
  'build→cta': 0.3,
  'climax→cta': 0.5,
};

function getPhaseTransitionWeight(from: NarrativePhase, to: NarrativePhase): number {
  if (from === to) return 0;
  return PHASE_TRANSITION_WEIGHTS[`${from}→${to}`] ?? 0.3;
}

function selectTransitionType(
  intensity: number,
  fromPhase: NarrativePhase,
  toPhase: NarrativePhase,
): TransitionType {
  // Special: entering climax → dramatic cut or wipe
  if (toPhase === 'climax') {
    return intensity > 0.5 ? 'cut' : 'wipe';
  }

  // Special: climax → resolution → slow fade
  if (fromPhase === 'climax' && toPhase === 'resolution') {
    return 'fade';
  }

  // General rules based on blended intensity
  if (intensity > 0.6) return 'cut';
  if (intensity > 0.4) return 'wipe';
  if (intensity > 0.2) return 'fade';
  return 'dissolve';
}

function clampDuration(d: number): number {
  return Math.round(Math.max(MIN_TRANSITION_DURATION, Math.min(MAX_TRANSITION_DURATION, d)) * 100) / 100;
}
