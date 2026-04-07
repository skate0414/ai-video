/* ------------------------------------------------------------------ */
/*  Stage 4: Storyboard – convert script to visual scene descriptions  */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, ScriptOutput, Scene, GenerationPlan, LogEntry } from '../types.js';
import { STORYBOARD_PROMPT, fillTemplate } from '../prompts.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';

export interface StoryboardInput {
  topic: string;
  styleProfile: StyleProfile;
  scriptOutput: ScriptOutput;
  generationPlan?: GenerationPlan;
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

  // Count script sentences for target_scene_count
  const scriptSentences = scriptOutput.scenes?.length
    ?? scriptOutput.scriptText.split('\n').filter(l => l.trim().length > 0).length;
  const targetSceneCount = input.generationPlan?.estimatedSceneCount ?? scriptSentences;

  emit(log('Generating storyboard with visual prompts...'));

  // Extract visual metaphor mapping rule + examples (ai-suite structured format)
  const vmm = trackB.visual_metaphor_mapping;
  let vmmRule = 'Map abstract concepts to visually concrete, cinematic 3D scenes';
  let vmmExamples = '(no examples available from reference)';
  if (vmm && typeof vmm === 'object' && 'rule' in vmm) {
    vmmRule = (vmm as any).rule ?? vmmRule;
    const examples = (vmm as any).examples;
    if (Array.isArray(examples) && examples.length > 0) {
      vmmExamples = examples.map((e: any) => `- ${e.concept} → ${e.metaphor_visual}`).join('\n');
    }
  } else if (vmm && typeof vmm === 'object') {
    const entries = Object.entries(vmm);
    if (entries.length > 0) {
      vmmExamples = entries.map(([k, v]) => `- ${k} → ${v}`).join('\n');
    }
  }

  const prompt = fillTemplate(STORYBOARD_PROMPT, {
    topic: input.topic,
    script_text: scriptOutput.scriptText,
    target_scene_count: targetSceneCount,
    base_medium: trackB.base_medium ?? styleProfile.visualStyle ?? '3D animation',
    lighting_style: trackB.lighting_style ?? 'soft cinematic',
    camera_motion: trackB.camera_motion ?? 'slow pan',
    color_temperature: trackB.color_temperature ?? 'warm',
    color_palette: (styleProfile.colorPalette ?? []).join(', '),
    color_palette_by_mood: JSON.stringify((styleProfile as any).colorPaletteByMood ?? {}),
    composition_style: trackB.composition_style ?? 'centered',
    transition_style: trackB.transition_style ?? 'cut',
    scene_avg_duration_sec: trackB.scene_avg_duration_sec ?? 5,
    visual_metaphor_mapping_rule: vmmRule,
    visual_metaphor_mapping_examples: vmmExamples,
  });
  console.log('[STORYBOARD] prompt preview:', prompt.slice(0, 500));

  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
  });
  console.log('[STORYBOARD] raw response length:', (result.text ?? '').length);
  console.log('[STORYBOARD] raw response preview:', (result.text ?? '').slice(0, 1000));

  const storyboardData = extractJSON<any>(result.text ?? '');
  console.log('[STORYBOARD] parsed scenes count:', storyboardData?.scenes?.length ?? 0);
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

  // Post-validation: warn if scene count diverges significantly from target
  if (Math.abs(scenes.length - targetSceneCount) > 3) {
    emit(log(`Warning: storyboard generated ${scenes.length} scenes but target was ${targetSceneCount}. Scene density may not match reference video.`, 'warning'));
  }

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
