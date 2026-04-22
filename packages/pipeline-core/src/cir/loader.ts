/* ------------------------------------------------------------------ */
/*  CIR Loader – thin artifact loaders, no schema validation         */
/*  Stages read typed data from disk through these helpers.          */
/* ------------------------------------------------------------------ */

import type { PipelineStage } from '../sharedTypes.js';
import { ARTIFACT } from '../constants.js';
import type { StyleAnalysisCIR, ScriptCIR, StoryboardCIR, FormatSignature, VideoIR, ShotCIR } from './types.js';
import { CIRValidationError } from './errors.js';

/* ---- Minimal context required — avoids coupling to full StageRunContext ---- */

export interface CIRLoadContext {
  loadArtifact: <T>(filename: string) => T | undefined;
}

/* ---- Generic loader (single implementation) ---- */

function loadCIR<T>(ctx: CIRLoadContext, stage: PipelineStage, filename: string, tag: string, cirType: string): T {
  const raw = ctx.loadArtifact<T>(filename);
  if (!raw || (raw as any)._cir !== tag) {
    throw new CIRValidationError(stage, cirType, [
      `${filename} is missing or not a valid ${cirType} — cannot proceed`,
    ]);
  }
  return raw;
}

/* ---- Public typed loaders ---- */

export function loadStyleCIR(ctx: CIRLoadContext, stage: PipelineStage): StyleAnalysisCIR {
  return loadCIR(ctx, stage, ARTIFACT.STYLE_ANALYSIS_CIR, 'StyleAnalysis', 'StyleAnalysis');
}

export function loadScriptCIR(ctx: CIRLoadContext, stage: PipelineStage): ScriptCIR {
  return loadCIR(ctx, stage, ARTIFACT.SCRIPT_CIR, 'Script', 'Script');
}

export function loadStoryboardCIR(ctx: CIRLoadContext, stage: PipelineStage): StoryboardCIR {
  return loadCIR(ctx, stage, ARTIFACT.STORYBOARD_CIR, 'Storyboard', 'Storyboard');
}

export function loadVideoIR(ctx: CIRLoadContext, stage: PipelineStage): VideoIR {
  return loadCIR(ctx, stage, ARTIFACT.VIDEO_IR_CIR, 'VideoIR', 'VideoIR');
}

/**
 * Load FormatSignature (optional artifact — returns undefined when absent).
 */
export function loadFormatSignature(ctx: CIRLoadContext, stage: PipelineStage): FormatSignature | undefined {
  const raw = ctx.loadArtifact<FormatSignature>(ARTIFACT.FORMAT_SIGNATURE);
  if (!raw) return undefined;
  if ((raw as any)._error) return undefined;
  if ((raw as any)._type !== 'FormatSignature') return undefined;
  return raw;
}

/**
 * Load ShotCIR (optional artifact — returns undefined when absent).
 */
export function loadShotCIR(ctx: CIRLoadContext, _stage: PipelineStage): ShotCIR | undefined {
  const raw = ctx.loadArtifact<ShotCIR>(ARTIFACT.SHOT_CIR);
  if (!raw || (raw as any)._cir !== 'ShotAnalysis') return undefined;
  return raw;
}
