// @ts-nocheck -- see tsconfig.json noUncheckedIndexedAccess migration (scripts/check-strict-progress.mjs)
/* ------------------------------------------------------------------ */
/*  Pass definitions – production group (codegen + linking passes)    */
/*  (VIDEO_GEN, TTS, ASSEMBLY, REFINEMENT)                            */
/*  These are the compiler's "codegen" (media generation) and        */
/*  "linker" (FFmpeg assembly) passes that produce the output binary. */
/* ------------------------------------------------------------------ */

import { ARTIFACT } from '@ai-video/pipeline-core/constants.js';
import { registerStage, type StageRunContext } from '@ai-video/pipeline-core/stageRegistry.js';
import { SSE_EVENT } from '@ai-video/pipeline-core/pipelineTypes.js';
import {
  buildColorGradeFilter,
  computeAdaptiveTransitions,
  computePostAssemblyMetrics,
  computeSSIM,
  extractFrame,
  getFormatName,
  getQualityTier,
  resolveEncodingProfile,
  resolveFormatPreset,
  runFinalRiskGate,
  runRefinement,
  runTts,
  runVideoGen,
} from '@ai-video/pipeline-core/stages/index.js';
import { isEdgeTTSAvailable, type TTSConfig } from '@ai-video/pipeline-core/ttsProvider.js';
import type { Scene } from '@ai-video/pipeline-core/pipelineTypes.js';
import { loadVideoIR } from '../../cir/loader.js';
import { CANDIDATE_COUNT } from '@ai-video/pipeline-core/constants.js';

/* ---- 10. VIDEO_GEN ---- */

registerStage({
  stage: 'VIDEO_GEN',
  after: 'KEYFRAME_GEN',
  async execute(ctx: StageRunContext) {
    const { project, assetsDir, addLog } = ctx;
    project.scenes = ctx.loadArtifact(ARTIFACT.SCENES) ?? project.scenes ?? [];

    // Load validated CIR — fail closed if missing or invalid
    const videoIR = loadVideoIR(ctx, 'VIDEO_GEN');

    const adapter = ctx.getAdapter('VIDEO_GEN', 'video_generation', project.modelOverrides);
    const updatedScenes = await runVideoGen(adapter, {
      scenes: project.scenes!,
      videoIR,
      assetsDir,
      aivideomakerAdapters: ctx.config.aivideomakerAdapters,
      candidateCount: CANDIDATE_COUNT,
    }, addLog, (scene) => {
      const idx = project.scenes!.findIndex(s => s.id === scene.id);
      if (idx !== -1) project.scenes![idx] = scene;
    });
    project.scenes = updatedScenes;
    ctx.saveArtifact(ARTIFACT.SCENES, updatedScenes);
  },
});

/* ---- 11. TTS ---- */

registerStage({
  stage: 'TTS',
  after: 'VIDEO_GEN',
  async execute(ctx: StageRunContext) {
    const { project, assetsDir, addLog } = ctx;
    project.scenes = ctx.loadArtifact(ARTIFACT.SCENES) ?? project.scenes ?? [];

    if (!(await isEdgeTTSAvailable())) {
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: '⚠️ edge-tts not installed. Run: pip install edge-tts. Skipping TTS.', type: 'warning', stage: 'TTS' });
      return;
    }

    // Load VideoIR — authoritative source for per-scene voice/rate
    const videoIR = loadVideoIR(ctx, 'TTS');

    const ttsConfig: TTSConfig = {
      assetsDir,
      voice: ctx.config.ttsConfig?.voice,
      rate: ctx.config.ttsConfig?.rate,
      pitch: ctx.config.ttsConfig?.pitch,
    };
    const updatedScenes = await runTts({
      scenes: project.scenes!,
      ttsConfig,
      videoIR,
      concurrency: ctx.config.productionConcurrency,
    }, addLog);
    project.scenes = updatedScenes;
    ctx.saveArtifact(ARTIFACT.SCENES, updatedScenes);

  },
});

/* ---- 12. ASSEMBLY ---- */

