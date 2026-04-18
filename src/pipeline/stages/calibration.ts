/* ------------------------------------------------------------------ */
/*  Pass 4: Calibration – speech-rate calibration + fact verification  */
/*  Computes target constraints (word count, duration, pacing) for   */
/*  downstream code generation passes.                               */
/* ------------------------------------------------------------------ */

import type { AIAdapter, ResearchData, CalibrationData, LogEntry } from '../types.js';
import type { StyleAnalysisCIR } from '../../cir/types.js';
import { CALIBRATION_PROMPT, fillTemplate } from '../prompts.js';
import { extractAndValidateJSON } from '../../adapters/responseParser.js';
import { CALIBRATION_SCHEMA } from '../../adapters/schemaValidator.js';
import { annotateValue } from './confidenceFilter.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';

const slog = createLogger('Calibration');

export interface CalibrationInput {
  topic: string;
  styleCIR: StyleAnalysisCIR;
  researchData: ResearchData;
}

// Calibration is a sub-step of the NARRATIVE_MAP stage (runs before narrative mapping)
const log = createStageLog('NARRATIVE_MAP');

/**
 * Run the calibration stage:
 * 1. Calculate speech rate from reference video data
 * 2. Determine target word count for new video
 * 3. Verify facts with source markers
 */
export async function runCalibration(
  adapter: AIAdapter,
  input: CalibrationInput,
  onLog?: (entry: LogEntry) => void,
): Promise<CalibrationData> {
  const emit = onLog ?? (() => {});
  const { topic, styleCIR } = input;

  const { scriptTrack, meta, computed, confidence } = styleCIR;

  emit(log('Calibrating speech rate and verifying facts...'));

  const calibPrompt = fillTemplate(CALIBRATION_PROMPT, {
    video_duration_sec: meta.videoDurationSec,
    total_words: computed.wordCount,
    video_language: meta.videoLanguage,
    narrative_arc: annotateValue(JSON.stringify(scriptTrack.narrativeArc), confidence['narrativeArc']),
    hook_strategy: annotateValue(scriptTrack.hookStrategy, confidence['hookStrategy']),
    cta_pattern: annotateValue(scriptTrack.ctaPattern, confidence['ctaPattern']),
    topic,
  });
  slog.debug('prompt_preview', { content: calibPrompt.slice(0, 500) });

  const result = await adapter.generateText('', calibPrompt, {
    responseMimeType: 'application/json',
  });
  slog.debug('response_received', { length: (result.text ?? '').length });
  slog.debug('response_preview', { content: (result.text ?? '').slice(0, 1000) });

  const data = extractAndValidateJSON<any>(result.text ?? '', CALIBRATION_SCHEMA, 'calibration');
  slog.debug('parsed_result', { keys: data ? Object.keys(data).join(', ') : 'null' });
  if (!data) {
    throw new Error('Calibration failed: could not parse response as JSON');
  }

  const calibration = data.calibration ?? {};
  const verified_facts = data.verified_facts ?? [];

  emit(log(`Calibration complete: WPM=${calibration.actual_speech_rate}, target=${calibration.target_word_count} words, ${verified_facts.length} facts verified`, 'success'));

  return { calibration, verified_facts };
}
