/* ------------------------------------------------------------------ */
/*  Beat Alignment – snap transitions to BGM strong beats             */
/*  Detects energy peaks in the BGM audio and adjusts scene           */
/*  transition timestamps to align with the nearest musical beat.     */
/* ------------------------------------------------------------------ */

/** Default tolerance: how far (seconds) a transition can shift to snap to a beat. */
export const BEAT_SNAP_TOLERANCE = 0.4;

/** Minimum interval between detected beats (prevents double-counting). */
const MIN_BEAT_INTERVAL = 0.25;

/** RMS threshold above which a frame is considered a beat (relative). */
const BEAT_RMS_FACTOR = 1.3;

export interface BeatInfo {
  /** Detected beat timestamps in seconds. */
  beats: number[];
  /** Estimated BPM (0 if detection failed). */
  estimatedBPM: number;
}

/**
 * Parse beat positions from FFmpeg astats output.
 *
 * We run: `ffmpeg -i bgm.mp3 -af "astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-" -f null /dev/null`
 * which prints per-frame RMS levels with pts_time timestamps. We find peaks above the mean as beats.
 */
export function parseBeatsFromAstats(astatsOutput: string, totalDuration: number): BeatInfo {
  // Parse pts_time + RMS_level pairs from ametadata output.
  // Format: "frame:N  pts:N  pts_time:N.NNN\nlavfi.astats.Overall.RMS_level=-XX.X"
  const ptsRegex = /pts_time:(\d+(?:\.\d+)?)/g;
  const rmsRegex = /lavfi\.astats\.Overall\.RMS_level=(-?\d+(?:\.\d+)?)/g;

  const ptsTimes: number[] = [];
  let m: RegExpExecArray | null;
  while ((m = ptsRegex.exec(astatsOutput)) !== null) {
    ptsTimes.push(parseFloat(m[1]));
  }

  const rmsValues: { time: number; rms: number }[] = [];
  let rmsIdx = 0;
  while ((m = rmsRegex.exec(astatsOutput)) !== null) {
    const rms = parseFloat(m[1]);
    if (!isNaN(rms) && rms > -100) {
      // Use pts_time if available, otherwise fall back to frame index as rough estimate
      const time = rmsIdx < ptsTimes.length ? ptsTimes[rmsIdx] : rmsIdx;
      rmsValues.push({ time, rms });
    }
    rmsIdx++;
  }

  if (rmsValues.length < 4) {
    return { beats: [], estimatedBPM: 0 };
  }

  // Convert dB RMS to linear for peak detection
  const linearValues = rmsValues.map(v => ({
    time: v.time,
    linear: Math.pow(10, v.rms / 20),
  }));

  // Compute moving average (window=3)
  const avgLinear = linearValues.reduce((s, v) => s + v.linear, 0) / linearValues.length;

  // Detect beats: points above BEAT_RMS_FACTOR × average
  const threshold = avgLinear * BEAT_RMS_FACTOR;
  const beats: number[] = [];
  let lastBeatTime = -MIN_BEAT_INTERVAL * 2;

  for (const v of linearValues) {
    if (v.linear >= threshold && v.time - lastBeatTime >= MIN_BEAT_INTERVAL) {
      beats.push(v.time);
      lastBeatTime = v.time;
    }
  }

  // Estimate BPM from beat intervals
  let estimatedBPM = 0;
  if (beats.length >= 2) {
    const intervals: number[] = [];
    for (let i = 1; i < beats.length; i++) {
      intervals.push(beats[i] - beats[i - 1]);
    }
    const avgInterval = intervals.reduce((s, v) => s + v, 0) / intervals.length;
    if (avgInterval > 0) {
      estimatedBPM = Math.round(60 / avgInterval);
    }
  }

  return { beats, estimatedBPM };
}

/**
 * Snap scene transition timestamps to the nearest BGM beat within tolerance.
 *
 * @param sceneDurations   Array of per-scene durations (seconds).
 * @param beats            Beat timestamps from BGM analysis.
 * @param tolerance        Max shift allowed (seconds). Default BEAT_SNAP_TOLERANCE.
 * @returns                Adjusted scene durations (same length as input).
 *                         The total duration sum is preserved (adjustments cancel out pairwise).
 */
export function snapTransitionsToBeats(
  sceneDurations: readonly number[],
  beats: readonly number[],
  tolerance: number = BEAT_SNAP_TOLERANCE,
): number[] {
  if (beats.length === 0 || sceneDurations.length < 2) {
    return [...sceneDurations];
  }

  const adjusted = [...sceneDurations];

  // Compute cumulative transition timestamps
  const transitionTimes: number[] = [];
  let cumulative = 0;
  for (let i = 0; i < adjusted.length - 1; i++) {
    cumulative += adjusted[i];
    transitionTimes.push(cumulative);
  }

  // For each transition point, find nearest beat and shift if within tolerance
  for (let i = 0; i < transitionTimes.length; i++) {
    const t = transitionTimes[i];
    let nearestBeat = -1;
    let nearestDist = Infinity;

    for (const b of beats) {
      const dist = Math.abs(b - t);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearestBeat = b;
      }
    }

    if (nearestBeat >= 0 && nearestDist <= tolerance) {
      const shift = nearestBeat - t;
      // Apply shift: extend/shorten scene i and compensate on scene i+1
      const newDurI = adjusted[i] + shift;
      const newDurNext = adjusted[i + 1] - shift;

      // Only apply if both scenes remain > 1s (safety floor)
      if (newDurI >= 1.0 && newDurNext >= 1.0) {
        adjusted[i] = newDurI;
        adjusted[i + 1] = newDurNext;
        // Update cumulative for subsequent iterations
        transitionTimes[i] = nearestBeat;
      }
    }
  }

  return adjusted;
}

/**
 * Convenience: build FFmpeg command args for beat detection via astats.
 */
export function buildBeatDetectionArgs(bgmPath: string): string[] {
  return [
    '-i', bgmPath,
    '-af', 'astats=metadata=1:reset=1,ametadata=print:key=lavfi.astats.Overall.RMS_level:file=-',
    '-f', 'null',
    '-y', '/dev/null',
  ];
}
