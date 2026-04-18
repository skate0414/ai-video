/* ------------------------------------------------------------------ */
/*  Pass 8: Storyboard – IR lowering (ScriptCIR → StoryboardCIR)     */
/*  Lowers abstract script into concrete visual scene descriptions.  */
/* ------------------------------------------------------------------ */

import type { AIAdapter, Scene, GenerationPlan, LogEntry, StoryboardReplicationSettings, StoryboardReferenceScene } from '../types.js';
import type { StyleAnalysisCIR, ScriptCIR, FormatSignature, ShotCIR } from '../../cir/types.js';
import { STORYBOARD_PROMPT, fillTemplate } from '../prompts.js';
import { extractAndValidateJSON } from '../../adapters/responseParser.js';
import { STORYBOARD_SCHEMA } from '../../adapters/schemaValidator.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';

const slog = createLogger('Storyboard');

export interface StoryboardInput {
  topic: string;
  /** Validated CIR — primary source of all visual/style constraints. */
  styleCIR: StyleAnalysisCIR;
  /** Validated CIR — primary source of script content. */
  scriptCIR: ScriptCIR;
  generationPlan?: GenerationPlan;
  /** FormatSignature for series visual motif inheritance (optional). */
  formatSignature?: FormatSignature;
  /** ShotCIR for shot→scene alignment (optional). When provided, scenes
   *  are grouped by reference-video shot boundaries instead of 1:1 sentence mapping. */
  shotCIR?: ShotCIR;
  /** Optional storyboard replication settings (scene scaffold from another project). */
  replicationSettings?: StoryboardReplicationSettings;
}

const log = createStageLog('STORYBOARD');
const MIN_VISUAL_PROMPT_LEN = 80;
const HIGH_REPLICATION_PROMPT_WORDS = 24;

/**
 * Run the storyboard stage:
 * Convert script into scene-by-scene visual prompts with production specs.
 * Consumes validated CIR — no raw styleProfile/scriptOutput reads.
 */
export async function runStoryboard(
  adapter: AIAdapter,
  input: StoryboardInput,
  onLog?: (entry: LogEntry) => void,
): Promise<Scene[]> {
  const emit = onLog ?? (() => {});
  const { styleCIR, scriptCIR } = input;

  // All structured fields come from validated CIRs — no raw ?? fallback chains
  const { visualTrack } = styleCIR;
  const defaultDurationSec = Math.max(1, visualTrack.sceneAvgDurationSec || 1);
  const sceneStructure = input.shotCIR && input.shotCIR.totalShots > 0
    ? buildShotAlignedScenes(scriptCIR, input.shotCIR, defaultDurationSec)
    : buildSceneStructure(scriptCIR, defaultDurationSec);

  emit(log('Generating storyboard with visual prompts...'));

  // Visual metaphor mapping: CIR already normalises this — no legacy format handling needed
  const vmm = visualTrack.visualMetaphorMapping;
  const vmmRule = vmm.rule;
  const vmmExamples = vmm.examples.length > 0
    ? vmm.examples.map(e => `- ${e.concept} → ${e.visual}`).join('\n')
    : '(no examples available from reference)';

  const prompt = fillTemplate(STORYBOARD_PROMPT, {
    topic: input.topic,
    script_text: scriptCIR.fullText,
    target_scene_count: sceneStructure.length,
    scene_structure_json: JSON.stringify(
      sceneStructure.map((scene) => ({
        number: scene.number,
        narrative: scene.narrative,
      })),
      null,
      2,
    ),
    base_medium: visualTrack.baseMedium,
    lighting_style: visualTrack.lightingStyle,
    camera_motion: visualTrack.cameraMotion,
    color_temperature: visualTrack.colorTemperature,
    color_palette: styleCIR.colorPalette.join(', '),
    color_palette_by_mood: '{}',
    composition_style: visualTrack.compositionStyle,
    transition_style: visualTrack.transitionStyle,
    scene_avg_duration_sec: visualTrack.sceneAvgDurationSec,
    visual_metaphor_mapping_rule: vmmRule,
    visual_metaphor_mapping_examples: vmmExamples,
    series_visual_motifs_section: (() => {
      const fs = input.formatSignature;
      if (!fs?.seriesVisualMotifs) return '(No series visual motifs available — use the visual metaphor mapping above.)';
      const m = fs.seriesVisualMotifs;
      return [
        'Apply these visual treatment categories consistently across all episodes in this series:',
        '',
        `- **Hook scenes** (opening): ${m.hookMotif}`,
        `- **Mechanism scenes** (explanation): ${m.mechanismMotif}`,
        `- **Climax scenes** (peak): ${m.climaxMotif}`,
        `- **Reflection scenes** (closing): ${m.reflectionMotif}`,
        '',
        'Match each scene to its narrative phase and apply the corresponding visual motif.',
        'The specific SUBJECT changes per topic, but the VISUAL TREATMENT CATEGORY must remain consistent.',
      ].join('\n');
    })(),
    storyboard_replication_section: buildStoryboardReplicationSection(input.replicationSettings),
  });
  slog.debug('prompt_preview', { content: prompt.slice(0, 500) });

  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
  });
  slog.debug('response_received', { length: (result.text ?? '').length });
  slog.debug('response_preview', { content: (result.text ?? '').slice(0, 1000) });

  const storyboardData = extractAndValidateJSON<any>(result.text ?? '', STORYBOARD_SCHEMA, 'storyboard');
  slog.debug('parsed_result', { sceneCount: storyboardData?.scenes?.length ?? 0 });
  if (!storyboardData?.scenes?.length) {
    // Fallback: deterministic structure with basic visual prompts
    emit(log('Warning: Could not parse storyboard JSON, generating from script sentences', 'warning'));
    return sceneStructure;
  }

  const aiScenes = Array.isArray(storyboardData.scenes) ? storyboardData.scenes : [];
  const scenes: Scene[] = sceneStructure.map((baseScene, i) => {
    const aiScene = aiScenes[i] ?? {};
    return {
      ...baseScene,
      visualPrompt: aiScene.visualPrompt ?? baseScene.visualPrompt,
      productionSpecs: {
        camera: aiScene.productionSpecs?.camera ?? baseScene.productionSpecs.camera,
        lighting: aiScene.productionSpecs?.lighting ?? baseScene.productionSpecs.lighting,
        sound: aiScene.productionSpecs?.sound ?? baseScene.productionSpecs.sound,
        notes: aiScene.productionSpecs?.notes ?? baseScene.productionSpecs.notes,
      },
    };
  });

  const enhancedScenes = enforceSceneQuality(scenes, styleCIR);
  const replicatedScenes = applyStoryboardReplication(enhancedScenes, input.replicationSettings);

  if (input.replicationSettings?.enabled) {
    emit(log(`Storyboard replication applied (strength=${input.replicationSettings.strength}, references=${input.replicationSettings.referenceScenes?.length ?? 0})`, 'info'));
  }

  emit(log(`Storyboard complete: ${replicatedScenes.length} scenes generated`, 'success'));

  return replicatedScenes;
}