registerStage({
  stage: 'ASSEMBLY',
  after: 'TTS',
  async execute(ctx: StageRunContext) {
    const { project, projectId, assetsDir, addLog } = ctx;
    project.scenes = ctx.loadArtifact(ARTIFACT.SCENES) ?? project.scenes ?? [];

    const { assembleVideo, isFFmpegAvailable } = await import('@ai-video/pipeline-core/ffmpegAssembler.js');

    if (!(await isFFmpegAvailable())) {
      throw new Error('FFmpeg is not installed. Please install FFmpeg to enable video assembly.');
    }

    // Load validated VideoIR — sole authority for all downstream stages
    const videoIR = loadVideoIR(ctx, 'ASSEMBLY');

    // P1: Pre-assembly total duration gate — abort if audio is wildly over budget
    const totalAudioDuration = project.scenes.reduce((sum, s) => sum + (s.audioDuration ?? 0), 0);
    const targetDuration = videoIR.targetDurationSec;
    if (targetDuration > 0 && totalAudioDuration > 0) {
      const durationRatio = totalAudioDuration / targetDuration;
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Pre-assembly duration check: total audio ${totalAudioDuration.toFixed(1)}s vs target ${targetDuration.toFixed(1)}s (ratio: ${durationRatio.toFixed(2)}x)`, type: 'info', stage: 'ASSEMBLY' });
      if (durationRatio > 3) {
        const msg = `Pre-assembly duration gate FAILED: total audio ${totalAudioDuration.toFixed(0)}s is ${durationRatio.toFixed(1)}x the target ${targetDuration.toFixed(0)}s — likely script or TTS issue. Aborting assembly.`;
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: msg, type: 'error', stage: 'ASSEMBLY' });
        throw new Error(msg);
      }
    }

    // Assert supported AV sync policy (fail-closed)
    if (videoIR.avSyncPolicy !== 'audio-primary') {
      throw new Error(`Unsupported avSyncPolicy: ${videoIR.avSyncPolicy} — only 'audio-primary' is implemented`);
    }

    addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: 'Starting video assembly with FFmpeg...', type: 'info', stage: 'ASSEMBLY' });

    // B7: Log BGM settings for auditability
    addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `BGM settings: volume=${videoIR.bgmRelativeVolume}, resolution=${videoIR.resolution.w}x${videoIR.resolution.h}, fps=${videoIR.fps}, avSync=${videoIR.avSyncPolicy}`, type: 'info', stage: 'ASSEMBLY' });

    // P4: Resolve output format preset from VideoIR resolution
    const formatPreset = resolveFormatPreset(videoIR.resolution.w, videoIR.resolution.h);
    const formatName = getFormatName(videoIR.resolution.w, videoIR.resolution.h) ?? 'custom';
    addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Output format: ${formatPreset.label} (${formatPreset.width}×${formatPreset.height}) — ${formatPreset.useCase}`, type: 'info', stage: 'ASSEMBLY' });

    // P4: Resolve encoding profile from quality tier
    const qualityTier = getQualityTier();
    const encodingProfile = resolveEncodingProfile(qualityTier, formatPreset.width, formatPreset.height, videoIR.fps);
    addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Encoding: tier=${qualityTier}, crf=${encodingProfile.crf}, preset=${encodingProfile.preset}, audio=${encodingProfile.audioBitrate}, 2pass=${encodingProfile.twoPass}`, type: 'info', stage: 'ASSEMBLY' });

    // Compute adaptive transitions from VideoIR scene emotion & narrative data
    const adaptive = computeAdaptiveTransitions(videoIR.scenes);

    addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Adaptive transitions: ${adaptive.types.filter(t => t !== 'none').join(', ')} | durations: ${adaptive.durations.filter(d => d > 0).map(d => d.toFixed(2) + 's').join(', ')}`, type: 'info', stage: 'ASSEMBLY' });

    // Compute color grading filter from VideoIR style metadata
    const colorTemp = videoIR.scenes[0]?.lightingStyle?.includes('warm') ? 'warm'
      : videoIR.scenes[0]?.lightingStyle?.includes('cool') ? 'cool'
      : 'neutral';
    const colorGradeFilter = buildColorGradeFilter(colorTemp, videoIR.scenes[0]?.visualStyle ?? '');
    if (colorGradeFilter) {
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Color grading: temp=${colorTemp}, style=${videoIR.scenes[0]?.visualStyle}, filter=${colorGradeFilter}`, type: 'info', stage: 'ASSEMBLY' });
    }

    // Enrich scenes with camera motion and sound design metadata from VideoIR
    const assemblyScenes = project.scenes!.map((s, i) => ({
      ...s,
      cameraMotion: videoIR.scenes[i]?.production?.camera,
      soundDesign: videoIR.scenes[i]?.production?.sound,
    }));

    // Check for refinement options (used during re-assembly)
    const refineOptions = (project as any).refineOptions as import('@ai-video/pipeline-core/sharedTypes.js').RefineOptions | undefined;
    const bgmPath = (project as any).bgmPath as string | undefined;

    // Resolve subtitle style from refine options or use defaults
    const subtitleStyle = refineOptions?.subtitleStyle;
    const titleCardStyle = refineOptions?.titleCard || undefined;

    // Resolve fade durations from refine options or use defaults
    const fadeInDuration = refineOptions?.fadeInDuration ?? 0.5;
    const fadeOutDuration = refineOptions?.fadeOutDuration ?? 1.0;

    // Resolve transition duration from refine options
    const defaultTransitionDuration = refineOptions?.transitionDuration;

    // Resolve encoding from quality/speed presets
    let finalEncodingProfile = encodingProfile;
    if (refineOptions) {
      // Map quality preset to CRF
      const crfMap = { high: 18, medium: 20, low: 23 };
      const presetMap = { fast: 'veryfast', balanced: 'medium', quality: 'slow' };
      finalEncodingProfile = {
        ...encodingProfile,
        crf: crfMap[refineOptions.qualityPreset] ?? encodingProfile.crf,
        preset: presetMap[refineOptions.speedPreset] ?? encodingProfile.preset,
      };
    }

    const finalPath = await assembleVideo(assemblyScenes, {
      assetsDir,
      outputDir: assetsDir,
      projectTitle: project.title,
      bgmPath: bgmPath,
      bgmVolume: refineOptions?.bgmVolume ?? videoIR.bgmRelativeVolume,
      bgmFadeIn: refineOptions?.bgmFadeIn ?? 0,
      bgmFadeOut: refineOptions?.bgmFadeOut ?? 0,
      transitions: adaptive.types,
      transitionDurations: adaptive.durations,
      defaultTransitionDuration: defaultTransitionDuration,
      colorGradeFilter: colorGradeFilter || undefined,
      encoding: {
        width: finalEncodingProfile.width,
        height: finalEncodingProfile.height,
        fps: finalEncodingProfile.fps,
        crf: finalEncodingProfile.crf,
        videoCodec: finalEncodingProfile.videoCodec,
        audioBitrate: finalEncodingProfile.audioBitrate,
        audioSampleRate: finalEncodingProfile.audioSampleRate,
        preset: finalEncodingProfile.preset,
        maxrate: finalEncodingProfile.maxrate,
        bufsize: finalEncodingProfile.bufsize,
      },
      // P5: Two-pass encoding for premium quality tier
      twoPass: finalEncodingProfile.twoPass,
      // Fade in/out from refine options or defaults
      fadeInDuration: fadeInDuration,
      fadeOutDuration: fadeOutDuration,
      // Title card from refine options or project title
      titleCard: titleCardStyle ? undefined : project.title,
      titleCardStyle: titleCardStyle,
      // Subtitle style from refine options
      subtitleStyle: subtitleStyle,
      onProgress: (percent: number, message: string) => {
        ctx.emitEvent({ type: SSE_EVENT.ASSEMBLY_PROGRESS, payload: { projectId, percent, message } });
      },
    });

    project.finalVideoPath = finalPath;
    addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Video assembly complete: ${finalPath}`, type: 'success', stage: 'ASSEMBLY' });

    // P2-2: Post-assembly validation — check duration and resolution
    const { getVideoInfo } = await import('@ai-video/pipeline-core/ffmpegAssembler.js');
    const videoInfo = await getVideoInfo(finalPath);
    if (videoInfo) {
      const expectedDuration = project.scenes!.reduce((sum, s, i) => {
        const irDuration = videoIR.scenes[i]?.apiDurationSec;
        return sum + (s.audioDuration ?? irDuration ?? 5);
      }, 0);
      const durationDelta = Math.abs(videoInfo.duration - expectedDuration) / expectedDuration;
      if (durationDelta > 0.2) {
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Post-assembly warning: video duration ${videoInfo.duration.toFixed(1)}s deviates >20% from expected ${expectedDuration.toFixed(1)}s`, type: 'warning', stage: 'ASSEMBLY' });
      }
      if (videoInfo.width < videoIR.resolution.w || videoInfo.height < videoIR.resolution.h) {
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Post-assembly warning: video resolution ${videoInfo.width}x${videoInfo.height} is below target ${videoIR.resolution.w}x${videoIR.resolution.h}`, type: 'warning', stage: 'ASSEMBLY' });
      }
      ctx.saveArtifact(ARTIFACT.ASSEMBLY_VALIDATION, { ...videoInfo, expectedDuration, durationDelta });
    } else {
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: 'Post-assembly warning: could not probe output video — file may be corrupted', type: 'error', stage: 'ASSEMBLY' });
    }

    // P3: Post-assembly perceptual quality metrics (black frames, silence gaps, audio levels)
    try {
      const qaMetrics = await computePostAssemblyMetrics(finalPath);
      ctx.saveArtifact('POST_ASSEMBLY_QA' as any, qaMetrics);
      if (qaMetrics.passed) {
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Post-assembly QA passed: blackFrames=${qaMetrics.blackFrameCount}, silenceGaps=${qaMetrics.silenceGapCount}, peak=${qaMetrics.peakAudioLevel?.toFixed(1) ?? 'N/A'} dBFS`, type: 'success', stage: 'ASSEMBLY' });
      } else {
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Post-assembly QA issues: ${qaMetrics.issues.join('; ')}`, type: 'warning', stage: 'ASSEMBLY' });
      }
    } catch {
      // Non-fatal: post-assembly QA is best-effort
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: 'Post-assembly QA skipped (FFmpeg probe error)', type: 'warning', stage: 'ASSEMBLY' });
    }

    // P4: Temporal consistency check — verify scene boundary smoothness
    try {
      const { tmpdir } = await import('node:os');
      const { mkdirSync } = await import('node:fs');
      const { join } = await import('node:path');
      const tempDir = join(tmpdir(), `temporal_${projectId}_${Date.now()}`);
      mkdirSync(tempDir, { recursive: true });

      // Compute cumulative scene timestamps for frame extraction
      const sceneDurations = project.scenes!.map((s, i) => {
        const irDuration = videoIR.scenes[i]?.apiDurationSec;
        return s.audioDuration ?? irDuration ?? 5;
      });

      // Extract boundary frames from final video
      const framesDir = join(tempDir, 'frames');
      mkdirSync(framesDir, { recursive: true });
      const boundarySsim: (number | undefined)[] = [];
      let pairsChecked = 0;
      let discontinuities = 0;
      const issues: string[] = [];

      let cumTime = 0;
      const cumulativeTimes: number[] = [];
      for (const dur of sceneDurations) {
        cumulativeTimes.push(cumTime);
        cumTime += dur;
      }

      for (let i = 0; i < sceneDurations.length - 1; i++) {
        const endOfCurrent = cumulativeTimes[i] + sceneDurations[i] - 0.1;
        const startOfNext = cumulativeTimes[i + 1] + 0.05;
        const lastFrame = await extractFrame(finalPath, endOfCurrent, join(framesDir, `last_${i}.jpg`));
        const firstFrame = await extractFrame(finalPath, startOfNext, join(framesDir, `first_${i + 1}.jpg`));
        if (!lastFrame || !firstFrame) {
          boundarySsim.push(undefined);
          continue;
        }
        const ssim = await computeSSIM(lastFrame, firstFrame);
        boundarySsim.push(ssim);
        pairsChecked++;
        const transition = adaptive.types[i] ?? 'cut';
        if (ssim !== undefined && ssim < 0.15 && transition !== 'cut' && transition !== 'none') {
          discontinuities++;
          issues.push(`Scene ${i + 1}→${i + 2}: SSIM ${ssim.toFixed(3)} with ${transition}`);
        }
      }

      const temporalMetrics = { pairsChecked, discontinuities, boundarySsim, passed: discontinuities <= Math.ceil(pairsChecked * 0.5), issues };
      ctx.saveArtifact('TEMPORAL_QUALITY' as any, temporalMetrics);
      if (temporalMetrics.passed) {
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Temporal QA passed: ${pairsChecked} pairs checked, ${discontinuities} discontinuities`, type: 'success', stage: 'ASSEMBLY' });
      } else {
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Temporal QA issues: ${issues.join('; ')}`, type: 'warning', stage: 'ASSEMBLY' });
      }
    } catch {
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: 'Temporal QA skipped (frame extraction error)', type: 'warning', stage: 'ASSEMBLY' });
    }

    // Final Risk Gate (safety + completeness check before refinement)
    const safetyMeta = project.scriptOutput?.safetyMetadata;
    const safetyPreCleared = safetyMeta != null && safetyMeta.needsManualReview === false;
    const gateResult = runFinalRiskGate({
      scenes: project.scenes!,
      scriptText: videoIR.scenes.map(s => s.narrative).join('\n'),
      safetyPreCleared,
    }, addLog);
    ctx.saveArtifact(ARTIFACT.FINAL_RISK_GATE, gateResult);
  },
});

/* ---- 13. REFINEMENT ---- */

registerStage({
  stage: 'REFINEMENT',
  after: 'ASSEMBLY',
  async execute(ctx: StageRunContext) {
    const { project, projectId, addLog } = ctx;
    project.scenes = ctx.loadArtifact(ARTIFACT.SCENES) ?? project.scenes ?? [];

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
    ctx.saveArtifact(ARTIFACT.REFINEMENT, result);
  },
});
