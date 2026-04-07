/* ------------------------------------------------------------------ */
/*  Stage 4: Calibration – speech rate calibration + fact verification */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, ResearchData, CalibrationData, LogEntry } from '../types.js';
import { CALIBRATION_PROMPT, fillTemplate } from '../prompts.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';

export interface CalibrationInput {
  topic: string;
  styleProfile: StyleProfile;
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
  const { topic, styleProfile } = input;

  const trackA = styleProfile.track_a_script ?? {};
  const meta = styleProfile.meta ?? { video_language: 'Chinese', video_duration_sec: 60 };

  emit(log('Calibrating speech rate and verifying facts...'));

  const calibPrompt = fillTemplate(CALIBRATION_PROMPT, {
    video_duration_sec: meta.video_duration_sec ?? 60,
    total_words: styleProfile.wordCount ?? 300,
    video_language: meta.video_language ?? 'Chinese',
    narrative_arc: JSON.stringify(styleProfile.narrativeStructure ?? []),
    hook_strategy: trackA.hook_strategy ?? styleProfile.hookType ?? 'Question',
    cta_pattern: trackA.cta_pattern ?? 'Subscribe CTA',
    topic,
  });
  console.log('[CALIBRATION] prompt preview:', calibPrompt.slice(0, 500));

  const result = await adapter.generateText('', calibPrompt, {
    responseMimeType: 'application/json',
  });
  console.log('[CALIBRATION] raw response length:', (result.text ?? '').length);
  console.log('[CALIBRATION] raw response preview:', (result.text ?? '').slice(0, 1000));

  const data = extractJSON<any>(result.text ?? '');
  console.log('[CALIBRATION] parsed data keys:', data ? Object.keys(data).join(', ') : 'null');
  if (!data) {
    throw new Error('Calibration failed: could not parse response as JSON');
  }

  const calibration = data.calibration ?? {};
  const verified_facts = data.verified_facts ?? [];

  emit(log(`Calibration complete: WPM=${calibration.actual_speech_rate}, target=${calibration.target_word_count} words, ${verified_facts.length} facts verified`, 'success'));

  return { calibration, verified_facts };
}
