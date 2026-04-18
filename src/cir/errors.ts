/* ------------------------------------------------------------------ */
/*  CIR Error Model – typed errors for compilation contract violations */
/*  All must be thrown, never ignored. No silent fallback.            */
/* ------------------------------------------------------------------ */

import type { PipelineStage } from '../../shared/types.js';

/* ---- Authority lock: recursive freeze for immutable CIR ---- */

/**
 * Recursively freeze an object tree. After this call, any attempt to
 * mutate the object (or its nested children) throws in strict mode.
 * Used to enforce VideoIR immutability after VIDEO_IR_COMPILE.
 */
export function deepFreeze<T extends object>(obj: T): Readonly<T> {
  Object.freeze(obj);
  for (const value of Object.values(obj)) {
    if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
      deepFreeze(value);
    }
  }
  return obj;
}

/**
 * Thrown when a CIR object fails schema validation.
 * This means the AI output → CIR parser produced invalid structure.
 */
export class CIRValidationError extends Error {
  constructor(
    public readonly stage: PipelineStage,
    public readonly cirType: string,
    public readonly violations: string[],
  ) {
    super(`CIR validation failed at ${stage} (${cirType}): ${violations.join('; ')}`);
    this.name = 'CIRValidationError';
  }
}


/**
 * Thrown when an AI response cannot be parsed into a CIR.
 * This is the "compiler frontend" error — raw LLM output is garbage.
 */
export class AIParseError extends Error {
  constructor(
    public readonly stage: PipelineStage,
    public readonly rawText: string,
    public readonly reason: string,
  ) {
    // Don't include full rawText in message (could be huge)
    super(`AI parse error at ${stage}: ${reason}`);
    this.name = 'AIParseError';
  }
}
