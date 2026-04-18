/* ------------------------------------------------------------------ */
/*  Tests for adaptive transition selection                           */
/* ------------------------------------------------------------------ */

import { describe, it, expect } from 'vitest';
import {
  selectAdaptiveTransition,
  computeAdaptiveTransitions,
  MIN_TRANSITION_DURATION,
  MAX_TRANSITION_DURATION,
} from './adaptiveTransitions.js';

describe('selectAdaptiveTransition', () => {
  it('returns dissolve with long duration for calm same-phase scenes', () => {
    const result = selectAdaptiveTransition(
      { emotionIntensity: 0.3, narrativePhase: 'build' },
      { emotionIntensity: 0.35, narrativePhase: 'build' },
    );
    expect(result.type).toBe('dissolve');
    expect(result.duration).toBeGreaterThanOrEqual(1.0);
    expect(result.duration).toBeLessThanOrEqual(MAX_TRANSITION_DURATION);
  });

  it('returns cut for high emotion delta (dramatic shift)', () => {
    const result = selectAdaptiveTransition(
      { emotionIntensity: 0.2, narrativePhase: 'build' },
      { emotionIntensity: 0.9, narrativePhase: 'climax' },
    );
    // Entering climax with high delta → cut or wipe
    expect(['cut', 'wipe']).toContain(result.type);
    expect(result.duration).toBeLessThanOrEqual(0.6);
  });

  it('uses fade for climax→resolution transition', () => {
    const result = selectAdaptiveTransition(
      { emotionIntensity: 0.9, narrativePhase: 'climax' },
      { emotionIntensity: 0.4, narrativePhase: 'resolution' },
    );
    expect(result.type).toBe('fade');
  });

  it('prefers wipe/cut when entering climax', () => {
    const result = selectAdaptiveTransition(
      { emotionIntensity: 0.5, narrativePhase: 'build' },
      { emotionIntensity: 0.8, narrativePhase: 'climax' },
    );
    expect(['cut', 'wipe']).toContain(result.type);
  });

  it('clamps duration to valid range', () => {
    // Very low delta → should hit max duration
    const low = selectAdaptiveTransition(
      { emotionIntensity: 0.5, narrativePhase: 'build' },
      { emotionIntensity: 0.5, narrativePhase: 'build' },
    );
    expect(low.duration).toBeLessThanOrEqual(MAX_TRANSITION_DURATION);
    expect(low.duration).toBeGreaterThanOrEqual(MIN_TRANSITION_DURATION);

    // Very high delta → should hit min duration
    const high = selectAdaptiveTransition(
      { emotionIntensity: 0.0, narrativePhase: 'hook' },
      { emotionIntensity: 1.0, narrativePhase: 'climax' },
    );
    expect(high.duration).toBeLessThanOrEqual(MAX_TRANSITION_DURATION);
    expect(high.duration).toBeGreaterThanOrEqual(MIN_TRANSITION_DURATION);
  });
});

describe('computeAdaptiveTransitions', () => {
  it('returns arrays aligned with scene count', () => {
    const scenes = [
      { emotionIntensity: 0.3, narrativePhase: 'hook' as const, transitionToNext: 'cut' as const },
      { emotionIntensity: 0.5, narrativePhase: 'build' as const, transitionToNext: 'dissolve' as const },
      { emotionIntensity: 0.9, narrativePhase: 'climax' as const, transitionToNext: 'none' as const },
    ];
    const { types, durations } = computeAdaptiveTransitions(scenes);
    expect(types).toHaveLength(3);
    expect(durations).toHaveLength(3);
    // Last scene always 'none'
    expect(types[2]).toBe('none');
    expect(durations[2]).toBe(0);
  });

  it('returns empty arrays for single scene', () => {
    const { types, durations } = computeAdaptiveTransitions([
      { emotionIntensity: 0.5, narrativePhase: 'hook' as const, transitionToNext: 'none' as const },
    ]);
    expect(types).toEqual(['none']);
    expect(durations).toEqual([0]);
  });

  it('produces variable durations for heterogeneous scenes', () => {
    const scenes = [
      { emotionIntensity: 0.2, narrativePhase: 'hook' as const, transitionToNext: 'cut' as const },
      { emotionIntensity: 0.3, narrativePhase: 'build' as const, transitionToNext: 'dissolve' as const },
      { emotionIntensity: 0.9, narrativePhase: 'climax' as const, transitionToNext: 'fade' as const },
      { emotionIntensity: 0.4, narrativePhase: 'resolution' as const, transitionToNext: 'none' as const },
    ];
    const { durations } = computeAdaptiveTransitions(scenes);
    // Durations should vary — build→climax should be shorter than hook→build
    const hookToBuild = durations[0];
    const buildToClimax = durations[1];
    expect(hookToBuild).toBeGreaterThan(buildToClimax);
  });
});
