/* ------------------------------------------------------------------ */
/*  Pass definitions – analysis group (frontend passes)               */
/*  (CAPABILITY_ASSESSMENT, STYLE_EXTRACTION, RESEARCH)               */
/*  These are the compiler's "lexing/parsing" passes that produce     */
/*  StyleAnalysisCIR and ResearchCIR from raw source input.           */
/* ------------------------------------------------------------------ */

import { existsSync } from 'node:fs';
import { ARTIFACT } from '@ai-video/pipeline-core/constants.js';
import { SSE_EVENT } from '@ai-video/pipeline-core/sharedTypes.js';
import { registerStage, type StageRunContext } from '@ai-video/pipeline-core/stageRegistry.js';
import {
  extractFormatSignature,
  runCapabilityAssessment,
  runFactVerification,
  runResearch,
  runShotAnalysis,
  runStyleExtraction,
} from '@ai-video/pipeline-core/stages/index.js';
import { validateStyleContract } from '@ai-video/pipeline-core/styleContract.js';
import { parseStyleAnalysisCIR, parseResearchCIR } from '../../cir/parsers.js';
import { loadStyleCIR } from '../../cir/loader.js';

/* ---- 1. CAPABILITY_ASSESSMENT ---- */

registerStage({
  stage: 'CAPABILITY_ASSESSMENT',
  async execute(ctx: StageRunContext) {
    const { project, addLog } = ctx;
    const adapter = ctx.getSessionAwareAdapter('CAPABILITY_ASSESSMENT', 'self_assessment', project.modelOverrides);

    // providerRegistry is accessed from the orchestrator via the adapter resolution — no direct coupling here.
    // The stage just calls the adapter.
    const result = await runCapabilityAssessment(adapter, {
      topic: project.topic,
      // providerRegistry + providerIds are supplied by the orchestrator's getAdapter wiring
      providerRegistry: ctx.providerRegistry,
      providerIds: ctx.providerRegistry.getAll().map(p => p.providerId),
    }, addLog);

    project.safetyCheck = result.safetyCheck;
    ctx.saveArtifact(ARTIFACT.CAPABILITY_ASSESSMENT, result);
  },
});

/* ---- 2. STYLE_EXTRACTION ---- */

registerStage({
  stage: 'STYLE_EXTRACTION',
  after: 'CAPABILITY_ASSESSMENT',
  async execute(ctx: StageRunContext) {
    const { project, assetsDir, addLog } = ctx;

    const adapter = ctx.getSessionAwareAdapter('STYLE_EXTRACTION', 'video_analysis', project.modelOverrides);

    if (!project.referenceVideoPath || !existsSync(project.referenceVideoPath)) {
      throw new Error('No reference video found — please upload a video or apply a style template before starting analysis');
    }

    addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Analyzing reference video: ${project.referenceVideoPath}`, type: 'info', stage: 'STYLE_EXTRACTION' });

    const result = await runStyleExtraction(adapter, {
      videoFilePath: project.referenceVideoPath,
      topic: project.topic,
      enableSelfAssessment: false,
    }, addLog);

    project.styleProfile = result.styleProfile;
    ctx.saveArtifact(ARTIFACT.STYLE_PROFILE, result.styleProfile);

    // Save contract validation result as separate artifact for observability
    const contractResult = validateStyleContract(result.styleProfile);
    ctx.saveArtifact(ARTIFACT.STYLE_CONTRACT, contractResult);

    // Parse into CIR — validated, deterministic representation for downstream stages
    const styleAnalysisCIR = parseStyleAnalysisCIR(result.styleProfile, contractResult.score);
    ctx.saveArtifact(ARTIFACT.STYLE_ANALYSIS_CIR, styleAnalysisCIR);

    // Extract FormatSignature — series structural identity (separate from topic content)
    // Uses a text-only call (no video upload needed) since it operates on the transcript
    try {
      const formatSignature = await extractFormatSignature(adapter, { styleCIR: styleAnalysisCIR }, addLog);
      ctx.saveArtifact(ARTIFACT.FORMAT_SIGNATURE, formatSignature);
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `FormatSignature extraction failed (non-blocking): ${msg}`, type: 'warning', stage: 'STYLE_EXTRACTION' });
      ctx.emitEvent({ type: SSE_EVENT.WARNING, payload: { projectId: ctx.projectId, stage: 'STYLE_EXTRACTION', message: `FormatSignature extraction failed: ${msg}` } });
      ctx.saveArtifact(ARTIFACT.FORMAT_SIGNATURE, { _type: 'FormatSignature', _error: msg });
    }

    // Shot boundary detection and keyframe analysis (non-blocking)
    try {
      const shotAnalysisAdapter = ctx.getSessionAwareAdapter('STYLE_EXTRACTION', 'video_analysis', project.modelOverrides);
      const shotCIR = await runShotAnalysis(shotAnalysisAdapter, {
        videoFilePath: project.referenceVideoPath,
        assetsDir,
      }, addLog);
      if (shotCIR.totalShots > 0) {
        ctx.saveArtifact(ARTIFACT.SHOT_CIR, shotCIR);
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Shot analysis: ${shotCIR.totalShots} shots detected, avg ${shotCIR.avgShotDurationSec}s/shot`, type: 'success', stage: 'STYLE_EXTRACTION' });
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Shot analysis failed (non-blocking): ${msg}`, type: 'warning', stage: 'STYLE_EXTRACTION' });
    }
  },
});

/* ---- 3. RESEARCH ---- */

registerStage({
  stage: 'RESEARCH',
  after: 'STYLE_EXTRACTION',
  async execute(ctx: StageRunContext) {
    const { project, addLog } = ctx;
    project.styleProfile = ctx.loadArtifact(ARTIFACT.STYLE_PROFILE) ?? project.styleProfile;

    // Load validated CIR — fail closed if missing or invalid
    const styleCIR = loadStyleCIR(ctx, 'RESEARCH');

    // Step A: Initial research
    const adapter = ctx.getSessionAwareAdapter('RESEARCH', 'fact_research', project.modelOverrides);
    const result = await runResearch(adapter, {
      topic: project.topic,
      styleCIR,
      suspiciousNumericClaims: project.styleProfile?.suspiciousNumericClaims,
    }, addLog);

    // Step B: Independent fact verification using a different adapter
    // Uses 'claim_verification' task type which routes to a different provider/session
    const verifyAdapter = ctx.getAdapter('RESEARCH', 'claim_verification', project.modelOverrides);
    const verification = await runFactVerification(verifyAdapter, {
      topic: project.topic,
      researchData: result,
    }, addLog);
    ctx.saveArtifact(ARTIFACT.FACT_VERIFICATION, verification);

    // Replace facts with verified versions (adjusted confidence + flagged)
    result.facts = verification.verifiedFacts;
    project.researchData = result;
    ctx.saveArtifact(ARTIFACT.RESEARCH, result);

    // Parse into CIR
    const researchCIR = parseResearchCIR(result);
    ctx.saveArtifact(ARTIFACT.RESEARCH_CIR, researchCIR);
  },
});