function buildStoryboardReplicationSection(replication?: StoryboardReplicationSettings): string {
  if (!replication?.enabled) {
    return 'Replication mode: disabled. Use only current script and style constraints.';
  }

  const strengthGuidance: Record<NonNullable<StoryboardReplicationSettings['strength']>, string> = {
    low: 'Preserve current content priority; only softly borrow camera/lighting cadence from blueprint.',
    medium: 'Balance current content with reference rhythm; align scene pacing and cinematography patterns.',
    high: 'Strongly mirror reference shot rhythm/camera cadence while keeping topic semantics strictly on current script.',
  };

  const refs = replication.referenceScenes ?? [];
  const header = [
    `Replication mode: enabled (${replication.strength}).`,
    strengthGuidance[replication.strength],
    replication.sourceProjectId ? `Reference project: ${replication.sourceProjectId}` : '',
    replication.notes ? `Creative brief: ${replication.notes}` : '',
  ].filter(Boolean).join('\n');

  if (refs.length === 0) {
    return `${header}\nNo reference scene blueprint provided; preserve style consistency using existing constraints only.`;
  }

  const compactBlueprint = refs.slice(0, 8).map((scene) => ({
    number: scene.number,
    narrative: scene.narrative,
    camera: scene.camera,
    lighting: scene.lighting,
    estimatedDuration: scene.estimatedDuration,
  }));

  return [
    header,
    'Reference storyboard blueprint (style/rhythm cues only, do not copy literal subject matter):',
    JSON.stringify(compactBlueprint, null, 2),
    'Keep the new topic accurate; apply only structure, shot rhythm, and cinematography cadence.',
  ].join('\n');
}

function trimWords(text: string, maxWords: number): string {
  return text.split(/\s+/).filter(Boolean).slice(0, maxWords).join(' ');
}

