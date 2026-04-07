/* ------------------------------------------------------------------ */
/*  Stage 13: Refinement – check completeness + auto-retry failures   */
/* ------------------------------------------------------------------ */

import type { LogEntry } from '../types.js';
import type { PipelineScene } from '../../../shared/types.js';
import { createStageLog } from './stageLog.js';

export interface RefinementInput {
  scenes: PipelineScene[];
  maxRetries: number;
}

export interface RefinementOutput {
  allComplete: boolean;
  failedScenes: string[];
  retriedScenes: string[];
  retryCount: number;
}

const log = createStageLog('REFINEMENT');

/**
 * Run the refinement stage:
 * 1. Check which scenes are missing assets or have errors
 * 2. Report failed scene IDs for upstream retry
 *
 * The actual retry of individual scenes is handled by the orchestrator
 * calling regenerateSceneAssets. This stage just identifies what needs fixing.
 */
export async function runRefinement(
  input: RefinementInput,
  onLog?: (entry: LogEntry) => void,
): Promise<RefinementOutput> {
  const emit = onLog ?? (() => {});
  const { scenes, maxRetries } = input;

  emit(log('Checking scene asset completeness...'));

  const failedScenes: string[] = [];

  for (const scene of scenes) {
    const hasVisual = scene.assetUrl && scene.assetType !== 'placeholder';
    const hasAudio = !!scene.audioUrl;

    if (!hasVisual || !hasAudio || scene.status === 'error') {
      failedScenes.push(scene.id);
    }
  }

  if (failedScenes.length === 0) {
    emit(log(`All ${scenes.length} scenes have complete assets`, 'success'));
    return { allComplete: true, failedScenes: [], retriedScenes: [], retryCount: 0 };
  }

  emit(log(`Found ${failedScenes.length} incomplete scenes: ${failedScenes.join(', ')}`, 'warning'));

  return {
    allComplete: false,
    failedScenes,
    retriedScenes: [],
    retryCount: 0,
  };
}
