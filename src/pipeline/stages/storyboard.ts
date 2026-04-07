/* ------------------------------------------------------------------ */
/*  Stage 4: Storyboard – convert script to visual scene descriptions  */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, ScriptOutput, Scene, LogEntry } from '../types.js';
import { STORYBOARD_PROMPT, fillTemplate } from '../prompts.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';

export interface StoryboardInput {
  topic: string;
  styleProfile: StyleProfile;
  scriptOutput: ScriptOutput;
}

const log = createStageLog('STORYBOARD');

/**
 * Run the storyboard stage:
 * Convert script into scene-by-scene visual prompts with production specs.
 */
export async function runStoryboard(
  adapter: AIAdapter,
  input: StoryboardInput,
  onLog?: (entry: LogEntry) => void,
): Promise<Scene[]> {
  const emit = onLog ?? (() => {});
  const { styleProfile, scriptOutput } = input;

  const trackB = styleProfile.track_b_visual ?? {};

  emit(log('Generating storyboard with visual prompts...'));

  const prompt = fillTemplate(STORYBOARD_PROMPT, {
    script_text: scriptOutput.scriptText,
    base_medium: trackB.base_medium ?? styleProfile.visualStyle ?? '3D animation',
    lighting_style: trackB.lighting_style ?? 'soft cinematic',
    camera_motion: trackB.camera_motion ?? 'slow pan',
    color_temperature: trackB.color_temperature ?? 'warm',
    color_palette: (styleProfile.colorPalette ?? []).join(', '),
    composition_style: trackB.composition_style ?? 'centered',
    transition_style: trackB.transition_style ?? 'cut',
    scene_avg_duration_sec: trackB.scene_avg_duration_sec ?? 5,
    visual_metaphor_mapping: JSON.stringify(trackB.visual_metaphor_mapping ?? {}),
  });

  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
  });

  const storyboardData = extractJSON<any>(result.text ?? '');
  if (!storyboardData?.scenes?.length) {
    // Fallback: auto-generate scenes from script lines
    emit(log('Warning: Could not parse storyboard JSON, generating from script lines', 'warning'));
    return generateScenesFromScript(scriptOutput);
  }

  const scenes: Scene[] = storyboardData.scenes.map((s: any, i: number) => ({
    id: `scene_${i + 1}`,
    number: s.number ?? i + 1,
    narrative: s.narrative ?? '',
    visualPrompt: s.visualPrompt ?? '',
    productionSpecs: {
      camera: s.productionSpecs?.camera ?? '',
      lighting: s.productionSpecs?.lighting ?? '',
      sound: s.productionSpecs?.sound ?? '',
    },
    estimatedDuration: s.estimatedDuration ?? 5,
    assetType: (s.assetType === 'video' ? 'video' : 'image') as 'image' | 'video' | 'placeholder',
    status: 'pending' as const,
    logs: [],
  }));

  emit(log(`Storyboard complete: ${scenes.length} scenes generated`, 'success'));

  return scenes;
}

/**
 * Fallback: generate basic scenes from script text when AI parsing fails.
 */
function generateScenesFromScript(scriptOutput: ScriptOutput): Scene[] {
  const lines = scriptOutput.scriptText.split('\n').filter(l => l.trim().length > 0);
  return lines.map((line, i) => ({
    id: `scene_${i + 1}`,
    number: i + 1,
    narrative: line.trim(),
    visualPrompt: `3D animated scene depicting: ${line.trim().slice(0, 100)}`,
    productionSpecs: {
      camera: 'medium shot',
      lighting: 'soft key light',
      sound: 'ambient',
    },
    estimatedDuration: 5,
    assetType: 'image' as const,
    status: 'pending' as const,
    logs: [],
  }));
}
