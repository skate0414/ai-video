/* ------------------------------------------------------------------ */
/*  Stage definitions – production group                              */
/*  (VIDEO_GEN, TTS, ASSEMBLY, REFINEMENT)                            */
/* ------------------------------------------------------------------ */

import { registerStage, type StageRunContext } from '../../stageRegistry.js';
import { runVideoGen } from '../videoGen.js';
import { runTts } from '../tts.js';
import { runFinalRiskGate } from '../finalRiskGate.js';
import { isEdgeTTSAvailable, resolveVoiceFromStyle, resolveRateFromPacing, type TTSConfig } from '../../../adapters/ttsProvider.js';
import type { Scene } from '../../types.js';

/* ---- 10. VIDEO_GEN ---- */

registerStage({
  stage: 'VIDEO_GEN',
  async execute(ctx: StageRunContext) {
    const { project, assetsDir, addLog } = ctx;
    project.styleProfile ??= ctx.loadArtifact('style-profile.json');
    project.scenes ??= ctx.loadArtifact('scenes.json') ?? [];

    const adapter = ctx.getAdapter('VIDEO_GEN', 'video_generation', project.modelOverrides);
    const updatedScenes = await runVideoGen(adapter, {
      scenes: project.scenes!,
      styleProfile: project.styleProfile!,
      assetsDir,
      videoProviderConfig: ctx.config.videoProviderConfig,
      concurrency: ctx.config.productionConcurrency,
    }, addLog, (scene) => {
      const idx = project.scenes!.findIndex(s => s.id === scene.id);
      if (idx !== -1) project.scenes![idx] = scene;
    });
    project.scenes = updatedScenes;
    ctx.saveArtifact('scenes.json', updatedScenes);
  },
});

/* ---- 11. TTS ---- */

registerStage({
  stage: 'TTS',
  async execute(ctx: StageRunContext) {
    const { project, assetsDir, addLog } = ctx;
    project.scenes ??= ctx.loadArtifact('scenes.json') ?? [];

    if (!(await isEdgeTTSAvailable())) {
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: '⚠️ edge-tts not installed. Run: pip install edge-tts. Skipping TTS.', type: 'warning', stage: 'TTS' });
      return;
    }

    const styleVoice = project.styleProfile?.track_c_audio?.voice_style;
    const stylePacing = project.styleProfile?.pacing;
    const videoLang = project.styleProfile?.meta?.video_language;
    const ttsConfig: TTSConfig = {
      assetsDir,
      voice: ctx.config.ttsConfig?.voice ?? resolveVoiceFromStyle(styleVoice, videoLang),
      rate: ctx.config.ttsConfig?.rate ?? resolveRateFromPacing(stylePacing),
      pitch: ctx.config.ttsConfig?.pitch,
    };
    const updatedScenes = await runTts({
      scenes: project.scenes!,
      ttsConfig,
      concurrency: ctx.config.productionConcurrency,
    }, addLog);
    project.scenes = updatedScenes;
    ctx.saveArtifact('scenes.json', updatedScenes);
  },
});

/* ---- 12. ASSEMBLY ---- */

registerStage({
  stage: 'ASSEMBLY',
  async execute(ctx: StageRunContext) {
    const { project, projectId, assetsDir, addLog } = ctx;
    project.scenes ??= ctx.loadArtifact('scenes.json') ?? [];

    const { assembleVideo, isFFmpegAvailable } = await import('../../../adapters/ffmpegAssembler.js');

    if (!(await isFFmpegAvailable())) {
      throw new Error('FFmpeg is not installed. Please install FFmpeg to enable video assembly.');
    }

    addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: 'Starting video assembly with FFmpeg...', type: 'info', stage: 'ASSEMBLY' });

    const finalPath = await assembleVideo(project.scenes!, {
      assetsDir,
      outputDir: assetsDir,
      projectTitle: project.title,
      bgmVolume: project.styleProfile?.track_c_audio?.bgm_relative_volume,
      onProgress: (percent: number, message: string) => {
        ctx.emitEvent({ type: 'pipeline_assembly_progress', payload: { projectId, percent, message } });
      },
    });

    project.finalVideoPath = finalPath;
    addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Video assembly complete: ${finalPath}`, type: 'success', stage: 'ASSEMBLY' });

    // Final Risk Gate (safety + completeness check before refinement)
    project.scriptOutput ??= ctx.loadArtifact('script.json');
    const gateResult = runFinalRiskGate({
      scenes: project.scenes!,
      scriptText: project.scriptOutput?.scriptText ?? '',
    }, addLog);
    ctx.saveArtifact('final-risk-gate.json', gateResult);
  },
});

/* ---- 13. REFINEMENT ---- */

registerStage({
  stage: 'REFINEMENT',
  async execute(ctx: StageRunContext) {
    const { project, projectId, addLog } = ctx;
    project.scenes ??= ctx.loadArtifact('scenes.json') ?? [];

    const { runRefinement } = await import('../refinement.js');
    const result = await runRefinement({
      scenes: project.scenes!,
      maxRetries: 2,
    }, addLog);

    if (!result.allComplete && result.failedScenes.length > 0) {
      const retried: string[] = [];
      for (const sceneId of result.failedScenes) {
        try {
          addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Auto-retrying scene ${sceneId}...`, type: 'info', stage: 'REFINEMENT' });
          await ctx.regenerateScene(projectId, sceneId);
          retried.push(sceneId);
        } catch {
          addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Scene ${sceneId} retry failed`, type: 'warning', stage: 'REFINEMENT' });
        }
      }
      result.retriedScenes = retried;
      result.retryCount = 1;
    }

    project.refinementHistory = [result];
    ctx.saveArtifact('refinement.json', result);
  },
});
