/* ------------------------------------------------------------------ */
/*  Stage 6: Script Generation – full script from style constraints   */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, ResearchData, CalibrationData, NarrativeMap, ScriptOutput, GenerationPlan, LogEntry } from '../types.js';
import { SCRIPT_SYSTEM_PROMPT, SCRIPT_USER_PROMPT, fillTemplate } from '../prompts.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { runSafetyMiddleware } from '../safety.js';
import { SafetyBlockError } from '../orchestrator.js';
import { createStageLog } from './stageLog.js';
import { sanitizeTranscriptForStyle } from '../../lib/sanitize.js';

export interface ScriptGenerationInput {
  topic: string;
  styleProfile: StyleProfile;
  researchData: ResearchData;
  calibrationData?: CalibrationData;
  narrativeMap: NarrativeMap;
  generationPlan?: GenerationPlan;
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

  // Inline calibration: compute from style profile when calibrationData is absent
  const durationSec = meta.video_duration_sec ?? 60;
  const wpm = styleProfile.wordsPerMinute ?? 180;
  const wordCount = styleProfile.wordCount ?? Math.round(wpm * durationSec / 60);
  const calibration = calibrationData?.calibration ?? {
    reference_total_words: wordCount,
    reference_duration_sec: durationSec,
    actual_speech_rate: `${wpm} ${(meta.video_language ?? 'Chinese').includes('Chinese') ? 'characters' : 'words'} per minute`,
    new_video_target_duration_sec: durationSec,
    target_word_count: wordCount,
    target_word_count_min: String(Math.round(wordCount * 0.9)),
    target_word_count_max: String(Math.round(wordCount * 1.1)),
  };

  emit(log('Generating full script...'));

  // Compile verified facts list
  const verifiedFacts = calibrationData?.verified_facts ?? [];
  const allFacts = [
    ...verifiedFacts.map(f => `[Fact ${f.fact_id}] ${f.content} (${f.source_marker})`),
    ...researchData.facts.map(f => `[${f.id}] ${f.content}`),
  ];
  const factsListStr = allFacts.slice(0, 10).join('\n');

  const systemPrompt = fillTemplate(SCRIPT_SYSTEM_PROMPT, {
    video_language: meta.video_language ?? 'Chinese',
  });

  // Compute target sentence count from generation plan's estimated scene count
  const targetSceneCount = input.generationPlan?.estimatedSceneCount
    ?? Math.round((meta.video_duration_sec ?? 60) / (styleProfile.track_b_visual?.scene_avg_duration_sec ?? 5));

  // Extract a reference transcript excerpt (first 300 chars as style example)
  const referenceTranscript = styleProfile.fullTranscript ?? '';
  const hookExample = trackA.hook_example ?? '';

  // Sanitize transcript to prevent content contamination (ai-suite strategy)
  const { sanitized: sanitizedExcerpt } = sanitizeTranscriptForStyle(
    referenceTranscript.slice(0, 300) || undefined,
    [],
    hookExample,
  );
  const transcriptExcerpt = sanitizedExcerpt || '(no reference transcript available)';

  // Expanded narrative arc: convert terse array into multi-paragraph stage descriptions
  const rawNarrativeMap = input.narrativeMap ?? (calibrationData as any)?.narrative_map ?? [];
  const narrativeArcExpanded = (() => {
    if (Array.isArray(rawNarrativeMap) && rawNarrativeMap.length > 0 && typeof rawNarrativeMap[0] === 'object') {
      return (rawNarrativeMap as any[]).map((s: any) =>
        `Stage ${s.stage_index}: ${s.stage_title}\n  → ${s.description}\n  → Target: ~${s.target_word_count} characters / ${s.estimated_duration_sec}s`
      ).join('\n\n');
    }
    const arc = styleProfile.narrativeStructure ?? [];
    return arc.map((s: string, i: number) => `Stage ${i + 1}: ${s}`).join('\n');
  })();

