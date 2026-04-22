/* ------------------------------------------------------------------ */
/*  Pass definitions – visual group (IR lowering passes)              */
/*  (STORYBOARD, REFERENCE_IMAGE, KEYFRAME_GEN)                       */
/*  These passes lower ScriptCIR into StoryboardCIR and then into   */
/*  concrete visual assets (images) for video codegen.               */
/* ------------------------------------------------------------------ */

import { ARTIFACT } from '@ai-video/pipeline-core/constants.js';
import { registerStage, type StageRunContext } from '@ai-video/pipeline-core/stageRegistry.js';
import {
  applySubjectIsolationFixes,
  CharacterTracker,
  compileVideoIR,
  runKeyframeGen,
  runReferenceImage,
  runStoryboard,
  runSubjectIsolation,
  validateStoryboard,
} from '@ai-video/pipeline-core/stages/index.js';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { Scene } from '@ai-video/pipeline-core/pipelineTypes.js';
import { parseStoryboardCIR } from '../../cir/parsers.js';
import { loadFormatSignature, loadScriptCIR, loadStyleCIR, loadVideoIR, loadShotCIR } from '../../cir/loader.js';
import type { TemporalPlanCIR, StoryboardCIR, ShotCIR } from '../../cir/types.js';
import { CIRValidationError } from '../../cir/errors.js';
import { CANDIDATE_COUNT } from '@ai-video/pipeline-core/constants.js';

const DEFAULT_MIN_VIDEO_SCENES = 2;

function getMinVideoScenes(): number {
  const raw = Number(process.env.MIN_VIDEO_SCENES ?? DEFAULT_MIN_VIDEO_SCENES);
  if (!Number.isFinite(raw)) return DEFAULT_MIN_VIDEO_SCENES;
  return Math.max(0, Math.floor(raw));
}

/* ---- 7. STORYBOARD (includes subject isolation sub-step) ---- */

registerStage({
  stage: 'STORYBOARD',
  after: 'TEMPORAL_PLANNING',
  async execute(ctx: StageRunContext) {
    const { project, addLog } = ctx;
    project.styleProfile = ctx.loadArtifact(ARTIFACT.STYLE_PROFILE) ?? project.styleProfile;
    project.scriptOutput = ctx.loadArtifact(ARTIFACT.SCRIPT) ?? project.scriptOutput;

    // Load validated CIRs — fail closed if missing or invalid
    const styleCIR = loadStyleCIR(ctx, 'STORYBOARD');
    const scriptCIR = loadScriptCIR(ctx, 'STORYBOARD');
    const shotCIR = loadShotCIR(ctx, 'STORYBOARD');

    const adapter = ctx.getSessionAwareAdapter('STORYBOARD', 'visual_prompts', project.modelOverrides);
    const scenes = await runStoryboard(adapter, {
      topic: project.topic,
      styleCIR,
      scriptCIR,
      generationPlan: project.generationPlan,
      formatSignature: loadFormatSignature(ctx, 'STORYBOARD'),
      shotCIR,
      replicationSettings: project.storyboardReplication,
    }, addLog);

    // Subject isolation check (uses validated CIR)
    const isolationResult = await runSubjectIsolation(adapter, {
      scenes,
      styleCIR,
    }, addLog);
    ctx.saveArtifact(ARTIFACT.SUBJECT_ISOLATION, isolationResult);

    let finalScenes = isolationResult.failedCount > 0
      ? applySubjectIsolationFixes(scenes, isolationResult)
      : scenes;

    // Character consistency — extract identities and inject anchors
    const tracker = new CharacterTracker();
    tracker.extractCharacters(finalScenes);
    tracker.injectCharacterAnchors(finalScenes);

    project.scenes = finalScenes;
    ctx.saveArtifact(ARTIFACT.SCENES, finalScenes);

    // Storyboard validation — scene count, prompt quality, duplicates
    const sbValidation = validateStoryboard(finalScenes, scriptCIR);
    ctx.saveArtifact('storyboard-validation.json', sbValidation);
    if (sbValidation.warnings.length > 0) {
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Storyboard validation warnings: ${sbValidation.warnings.join('; ')}`, type: 'warning', stage: 'STORYBOARD' });
    }
    if (!sbValidation.passed) {
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Storyboard validation errors: ${sbValidation.errors.join('; ')}`, type: 'warning', stage: 'STORYBOARD' });
    }

    // Parse into CIR — validated scene structure for downstream production stages
    const storyboardCIR = parseStoryboardCIR(finalScenes);
    ctx.saveArtifact(ARTIFACT.STORYBOARD_CIR, storyboardCIR);
  },
});

