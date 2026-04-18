import { describe, expect, it } from 'vitest';
import { resolveKenBurnsVariant, buildKenBurnsFilter, type KenBurnsVariant } from './cameraMotion.js';

describe('resolveKenBurnsVariant', () => {
  it('returns center_zoom for "static"', () => {
    expect(resolveKenBurnsVariant('static', 0)).toBe('center_zoom');
  });

  it('returns center_zoom for "locked shot"', () => {
    expect(resolveKenBurnsVariant('locked shot', 0)).toBe('center_zoom');
  });

  it('returns pan_left_right for "pan left"', () => {
    expect(resolveKenBurnsVariant('pan left across scene', 0)).toBe('pan_left_right');
  });

  it('returns pan_left_right for "track left"', () => {
    expect(resolveKenBurnsVariant('track left', 0)).toBe('pan_left_right');
  });

  it('returns pan_right_left for "pan right"', () => {
    expect(resolveKenBurnsVariant('slow pan right', 0)).toBe('pan_right_left');
  });

  it('returns pan_top_bottom for "tilt down"', () => {
    expect(resolveKenBurnsVariant('tilt down to reveal', 0)).toBe('pan_top_bottom');
  });

  it('returns pan_top_bottom for "crane down"', () => {
    expect(resolveKenBurnsVariant('crane down', 0)).toBe('pan_top_bottom');
  });

  it('returns pan_bottom_top for "tilt up"', () => {
    expect(resolveKenBurnsVariant('tilt up', 0)).toBe('pan_bottom_top');
  });

  it('returns pan_bottom_top for "rise"', () => {
    expect(resolveKenBurnsVariant('slow rise over city', 0)).toBe('pan_bottom_top');
  });

  it('returns zoom_out for "zoom out"', () => {
    expect(resolveKenBurnsVariant('zoom out slowly', 0)).toBe('zoom_out');
  });

  it('returns zoom_out for "pull back"', () => {
    expect(resolveKenBurnsVariant('pull back to wide', 0)).toBe('zoom_out');
  });

  it('returns center_zoom for "zoom in"', () => {
    expect(resolveKenBurnsVariant('zoom into detail', 0)).toBe('center_zoom');
  });

  it('returns center_zoom for "push in"', () => {
    expect(resolveKenBurnsVariant('push towards subject', 0)).toBe('center_zoom');
  });

  it('returns pan_left_right for "orbit"', () => {
    expect(resolveKenBurnsVariant('orbit around subject', 0)).toBe('pan_left_right');
  });

  it('returns pan_left_right for "tracking"', () => {
    expect(resolveKenBurnsVariant('tracking shot', 0)).toBe('pan_left_right');
  });

  it('cycles variants for undefined cameraMotion', () => {
    const results: KenBurnsVariant[] = [];
    for (let i = 0; i < 4; i++) {
      results.push(resolveKenBurnsVariant(undefined, i));
    }
    expect(results).toEqual([
      'center_zoom', 'pan_left_right', 'pan_right_left', 'pan_top_bottom',
    ]);
  });

  it('cycles back to first variant at index 4', () => {
    expect(resolveKenBurnsVariant(undefined, 4)).toBe('center_zoom');
  });

  it('falls back to cycle for unrecognized motion', () => {
    // Unrecognized motion should cycle like undefined
    expect(resolveKenBurnsVariant('xyzzy123', 0)).toBe('center_zoom');
    expect(resolveKenBurnsVariant('xyzzy123', 1)).toBe('pan_left_right');
  });
});

describe('buildKenBurnsFilter', () => {
  const W = 1920;
  const H = 1080;
  const FPS = 30;
  const FRAMES = 150; // 5 seconds

  it('returns a filter string containing zoompan', () => {
    const filter = buildKenBurnsFilter('center_zoom', FRAMES, W, H, FPS);
    expect(filter).toContain('zoompan');
  });

  it('includes scale pre-filter', () => {
    const filter = buildKenBurnsFilter('center_zoom', FRAMES, W, H, FPS);
    expect(filter).toContain('scale=');
  });

  it('includes target resolution', () => {
    const filter = buildKenBurnsFilter('center_zoom', FRAMES, W, H, FPS);
    expect(filter).toContain(`s=${W}x${H}`);
  });

  it('includes correct fps', () => {
    const filter = buildKenBurnsFilter('center_zoom', FRAMES, W, H, FPS);
    expect(filter).toContain(`fps=${FPS}`);
  });

  it('includes correct frame count', () => {
    const filter = buildKenBurnsFilter('center_zoom', FRAMES, W, H, FPS);
    expect(filter).toContain(`d=${FRAMES}`);
  });

  it('uses zoom decrement for zoom_out', () => {
    const filter = buildKenBurnsFilter('zoom_out', FRAMES, W, H, FPS);
    expect(filter).toContain('max(zoom-');
  });

  it('uses zoom increment for center_zoom', () => {
    const filter = buildKenBurnsFilter('center_zoom', FRAMES, W, H, FPS);
    expect(filter).toContain('min(zoom+');
  });

  it('uses horizontal panning for pan_left_right', () => {
    const filter = buildKenBurnsFilter('pan_left_right', FRAMES, W, H, FPS);
    expect(filter).toContain('x+iw/');
  });

  it('uses vertical panning for pan_top_bottom', () => {
    const filter = buildKenBurnsFilter('pan_top_bottom', FRAMES, W, H, FPS);
    expect(filter).toContain('y+ih/');
  });
});