function applyStoryboardReplication(scenes: Scene[], replication?: StoryboardReplicationSettings): Scene[] {
  if (!replication?.enabled) return scenes;
  const refs = replication.referenceScenes ?? [];
  if (refs.length === 0) return scenes;

  return scenes.map((scene, index) => {
    const ref: StoryboardReferenceScene = refs[index % refs.length];
    const currentCamera = scene.productionSpecs.camera ?? '';
    const currentLighting = scene.productionSpecs.lighting ?? '';

    let camera = currentCamera;
    let lighting = currentLighting;
    let estimatedDuration = scene.estimatedDuration;
    let visualPrompt = scene.visualPrompt;

    if (replication.strength === 'low') {
      camera = currentCamera || ref.camera || currentCamera;
      lighting = currentLighting || ref.lighting || currentLighting;
    } else {
      camera = ref.camera || currentCamera;
      lighting = ref.lighting || currentLighting;
    }

    if (typeof ref.estimatedDuration === 'number' && Number.isFinite(ref.estimatedDuration) && ref.estimatedDuration > 0) {
      if (replication.strength === 'medium') {
        estimatedDuration = Math.max(1, Math.round(((scene.estimatedDuration + ref.estimatedDuration) / 2) * 100) / 100);
      } else if (replication.strength === 'high') {
        estimatedDuration = ref.estimatedDuration;
      }
    }

    if (replication.strength === 'high' && ref.visualPrompt) {
      const cue = trimWords(ref.visualPrompt, HIGH_REPLICATION_PROMPT_WORDS);
      if (cue && !visualPrompt.includes('Shot rhythm reference:')) {
        visualPrompt = `${visualPrompt} Shot rhythm reference: ${cue}.`;
      }
    }

    return {
      ...scene,
      visualPrompt,
      estimatedDuration,
      productionSpecs: {
        ...scene.productionSpecs,
        camera,
        lighting,
      },
    };
  });
}

/**
 * Post-process storyboard scenes to ensure a minimum prompt richness.
 * This raises baseline per-scene visual quality even when model output is terse.
 */
function enforceSceneQuality(scenes: Scene[], styleCIR: StyleAnalysisCIR): Scene[] {
  const visualTrack = styleCIR.visualTrack;
  const palette = styleCIR.colorPalette.join(', ');

  return scenes.map((scene) => {
    const camera = scene.productionSpecs.camera?.trim() || visualTrack.cameraMotion || 'medium shot';
    const lighting = scene.productionSpecs.lighting?.trim() || visualTrack.lightingStyle || 'soft key light';
    let visualPrompt = (scene.visualPrompt ?? '').trim();

    if (visualPrompt.length < MIN_VISUAL_PROMPT_LEN) {
      const qualitySuffix = [
        `Style: ${styleCIR.visualStyle}.`,
        `Camera: ${camera}.`,
        `Lighting: ${lighting}.`,
        `Color palette: ${palette}.`,
      ].join(' ');
      visualPrompt = `${visualPrompt || `3D animated scene depicting: ${scene.narrative}`} ${qualitySuffix}`.trim();
    }

    return {
      ...scene,
      visualPrompt,
      productionSpecs: {
        ...scene.productionSpecs,
        camera,
        lighting,
      },
    };
  });
}

/**
 * Shot-aligned scene construction: group sentences into scenes matching
 * the reference video's shot boundaries. Each shot maps to one scene;
 * sentences are distributed across shots proportionally by duration.
 *
 * When there are more shots than sentences, adjacent shots are merged.
 * When there are more sentences than shots, sentences are distributed
 * proportionally by shot duration.
 */