/* ---- 8. VIDEO_IR_COMPILE ---- */

registerStage({
  stage: 'VIDEO_IR_COMPILE',
  after: 'STORYBOARD',
  async execute(ctx: StageRunContext) {
    const { project, addLog } = ctx;

    const styleCIR = loadStyleCIR(ctx, 'VIDEO_IR_COMPILE');
    const scriptCIR = loadScriptCIR(ctx, 'VIDEO_IR_COMPILE');
    const storyboardCIR = ctx.loadArtifact<StoryboardCIR>(ARTIFACT.STORYBOARD_CIR);
    const temporalPlan: TemporalPlanCIR | undefined =
      project.temporalPlan ?? ctx.loadArtifact(ARTIFACT.TEMPORAL_PLAN_CIR);
    const shotCIR = loadShotCIR(ctx, 'VIDEO_IR_COMPILE');

    if (!storyboardCIR) {
      throw new CIRValidationError('VIDEO_IR_COMPILE', 'Storyboard', [
        `${ARTIFACT.STORYBOARD_CIR} is missing — cannot build VideoIR`,
      ]);
    }
    if (!temporalPlan) {
      throw new CIRValidationError('VIDEO_IR_COMPILE', 'TemporalPlan', [
        `${ARTIFACT.TEMPORAL_PLAN_CIR} is missing — cannot build VideoIR`,
      ]);
    }

    const videoIR = compileVideoIR({
      scriptCIR,
      storyboardCIR,
      temporalPlanCIR: temporalPlan,
      styleCIR,
      minVideoScenes: getMinVideoScenes(),
      shotCIR,
    });

    project.videoIR = videoIR;
    ctx.saveArtifact(ARTIFACT.VIDEO_IR_CIR, videoIR);

    const videoSceneCount = videoIR.scenes.filter((scene: Scene) => scene.assetType === 'video').length;
    addLog({
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      message: `Compiled VideoIR: ${videoIR.scenes.length} scene(s), target ${videoIR.targetDurationSec}s, ${videoSceneCount} video scene(s)`,
      type: 'success',
      stage: 'VIDEO_IR_COMPILE',
    });
  },
});

/* ---- 9. REFERENCE_IMAGE ---- */

registerStage({
  stage: 'REFERENCE_IMAGE',
  after: 'VIDEO_IR_COMPILE',
  async execute(ctx: StageRunContext) {
    const { project, projectId, assetsDir, addLog } = ctx;
    project.scenes = ctx.loadArtifact(ARTIFACT.SCENES) ?? project.scenes ?? [];
    const videoIR = loadVideoIR(ctx, 'REFERENCE_IMAGE');

    const adapter = ctx.getSessionAwareAdapter('REFERENCE_IMAGE', 'image_generation', project.modelOverrides);
    const updatedScenes = await runReferenceImage(adapter, {
      scenes: project.scenes!,
      videoIR,
      assetsDir,
      topic: project.topic,
      candidateCount: CANDIDATE_COUNT,
    }, addLog);
    project.scenes = updatedScenes;
    ctx.saveArtifact(ARTIFACT.SCENES, updatedScenes);

    // Expose reference_sheet to frontend
    const sheetPath = join(assetsDir, ARTIFACT.REFERENCE_SHEET);
    if (existsSync(sheetPath)) {
      project.referenceImages = [`/api/pipeline/${projectId}/assets/${ARTIFACT.REFERENCE_SHEET}`];
    }
  },
});

/* ---- 10. KEYFRAME_GEN ---- */

registerStage({
  stage: 'KEYFRAME_GEN',
  after: 'REFERENCE_IMAGE',
  async execute(ctx: StageRunContext) {
    const { project, assetsDir, addLog } = ctx;
    project.scenes = ctx.loadArtifact(ARTIFACT.SCENES) ?? project.scenes ?? [];
    const videoIR = loadVideoIR(ctx, 'KEYFRAME_GEN');

    const adapter = ctx.getSessionAwareAdapter('KEYFRAME_GEN', 'image_generation', project.modelOverrides);
    const updatedScenes = await runKeyframeGen(adapter, {
      scenes: project.scenes!,
      videoIR,
      assetsDir,
    }, addLog);
    project.scenes = updatedScenes;
    ctx.saveArtifact(ARTIFACT.SCENES, updatedScenes);
  },
});
