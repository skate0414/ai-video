/* ------------------------------------------------------------------ */
/*  Stage 6: Script Generation – full script from style constraints   */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, ResearchData, CalibrationData, NarrativeMap, ScriptOutput, LogEntry } from '../types.js';
import { SCRIPT_SYSTEM_PROMPT, SCRIPT_USER_PROMPT, fillTemplate } from '../prompts.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { runSafetyMiddleware } from '../safety.js';
import { SafetyBlockError } from '../orchestrator.js';
import { createStageLog } from './stageLog.js';

export interface ScriptGenerationInput {
  topic: string;
  styleProfile: StyleProfile;
  researchData: ResearchData;
  calibrationData: CalibrationData;
  narrativeMap: NarrativeMap;
}

const log = createStageLog('SCRIPT_GENERATION');

/**
 * Run the script generation stage:
 * Generate full script based on Style DNA constraints, calibration data, and narrative map.
 * Includes safety middleware check.
 */
export async function runScriptGeneration(
  adapter: AIAdapter,
  input: ScriptGenerationInput,
  onLog?: (entry: LogEntry) => void,
): Promise<ScriptOutput> {
  const emit = onLog ?? (() => {});
  const { topic, styleProfile, researchData, calibrationData, narrativeMap } = input;

  const trackA = styleProfile.track_a_script ?? {};
  const trackB = styleProfile.track_b_visual ?? {};
  const meta = styleProfile.meta ?? { video_language: 'Chinese', video_duration_sec: 60 };
  const calibration = calibrationData.calibration;

  emit(log('Generating full script...'));

  // Compile verified facts list
  const allFacts = [
    ...calibrationData.verified_facts.map(f => `[Fact ${f.fact_id}] ${f.content} (${f.source_marker})`),
    ...researchData.facts.map(f => `[${f.id}] ${f.content}`),
  ];
  const factsListStr = allFacts.slice(0, 10).join('\n');

  const systemPrompt = fillTemplate(SCRIPT_SYSTEM_PROMPT, {
    video_language: meta.video_language ?? 'Chinese',
  });

  const userPrompt = fillTemplate(SCRIPT_USER_PROMPT, {
    topic,
    target_word_count: calibration.target_word_count ?? 300,
    target_word_count_min: calibration.target_word_count_min ?? '270',
    target_word_count_max: calibration.target_word_count_max ?? '330',
    target_duration_sec: calibration.new_video_target_duration_sec ?? meta.video_duration_sec ?? 60,
    speech_rate: calibration.actual_speech_rate ?? '250 characters per minute',
    hook_strategy: trackA.hook_strategy ?? styleProfile.hookType ?? 'Question',
    narrative_arc: JSON.stringify(styleProfile.narrativeStructure ?? []),
    emotional_tone_arc: trackA.emotional_tone_arc ?? 'neutral → engaged → climax → resolution',
    cta_pattern: trackA.cta_pattern ?? 'Subscribe / LearnMore',
    sentence_length_avg: trackA.sentence_length_avg ?? 15,
    sentence_length_unit: trackA.sentence_length_unit ?? 'characters',
    sentence_length_max: trackA.sentence_length_max ?? 30,
    metaphor_count: trackA.metaphor_count ?? 3,
    interaction_cues_count: trackA.interaction_cues_count ?? 2,
    rhetorical_core: trackA.rhetorical_core ?? 'analogy, contrast',
    jargon_treatment: trackA.jargon_treatment ?? 'simplified',
    base_medium: trackB.base_medium ?? styleProfile.visualStyle ?? '3D animation',
    visual_metaphor_mapping: JSON.stringify(trackB.visual_metaphor_mapping ?? {}),
    verified_facts_list: factsListStr,
    narrative_map: JSON.stringify(narrativeMap, null, 2),
  });

  const scriptResult = await adapter.generateText('', userPrompt, {
    systemInstruction: systemPrompt,
    responseMimeType: 'application/json',
  });

  const scriptData = extractJSON<any>(scriptResult.text ?? '');
  if (!scriptData) {
    emit(log('Warning: could not parse script as JSON, using raw text', 'warning'));
  }

  const scriptText = scriptData?.script ?? scriptResult.text ?? '';

  // Safety check
  emit(log('Running safety checks on generated script...'));
  const safetyReport = runSafetyMiddleware(scriptText);

  if (safetyReport.requiresManualReview) {
    emit(log(`Safety: manual review required (${safetyReport.categories.join(', ')})`, 'warning'));
    // Block pipeline — high-risk content (suicide, medical claims) cannot proceed automatically
    if (safetyReport.suicideDetected || safetyReport.medicalClaimDetected) {
      throw new SafetyBlockError(`Script contains high-risk content: ${safetyReport.categories.join(', ')}`);
    }
  } else if (safetyReport.softened) {
    emit(log('Safety: absolute statements softened', 'info'));
  } else {
    emit(log('Safety check passed', 'success'));
  }

  const usedFactIDs = scriptData?.sentence_list
    ?.flatMap((s: any) => s.factReferences ?? [])
    ?.filter(Boolean) ?? [];

  const scriptOutput: ScriptOutput = {
    scriptText: safetyReport.finalText,
    usedFactIDs,
    factUsage: usedFactIDs.map((id: string) => ({
      factId: id,
      usageType: 'referenced' as const,
    })),
    safetyMetadata: {
      isHighRisk: safetyReport.suicideDetected || safetyReport.medicalClaimDetected,
      riskCategories: safetyReport.categories,
      softenedWordingApplied: safetyReport.softened,
      needsManualReview: safetyReport.requiresManualReview,
    },
    totalWordCount: scriptData?.total_length,
    scenes: scriptData?.sentence_list,
    calibration: calibration as any,
    warnings: safetyReport.numericIssues,
  };

  emit(log(`Script generated: ${scriptOutput.totalWordCount ?? '?'} words`, 'success'));

  return scriptOutput;
}
