/* ------------------------------------------------------------------ */
/*  Audio SFX / Ambient Sound Design                                  */
/*  Maps VideoIR production.sound metadata to FFmpeg audio filters.   */
/*  Uses synthesized ambient textures (via lavfi) — no external       */
/*  SFX files required.                                               */
/* ------------------------------------------------------------------ */

/**
 * SFX layer descriptor — describes an ambient audio texture to apply.
 */
export interface SFXLayer {
  /** Descriptive label for logging */
  label: string;
  /** FFmpeg lavfi source expression (e.g. "anoisesrc=d=10:c=pink:a=0.02") */
  lavfiSource: string;
  /** Volume relative to main audio (0-1) */
  volume: number;
}

/**
 * Map per-scene sound design hint to an ambient SFX filter.
 * Returns undefined if no SFX is appropriate.
 *
 * These are subtle ambient textures synthesized via FFmpeg's lavfi generators,
 * not full SFX samples (which would require external asset sourcing).
 */
export function resolveSFXLayer(
  soundHint: string | undefined,
  durationSec: number,
): SFXLayer | undefined {
  if (!soundHint) return undefined;

  const lower = soundHint.toLowerCase();
  const dur = Math.ceil(durationSec);

  // Ambient / atmosphere
  if (lower.includes('ambient') || lower.includes('atmosphere') || lower.includes('drone')) {
    return {
      label: 'ambient_drone',
      lavfiSource: `anoisesrc=d=${dur}:c=brown:a=0.008`,
      volume: 0.06,
    };
  }

  // Rising tension / suspense
  if (lower.includes('tension') || lower.includes('suspense') || lower.includes('rising')) {
    return {
      label: 'rising_tension',
      lavfiSource: `sine=f=80:d=${dur},afade=t=in:d=${Math.min(dur, 3)},afade=t=out:st=${Math.max(0, dur - 2)}:d=2`,
      volume: 0.04,
    };
  }

  // Impact / hit
  if (lower.includes('impact') || lower.includes('hit') || lower.includes('boom')) {
    return {
      label: 'impact_hit',
      lavfiSource: `sine=f=40:d=${Math.min(dur, 1)},afade=t=out:d=${Math.min(dur, 1)}`,
      volume: 0.08,
    };
  }

  // Calm / peaceful
  if (lower.includes('calm') || lower.includes('peace') || lower.includes('gentle') || lower.includes('soft')) {
    return {
      label: 'calm_ambient',
      lavfiSource: `anoisesrc=d=${dur}:c=pink:a=0.004`,
      volume: 0.03,
    };
  }

  // Nature / outdoor
  if (lower.includes('nature') || lower.includes('wind') || lower.includes('outdoor') || lower.includes('forest')) {
    return {
      label: 'nature_wind',
      lavfiSource: `anoisesrc=d=${dur}:c=pink:a=0.01`,
      volume: 0.05,
    };
  }

  // Urban / city
  if (lower.includes('urban') || lower.includes('city') || lower.includes('traffic') || lower.includes('street')) {
    return {
      label: 'urban_ambient',
      lavfiSource: `anoisesrc=d=${dur}:c=brown:a=0.012`,
      volume: 0.04,
    };
  }

  // Silence / none — explicitly no SFX
  if (lower.includes('silence') || lower.includes('none') || lower.includes('quiet')) {
    return undefined;
  }

  return undefined;
}

/**
 * Build per-scene SFX ambient layers for the full assembly.
 * Returns an array aligned with scene indices — undefined entries mean no SFX for that scene.
 */
export function buildSFXPlan(
  scenes: readonly { production?: { sound?: string }; audioDuration?: number; estimatedDuration?: number }[],
): (SFXLayer | undefined)[] {
  return scenes.map(s => {
    const dur = s.audioDuration ?? s.estimatedDuration ?? 5;
    return resolveSFXLayer(s.production?.sound, dur);
  });
}

/**
 * Build an FFmpeg filter_complex snippet to mix an SFX layer into a scene's audio.
 * Input: [0:a] = original audio, lavfi source = SFX
 * Output: mixed audio label
 *
 * @returns FFmpeg args to prepend to the scene processing, or undefined if no SFX
 */
export function buildSFXMixArgs(
  sfx: SFXLayer,
  durationSec: number,
): { inputs: string[]; filterComplex: string } {
  return {
    inputs: ['-f', 'lavfi', '-i', sfx.lavfiSource],
    filterComplex:
      `[1:a]volume=${sfx.volume}[sfx];` +
      `[0:a][sfx]amix=inputs=2:duration=first:dropout_transition=2[aout]`,
  };
}
