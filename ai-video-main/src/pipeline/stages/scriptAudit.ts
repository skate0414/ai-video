/* ------------------------------------------------------------------ */
/*  Script Audit – self-correction step (ai-suite Step 3)             */
/*  Re-evaluates script against Style DNA constraints and produces    */
/*  a corrected version if issues are found.                          */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, ScriptOutput, LogEntry } from '../types.js';
import { fillTemplate } from '../prompts.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';

export interface ScriptAuditInput {
  scriptOutput: ScriptOutput;
  styleProfile: StyleProfile;
  topic: string;
}

export interface ScriptAuditOutput {
  correctedScript: string;
  corrections: Array<{
    type: 'factual' | 'style' | 'length' | 'visual' | 'safety';
    original: string;
    corrected: string;
    reason: string;
  }>;
  styleConsistencyScore: number;
  factCoverageScore: number;
  passed: boolean;
}

// Script audit is a sub-step of the SCRIPT_GENERATION stage (self-correction pass after generation)
const log = createStageLog('SCRIPT_GENERATION');

const SCRIPT_AUDIT_PROMPT = `You are a senior script editor performing a self-correction audit on a science explainer video script.

## YOUR TASK
Review the script below and fix any issues. Do NOT rewrite the entire script — only fix specific problems.

## SCRIPT TO AUDIT
{script_text}

## STYLE DNA CONSTRAINTS TO CHECK AGAINST
- Target word count: {target_word_count} (range: {target_word_count_min} - {target_word_count_max})
- Target tone: {tone}
- Hook strategy: {hook_strategy}
- Narrative arc: {narrative_arc}
- Sentence length avg: {sentence_length_avg} {sentence_length_unit}
- Sentence length max: {sentence_length_max} {sentence_length_unit}
- Metaphor count target: {metaphor_count}
- Video language: {video_language}

## AUDIT CHECKLIST
1. **Word count**: Is total within [{target_word_count_min}, {target_word_count_max}]? If not, trim/expand specific sentences.
2. **Factual integrity**: Are all numeric claims sourced? Flag unsourced numbers.
3. **Style consistency**: Does tone stay consistent? Any register shifts?
4. **Visual renderability**: Can every sentence be independently rendered as a {base_medium} scene?
5. **Safety**: Any absolute medical/health claims? Any fabricated statistics?

## OUTPUT FORMAT (JSON only):
{
  "correctedScript": "the full script after corrections (or same as input if no issues)",
  "corrections": [
    {
      "type": "factual/style/length/visual/safety",
      "original": "original sentence",
      "corrected": "corrected sentence",
      "reason": "why this was changed"
    }
  ],
  "styleConsistencyScore": 0.0-1.0,
  "factCoverageScore": 0.0-1.0,
  "wordCountDelta": number,
  "passed": true/false
}`;

/**
 * Run script self-correction audit.
 * This is modeled after ai-suite's Step 3 — a second LLM pass that catches
 * issues the initial generation missed.
 *
 * Returns corrected script + quality scores.
 * Only applied when the script is generated (not when user manually edits).
 */
export async function runScriptAudit(
  adapter: AIAdapter,
  input: ScriptAuditInput,
  onLog?: (entry: LogEntry) => void,
): Promise<ScriptAuditOutput> {
  const emit = onLog ?? (() => {});
  const { scriptOutput, styleProfile, topic } = input;

  const trackA = styleProfile.track_a_script ?? {};
  const meta = styleProfile.meta ?? { video_language: 'Chinese', video_duration_sec: 60 };
  const calibration = scriptOutput.calibration;

  emit(log('Running self-correction audit on script...'));

  const prompt = fillTemplate(SCRIPT_AUDIT_PROMPT, {
    script_text: scriptOutput.scriptText,
    target_word_count: calibration?.target_word_count ?? 300,
    target_word_count_min: calibration?.target_word_count_min ?? '270',
    target_word_count_max: calibration?.target_word_count_max ?? '330',
    tone: styleProfile.tone ?? 'informative',
    hook_strategy: trackA.hook_strategy ?? styleProfile.hookType ?? 'Question',
    narrative_arc: JSON.stringify(styleProfile.narrativeStructure ?? []),
    sentence_length_avg: trackA.sentence_length_avg ?? 15,
    sentence_length_unit: trackA.sentence_length_unit ?? 'characters',
    sentence_length_max: trackA.sentence_length_max ?? 30,
    metaphor_count: trackA.metaphor_count ?? 3,
    video_language: meta.video_language ?? 'Chinese',
    base_medium: styleProfile.track_b_visual?.base_medium ?? styleProfile.visualStyle ?? '3D animation',
  });
  console.log('[SCRIPT_AUDIT] prompt preview:', prompt.slice(0, 500));

  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
  });
  console.log('[SCRIPT_AUDIT] raw response length:', (result.text ?? '').length);
  console.log('[SCRIPT_AUDIT] raw response preview:', (result.text ?? '').slice(0, 1000));

  const auditData = extractJSON<any>(result.text ?? '');
  console.log('[SCRIPT_AUDIT] parsed keys:', auditData ? Object.keys(auditData).join(', ') : 'null');

  if (!auditData) {
    emit(log('Script audit: could not parse response, using original script', 'warning'));
    return {
      correctedScript: scriptOutput.scriptText,
      corrections: [],
      styleConsistencyScore: 0.8,
      factCoverageScore: 0.8,
      passed: true,
    };
  }

  const output: ScriptAuditOutput = {
    correctedScript: auditData.correctedScript ?? scriptOutput.scriptText,
    corrections: auditData.corrections ?? [],
    styleConsistencyScore: auditData.styleConsistencyScore ?? 0.8,
    factCoverageScore: auditData.factCoverageScore ?? 0.8,
    passed: auditData.passed ?? true,
  };

  if (output.corrections.length > 0) {
    emit(log(`Script audit: ${output.corrections.length} corrections applied`, 'info'));
    for (const c of output.corrections) {
      emit(log(`  [${c.type}] ${c.reason}`, 'info'));
    }
  } else {
    emit(log('Script audit: no corrections needed', 'success'));
  }

  emit(log(
    `Quality scores — style: ${output.styleConsistencyScore.toFixed(2)}, facts: ${output.factCoverageScore.toFixed(2)}`,
    output.passed ? 'success' : 'warning',
  ));

  return output;
}
