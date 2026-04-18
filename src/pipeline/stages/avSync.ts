/* ------------------------------------------------------------------ */
/*  A/V Sync – per-scene audio/video duration alignment               */
/*  Computes FFmpeg correction strategy when TTS audio and generated  */
/*  video durations diverge beyond a tolerance threshold.             */
/* ------------------------------------------------------------------ */

/** Tolerance in seconds — deltas within this range need no correction. */
export const AV_SYNC_TOLERANCE = 0.3;

/** Maximum atempo adjustment (±15%). Beyond this, use pad/trim instead. */
export const MAX_ATEMPO_RATIO = 0.15;

export type AVSyncStrategy =
  | 'none'
  | 'loop-video'
  | 'pad-video'
  | 'trim-video'
  | 'speed-audio'
  | 'pad-audio';

export interface AVSyncResult {
  strategy: AVSyncStrategy;
  /** Speed factor for atempo filter (e.g. 1.05 = 5% faster). Only set for 'speed-audio'. */
  atempo?: number;
  /** Target output duration in seconds for -t flag. */
  targetDuration?: number;
  /** Human-readable description of the adjustment. */
  description: string;
}

/**
 * Determine the best A/V synchronisation strategy for a single scene.
 *
 * Policy: **audio-primary** — the TTS audio duration is authoritative.
 * Video is adjusted to match audio length whenever possible.
 *
 * @param videoDur  Actual duration of the video asset (seconds)
 * @param audioDur  Actual duration of the TTS audio (seconds)
 */
export function computeAVSyncStrategy(videoDur: number, audioDur: number): AVSyncResult {
  if (videoDur <= 0 || audioDur <= 0) {
    return { strategy: 'none', description: 'missing duration — skipping sync' };
  }

  const delta = audioDur - videoDur; // positive = audio is longer than video

  // Within tolerance — no adjustment needed
  if (Math.abs(delta) <= AV_SYNC_TOLERANCE) {
    return { strategy: 'none', description: `delta ${delta.toFixed(3)}s within tolerance` };
  }

  if (delta > 0) {
    // Audio is LONGER than video — need to extend video
    if (delta >= 2.0) {
      // Large gap: loop video to match
      return {
        strategy: 'loop-video',
        targetDuration: audioDur,
        description: `video ${delta.toFixed(1)}s shorter → loop video`,
      };
    }
    // Small gap: freeze last frame via tpad
    return {
      strategy: 'pad-video',
      targetDuration: audioDur,
      description: `video ${delta.toFixed(2)}s shorter → pad last frame`,
    };
  }

  // Video is LONGER than audio — need to extend audio or trim video
  const absDelta = -delta; // positive value
  const ratio = absDelta / audioDur;

  if (ratio <= MAX_ATEMPO_RATIO && absDelta < 3.0) {
    // Small relative gap: slow down audio slightly to fill the video
    const atempo = audioDur / videoDur; // < 1.0 = slower
    return {
      strategy: 'speed-audio',
      atempo,
      targetDuration: videoDur,
      description: `audio ${absDelta.toFixed(2)}s shorter → atempo=${atempo.toFixed(4)}`,
    };
  }

  // Large gap: trim video to match audio length (audio-primary policy)
  return {
    strategy: 'trim-video',
    targetDuration: audioDur,
    description: `video ${absDelta.toFixed(1)}s longer → trim to audio length`,
  };
}

/**
 * Build FFmpeg arguments for A/V sync adjustment in scene compositing.
 *
 * Returns additional args to insert into the ffmpeg command, or empty array if no adjustment.
 * The caller is responsible for applying these between input args and output.
 */
export function buildAVSyncArgs(result: AVSyncResult): {
  /** Extra flags to add before output path (e.g. ['-t', '5.2']) */
  outputFlags: string[];
  /** Video filter to prepend (e.g. 'tpad=stop=-1:stop_mode=clone') or empty */
  videoFilter: string;
  /** Audio filter to prepend (e.g. 'atempo=0.97') or empty */
  audioFilter: string;
  /** Whether -stream_loop -1 should be used for input video */
  loopInput: boolean;
} {
  switch (result.strategy) {
    case 'loop-video':
      return {
        outputFlags: result.targetDuration ? ['-t', String(result.targetDuration)] : [],
        videoFilter: '',
        audioFilter: '',
        loopInput: true,
      };
    case 'pad-video':
      return {
        outputFlags: result.targetDuration ? ['-t', String(result.targetDuration)] : [],
        videoFilter: 'tpad=stop=-1:stop_mode=clone',
        audioFilter: '',
        loopInput: false,
      };
    case 'speed-audio':
      return {
        outputFlags: result.targetDuration ? ['-t', String(result.targetDuration)] : [],
        videoFilter: '',
        audioFilter: result.atempo ? `atempo=${result.atempo.toFixed(4)}` : '',
        loopInput: false,
      };
    case 'trim-video':
      return {
        outputFlags: result.targetDuration ? ['-t', String(result.targetDuration)] : [],
        videoFilter: '',
        audioFilter: '',
        loopInput: false,
      };
    case 'none':
    default:
      return { outputFlags: [], videoFilter: '', audioFilter: '', loopInput: false };
  }
}
