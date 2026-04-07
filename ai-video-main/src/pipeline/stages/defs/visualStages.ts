/* ------------------------------------------------------------------ */
/*  Stage definitions – visual group                                  */
/*  (STORYBOARD, REFERENCE_IMAGE, KEYFRAME_GEN)                       */
/* ------------------------------------------------------------------ */

import { registerStage, type StageRunContext } from '../../stageRegistry.js';
import { runStoryboard } from '../storyboard.js';
import { runSubjectIsolation, applySubjectIsolationFixes } from '../subjectIsolation.js';
import { runReferenceImage } from '../referenceImage.js';
import { runKeyframeGen } from '../keyframeGen.js';
import type { Scene } from '../../types.js';

const DEFAULT_MIN_VIDEO_SCENES = 2;

function getMinVideoScenes(): number {
  const raw = Number(process.env.MIN_VIDEO_SCENES ?? DEFAULT_MIN_VIDEO_SCENES);
  if (!Number.isFinite(raw)) return DEFAULT_MIN_VIDEO_SCENES;
  return Math.max(0, Math.floor(raw));
}

function ensureMinVideoScenes(scenes: Scene[], minVideoScenes: number): { scenes: Scene[]; promoted: number } {
  if (minVideoScenes <= 0 || scenes.length === 0) return { scenes, promoted: 0 };
  const currentVideoCount = scenes.filter((s) => s.assetType === 'video').length;
  if (currentVideoCount >= minVideoScenes) return { scenes, promoted: 0 };
  const need = Math.min(minVideoScenes - currentVideoCount, scenes.length - currentVideoCount);
  if (need <= 0) return { scenes, promoted: 0 };
  const next = scenes.map((scene) => ({ ...scene }));
  const candidates = next
    .filter((s) => s.assetType !== 'video')
    .sort((a, b) => (b.estimatedDuration ?? 0) - (a.estimatedDuration ?? 0));
  let promoted = 0;
  for (const candidate of candidates) {
    if (promoted >= need) break;
    candidate.assetType = 'video';
    promoted++;
  }
  return { scenes: next, promoted };
}

/* ---- 7. STORYBOARD (includes subject isolation sub-step) ---- */

registerStage({
  stage: 'STORYBOARD',
  async execute(ctx: StageRunContext) {
    const { project, addLog } = ctx;
    project.styleProfile ??= ctx.loadArtifact('style-profile.json');
    project.scriptOutput ??= ctx.loadArtifact('script.json');

    const adapter = ctx.getSessionAwareAdapter('STORYBOARD', 'visual_prompts', project.modelOverrides);
    const scenes = await runStoryboard(adapter, {
      topic: project.topic,
      styleProfile: project.styleProfile!,
      scriptOutput: project.scriptOutput!,
      generationPlan: project.generationPlan,
    }, addLog);

    // Subject isolation check
    const isolationResult = await runSubjectIsolation(adapter, {
      scenes,
      styleProfile: project.styleProfile!,
    }, addLog);
    ctx.saveArtifact('subject-isolation.json', isolationResult);

    let finalScenes = isolationResult.failedCount > 0
      ? applySubjectIsolationFixes(scenes, isolationResult)
      : scenes;

    // Enforce minimum video scenes
    const minVideoScenes = getMinVideoScenes();
    const enforced = ensureMinVideoScenes(finalScenes, minVideoScenes);
    finalScenes = enforced.scenes;
    if (enforced.promoted > 0) {
      addLog({
        id: `log_${Date.now()}`,
        timestamp: new Date().toISOString(),
        message: `Enforced minimum video scenes: promoted ${enforced.promoted} scene(s) to assetType=video (target=${minVideoScenes})`,
        type: 'warning',
        stage: 'STORYBOARD',
      });
    }

    project.scenes = finalScenes;
    ctx.saveArtifact('scenes.json', finalScenes);
  },
});

/* ---- 8. REFERENCE_IMAGE ---- */

registerStage({
  stage: 'REFERENCE_IMAGE',
  async execute(ctx: StageRunContext) {
    const { project, assetsDir, addLog } = ctx;
    project.styleProfile ??= ctx.loadArtifact('style-profile.json');
    project.scenes ??= ctx.loadArtifact('scenes.json') ?? [];

    const adapter = ctx.getSessionAwareAdapter('REFERENCE_IMAGE', 'image_generation', project.modelOverrides);
    const updatedScenes = await runReferenceImage(adapter, {
      scenes: project.scenes!,
      styleProfile: project.styleProfile!,
      assetsDir,
      topic: project.topic,
    }, addLog);
    project.scenes = updatedScenes;
    ctx.saveArtifact('scenes.json', updatedScenes);
  },
});

/* ---- 9. KEYFRAME_GEN ---- */

registerStage({
  stage: 'KEYFRAME_GEN',
  async execute(ctx: StageRunContext) {
    const { project, assetsDir, addLog } = ctx;
    project.styleProfile ??= ctx.loadArtifact('style-profile.json');
    project.scenes ??= ctx.loadArtifact('scenes.json') ?? [];

    const adapter = ctx.getSessionAwareAdapter('KEYFRAME_GEN', 'image_generation', project.modelOverrides);
    const updatedScenes = await runKeyframeGen(adapter, {
      scenes: project.scenes!,
      styleProfile: project.styleProfile!,
      assetsDir,
    }, addLog);
    project.scenes = updatedScenes;
    ctx.saveArtifact('scenes.json', updatedScenes);
  },
});