/** @internal Exported for testing */
export function buildShotAlignedScenes(
  scriptCIR: ScriptCIR,
  shotCIR: ShotCIR,
  defaultDurationSec: number,
): Scene[] {
  const shots = shotCIR.shots;
  const sentences = scriptCIR.sentences;

  if (shots.length === 0) {
    return buildSceneStructure(scriptCIR, defaultDurationSec);
  }

  // Distribute sentences across shots proportionally by shot duration
  const totalDuration = shotCIR.videoDurationSec || shots.reduce((s, sh) => s + sh.durationSec, 0);
  const targetSentencesPerShot = shots.map(sh => sh.durationSec / totalDuration * sentences.length);

  // Greedy assignment: assign whole sentences to shots
  const shotSentences: number[][] = shots.map(() => []);
  let sentenceIdx = 0;
  let accumulated = 0;

  for (let shotIdx = 0; shotIdx < shots.length && sentenceIdx < sentences.length; shotIdx++) {
    accumulated += targetSentencesPerShot[shotIdx];
    const targetCount = Math.round(accumulated) - shotSentences.slice(0, shotIdx).reduce((s, a) => s + a.length, 0);
    const count = Math.max(1, Math.min(targetCount, sentences.length - sentenceIdx));

    for (let j = 0; j < count && sentenceIdx < sentences.length; j++) {
      shotSentences[shotIdx].push(sentenceIdx++);
    }
  }

  // Assign remaining sentences to the last shot
  while (sentenceIdx < sentences.length) {
    shotSentences[shots.length - 1].push(sentenceIdx++);
  }

  // Remove empty shots (can happen if sentences < shots)
  const activeShots = shots
    .map((shot, i) => ({ shot, sentenceIndices: shotSentences[i] }))
    .filter(entry => entry.sentenceIndices.length > 0);

  return activeShots.map((entry, i) => {
    const narrative = entry.sentenceIndices
      .map(si => sentences[si].text.trim())
      .join('');
    const camera = entry.shot.cameraMotion || 'medium shot';

    return {
      id: `scene_${i + 1}`,
      number: i + 1,
      narrative,
      visualPrompt: `${entry.shot.subjectDescription || '3D animated scene depicting'}: ${narrative.slice(0, 100)}`,
      productionSpecs: {
        camera,
        lighting: 'soft key light',
        sound: 'ambient',
        notes: entry.shot.dominantColors.length > 0
          ? `Reference colors: ${entry.shot.dominantColors.join(', ')}`
          : '',
      },
      estimatedDuration: entry.shot.durationSec || defaultDurationSec,
      assetType: 'image' as const,
      status: 'pending' as const,
      logs: [],
    };
  });
}

/**
 * Fallback: generate basic scenes from ScriptCIR sentences when AI parsing fails.
 */
function buildSceneStructure(scriptCIR: ScriptCIR, defaultDurationSec: number): Scene[] {
  return scriptCIR.sentences.map((sentence, i) => ({
    id: `scene_${i + 1}`,
    number: i + 1,
    narrative: sentence.text.trim(),
    visualPrompt: `3D animated scene depicting: ${sentence.text.trim().slice(0, 100)}`,
    productionSpecs: {
      camera: 'medium shot',
      lighting: 'soft key light',
      sound: 'ambient',
      notes: '',
    },
    estimatedDuration: defaultDurationSec,
    assetType: 'image' as const,
    status: 'pending' as const,
    logs: [],
  }));
}

/* ================================================================= */
/*  Storyboard Validation                                             */
/* ================================================================= */

export interface StoryboardValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
}

/**
 * Validate storyboard scenes against the script CIR.
 * Checks: scene count alignment, visual prompt richness, duplicate detection,
 * and asset type distribution sanity.
 */
export function validateStoryboard(
  scenes: Scene[],
  scriptCIR: ScriptCIR,
): StoryboardValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const sentenceCount = scriptCIR.sentences.length;

  // Scene count ≈ sentence count ±2
  if (scenes.length < sentenceCount - 2) {
    errors.push(`场景数不足: ${scenes.length} 个场景 vs ${sentenceCount} 句脚本 (允许 ±2 差值)`);
  } else if (scenes.length > sentenceCount + 2) {
    warnings.push(`场景数偏多: ${scenes.length} 个场景 vs ${sentenceCount} 句脚本 (允许 ±2 差值)`);
  }

  // Visual prompt minimum length
  const shortPrompts = scenes.filter(s => (s.visualPrompt ?? '').length < MIN_VISUAL_PROMPT_LEN);
  if (shortPrompts.length > 0) {
    errors.push(`${shortPrompts.length} 个场景的视觉提示词过短 (< ${MIN_VISUAL_PROMPT_LEN} 字符): 场景 ${shortPrompts.map(s => s.number).join(', ')}`);
  }

  // Duplicate visual prompts
  const promptSet = new Map<string, number[]>();
  for (const scene of scenes) {
    const key = (scene.visualPrompt ?? '').trim().toLowerCase();
    if (!key) continue;
    const ids = promptSet.get(key) ?? [];
    ids.push(scene.number);
    promptSet.set(key, ids);
  }
  const duplicates = [...promptSet.values()].filter(ids => ids.length > 1);
  if (duplicates.length > 0) {
    errors.push(`重复视觉提示词: 场景 ${duplicates.map(ids => ids.join('&')).join(', ')} 拥有完全相同的提示词`);
  }

  // Asset type distribution sanity: at least 80% should be image
  const imageCount = scenes.filter(s => s.assetType === 'image').length;
  if (scenes.length > 0 && imageCount / scenes.length < 0.8) {
    warnings.push(`素材类型分布异常: 仅 ${imageCount}/${scenes.length} (${Math.round(imageCount / scenes.length * 100)}%) 为图片, 预期 ≥ 80%`);
  }

  return { passed: errors.length === 0, errors, warnings };
}
