/* ------------------------------------------------------------------ */
/*  Final Risk Gate – last safety check before pipeline completes     */
/*  Inspired by ai-suite's finalRiskGate (4-point validation)        */
/* ------------------------------------------------------------------ */

import type { LogEntry } from '../types.js';
import type { PipelineScene } from '../../../shared/types.js';
import { runSafetyMiddleware } from '../safety.js';
import { SafetyBlockError } from '../orchestrator.js';
import { createStageLog } from './stageLog.js';

export interface FinalRiskGateInput {
  scenes: PipelineScene[];
  scriptText: string;
}

export interface FinalRiskGateOutput {
  passed: boolean;
  checks: {
    sceneCompleteness: boolean;
    placeholderDetection: boolean;
    narrativeSafety: boolean;
    missingAssets: string[];
    safetyIssues: string[];
  };
}

// Final risk gate is a sub-step of the REFINEMENT stage (safety check before pipeline completion)
const log = createStageLog('REFINEMENT');

/**
 * Final risk gate — runs 4 checks before allowing the pipeline to consider itself complete:
 * 1. Scene completeness: all scenes have visual + audio assets
 * 2. Placeholder detection: no placeholder/dummy content in narratives
 * 3. Narrative safety: re-run safety middleware on the final assembled script
 * 4. Missing asset detection: check for placeholder asset types
 */
export function runFinalRiskGate(
  input: FinalRiskGateInput,
  onLog?: (entry: LogEntry) => void,
): FinalRiskGateOutput {
  const emit = onLog ?? (() => {});
  const { scenes, scriptText } = input;

  emit(log('Running final risk gate...'));

  // 1. Scene completeness
  const missingAssets: string[] = [];
  for (const scene of scenes) {
    if (!scene.assetUrl || scene.assetType === 'placeholder') {
      missingAssets.push(scene.id);
    }
    if (!scene.audioUrl) {
      missingAssets.push(`${scene.id}:audio`);
    }
  }
  const sceneCompleteness = missingAssets.length === 0;

  // 2. Placeholder detection — look for [TODO], [INSERT], PLACEHOLDER, etc.
  const placeholderPatterns = /\[TODO\]|\[INSERT\]|\[PLACEHOLDER\]|PLACEHOLDER|lorem ipsum|TBD/i;
  const hasPlaceholders = scenes.some(s =>
    placeholderPatterns.test(s.narrative) || placeholderPatterns.test(s.visualPrompt)
  );
  const placeholderDetection = !hasPlaceholders;

  // 3. Narrative safety — re-run safety middleware on final script
  const safetyReport = runSafetyMiddleware(scriptText);
  const safetyIssues: string[] = [];
  if (safetyReport.suicideDetected) safetyIssues.push('suicide_risk');
  if (safetyReport.medicalClaimDetected) safetyIssues.push('medical_claim');
  const narrativeSafety = safetyIssues.length === 0;

  const passed = sceneCompleteness && placeholderDetection && narrativeSafety;

  if (passed) {
    emit(log('Final risk gate: all checks passed', 'success'));
  } else {
    const failReasons: string[] = [];
    if (!sceneCompleteness) failReasons.push(`${missingAssets.length} missing assets`);
    if (!placeholderDetection) failReasons.push('placeholder content detected');
    if (!narrativeSafety) failReasons.push(`safety issues: ${safetyIssues.join(', ')}`);
    emit(log(`Final risk gate: FAILED — ${failReasons.join('; ')}`, 'warning'));
  }

  // Hard block on safety issues — these cannot proceed
  if (!narrativeSafety) {
    throw new SafetyBlockError(`Final risk gate: narrative safety failed (${safetyIssues.join(', ')})`);
  }

  return {
    passed,
    checks: {
      sceneCompleteness,
      placeholderDetection,
      narrativeSafety,
      missingAssets,
      safetyIssues,
    },
  };
}
