/* ------------------------------------------------------------------ */
/*  CIR validators – structural validation for IR objects             */
/* ------------------------------------------------------------------ */

export function validateStyleAnalysisCIR(cir: unknown): string[] {
  const errors: string[] = [];
  if (!cir || typeof cir !== 'object') { errors.push('CIR is null or not an object'); return errors; }
  const c = cir as Record<string, unknown>;
  if (c._cir !== 'StyleAnalysis') errors.push('_cir must be "StyleAnalysis"');
  if (!c.visualStyle) errors.push('visualStyle is required');
  if (!c.meta || typeof c.meta !== 'object') errors.push('meta is required');
  else {
    const m = c.meta as Record<string, unknown>;
    if (typeof m.videoDurationSec !== 'number' || m.videoDurationSec <= 0) errors.push('meta.videoDurationSec must be positive number');
    if (!m.videoLanguage) errors.push('meta.videoLanguage is required');
  }
  if (!c.scriptTrack || typeof c.scriptTrack !== 'object') errors.push('scriptTrack is required');
  if (!c.visualTrack || typeof c.visualTrack !== 'object') errors.push('visualTrack is required');
  if (!c.audioTrack || typeof c.audioTrack !== 'object') errors.push('audioTrack is required');
  return errors;
}

export function validateScriptCIR(cir: unknown): string[] {
  const errors: string[] = [];
  if (!cir || typeof cir !== 'object') { errors.push('CIR is null or not an object'); return errors; }
  const c = cir as Record<string, unknown>;
  if (c._cir !== 'Script') errors.push('_cir must be "Script"');
  if (typeof c.fullText !== 'string' || !c.fullText) errors.push('fullText is required');
  if (!Array.isArray(c.sentences)) errors.push('sentences must be an array');
  if (typeof c.totalWordCount !== 'number') errors.push('totalWordCount must be a number');
  if (!c.safety || typeof c.safety !== 'object') errors.push('safety is required');
  if (!c.calibration || typeof c.calibration !== 'object') errors.push('calibration is required');
  return errors;
}

export function validateFormatSignature(fs: unknown): string[] {
  const errors: string[] = [];
  if (!fs || typeof fs !== 'object') { errors.push('FormatSignature is null or not an object'); return errors; }
  const f = fs as Record<string, unknown>;
  if (f._type !== 'FormatSignature') errors.push('_type must be "FormatSignature"');
  if (f._error) errors.push(`FormatSignature has extraction error: ${f._error}`);
  if (typeof f.hookTemplate !== 'string') errors.push('hookTemplate must be a string');
  if (typeof f.closingTemplate !== 'string') errors.push('closingTemplate must be a string');
  if (!Array.isArray(f.sentenceLengthSequence)) errors.push('sentenceLengthSequence must be an array');
  if (!Array.isArray(f.transitionPositions)) errors.push('transitionPositions must be an array');
  if (!Array.isArray(f.transitionPatterns)) errors.push('transitionPatterns must be an array');
  if (!Array.isArray(f.arcSentenceAllocation)) errors.push('arcSentenceAllocation must be an array');
  if (!Array.isArray(f.arcStageLabels)) errors.push('arcStageLabels must be an array');
  if (!Array.isArray(f.signaturePhrases)) errors.push('signaturePhrases must be an array');
  if (!Array.isArray(f.emotionalArcShape)) errors.push('emotionalArcShape must be an array');
  if (!f.seriesVisualMotifs || typeof f.seriesVisualMotifs !== 'object') errors.push('seriesVisualMotifs must be an object');
  return errors;
}

export function validateShotCIR(cir: unknown): string[] {
  const errors: string[] = [];
  if (!cir || typeof cir !== 'object') { errors.push('CIR is null or not an object'); return errors; }
  const c = cir as Record<string, unknown>;
  if (c._cir !== 'ShotAnalysis') errors.push('_cir must be "ShotAnalysis"');
  if (!Array.isArray(c.shots)) errors.push('shots must be an array');
  if (typeof c.totalShots !== 'number' || c.totalShots < 0) errors.push('totalShots must be a non-negative number');
  if (typeof c.videoDurationSec !== 'number' || c.videoDurationSec <= 0) errors.push('videoDurationSec must be positive');
  if (!Array.isArray(c.rhythmSignature)) errors.push('rhythmSignature must be an array');
  return errors;
}

export function validateStoryboardCIR(cir: unknown): string[] {
  const errors: string[] = [];
  if (!cir || typeof cir !== 'object') { errors.push('CIR is null or not an object'); return errors; }
  const c = cir as Record<string, unknown>;
  if (c._cir !== 'Storyboard') errors.push('_cir must be "Storyboard"');
  if (!Array.isArray(c.scenes)) errors.push('scenes must be an array');
  else if ((c.scenes as unknown[]).length === 0) errors.push('scenes must not be empty');
  return errors;
}

