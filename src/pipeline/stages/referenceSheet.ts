/* ------------------------------------------------------------------ */
/*  Reference Sheet – global style anchor for visual codegen          */
/*  Generates a single composite image that constrains all per-scene */
/*  image generation to maintain visual consistency.                  */
/* ------------------------------------------------------------------ */

import type { AIAdapter, LogEntry } from '../types.js';
import { REFERENCE_SHEET_PROMPT, fillTemplate } from '../prompts.js';
import { createStageLog } from './stageLog.js';
import { writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const log = createStageLog('REFERENCE_IMAGE');

/**
 * Generates a "Style Reference Sheet" image — a single image capturing
 * the global visual identity (palette, lighting, style, key elements).
 *
 * Downstream stages (reference image per scene, keyframe gen) include
 * this sheet as an inlineData visual anchor so the generation model can
 * "see" the target style rather than relying on text alone.
 *
 * Returns a base64 data-URI string, or `undefined` if generation fails.
 * Also saves the image to `assetsDir/reference_sheet.png`.
 */
export async function generateReferenceSheet(
  adapter: AIAdapter,
  topic: string,
  styleContext: {
    visualStyle: string;
    colorPalette: readonly string[];
    lightingStyle: string;
    aspectRatio: string;
    keyElements?: readonly string[];
    pedagogicalApproach?: string;
  },
  assetsDir: string,
  onLog?: (entry: LogEntry) => void,
): Promise<string | undefined> {
  const emit = onLog ?? (() => {});

  const prompt = fillTemplate(REFERENCE_SHEET_PROMPT, {
    topic,
    visual_style: styleContext.visualStyle,
    color_palette: styleContext.colorPalette.join(', '),
    key_elements: (styleContext.keyElements ?? []).join(', '),
    lighting_style: styleContext.lightingStyle,
    pedagogical_approach: styleContext.pedagogicalApproach ?? '',
    aspect_ratio: styleContext.aspectRatio,
  });

  emit(log('Generating style reference sheet...'));

  try {
    const result = await adapter.generateImage(
      '',
      prompt,
      styleContext.aspectRatio,
    );

    let base64: string | undefined;

    if (result.base64) {
      base64 = result.base64;
    } else if (result.imageUrl) {
      // imageUrl is a local path — not a base64 URI
      // We still return the path so callers can read it later
      emit(log('Reference sheet generated (file path)', 'success'));
      return result.imageUrl;
    }

    if (base64) {
      // Persist to disk
      if (!existsSync(assetsDir)) mkdirSync(assetsDir, { recursive: true });
      const match = base64.match(/^data:image\/(\w+);base64,(.+)$/);
      const ext = match?.[1] ?? 'png';
      const b64data = match?.[2] ?? base64;
      const filePath = join(assetsDir, `reference_sheet.${ext}`);
      writeFileSync(filePath, Buffer.from(b64data, 'base64'));
      emit(log('Reference sheet generated and saved', 'success'));
      return base64;
    }

    emit(log('Reference sheet generation returned no image data', 'warning'));
    return undefined;
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    emit(log(`Reference sheet generation failed: ${msg} — proceeding without visual anchor`, 'warning'));
    return undefined;
  }
}
