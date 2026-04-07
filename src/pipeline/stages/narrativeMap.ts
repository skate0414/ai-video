/* ------------------------------------------------------------------ */
/*  Stage 5: Narrative Map – build narrative structure from calibration */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, CalibrationData, NarrativeMap, GenerationPlan, LogEntry } from '../types.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';

export interface NarrativeMapInput {
  topic: string;
  styleProfile: StyleProfile;
  calibrationData: CalibrationData;
}

export interface NarrativeMapOutput {
  narrativeMap: NarrativeMap;
  generationPlan: GenerationPlan;
}

const log = createStageLog('NARRATIVE_MAP');

/**
 * Run the narrative map stage:
 * Build narrative structure from calibration data (this was originally
 * the narrative_map portion of the calibration prompt response).
 *
 * If calibrationData already contains a narrative_map from the calibration
 * AI response, we parse it directly. Otherwise we generate one.
 */
export async function runNarrativeMap(
  adapter: AIAdapter,
  input: NarrativeMapInput,
  onLog?: (entry: LogEntry) => void,
): Promise<NarrativeMapOutput> {
  const emit = onLog ?? (() => {});
  const { topic, styleProfile, calibrationData } = input;

  const meta = styleProfile.meta ?? { video_language: 'Chinese', video_duration_sec: 60 };
  const calibration = calibrationData.calibration;

  emit(log('Building narrative map from calibration data...'));

  // Generate narrative map via AI
  const prompt = `You are a narrative structure expert for science explainer videos.

Based on the following calibration data and style profile, generate a narrative map.

Topic: ${topic}
Target duration: ${calibration.new_video_target_duration_sec ?? meta.video_duration_sec} seconds
Target word count: ${calibration.target_word_count ?? 300}
Narrative arc: ${JSON.stringify(styleProfile.narrativeStructure ?? [])}
Hook type: ${styleProfile.hookType ?? 'Question'}

Verified facts available:
${calibrationData.verified_facts.map(f => `[Fact ${f.fact_id}] ${f.content}`).join('\n')}

Output JSON (no markdown):
{
  "narrative_map": [
    {
      "stage_title": "stage name",
      "description": "what this stage achieves",
      "estimated_duration_sec": number,
      "target_word_count": number,
      "fact_references": [1, 2]
    }
  ]
}`;

  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
  });

  const data = extractJSON<any>(result.text ?? '');
  const rawMap = data?.narrative_map ?? [];

  const narrativeMap: NarrativeMap = rawMap.map((m: any) => ({
    sectionTitle: m.stage_title ?? m.sectionTitle ?? '',
    description: m.description ?? '',
    estimatedDuration: m.estimated_duration_sec ?? m.estimatedDuration ?? 10,
    targetWordCount: m.target_word_count ?? m.targetWordCount,
    factReferences: (m.fact_references ?? m.factReferences ?? []).map(String),
  }));

  const generationPlan: GenerationPlan = {
    factsCount: calibrationData.verified_facts.length,
    sequenceCount: narrativeMap.length,
    estimatedSceneCount: narrativeMap.length * 3,
    targetSceneDuration: (meta.video_duration_sec ?? 60) / Math.max(narrativeMap.length * 3, 1),
    targetWPM: parseFloat(calibration.actual_speech_rate) || styleProfile.wordsPerMinute || 160,
    audienceFactor: 1.0,
    reasoning: ['Calibrated from reference video speech rate', `${calibrationData.verified_facts.length} facts verified`],
  };

  emit(log(`Narrative map: ${narrativeMap.length} stages, estimated ${generationPlan.estimatedSceneCount} scenes`, 'success'));

  return { narrativeMap, generationPlan };
}
