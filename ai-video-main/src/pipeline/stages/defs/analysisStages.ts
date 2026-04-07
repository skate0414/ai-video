/* ------------------------------------------------------------------ */
/*  Stage definitions – analysis group                                */
/*  (CAPABILITY_ASSESSMENT, STYLE_EXTRACTION, RESEARCH)               */
/* ------------------------------------------------------------------ */

import { existsSync } from 'node:fs';
import { registerStage, type StageRunContext } from '../../stageRegistry.js';
import { runCapabilityAssessment } from '../capabilityAssessment.js';
import { runCvPreprocess, type CvPreprocessOutput } from '../cvPreprocess.js';
import { runStyleExtraction } from '../styleExtraction.js';
import { runResearch } from '../research.js';
import type { StyleProfile } from '../../types.js';

/* ---- 1. CAPABILITY_ASSESSMENT ---- */

registerStage({
  stage: 'CAPABILITY_ASSESSMENT',
  async execute(ctx: StageRunContext) {
    const { project, projectId, addLog } = ctx;
    const adapter = ctx.getSessionAwareAdapter('CAPABILITY_ASSESSMENT', 'safety_check', project.modelOverrides);

    // providerRegistry is accessed from the orchestrator via the adapter resolution — no direct coupling here.
    // The stage just calls the adapter.
    const result = await runCapabilityAssessment(adapter, {
      topic: project.topic,
      // providerRegistry + providerIds are supplied by the orchestrator's getAdapter wiring
      providerRegistry: ctx.providerRegistry,
      providerIds: ctx.providerRegistry.getAll().map(p => p.providerId),
    }, addLog);

    project.safetyCheck = result.safetyCheck;
    ctx.saveArtifact('capability-assessment.json', result);
  },
});

/* ---- 2. STYLE_EXTRACTION ---- */

registerStage({
  stage: 'STYLE_EXTRACTION',
  async execute(ctx: StageRunContext) {
    const { project, projectId, assetsDir, addLog } = ctx;

    // CV pre-processing: extract ground-truth visual features
    let cvData: CvPreprocessOutput | undefined;
    if (project.referenceVideoPath) {
      try {
        const cvAdapter = ctx.getSessionAwareAdapter('STYLE_EXTRACTION', 'video_analysis', project.modelOverrides);
        cvData = await runCvPreprocess(cvAdapter, {
          videoFilePath: project.referenceVideoPath,
          assetsDir,
        }, addLog);
        ctx.saveArtifact('cv-preprocess.json', cvData);
      } catch {
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: 'CV pre-processing failed (non-blocking), continuing with style extraction', type: 'warning', stage: 'STYLE_EXTRACTION' });
      }
    }

    const adapter = ctx.getSessionAwareAdapter('STYLE_EXTRACTION', 'video_analysis', project.modelOverrides);

    let result: { styleProfile: StyleProfile };
    if (project.referenceVideoPath && existsSync(project.referenceVideoPath)) {
      result = await runStyleExtraction(adapter, {
        videoFilePath: project.referenceVideoPath,
        topic: project.topic,
      }, addLog);
    } else {
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: 'No reference video — generating style profile from topic text', type: 'info', stage: 'STYLE_EXTRACTION' });
      const textResult = await adapter.generateText('', [
        { text: `Analyze the following video topic and generate a StyleDNA JSON profile for it. Topic: "${project.topic}"\n\nReturn a JSON object with these fields: visualStyle, pacing, tone, colorPalette (array of hex colors), narrativeStructure (array of section names), hookType, callToActionType, wordCount (estimated), wordsPerMinute (default 180), emotionalIntensity (0-1), track_b_visual (object with lighting_style, visual_style, aspect_ratio). Use cinematic defaults where uncertain.` },
      ], { responseMimeType: 'application/json' });
      const { extractJSON } = await import('../../../adapters/responseParser.js');
      const styleData = extractJSON<any>(textResult.text ?? '');
      if (!styleData) throw new Error('Failed to generate style profile from topic text');
      result = {
        styleProfile: {
          visualStyle: styleData.visualStyle ?? 'cinematic',
          pacing: styleData.pacing ?? 'medium',
          tone: styleData.tone ?? 'informative',
          colorPalette: styleData.colorPalette ?? ['#1a1a2e', '#16213e', '#e94560'],
          narrativeStructure: styleData.narrativeStructure ?? ['Hook', 'Body', 'Conclusion'],
          hookType: styleData.hookType,
          callToActionType: styleData.callToActionType,
          wordCount: styleData.wordCount,
          wordsPerMinute: styleData.wordsPerMinute ?? 180,
          emotionalIntensity: styleData.emotionalIntensity,
          track_b_visual: styleData.track_b_visual,
          targetAudience: styleData.targetAudience,
        },
      };
    }

    // Override LLM color palette with CV ground-truth if available
    if (cvData?.dominantColors?.length) {
      result.styleProfile.colorPalette = cvData.dominantColors;
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Color palette overridden by CV: ${cvData.dominantColors.join(', ')}`, type: 'info', stage: 'STYLE_EXTRACTION' });
    }

    project.styleProfile = result.styleProfile;
    ctx.saveArtifact('style-profile.json', result.styleProfile);
  },
});

/* ---- 3. RESEARCH ---- */

registerStage({
  stage: 'RESEARCH',
  async execute(ctx: StageRunContext) {
    const { project, addLog } = ctx;
    project.styleProfile ??= ctx.loadArtifact('style-profile.json');

    const adapter = ctx.getSessionAwareAdapter('RESEARCH', 'fact_research', project.modelOverrides);
    const result = await runResearch(adapter, {
      topic: project.topic,
      styleProfile: project.styleProfile!,
      suspiciousNumericClaims: project.styleProfile?.suspiciousNumericClaims,
    }, addLog);
    project.researchData = result;
    ctx.saveArtifact('research.json', result);
  },
});
