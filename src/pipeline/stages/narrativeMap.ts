/* ------------------------------------------------------------------ */
/*  Pass 5: Narrative Map – semantic analysis                         */
/*  Builds narrative arc structure from calibration data, defining   */
/*  the high-level program flow for script generation.               */
/* ------------------------------------------------------------------ */

import type { AIAdapter, CalibrationData, NarrativeMap, GenerationPlan, LogEntry } from '../types.js';
import type { StyleAnalysisCIR } from '../../cir/types.js';
import { extractAndValidateJSON } from '../../adapters/responseParser.js';
import { NARRATIVE_MAP_SCHEMA } from '../../adapters/schemaValidator.js';
import { annotateValue } from './confidenceFilter.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';

const slog = createLogger('NarrativeMap');

export interface NarrativeMapInput {
  topic: string;
  styleCIR: StyleAnalysisCIR;
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
  const { topic, styleCIR, calibrationData } = input;

  const { meta, scriptTrack, visualTrack, computed, confidence } = styleCIR;
  const calibration = calibrationData.calibration;

  emit(log('Building narrative map from calibration data...'));

  // Generate narrative map via AI
  const prompt = `You are a narrative structure expert for science explainer videos.

Based on the following calibration data and style profile, generate a narrative map.

Topic: ${topic}
Target duration: ${calibration.new_video_target_duration_sec ?? meta.videoDurationSec} seconds
Target word count: ${calibration.target_word_count ?? 300}
Narrative arc: ${annotateValue(JSON.stringify(scriptTrack.narrativeArc), confidence['narrativeArc'])}
Hook type: ${annotateValue(scriptTrack.hookStrategy, confidence['hookStrategy'])}

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

  slog.debug('prompt_preview', { content: prompt.slice(0, 500) });

  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
  });
  slog.debug('response_received', { length: (result.text ?? '').length });
  slog.debug('response_preview', { content: (result.text ?? '').slice(0, 1000) });

  const data = extractAndValidateJSON<any>(result.text ?? '', NARRATIVE_MAP_SCHEMA, 'narrativeMap');
  slog.debug('parsed_result', { keys: data ? Object.keys(data).join(', ') : 'null' });
  const rawMap = data?.narrative_map ?? [];

  const narrativeMap: NarrativeMap = rawMap.map((m: any) => ({
    sectionTitle: m.stage_title ?? m.sectionTitle ?? '',
    description: m.description ?? '',
    estimatedDuration: m.estimated_duration_sec ?? m.estimatedDuration ?? 10,
    targetWordCount: m.target_word_count ?? m.targetWordCount,
    factReferences: (m.fact_references ?? m.factReferences ?? []).map(String),
  }));

  // Compute target scene count: each scene = 1 TTS sentence, so derive from
  // word count / average sentence length rather than duration / visual-cut length.
  // The reference video's scene_avg_duration reflects editing pace (visual cuts),
  // not TTS sentence boundaries — using it directly produces far too many scenes
  // for the target word count (e.g. 37 scenes × 46 chars = 1702 chars vs 504 target).
  const sceneAvgDuration = visualTrack.sceneAvgDurationSec;
  const videoDuration = meta.videoDurationSec;
  const targetWordCount = Number(calibration.target_word_count ?? computed.wordCount);
  const sentenceLengthAvg = scriptTrack.sentenceLengthAvg;
  // Widen sentence length when it's a guess — ±30% tolerance for scene count calc
  const sentenceLengthAvgConf = confidence['sentenceLengthAvg'];
  const effectiveSentenceLengthAvg = sentenceLengthAvgConf === 'guess'
    ? sentenceLengthAvg * 0.85  // shorter sentences → more scenes (conservative)
    : sentenceLengthAvg;
  // Primary: derive from word count ÷ sentence length
  const wordBasedSceneCount = Math.round(targetWordCount / effectiveSentenceLengthAvg);
  // Secondary: derive from duration ÷ visual cut length (legacy, used as soft cap)
  // Widen this cap when sceneAvgDuration confidence is low
  const sceneAvgDurationConf = confidence['sceneAvgDurationSec'];
  const durationSceneCountRaw = Math.round(videoDuration / sceneAvgDuration);
  const durationBasedSceneCount = sceneAvgDurationConf === 'guess'
    ? Math.round(durationSceneCountRaw * 1.3)  // 30% wider cap
    : durationSceneCountRaw;
  // Use the word-based count, but cap at duration-based to avoid excessive scenes
  const targetSceneCount = Math.min(wordBasedSceneCount, durationBasedSceneCount);
  // Recompute effective scene duration from the reconciled count
  const effectiveSceneDuration = videoDuration / targetSceneCount;

  const generationPlan: GenerationPlan = {
    factsCount: calibrationData.verified_facts.length,
    sequenceCount: narrativeMap.length,
    estimatedSceneCount: targetSceneCount,
    targetSceneDuration: effectiveSceneDuration,
    targetWPM: parseFloat(calibration.actual_speech_rate) || computed.wordsPerMinute,
    audienceFactor: 1.0,
    reasoning: [
      'Calibrated from reference video speech rate',
      `${calibrationData.verified_facts.length} facts verified`,
      `Target scene count: ${targetSceneCount} (${targetWordCount} chars / ${sentenceLengthAvg} avg chars/sentence, capped by ${durationBasedSceneCount} visual scenes)`,
    ],
  };

  emit(log(`Narrative map: ${narrativeMap.length} stages, estimated ${generationPlan.estimatedSceneCount} scenes`, 'success'));

  return { narrativeMap, generationPlan };
}
