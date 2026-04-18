/* ------------------------------------------------------------------ */
/*  VideoIR prompt semantics projection                               */
/*  Build generation prompts exclusively from compiled VideoIR scene  */
/*  data so downstream stages cannot diverge semantically.            */
/* ------------------------------------------------------------------ */

import type { VideoIR, VideoIRScene } from '../../cir/types.js';
import { IMAGE_GEN_PROMPT, VIDEO_GEN_PROMPT, fillTemplate } from '../prompts.js';

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

export function getAspectRatioFromVideoIR(videoIR: VideoIR): string {
  const { w, h } = videoIR.resolution;
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return '16:9';
  const d = gcd(w, h);
  return `${Math.floor(w / d)}:${Math.floor(h / d)}`;
}

export function getVideoIRScene(videoIR: VideoIR, sceneNumber: number, fallbackIndex: number): VideoIRScene {
  const byNumber = videoIR.scenes[sceneNumber - 1];
  if (byNumber) return byNumber;
  const byIndex = videoIR.scenes[fallbackIndex];
  if (!byIndex) {
    throw new Error(`VideoIR scene not found for sceneNumber=${sceneNumber}, index=${fallbackIndex}`);
  }
  return byIndex;
}

export function buildImagePromptFromVideoIRScene(
  irScene: VideoIRScene,
  aspectRatio: string,
  /** Dominant colors extracted from the previous scene's reference image for palette continuity. */
  previousScenePalette?: readonly string[],
): string {
  const paletteBase = irScene.colorPalette.join(', ');
  const paletteStr = previousScenePalette && previousScenePalette.length > 0
    ? `${paletteBase} | Continuity from previous scene: ${previousScenePalette.join(', ')}`
    : paletteBase;
  return fillTemplate(IMAGE_GEN_PROMPT, {
    visual_prompt: irScene.visualPrompt,
    color_palette: paletteStr,
    lighting_style: irScene.lightingStyle,
    visual_style: irScene.visualStyle,
    aspect_ratio: aspectRatio,
  });
}

export function buildVideoPromptFromVideoIRScene(
  irScene: VideoIRScene,
  aspectRatio: string,
  durationSec: number,
  styleAnchor?: string,
): string {
  return fillTemplate(VIDEO_GEN_PROMPT, {
    visual_prompt: irScene.visualPrompt,
    color_palette: irScene.colorPalette.join(', '),
    lighting_style: irScene.lightingStyle,
    visual_style: irScene.visualStyle,
    aspect_ratio: aspectRatio,
    duration: String(durationSec),
    style_anchor: styleAnchor ?? '',
  });
}

/**
 * Build a negative prompt for image generation based on style context.
 * Helps generators avoid common quality pitfalls and style contradictions.
 */
const STYLE_EXCLUSIONS: Record<string, string> = {
  'cinematic':   'cartoon, anime, flat illustration, clip art, low quality',
  'anime':       'photorealistic, live-action, 3D render',
  'watercolor':  'photorealistic, sharp edges, digital render, neon',
  'flat':        '3D, photorealistic, cinematic, depth of field',
  'realistic':   'cartoon, anime, illustration, clip art',
  '3d':          'flat illustration, 2D, hand-drawn, sketch',
};

const BASE_NEGATIVE = 'blurry, distorted, deformed, watermark, text overlay, low resolution, cropped, out of frame, duplicate, ugly';

export function buildNegativePrompt(visualStyle: string): string {
  const styleLower = visualStyle.toLowerCase();
  const extra = Object.entries(STYLE_EXCLUSIONS)
    .filter(([key]) => styleLower.includes(key))
    .map(([, val]) => val);
  return extra.length > 0 ? `${BASE_NEGATIVE}, ${extra.join(', ')}` : BASE_NEGATIVE;
}
