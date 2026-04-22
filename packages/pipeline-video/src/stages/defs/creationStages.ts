/* ------------------------------------------------------------------ */
/*  Pass definitions – creation group                                 */
/*  (NARRATIVE_MAP, SCRIPT_GENERATION, QA_REVIEW)                     */
/*  Generates script via two-step (skeleton→writing), validates once, */
/*  single-pass QA review. No retry loops — human reviews at pause.  */
/* ------------------------------------------------------------------ */

import { ARTIFACT } from '@ai-video/pipeline-core/constants.js';
import { SSE_EVENT } from '@ai-video/pipeline-core/sharedTypes.js';
import { registerStage, type StageRunContext } from '@ai-video/pipeline-core/stageRegistry.js';
import {
  checkContamination,
  checkSourceMarkers,
  computeTemporalPlan,
  extractFormatSignature,
  runCalibration,
  runNarrativeMap,
  runQaReview,
  runScriptGeneration,
  validateScript,
} from '@ai-video/pipeline-core/stages/index.js';
import { parseScriptCIR } from '@ai-video/pipeline-core/cir/parsers.js';
import { loadStyleCIR, loadScriptCIR, loadFormatSignature, loadShotCIR } from '@ai-video/pipeline-core/cir/loader.js';
import type { StyleAnalysisCIR, FormatSignature } from '@ai-video/pipeline-core/cir/types.js';

/* ---- 4. NARRATIVE_MAP (includes calibration sub-step) ---- */

registerStage({
  stage: 'NARRATIVE_MAP',
  after: 'RESEARCH',
  async execute(ctx: StageRunContext) {
    const { project, addLog } = ctx;
    project.styleProfile = ctx.loadArtifact(ARTIFACT.STYLE_PROFILE) ?? project.styleProfile;
    project.researchData = ctx.loadArtifact(ARTIFACT.RESEARCH) ?? project.researchData;

    // Load validated CIR — fail closed if missing or invalid
    const styleCIR = loadStyleCIR(ctx, 'NARRATIVE_MAP');

    // Step A: Calibration
    const calAdapter = ctx.getSessionAwareAdapter('NARRATIVE_MAP', 'calibration', project.modelOverrides);
    if (!project.researchData) throw new Error('Missing researchData — RESEARCH stage may not have completed');
    const calResult = await runCalibration(calAdapter, {
      topic: project.topic,
      styleCIR,
      researchData: project.researchData,
    }, addLog);
    project.calibrationData = calResult;
    ctx.saveArtifact(ARTIFACT.CALIBRATION, calResult);

    // Step B: Narrative map
    const nmAdapter = ctx.getSessionAwareAdapter('NARRATIVE_MAP', 'calibration', project.modelOverrides);
    const nmResult = await runNarrativeMap(nmAdapter, {
      topic: project.topic,
      styleCIR,
      calibrationData: calResult,
    }, addLog);
    project.narrativeMap = nmResult.narrativeMap;
    project.generationPlan = nmResult.generationPlan;
    ctx.saveArtifact(ARTIFACT.NARRATIVE_MAP, nmResult);
  },
});

/* ---- 5. SCRIPT_GENERATION (two-step: skeleton→writing, single validation) ---- */

