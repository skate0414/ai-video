/* ------------------------------------------------------------------ */
/*  Stage definitions – creation group                                */
/*  (NARRATIVE_MAP, SCRIPT_GENERATION, QA_REVIEW)                     */
/* ------------------------------------------------------------------ */

import { registerStage, type StageRunContext } from '../../stageRegistry.js';
import { runCalibration } from '../calibration.js';
import { runNarrativeMap } from '../narrativeMap.js';
import { runScriptGeneration } from '../scriptGeneration.js';
import { runScriptAudit } from '../scriptAudit.js';
import { runQaReview } from '../qaReview.js';

/* ---- 4. NARRATIVE_MAP (includes calibration sub-step) ---- */

registerStage({
  stage: 'NARRATIVE_MAP',
  async execute(ctx: StageRunContext) {
    const { project, addLog } = ctx;
    project.styleProfile ??= ctx.loadArtifact('style-profile.json');
    project.researchData ??= ctx.loadArtifact('research.json');

    // Step A: Calibration
    const calAdapter = ctx.getSessionAwareAdapter('NARRATIVE_MAP', 'calibration', project.modelOverrides);
    const calResult = await runCalibration(calAdapter, {
      topic: project.topic,
      styleProfile: project.styleProfile!,
      researchData: project.researchData!,
    }, addLog);
    project.calibrationData = calResult;
    ctx.saveArtifact('calibration.json', calResult);

    // Step B: Narrative map
    const nmAdapter = ctx.getSessionAwareAdapter('NARRATIVE_MAP', 'calibration', project.modelOverrides);
    const nmResult = await runNarrativeMap(nmAdapter, {
      topic: project.topic,
      styleProfile: project.styleProfile!,
      calibrationData: calResult,
    }, addLog);
    project.narrativeMap = nmResult.narrativeMap;
    project.generationPlan = nmResult.generationPlan;
    ctx.saveArtifact('narrative-map.json', nmResult);
  },
});

/* ---- 5. SCRIPT_GENERATION (includes script audit sub-step) ---- */

registerStage({
  stage: 'SCRIPT_GENERATION',
  async execute(ctx: StageRunContext) {
    const { project, addLog } = ctx;
    project.styleProfile ??= ctx.loadArtifact('style-profile.json');
    project.researchData ??= ctx.loadArtifact('research.json');
    project.calibrationData ??= ctx.loadArtifact('calibration.json');
    project.narrativeMap ??= ctx.loadArtifact<any>('narrative-map.json')?.narrativeMap;

    const adapter = ctx.getSessionAwareAdapter('SCRIPT_GENERATION', 'script_generation', project.modelOverrides);
    const result = await runScriptGeneration(adapter, {
      topic: project.topic,
      styleProfile: project.styleProfile!,
      researchData: project.researchData!,
      calibrationData: project.calibrationData,
      narrativeMap: project.narrativeMap!,
      generationPlan: project.generationPlan,
    }, addLog);
    project.scriptOutput = result;
    ctx.saveArtifact('script.json', result);

    // Self-correction audit sub-step
    const auditAdapter = ctx.getSessionAwareAdapter('SCRIPT_GENERATION', 'script_generation', project.modelOverrides);
    const auditResult = await runScriptAudit(auditAdapter, {
      scriptOutput: result,
      styleProfile: project.styleProfile!,
      topic: project.topic,
    }, addLog);
    ctx.saveArtifact('script-audit.json', auditResult);

    // Apply corrections if needed
    if (auditResult.corrections.length > 0 && auditResult.correctedScript !== result.scriptText) {
      project.scriptOutput!.scriptText = auditResult.correctedScript;
      ctx.saveArtifact('script.json', project.scriptOutput);
    }

    project.scriptOutput!.styleConsistency = {
      score: auditResult.styleConsistencyScore,
      isDeviation: auditResult.styleConsistencyScore < 0.78,
      feedback: auditResult.corrections.map((c: any) => c.reason).join('; ') || 'No issues',
      status: auditResult.styleConsistencyScore >= 0.78 ? 'pass' : 'warn',
    };
  },
});

/* ---- 6. QA_REVIEW ---- */

registerStage({
  stage: 'QA_REVIEW',
  async execute(ctx: StageRunContext) {
    const { project, addLog } = ctx;
    project.scriptOutput ??= ctx.loadArtifact('script.json');

    const adapter = ctx.getSessionAwareAdapter('QA_REVIEW', 'quality_review', project.modelOverrides);
    const result = await runQaReview(adapter, {
      scriptOutput: project.scriptOutput!,
      topic: project.topic,
      styleProfile: project.styleProfile!,
    }, addLog);
    project.qaReviewResult = result;
    ctx.saveArtifact('qa-review.json', result);
  },
});
