/* ------------------------------------------------------------------ */
/*  Compilation Pass State Machine — enforces valid pass transitions   */
/* ------------------------------------------------------------------ */

import type { ProcessStatus, PipelineStage } from '../../shared/types.js';

/**
 * Valid state transitions for pipeline stages.
 *
 * ```
 *   pending ──→ processing ──→ completed
 *                   │
 *                   └──→ error ──→ pending (retry)
 * ```
 */
const VALID_STAGE_TRANSITIONS: Record<ProcessStatus, readonly ProcessStatus[]> = {
  pending: ['processing'],
  processing: ['completed', 'error'],
  completed: ['pending'],   // allow reset for retry
  error: ['pending'],       // retry resets to pending
};

export class InvalidStageTransitionError extends Error {
  constructor(
    public readonly stage: PipelineStage,
    public readonly from: ProcessStatus,
    public readonly to: ProcessStatus,
  ) {
    super(`Invalid stage transition: ${stage} ${from} → ${to}`);
    this.name = 'InvalidStageTransitionError';
  }
}

/**
 * Assert that a stage transition is valid. Throws if not.
 */
export function assertStageTransition(
  stage: PipelineStage,
  from: ProcessStatus,
  to: ProcessStatus,
): void {
  const allowed = VALID_STAGE_TRANSITIONS[from];
  if (!allowed.includes(to)) {
    throw new InvalidStageTransitionError(stage, from, to);
  }
}

/**
 * Safely transition a stage status, returning the new status.
 * Throws InvalidStageTransitionError on illegal transitions.
 */
export function transitionStage(
  stageStatus: Record<string, ProcessStatus>,
  stage: PipelineStage,
  to: ProcessStatus,
): ProcessStatus {
  const from = stageStatus[stage] ?? 'pending';
  assertStageTransition(stage, from, to);
  stageStatus[stage] = to;
  return to;
}
