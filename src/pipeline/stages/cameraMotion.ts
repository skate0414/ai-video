/* ------------------------------------------------------------------ */
/*  Camera Motion → Ken Burns variant mapping                         */
/*  Maps CIR camera motion metadata to FFmpeg zoompan parameters.     */
/* ------------------------------------------------------------------ */

export type KenBurnsVariant = 'center_zoom' | 'pan_left_right' | 'pan_right_left' | 'pan_top_bottom' | 'pan_bottom_top' | 'zoom_out';

/**
 * Map a camera motion string (from CIR production specs) to a Ken Burns variant.
 * Falls back to cycling through variants based on scene index.
 */
export function resolveKenBurnsVariant(cameraMotion: string | undefined, sceneIndex: number): KenBurnsVariant {
  if (!cameraMotion) return CYCLE_VARIANTS[sceneIndex % CYCLE_VARIANTS.length];

  const lower = cameraMotion.toLowerCase();

  // Direct motion keyword matching
  if (lower.includes('static') || lower.includes('locked') || lower.includes('fixed')) {
    return 'center_zoom'; // subtle center zoom for "static" scenes
  }
  if (lower.includes('pan left') || lower.includes('pan_left') || lower.includes('track left') || lower.includes('left to right') || lower.includes('l→r') || lower.includes('l-r')) {
    return 'pan_left_right';
  }
  if (lower.includes('pan right') || lower.includes('pan_right') || lower.includes('track right') || lower.includes('right to left') || lower.includes('r→l') || lower.includes('r-l')) {
    return 'pan_right_left';
  }
  if (lower.includes('tilt down') || lower.includes('pan down') || lower.includes('top') || lower.includes('crane down')) {
    return 'pan_top_bottom';
  }
  if (lower.includes('tilt up') || lower.includes('pan up') || lower.includes('bottom') || lower.includes('crane up') || lower.includes('rise')) {
    return 'pan_bottom_top';
  }
  if (lower.includes('zoom out') || lower.includes('pull back') || lower.includes('dolly out') || lower.includes('wide')) {
    return 'zoom_out';
  }
  if (lower.includes('zoom') || lower.includes('dolly') || lower.includes('push') || lower.includes('close')) {
    return 'center_zoom';
  }
  if (lower.includes('orbit') || lower.includes('arc') || lower.includes('circular')) {
    return 'pan_left_right'; // orbit approximated as pan
  }
  if (lower.includes('tracking') || lower.includes('follow')) {
    return 'pan_left_right';
  }

  // Fallback: cycle
  return CYCLE_VARIANTS[sceneIndex % CYCLE_VARIANTS.length];
}

const CYCLE_VARIANTS: KenBurnsVariant[] = ['center_zoom', 'pan_left_right', 'pan_right_left', 'pan_top_bottom'];

/**
 * Build FFmpeg zoompan filter string for a given Ken Burns variant.
 *
 * @param variant The motion variant to apply
 * @param totalFrames Total number of frames for the animation
 * @param width Target width
 * @param height Target height
 * @param fps Target frame rate
 * @returns FFmpeg filter string (scale + zoompan)
 */
export function buildKenBurnsFilter(
  variant: KenBurnsVariant,
  totalFrames: number,
  width: number,
  height: number,
  fps: number,
): string {
  const resTag = `${width}x${height}`;
  const zoomInc = (0.2 / totalFrames).toFixed(8);

  let x: string;
  let y: string;
  let z: string;

  switch (variant) {
    case 'center_zoom':
      x = "'iw/2-(iw/zoom/2)'";
      y = "'ih/2-(ih/zoom/2)'";
      z = `'min(zoom+${zoomInc},1.2)'`;
      break;
    case 'pan_left_right':
      x = `'if(eq(on,1),0,x+iw/${totalFrames}/zoom)'`;
      y = "'ih/2-(ih/zoom/2)'";
      z = `'min(zoom+${zoomInc},1.2)'`;
      break;
    case 'pan_right_left':
      x = `'if(eq(on,1),iw/zoom-iw/zoom,x-iw/${totalFrames}/zoom)'`;
      y = "'ih/2-(ih/zoom/2)'";
      z = `'min(zoom+${zoomInc},1.2)'`;
      break;
    case 'pan_top_bottom':
      x = "'iw/2-(iw/zoom/2)'";
      y = `'if(eq(on,1),0,y+ih/${totalFrames}/zoom)'`;
      z = `'min(zoom+${zoomInc},1.2)'`;
      break;
    case 'pan_bottom_top':
      x = "'iw/2-(iw/zoom/2)'";
      y = `'if(eq(on,1),ih/zoom-ih/zoom,y-ih/${totalFrames}/zoom)'`;
      z = `'min(zoom+${zoomInc},1.2)'`;
      break;
    case 'zoom_out':
      x = "'iw/2-(iw/zoom/2)'";
      y = "'ih/2-(ih/zoom/2)'";
      z = `'max(zoom-${zoomInc},1.0)'`;
      break;
  }

  return `scale=${width * 1.5}:${height * 1.5},zoompan=z=${z}:x=${x}:y=${y}:d=${totalFrames}:s=${resTag}:fps=${fps}`;
}
