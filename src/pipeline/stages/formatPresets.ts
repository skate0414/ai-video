/* ------------------------------------------------------------------ */
/*  Format Presets – multi-resolution / aspect ratio profiles         */
/*  Maps output format names to resolution + scaling parameters.     */
/* ------------------------------------------------------------------ */

/**
 * Named output format presets for different distribution targets.
 *
 * Each preset defines resolution, aspect ratio, and display context.
 * The pipeline reads the format from VideoIR and uses it to drive
 * assembly (scaling, padding, Ken Burns) and encoding.
 */
export interface FormatPreset {
  /** Display name */
  label: string;
  /** Target width */
  width: number;
  /** Target height */
  height: number;
  /** Aspect ratio string for logging (e.g. "16:9") */
  aspect: string;
  /** FFmpeg scale + pad filter for normalization */
  normFilter: string;
  /** Typical use case */
  useCase: string;
}

function buildNormFilter(w: number, h: number): string {
  return `scale=${w}:${h}:force_original_aspect_ratio=decrease,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2,setsar=1`;
}

export const FORMAT_PRESETS: Readonly<Record<string, FormatPreset>> = Object.freeze({
  '16:9': {
    label: 'Landscape HD (16:9)',
    width: 1920,
    height: 1080,
    aspect: '16:9',
    normFilter: buildNormFilter(1920, 1080),
    useCase: 'YouTube, desktop playback',
  },
  '9:16': {
    label: 'Vertical HD (9:16)',
    width: 1080,
    height: 1920,
    aspect: '9:16',
    normFilter: buildNormFilter(1080, 1920),
    useCase: 'TikTok, YouTube Shorts, Instagram Reels',
  },
  '1:1': {
    label: 'Square (1:1)',
    width: 1080,
    height: 1080,
    aspect: '1:1',
    normFilter: buildNormFilter(1080, 1080),
    useCase: 'Instagram feed, social media',
  },
  '4:3': {
    label: 'Classic (4:3)',
    width: 1440,
    height: 1080,
    aspect: '4:3',
    normFilter: buildNormFilter(1440, 1080),
    useCase: 'Retro style, presentations',
  },
  '21:9': {
    label: 'Ultra-wide (21:9)',
    width: 2560,
    height: 1080,
    aspect: '21:9',
    normFilter: buildNormFilter(2560, 1080),
    useCase: 'Cinematic widescreen',
  },
});

/**
 * Resolve a format preset from a width/height pair.
 * Falls back to 16:9 if the ratio doesn't match any known preset.
 */
export function resolveFormatPreset(width: number, height: number): FormatPreset {
  const ratio = width / height;

  // Match with 5% tolerance
  if (Math.abs(ratio - 16 / 9) < 0.1) return FORMAT_PRESETS['16:9'];
  if (Math.abs(ratio - 9 / 16) < 0.1) return FORMAT_PRESETS['9:16'];
  if (Math.abs(ratio - 1) < 0.1) return FORMAT_PRESETS['1:1'];
  if (Math.abs(ratio - 4 / 3) < 0.1) return FORMAT_PRESETS['4:3'];
  if (Math.abs(ratio - 21 / 9) < 0.15) return FORMAT_PRESETS['21:9'];

  // Custom resolution: build dynamic preset
  return {
    label: `Custom (${width}×${height})`,
    width,
    height,
    aspect: `${width}:${height}`,
    normFilter: buildNormFilter(width, height),
    useCase: 'Custom',
  };
}

/**
 * Get the format preset name from dimensions, or undefined if custom.
 */
export function getFormatName(width: number, height: number): string | undefined {
  const ratio = width / height;
  if (Math.abs(ratio - 16 / 9) < 0.1) return '16:9';
  if (Math.abs(ratio - 9 / 16) < 0.1) return '9:16';
  if (Math.abs(ratio - 1) < 0.1) return '1:1';
  if (Math.abs(ratio - 4 / 3) < 0.1) return '4:3';
  if (Math.abs(ratio - 21 / 9) < 0.15) return '21:9';
  return undefined;
}
