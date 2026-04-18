/* ------------------------------------------------------------------ */
/*  VIDEO_IR_COMPILE – pure MIR builder                               */
/*  Merges validated HIR artifacts into a fully-resolved VideoIR.     */
/*  This is the compiler barrier before downstream codegen passes.    */
/* ------------------------------------------------------------------ */

import type {
  ScriptCIR,
  StoryboardCIR,
  TemporalPlanCIR,
  StyleAnalysisCIR,
  ShotCIR,
  VideoIR,
} from '../../cir/types.js';
import { buildVideoIR } from '../../cir/parsers.js';
import { createLogger } from '../../lib/logger.js';
import { resolveVoiceFromStyle, resolveRateFromPacing, computeRateFromWpm, combineRates } from '../../adapters/ttsProvider.js';

const log = createLogger('VideoIRCompile');

/** C2: Default minimum video scenes — can be overridden via CompileVideoIRInput.minVideoScenes */
export const DEFAULT_MIN_VIDEO_SCENES = 2;

export interface CompileVideoIRInput {
  scriptCIR: ScriptCIR;
  storyboardCIR: StoryboardCIR;
  temporalPlanCIR: TemporalPlanCIR;
  styleCIR: StyleAnalysisCIR;
  minVideoScenes?: number;
  /** ShotCIR for transition mapping (optional). */
  shotCIR?: ShotCIR;
}

export function compileVideoIR(input: CompileVideoIRInput): VideoIR {
  const { scriptCIR, storyboardCIR, temporalPlanCIR, styleCIR, shotCIR } = input;

  alignCIRs(scriptCIR, storyboardCIR, temporalPlanCIR);

  const ttsVoice = resolveVoiceFromStyle(
    styleCIR.audioTrack.voiceStyle,
    styleCIR.meta.videoLanguage,
  );
  const pacingRate = resolveRateFromPacing(styleCIR.pacing);
  const wpmRate = computeRateFromWpm(styleCIR.computed.wordsPerMinute);
  const ttsRate = combineRates(pacingRate, wpmRate);
  log.info('tts_rate_resolved', { pacing: styleCIR.pacing, pacingRate, wpm: styleCIR.computed.wordsPerMinute, wpmRate, combined: ttsRate });
  const promotedVideoIndices = ensureMinVideoScenes(
    storyboardCIR,
    input.minVideoScenes ?? DEFAULT_MIN_VIDEO_SCENES,
  );

  return buildVideoIR({
    scriptCIR,
    storyboardCIR,
    temporalPlanCIR,
    styleCIR,
    ttsVoice,
    ttsRate,
    promotedVideoIndices,
    shotCIR,
  });
}

/**
 * Align CIR lengths: if storyboard or temporal plan mismatch the script
 * sentence count, pad or truncate to match. Logs warnings for any adjustment.
 */
function alignCIRs(
  scriptCIR: ScriptCIR,
  storyboardCIR: StoryboardCIR,
  temporalPlanCIR: TemporalPlanCIR,
): void {
  const target = scriptCIR.sentences.length;
  const storyboardCount = storyboardCIR.scenes.length;
  const temporalCount = temporalPlanCIR.scenes.length;

  if (storyboardCount !== target) {
    log.warn('alignment_fix', {
      cir: 'Storyboard',
      was: storyboardCount,
      target,
      action: storyboardCount > target ? 'truncate' : 'pad',
    });
    if (storyboardCount > target) {
      storyboardCIR.scenes.length = target;
    } else {
      const template = storyboardCIR.scenes[storyboardCIR.scenes.length - 1];
      while (storyboardCIR.scenes.length < target) {
        storyboardCIR.scenes.push({ ...template, narrative: template?.narrative ?? '' });
      }
    }
    storyboardCIR.totalScenes = target;
  }

  if (temporalCount !== target) {
    log.warn('alignment_fix', {
      cir: 'TemporalPlan',
      was: temporalCount,
      target,
      action: temporalCount > target ? 'truncate' : 'pad',
    });
    if (temporalCount > target) {
      temporalPlanCIR.scenes.length = target;
    } else {
      const template = temporalPlanCIR.scenes[temporalPlanCIR.scenes.length - 1];
      while (temporalPlanCIR.scenes.length < target) {
        temporalPlanCIR.scenes.push({ ...template });
      }
    }
    temporalPlanCIR.totalSentences = target;
  }
}

function ensureMinVideoScenes(storyboardCIR: StoryboardCIR, minVideoScenes: number): Set<number> {
  const promoted = new Set<number>();
  if (minVideoScenes <= 0 || storyboardCIR.scenes.length === 0) return promoted;

  const currentVideoCount = storyboardCIR.scenes.filter((scene) => scene.assetType === 'video').length;
  if (currentVideoCount >= minVideoScenes) return promoted;

  const need = Math.min(
    minVideoScenes - currentVideoCount,
    storyboardCIR.scenes.length - currentVideoCount,
  );
  if (need <= 0) return promoted;

  const candidates = storyboardCIR.scenes
    .map((scene, index) => ({ index, scene }))
    .filter(({ scene }) => scene.assetType !== 'video')
    .sort((left, right) => right.scene.targetDurationSec - left.scene.targetDurationSec);

  for (const candidate of candidates.slice(0, need)) {
    promoted.add(candidate.index);
  }

  return promoted;
}
