/* ------------------------------------------------------------------ */
/*  Stage 7: QA Review – script quality + accuracy review             */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, ScriptOutput, LogEntry } from '../types.js';
import { fillTemplate, QA_REVIEW_PROMPT } from '../prompts.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';

export interface QaReviewInput {
  scriptOutput: ScriptOutput;
  topic: string;
  styleProfile: StyleProfile;
}

export interface QaReviewOutput {
  approved: boolean;
  feedback?: string;
  scores?: {
    accuracy: number;
    styleConsistency: number;
    productionReadiness: number;
    engagement: number;
    overall: number;
  };
  issues?: string[];
  suspiciousNumericClaims?: Array<{ claim: string; reason: string }>;
  styleDeviations?: string[];
  unfilmableSentences?: Array<{ index: number; text: string; reason: string }>;
}

const log = createStageLog('QA_REVIEW');

/**
 * Run QA review:
 * AI-assisted quality check on the script before proceeding to visual generation.
 * This is a human review checkpoint — pipeline pauses here by default.
 */
export async function runQaReview(
  adapter: AIAdapter,
  input: QaReviewInput,
  onLog?: (entry: LogEntry) => void,
): Promise<QaReviewOutput> {
  const emit = onLog ?? (() => {});
  const { scriptOutput, topic, styleProfile } = input;

  emit(log('Running QA review on script...'));

  const prompt = fillTemplate(QA_REVIEW_PROMPT, {
    topic,
    script_text: scriptOutput.scriptText,
    target_word_count: scriptOutput.calibration?.target_word_count ?? 300,
    visual_style: styleProfile.visualStyle ?? '3D animation',
    tone: styleProfile.tone ?? 'informative',
    narrative_arc: JSON.stringify(styleProfile.narrativeStructure ?? []),
  });

  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
  });

  const reviewData = extractJSON<any>(result.text ?? '');

  if (!reviewData) {
    emit(log('QA review: could not parse AI response, auto-approving', 'warning'));
    return { approved: true, feedback: 'Auto-approved (AI response unparseable)' };
  }

  const output: QaReviewOutput = {
    approved: reviewData.approved ?? reviewData.overall_score >= 7,
    feedback: reviewData.feedback ?? reviewData.summary,
    scores: reviewData.scores ?? {
      accuracy: reviewData.accuracy_score ?? 0,
      styleConsistency: reviewData.style_score ?? 0,
      productionReadiness: reviewData.productionReadiness ?? reviewData.production_readiness_score ?? 0,
      engagement: reviewData.engagement_score ?? 0,
      overall: reviewData.overall_score ?? 0,
    },
    issues: reviewData.issues ?? [],
    suspiciousNumericClaims: reviewData.suspiciousNumericClaims ?? [],
    styleDeviations: reviewData.styleDeviations ?? [],
    unfilmableSentences: reviewData.unfilmableSentences ?? [],
  };

  if (output.approved) {
    emit(log(`QA review passed (score: ${output.scores?.overall ?? 'N/A'}/10)`, 'success'));
  } else {
    emit(log(`QA review: improvements needed (score: ${output.scores?.overall ?? 'N/A'}/10): ${output.feedback}`, 'warning'));
  }

  return output;
}
