/* ------------------------------------------------------------------ */
/*  Color Grading – FFmpeg colorbalance-based look pipeline           */
/*  Maps VideoIR style metadata to FFmpeg filter parameters.          */
/*  No external LUT files required – pure filter chain grading.       */
/* ------------------------------------------------------------------ */

/**
 * Color temperature presets mapping to FFmpeg colorbalance parameters.
 * Values are [rs, gs, bs] adjustments for shadows/midtones/highlights.
 */
export interface ColorGradeParams {
  /** FFmpeg colorbalance filter string (e.g. "rs=0.05:gs=-0.03:bs=-0.08") */
  colorbalance: string;
  /** Optional FFmpeg eq filter for brightness/contrast (e.g. "contrast=1.05:brightness=0.02") */
  eq?: string;
}

/** Color temperature → FFmpeg colorbalance mapping */
const TEMPERATURE_GRADES: Record<string, ColorGradeParams> = {
  warm: {
    colorbalance: 'rs=0.06:gs=0.02:bs=-0.08:rm=0.04:gm=0.01:bm=-0.05',
    eq: 'contrast=1.03:brightness=0.01',
  },
  cool: {
    colorbalance: 'rs=-0.06:gs=-0.01:bs=0.08:rm=-0.04:gm=0.0:bm=0.05',
    eq: 'contrast=1.04:brightness=-0.01',
  },
  neutral: {
    colorbalance: 'rs=0:gs=0:bs=0',
  },
};

/** Visual style → subtle color grade overlay */
const STYLE_GRADES: Record<string, Partial<ColorGradeParams>> = {
  cinematic: {
    colorbalance: 'rh=-0.03:gh=-0.01:bh=0.04',
    eq: 'contrast=1.08:brightness=-0.02:saturation=1.1',
  },
  anime: {
    eq: 'contrast=1.12:saturation=1.25:brightness=0.02',
  },
  watercolor: {
    eq: 'contrast=0.92:saturation=0.85:brightness=0.03',
  },
  documentary: {
    colorbalance: 'rs=-0.02:gs=0:bs=0.02',
    eq: 'contrast=1.05:saturation=0.9',
  },
  flat: {
    eq: 'contrast=0.95:saturation=1.15:brightness=0.01',
  },
  realistic: {
    eq: 'contrast=1.02:saturation=1.0',
  },
};

/**
 * Build FFmpeg color grading filter string from style metadata.
 * Returns an empty string if no grading is needed (neutral + no style match).
 *
 * Usage: append to -vf chain, e.g. `scale=...,pad=...,setsar=1,${colorGradeFilter}`
 */
export function buildColorGradeFilter(
  colorTemperature: string,
  visualStyle: string,
): string {
  const filters: string[] = [];

  // 1. Temperature-based colorbalance
  const tempGrade = TEMPERATURE_GRADES[colorTemperature] ?? TEMPERATURE_GRADES.neutral;
  if (tempGrade.colorbalance && tempGrade.colorbalance !== 'rs=0:gs=0:bs=0') {
    filters.push(`colorbalance=${tempGrade.colorbalance}`);
  }

  // 2. Style-based overlay
  const styleLower = visualStyle.toLowerCase();
  const styleKey = Object.keys(STYLE_GRADES).find(k => styleLower.includes(k));
  const styleGrade = styleKey ? STYLE_GRADES[styleKey] : undefined;

  // Merge style colorbalance with temperature (additive would be complex; style takes precedence for highlights)
  if (styleGrade?.colorbalance) {
    filters.push(`colorbalance=${styleGrade.colorbalance}`);
  }

  // 3. EQ adjustments (contrast/brightness/saturation)
  // Merge: prefer style eq if available, otherwise temperature eq
  const eqStr = styleGrade?.eq ?? tempGrade.eq;
  if (eqStr) {
    filters.push(`eq=${eqStr}`);
  }

  return filters.join(',');
}

/**
 * Check whether a color grade filter would be non-empty for the given params.
 */
export function hasColorGrading(colorTemperature: string, visualStyle: string): boolean {
  return buildColorGradeFilter(colorTemperature, visualStyle).length > 0;
}