registerStage({
  stage: 'SCRIPT_GENERATION',
  after: 'NARRATIVE_MAP',
  async execute(ctx: StageRunContext) {
    const { project, addLog } = ctx;
    project.styleProfile = ctx.loadArtifact(ARTIFACT.STYLE_PROFILE) ?? project.styleProfile;
    project.researchData = ctx.loadArtifact(ARTIFACT.RESEARCH) ?? project.researchData;
    project.calibrationData = ctx.loadArtifact(ARTIFACT.CALIBRATION) ?? project.calibrationData;
    project.narrativeMap = ctx.loadArtifact<any>(ARTIFACT.NARRATIVE_MAP)?.narrativeMap ?? project.narrativeMap;

    const styleCIR = loadStyleCIR(ctx, 'SCRIPT_GENERATION');

    // Load FormatSignature for series-aware validation (optional)
    let fmtSig = loadFormatSignature(ctx, 'SCRIPT_GENERATION');
    if (!fmtSig) {
      try {
        const extAdapter = ctx.getSessionAwareAdapter('STYLE_EXTRACTION', 'video_analysis', project.modelOverrides);
        fmtSig = await extractFormatSignature(extAdapter, { styleCIR }, addLog);
        ctx.saveArtifact(ARTIFACT.FORMAT_SIGNATURE, fmtSig);
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: 'FormatSignature extracted on-the-fly from StyleCIR', type: 'info', stage: 'SCRIPT_GENERATION' });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `FormatSignature extraction failed (non-blocking): ${msg}`, type: 'warning', stage: 'SCRIPT_GENERATION' });
        ctx.emitEvent({ type: SSE_EVENT.WARNING, payload: { projectId: ctx.projectId, stage: 'SCRIPT_GENERATION', message: `FormatSignature extraction failed: ${msg}` } });
      }
    }

    // Two-step generation (skeleton → writing) — single pass, no retry loop
    const result = await generateScript(ctx, undefined, styleCIR, fmtSig);
    project.scriptOutput = result;
    ctx.saveArtifact(ARTIFACT.SCRIPT, result);

    // Single validation pass — log results for human review at QA pause point
    const validation = validateScript(result, project.calibrationData, styleCIR, fmtSig, project.researchData?.facts);
    ctx.saveArtifact('script-validation.json', validation);

    if (validation.passed) {
      if (validation.warnings.length > 0) {
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Script validation warnings: ${validation.warnings.join('; ')}`, type: 'warning', stage: 'SCRIPT_GENERATION' });
      }
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Script validation passed (${validation.metrics.actualWordCount} words, ${validation.metrics.actualSentenceCount} sentences)`, type: 'success', stage: 'SCRIPT_GENERATION' });
    } else {
      // Log errors + contamination flags for human review (no auto-retry)
      addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `Script validation issues: ${validation.errors.join('; ')}`, type: 'warning', stage: 'SCRIPT_GENERATION' });
      // C12/C13 contamination is always surfaced prominently
      const contamination = validation.classifiedErrors.filter(e => e.class === 'contamination');
      if (contamination.length > 0) {
        addLog({ id: `log_${Date.now()}`, timestamp: new Date().toISOString(), message: `⚠ Contamination detected: ${contamination.map(e => e.message).join('; ')}`, type: 'error', stage: 'SCRIPT_GENERATION' });
      }
    }

    // Parse into typed representation for downstream stages
    const language = styleCIR.meta?.videoLanguage;
    if (!project.scriptOutput) throw new Error('Missing scriptOutput after generation');
    const scriptCIR = parseScriptCIR(project.scriptOutput, project.calibrationData, language);
    ctx.saveArtifact(ARTIFACT.SCRIPT_CIR, scriptCIR);
  },
});

/** Helper: run script generation with optional validation feedback. */
async function generateScript(ctx: StageRunContext, validationFeedback?: string, styleCIR?: StyleAnalysisCIR, formatSignature?: FormatSignature) {
  const { project } = ctx;
  const cir = styleCIR ?? loadStyleCIR(ctx, 'SCRIPT_GENERATION');
  const adapter = ctx.getSessionAwareAdapter('SCRIPT_GENERATION', 'script_generation', project.modelOverrides);

  // Use passed FormatSignature or load from artifact (non-blocking — absent on first extraction)
  const fmtSig = formatSignature ?? loadFormatSignature(ctx, 'SCRIPT_GENERATION');

  // Consume and clear retryDirective if it targets this stage
  const retryDirective = project.retryDirective?.stage === 'SCRIPT_GENERATION'
    ? project.retryDirective.directive
    : undefined;

  return runScriptGeneration(adapter, {
    topic: project.topic,
    styleCIR: cir,
    researchData: project.researchData ?? {} as any,
    calibrationData: project.calibrationData,
    narrativeMap: project.narrativeMap ?? [],
    generationPlan: project.generationPlan,
    validationFeedback,
    formatSignature: fmtSig,
    // Non-critical optional fields extracted from raw styleProfile (fallback only)
    targetAudience: project.styleProfile?.targetAudience,
    emotionalIntensity: project.styleProfile?.emotionalIntensity,
    hookExample: project.styleProfile?.track_a_script?.hook_example,
    promptOverrides: project.promptOverrides,
    retryDirective,
  }, ctx.addLog);
}

/* ---- 6. QA_REVIEW (single-pass review, no retry loop) ---- */

