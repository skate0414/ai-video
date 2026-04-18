/* ------------------------------------------------------------------ */
/*  Global LUT – Cross-scene color normalisation via reference scene  */
/*  Extracts colour statistics from the first scene and computes      */
/*  per-scene corrective FFmpeg filters to unify the colour space.    */
/* ------------------------------------------------------------------ */

/** Lightweight colour statistics extracted via FFmpeg signalstats. */
export interface ColorStats {
  /** Average R channel value (0–255). */
  avgR: number;
  /** Average G channel value (0–255). */
  avgG: number;
  /** Average B channel value (0–255). */
  avgB: number;
  /** Perceived brightness (0–255). */
  brightness: number;
  /** Saturation estimate (0–255). */
  saturation: number;
}

/** Maximum per-channel correction (clamped to avoid extreme shifts). */
const MAX_SHIFT = 0.12;

/** Minimum delta to bother applying correction (below this is perceptually invisible). */
const MIN_DELTA = 5;

/**
 * Parse colour statistics from FFmpeg signalstats + showinfo output.
 *
 * We run: `ffmpeg -i input -vf "signalstats,metadata=print:file=-" -frames:v 30 -f null /dev/null`
 * and average the per-frame YAVG, UAVG, VAVG, SATAVG values.
 *
 * For simplicity, we parse YAVG (luma ≈ brightness) and UAVG/VAVG (chroma) then convert
 * to approximate RGB via standard BT.601 conversion.
 */
export function parseColorStats(ffmpegOutput: string): ColorStats | undefined {
  const yRegex = /YAVG=(\d+(?:\.\d+)?)/g;
  const uRegex = /UAVG=(\d+(?:\.\d+)?)/g;
  const vRegex = /VAVG=(\d+(?:\.\d+)?)/g;
  const satRegex = /SATAVG=(\d+(?:\.\d+)?)/g;

  const yVals = [...ffmpegOutput.matchAll(yRegex)].map(m => parseFloat(m[1]));
  const uVals = [...ffmpegOutput.matchAll(uRegex)].map(m => parseFloat(m[1]));
  const vVals = [...ffmpegOutput.matchAll(vRegex)].map(m => parseFloat(m[1]));
  const satVals = [...ffmpegOutput.matchAll(satRegex)].map(m => parseFloat(m[1]));

  if (yVals.length === 0) return undefined;

  const avg = (arr: number[]) => arr.reduce((s, v) => s + v, 0) / arr.length;

  const yAvg = avg(yVals);
  const uAvg = uVals.length > 0 ? avg(uVals) : 128;
  const vAvg = vVals.length > 0 ? avg(vVals) : 128;

  // YUV→RGB (BT.601 approximation, Y/U/V in [0,255])
  const y = yAvg;
  const u = uAvg - 128;
  const v = vAvg - 128;
  const r = Math.max(0, Math.min(255, y + 1.402 * v));
  const g = Math.max(0, Math.min(255, y - 0.344 * u - 0.714 * v));
  const b = Math.max(0, Math.min(255, y + 1.772 * u));

  return {
    avgR: Math.round(r),
    avgG: Math.round(g),
    avgB: Math.round(b),
    brightness: Math.round(yAvg),
    saturation: satVals.length > 0 ? Math.round(avg(satVals)) : 0,
  };
}

/**
 * Compute an FFmpeg colorbalance + eq correction filter that nudges a scene's
 * colour profile towards the reference (first scene).
 *
 * Returns an empty string if no correction is needed (scene is already close).
 */
export function buildColorCorrectionFilter(
  reference: ColorStats,
  scene: ColorStats,
): string {
  const filters: string[] = [];

  // Per-channel delta (reference - scene), normalised to [-1, 1] for FFmpeg colorbalance
  const deltaR = reference.avgR - scene.avgR;
  const deltaG = reference.avgG - scene.avgG;
  const deltaB = reference.avgB - scene.avgB;

  const needsBalance = Math.abs(deltaR) > MIN_DELTA ||
    Math.abs(deltaG) > MIN_DELTA ||
    Math.abs(deltaB) > MIN_DELTA;

  if (needsBalance) {
    // FFmpeg colorbalance rs/gs/bs range is -1.0..1.0 — scale our 0-255 delta
    const scale = (d: number) => {
      const s = d / 255;
      return Math.max(-MAX_SHIFT, Math.min(MAX_SHIFT, s));
    };
    const rs = scale(deltaR).toFixed(4);
    const gs = scale(deltaG).toFixed(4);
    const bs = scale(deltaB).toFixed(4);
    // Apply to midtones (rm/gm/bm) for the most natural correction
    filters.push(`colorbalance=rm=${rs}:gm=${gs}:bm=${bs}`);
  }

  // Brightness / contrast correction via eq filter
  const brightnessDelta = reference.brightness - scene.brightness;
  if (Math.abs(brightnessDelta) > MIN_DELTA) {
    // eq brightness range is roughly -1.0..1.0 (additive)
    const bAdj = Math.max(-0.08, Math.min(0.08, brightnessDelta / 255));
    filters.push(`eq=brightness=${bAdj.toFixed(4)}`);
  }

  return filters.join(',');
}

/**
 * Convenience: build the FFmpeg signalstats command-line arguments
 * to extract colour statistics from a video (first 30 frames).
 */
export function buildSignalstatsArgs(inputPath: string): string[] {
  return [
    '-i', inputPath,
    '-vf', 'signalstats,metadata=print:file=-',
    '-frames:v', '30',
    '-f', 'null',
    '-y', '/dev/null',
  ];
}