  // Expanded rhetorical core: convert single string into bullet list
  const rhetoricalCoreExpanded = (() => {
    const core = trackA.rhetorical_core ?? 'analogy, contrast';
    if (typeof core === 'string') {
      return core.split(/[,，]/).map(r => `- ${r.trim()}`).join('\n');
    }
    return `- ${core}`;
  })();

  // Visual metaphor mapping: extract rule + examples (ai-suite structured format)
  const vmm = trackB.visual_metaphor_mapping;
  let vmmRule = 'Map abstract concepts to visually concrete, cinematic 3D scenes';
  let vmmExamples = '(no examples available from reference)';
  if (vmm && typeof vmm === 'object' && 'rule' in vmm) {
    vmmRule = (vmm as any).rule ?? vmmRule;
    const examples = (vmm as any).examples;
    if (Array.isArray(examples) && examples.length > 0) {
      vmmExamples = examples.map((e: any) => `- ${e.concept} → ${e.metaphor_visual}`).join('\n');
    }
  } else if (vmm && typeof vmm === 'object') {
    // Legacy format: { "concept": "visual" }
    const entries = Object.entries(vmm);
    if (entries.length > 0) {
      vmmExamples = entries.map(([k, v]) => `- ${k} → ${v}`).join('\n');
    }
  }

  const userPrompt = fillTemplate(SCRIPT_USER_PROMPT, {
    topic,
    target_audience: styleProfile.targetAudience ?? 'general audience',
    target_word_count: calibration.target_word_count ?? 300,
    target_word_count_min: calibration.target_word_count_min ?? '270',
    target_word_count_max: calibration.target_word_count_max ?? '330',
    target_duration_sec: calibration.new_video_target_duration_sec ?? meta.video_duration_sec ?? 60,
    speech_rate: calibration.actual_speech_rate ?? '250 characters per minute',
    target_sentence_count: targetSceneCount,
    hook_strategy: trackA.hook_strategy ?? styleProfile.hookType ?? 'Question',
    hook_example: hookExample || '(no hook example available)',
    narrative_arc_expanded: narrativeArcExpanded,
    emotional_tone_arc: trackA.emotional_tone_arc ?? 'neutral → engaged → climax → resolution',
    rhetorical_core_expanded: rhetoricalCoreExpanded,
    sentence_length_avg: trackA.sentence_length_avg ?? 15,
    sentence_length_unit: trackA.sentence_length_unit ?? 'characters',
    sentence_length_max: trackA.sentence_length_max ?? 30,
    sentence_length_max_context: 'Climax/emotional peak stages may allow slightly longer sentences',
    interaction_cues_count: trackA.interaction_cues_count ?? 2,
    jargon_treatment: trackA.jargon_treatment ?? 'simplified',
    pacing: styleProfile.pacing ?? 'medium',
    emotional_intensity: styleProfile.emotionalIntensity ?? 3,
    reference_transcript_excerpt: transcriptExcerpt,
    metaphor_count: trackA.metaphor_count ?? 3,
    visual_metaphor_mapping_rule: vmmRule,
    visual_metaphor_mapping_examples: vmmExamples,
    cta_pattern: trackA.cta_pattern ?? styleProfile.callToActionType ?? 'Subscribe / LearnMore',
    verified_facts_list: factsListStr,
    base_medium: trackB.base_medium ?? styleProfile.visualStyle ?? '3D animation',
    narrative_map: JSON.stringify(narrativeMap, null, 2),
  });

  const scriptResult = await adapter.generateText('', userPrompt, {
    systemInstruction: systemPrompt,
    responseMimeType: 'application/json',
  });
  console.log('[SCRIPT_GENERATION] system prompt preview:', systemPrompt.slice(0, 300));
  console.log('[SCRIPT_GENERATION] user prompt preview:', userPrompt.slice(0, 500));
  console.log('[SCRIPT_GENERATION] raw response length:', (scriptResult.text ?? '').length);
  console.log('[SCRIPT_GENERATION] raw response preview:', (scriptResult.text ?? '').slice(0, 1000));

  const scriptData = extractJSON<any>(scriptResult.text ?? '');
  console.log('[SCRIPT_GENERATION] parsed keys:', scriptData ? Object.keys(scriptData).join(', ') : 'null');
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