export function validateVideoIR(cir: unknown): string[] {
  const errors: string[] = [];
  if (!cir || typeof cir !== 'object') { errors.push('CIR is null or not an object'); return errors; }
  const c = cir as Record<string, unknown>;

  if (c._cir !== 'VideoIR') errors.push('_cir must be "VideoIR"');
  if (c.version !== 1) errors.push('version must be 1');
  if (typeof c.targetDurationSec !== 'number' || c.targetDurationSec <= 0) errors.push('targetDurationSec must be positive number');
  if (typeof c.fps !== 'number' || c.fps <= 0) errors.push('fps must be positive number');
  if (typeof c.language !== 'string' || !c.language) errors.push('language is required');
  if (c.avSyncPolicy !== 'audio-primary') errors.push('avSyncPolicy must be "audio-primary"');
  if (typeof c.bgmRelativeVolume !== 'number' || c.bgmRelativeVolume < 0 || c.bgmRelativeVolume > 1) errors.push('bgmRelativeVolume must be a number between 0 and 1');

  const res = c.resolution as Record<string, unknown> | undefined;
  if (!res || typeof res !== 'object') errors.push('resolution is required');
  else {
    if (typeof res.w !== 'number' || res.w <= 0) errors.push('resolution.w must be positive number');
    if (typeof res.h !== 'number' || res.h <= 0) errors.push('resolution.h must be positive number');
  }

  if (!Array.isArray(c.scenes)) { errors.push('scenes must be an array'); return errors; }
  const scenes = c.scenes as unknown[];
  if (scenes.length === 0) errors.push('scenes must not be empty');

  const VALID_DURATIONS = [5, 8, 10, 15, 20];
  const VALID_EMPHASIS: string[] = ['slow', 'normal', 'fast'];
  const VALID_ASSET: string[] = ['image', 'video'];
  const VALID_PHASE: string[] = ['hook', 'build', 'climax', 'resolution', 'cta'];
  const VALID_TRANSITION: string[] = ['cut', 'dissolve', 'fade', 'wipe', 'zoom', 'none'];

  for (let i = 0; i < scenes.length; i++) {
    const s = scenes[i] as Record<string, unknown> | undefined;
    if (!s || typeof s !== 'object') { errors.push(`scenes[${i}] is not an object`); continue; }

    if (typeof s.index !== 'number') errors.push(`scenes[${i}].index must be a number`);
    if (!Array.isArray(s.sentenceIndices) || (s.sentenceIndices as unknown[]).length === 0) {
      errors.push(`scenes[${i}].sentenceIndices must be non-empty array`);
    }
    if (typeof s.narrative !== 'string' || !s.narrative) errors.push(`scenes[${i}].narrative is required`);
    if (typeof s.visualPrompt !== 'string' || !s.visualPrompt) errors.push(`scenes[${i}].visualPrompt is required`);
    if (!Array.isArray(s.colorPalette) || (s.colorPalette as unknown[]).length === 0) {
      errors.push(`scenes[${i}].colorPalette must be a non-empty string array`);
    }
    if (typeof s.lightingStyle !== 'string' || !s.lightingStyle) errors.push(`scenes[${i}].lightingStyle is required`);
    if (typeof s.visualStyle !== 'string' || !s.visualStyle) errors.push(`scenes[${i}].visualStyle is required`);
    if (!VALID_ASSET.includes(s.assetType as string)) errors.push(`scenes[${i}].assetType must be 'image' or 'video'`);
    if (typeof s.rawDurationSec !== 'number' || (s.rawDurationSec as number) <= 0) errors.push(`scenes[${i}].rawDurationSec must be positive`);
    if (!VALID_DURATIONS.includes(s.apiDurationSec as number)) errors.push(`scenes[${i}].apiDurationSec must be one of [5,8,10,15,20]`);
    if (typeof s.ttsBudgetSec !== 'number' || (s.ttsBudgetSec as number) <= 0) errors.push(`scenes[${i}].ttsBudgetSec must be positive`);
    if (typeof s.ttsVoice !== 'string' || !s.ttsVoice) errors.push(`scenes[${i}].ttsVoice is required`);
    if (s.ttsRate !== undefined && typeof s.ttsRate !== 'string') errors.push(`scenes[${i}].ttsRate must be string or undefined`);
    if (!VALID_EMPHASIS.includes(s.emphasis as string)) errors.push(`scenes[${i}].emphasis must be 'slow', 'normal', or 'fast'`);
    if (!VALID_PHASE.includes(s.narrativePhase as string)) errors.push(`scenes[${i}].narrativePhase must be a valid phase`);
    if (!VALID_TRANSITION.includes(s.transitionToNext as string)) errors.push(`scenes[${i}].transitionToNext must be a valid transition type`);
    if (!s.production || typeof s.production !== 'object') errors.push(`scenes[${i}].production is required`);
  }
  return errors;
}