registerStage({
  stage: 'QA_REVIEW',
  after: 'SCRIPT_GENERATION',
  async execute(ctx: StageRunContext) {
    const { project, addLog } = ctx;
    project.scriptOutput = ctx.loadArtifact(ARTIFACT.SCRIPT) ?? project.scriptOutput;

    const adapter = ctx.getSessionAwareAdapter('QA_REVIEW', 'quality_review', project.modelOverrides);
    const styleCIR = loadStyleCIR(ctx, 'QA_REVIEW');

    const result = await runQaReview(adapter, {
      scriptOutput: project.scriptOutput ?? {} as any,
      topic: project.topic,
      styleCIR,
      formatSignature: loadFormatSignature(ctx, 'QA_REVIEW'),
    }, addLog);

    project.qaReviewResult = result;
    ctx.saveArtifact(ARTIFACT.QA_REVIEW, result);

    // Log QA scores for human review at the pause point
    addLog({
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      message: `QA review: ${result.approved ? 'APPROVED' : 'NEEDS REVIEW'} (score: ${result.scores?.overall ?? 'N/A'}/10)`,
      type: result.approved ? 'success' : 'warning',
      stage: 'QA_REVIEW',
    });

    // Run contamination check — surface C12/C13 flags for human review
    const validation = validateScript(
      project.scriptOutput ?? {} as any, project.calibrationData, styleCIR,
      loadFormatSignature(ctx, 'QA_REVIEW'), project.researchData?.facts,
    );
    const contamination = validation.classifiedErrors.filter(e => e.class === 'contamination');
    if (contamination.length > 0) {
      addLog({
        id: `log_${Date.now()}`,
        timestamp: new Date().toISOString(),
        message: `⚠ Contamination flags: ${contamination.map(e => e.message).join('; ')}`,
        type: 'error',
        stage: 'QA_REVIEW',
      });
    }

    // Code-level n-gram contamination detection (supplements AI self-assessment)
    const contaminationCheck: Record<string, unknown> = { ngram: null, sourceMarkers: null, scriptValidation: null };
    const refTranscript = styleCIR.computed?.fullTranscript;
    if (refTranscript && project.scriptOutput?.scriptText) {
      const ngramResult = checkContamination(project.scriptOutput.scriptText, refTranscript);
      contaminationCheck.ngram = ngramResult;
      if (ngramResult.score > 0) {
        addLog({
          id: `log_${Date.now()}`,
          timestamp: new Date().toISOString(),
          message: `N-gram contamination: score=${ngramResult.score.toFixed(2)}, phrases=[${ngramResult.overlappingPhrases.slice(0, 5).join(', ')}]`,
          type: ngramResult.isBlocking ? 'error' : 'warning',
          stage: 'QA_REVIEW',
        });
      }
      if (ngramResult.isBlocking) {
        result.approved = false;
        project.manualReviewRequired = true;
      }
    }

    // Source marker detection — flag numeric claims without attribution
    if (project.scriptOutput?.scriptText) {
      const srcResult = checkSourceMarkers(project.scriptOutput.scriptText);
      contaminationCheck.sourceMarkers = srcResult;
      if (srcResult.unmarkedClaims.length > 0) {
        addLog({
          id: `log_${Date.now()}`,
          timestamp: new Date().toISOString(),
          message: `Source markers: ${srcResult.unmarkedClaims.length} numeric claim(s) without attribution`,
          type: 'warning',
          stage: 'QA_REVIEW',
        });
      }
    }

    // Save script validation results from earlier in the pipeline
    contaminationCheck.scriptValidation = validation;

    // Persist all contamination/validation data as a single artifact for frontend display
    ctx.saveArtifact(ARTIFACT.CONTAMINATION_CHECK, contaminationCheck);

    if (!result.approved) {
      project.manualReviewRequired = true;
      addLog({
        id: `log_${Date.now()}`,
        timestamp: new Date().toISOString(),
        message: `QA review flagged issues: ${(result.issues ?? []).join('; ')}. Manual review recommended.`,
        type: 'warning',
        stage: 'QA_REVIEW',
      });
    }
  },
});

/* ---- 6b. TEMPORAL_PLANNING (pure computation, no AI call) ---- */

registerStage({
  stage: 'TEMPORAL_PLANNING',
  after: 'QA_REVIEW',
  async execute(ctx: StageRunContext) {
    const { project, addLog } = ctx;

    // Load validated CIRs
    const styleCIR = loadStyleCIR(ctx, 'TEMPORAL_PLANNING');
    const scriptCIR = loadScriptCIR(ctx, 'TEMPORAL_PLANNING');
    const formatSignature = loadFormatSignature(ctx, 'TEMPORAL_PLANNING');
    const shotCIR = loadShotCIR(ctx, 'TEMPORAL_PLANNING');

    const plan = computeTemporalPlan({ scriptCIR, styleCIR, formatSignature, shotCIR });

    project.temporalPlan = plan;
    ctx.saveArtifact(ARTIFACT.TEMPORAL_PLAN_CIR, plan);

    addLog({
      id: `log_${Date.now()}`,
      timestamp: new Date().toISOString(),
      message: `Temporal plan: ${plan.totalSentences} scenes, ${plan.durationBudget?.allocated ?? '?'}s allocated (target ${plan.durationBudget?.target ?? '?'}s, deviation ${((plan.durationBudget?.deviation ?? 0) * 100).toFixed(1)}%)`,
      type: 'success',
      stage: 'TEMPORAL_PLANNING',
    });
  },
});
