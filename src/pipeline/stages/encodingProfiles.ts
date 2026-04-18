/* ------------------------------------------------------------------ */
/*  Encoding Profiles – quality-tier-aware encoding parameters        */
/*  Maps quality tier (draft / balanced / premium) to FFmpeg          */
/*  encoding settings: CRF, preset, audio bitrate, 2-pass flag.     */
/* ------------------------------------------------------------------ */

import type { ResolvedEncoding } from '../../adapters/ffmpegAssembler.js';

/**
 * Quality tier names used across the pipeline.
 * - draft: fast previews, lower quality
 * - balanced: default production quality
 * - premium: maximum quality, slower encoding
 */
export type QualityTier = 'draft' | 'balanced' | 'premium';

export interface TieredEncodingProfile extends ResolvedEncoding {
  /** x264/x265 encoding preset (ultrafast → veryslow). Slower = smaller + better quality. */
  preset: string;
  /** Whether to use 2-pass encoding for better bitrate distribution. */
  twoPass: boolean;
  /** Maximum bitrate cap (e.g. '5M'). undefined = uncapped (CRF-only). */
  maxrate?: string;
  /** Buffer size for rate control (e.g. '10M'). */
  bufsize?: string;
}

/**
 * Encoding parameters per quality tier.
 * Base resolution and fps are provided externally (from VideoIR / format preset).
 */
const TIER_PROFILES: Record<QualityTier, Omit<TieredEncodingProfile, 'width' | 'height' | 'fps'>> = {
  draft: {
    videoCodec: 'libx264',
    crf: 28,
    audioBitrate: '128k',
    audioSampleRate: 44100,
    preset: 'fast',
    twoPass: false,
  },
  balanced: {
    videoCodec: 'libx264',
    crf: 20,
    audioBitrate: '192k',
    audioSampleRate: 48000,
    preset: 'medium',
    twoPass: false,
  },
  premium: {
    videoCodec: 'libx264',
    crf: 16,
    audioBitrate: '256k',
    audioSampleRate: 48000,
    preset: 'slow',
    twoPass: true,
    maxrate: '8M',
    bufsize: '16M',
  },
};

/**
 * Resolve a full encoding profile by merging quality tier defaults
 * with resolution/fps from the pipeline.
 *
 * @param tier Quality tier name (defaults to 'balanced')
 * @param width Target width from VideoIR/format preset
 * @param height Target height
 * @param fps Target frame rate
 * @returns Full tiered encoding profile ready for FFmpeg
 */
export function resolveEncodingProfile(
  tier: QualityTier | undefined,
  width: number,
  height: number,
  fps: number,
): TieredEncodingProfile {
  const base = TIER_PROFILES[tier ?? 'balanced'];
  return { ...base, width, height, fps };
}

/**
 * Get the quality tier from an environment variable or default.
 * Reads QUALITY_TIER env var (draft | balanced | premium).
 */
export function getQualityTier(): QualityTier {
  const env = process.env.QUALITY_TIER?.toLowerCase();
  if (env === 'draft' || env === 'balanced' || env === 'premium') return env;
  return 'balanced';
}

/**
 * Build FFmpeg args for encoding preset.
 * Returns args to insert into the FFmpeg command line.
 */
export function buildEncodingArgs(profile: TieredEncodingProfile): string[] {
  const args: string[] = [
    '-preset', profile.preset,
  ];
  if (profile.maxrate) {
    args.push('-maxrate', profile.maxrate, '-bufsize', profile.bufsize ?? profile.maxrate);
  }
  return args;
}
