/* ------------------------------------------------------------------ */
/*  FormatSignature Extraction – series structural identity           */
/*  Extracts the immutable "series format DNA" from a reference       */
/*  transcript, separating structural patterns from topic content.    */
/* ------------------------------------------------------------------ */

import type { AIAdapter, LogEntry } from '../types.js';
import type { StyleAnalysisCIR, FormatSignature } from '../../cir/types.js';
import { FORMAT_SIGNATURE_PROMPT, fillTemplate } from '../prompts.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';

const log = createStageLog('STYLE_EXTRACTION');
const slog = createLogger('FormatSignatureExtraction');

export interface FormatSignatureInput {
  styleCIR: StyleAnalysisCIR;
}

/**
 * Extract FormatSignature from a validated StyleAnalysisCIR.
 * Uses the fullTranscript + narrative arc to derive structural patterns.
 */
export async function extractFormatSignature(
  adapter: AIAdapter,
  input: FormatSignatureInput,
  onLog?: (entry: LogEntry) => void,
): Promise<FormatSignature> {
  const emit = onLog ?? (() => {});
  const { styleCIR } = input;

  emit(log('Extracting FormatSignature (series structural identity)...'));

  const prompt = fillTemplate(FORMAT_SIGNATURE_PROMPT, {
    fullTranscript: styleCIR.computed.fullTranscript,
    narrative_arc: JSON.stringify(styleCIR.scriptTrack.narrativeArc),
    hook_strategy: styleCIR.scriptTrack.hookStrategy,
    cta_pattern: styleCIR.scriptTrack.ctaPattern,
    video_language: styleCIR.meta.videoLanguage,
  });

  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
  });

  slog.debug('response_received', { length: (result.text ?? '').length });

  const parsed = extractJSON<any>(result.text ?? '');
  if (!parsed) {
    throw new Error('Failed to extract FormatSignature: could not parse AI response as JSON');
  }

  // Normalize into FormatSignature type
  const signature: FormatSignature = {
    _type: 'FormatSignature',
    version: 1,
    hookTemplate: parsed.hookTemplate ?? '',
    closingTemplate: parsed.closingTemplate ?? '',
    sentenceLengthSequence: Array.isArray(parsed.sentenceLengthSequence) ? parsed.sentenceLengthSequence : [],
    transitionPositions: Array.isArray(parsed.transitionPositions) ? parsed.transitionPositions : [],
    transitionPatterns: Array.isArray(parsed.transitionPatterns) ? parsed.transitionPatterns : [],
    arcSentenceAllocation: Array.isArray(parsed.arcSentenceAllocation) ? parsed.arcSentenceAllocation : [],
    arcStageLabels: Array.isArray(parsed.arcStageLabels) ? parsed.arcStageLabels : [],
    signaturePhrases: Array.isArray(parsed.signaturePhrases) ? parsed.signaturePhrases : [],
    emotionalArcShape: Array.isArray(parsed.emotionalArcShape) ? parsed.emotionalArcShape : [],
    seriesVisualMotifs: {
      hookMotif: parsed.seriesVisualMotifs?.hookMotif ?? '',
      mechanismMotif: parsed.seriesVisualMotifs?.mechanismMotif ?? '',
      climaxMotif: parsed.seriesVisualMotifs?.climaxMotif ?? '',
      reflectionMotif: parsed.seriesVisualMotifs?.reflectionMotif ?? '',
    },
  };

  emit(log(`FormatSignature extracted: ${signature.sentenceLengthSequence.length} sentences, ${signature.transitionPositions.length} transitions, ${signature.signaturePhrases.length} signature phrases`, 'success'));

  return signature;
}
