/* ------------------------------------------------------------------ */
/*  Pass 7: QA Review – optimization pass (quality verification)      */
/*  Cross-validates script quality against style constraints; may    */
/*  trigger recompilation of the script generation pass.              */
/* ------------------------------------------------------------------ */

import type { AIAdapter, ScriptOutput, LogEntry } from '../types.js';
import type { FormatSignature, StyleAnalysisCIR } from '../../cir/types.js';
import { fillTemplate, QA_REVIEW_PROMPT } from '../prompts.js';
import { extractAndValidateJSON } from '../../adapters/responseParser.js';
import { QA_REVIEW_SCHEMA } from '../../adapters/schemaValidator.js';
import { shouldInject } from './confidenceFilter.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';

const slog = createLogger('QaReview');

export class QaReviewParseError extends Error {
  constructor(message = 'QA review response was unparseable') {
    super(message);
    this.name = 'QaReviewParseError';
  }
}

export interface QaReviewInput {
  scriptOutput: ScriptOutput;
  topic: string;
  styleCIR: StyleAnalysisCIR;
  formatSignature?: FormatSignature;
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
  contentContamination?: {
    score: number;
    copiedPhrases: string[];
    reusedFacts: string[];
    reusedMetaphors: string[];
  };
  seriesConsistency?: {
    score: number;
    hookStructureMatch: boolean;
    closingStructureMatch: boolean;
    rhythmSimilarity: 'high' | 'medium' | 'low';
    arcAllocationMatch: boolean;
    deviations: string[];
  };
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
  const { scriptOutput, topic, styleCIR } = input;
  const confidence = styleCIR.confidence ?? {};

  emit(log('Running QA review on script...'));

  // Build confidence notes so the LLM knows which constraints are uncertain
  const confidenceNotes = buildQaConfidenceNotes(styleCIR);

  // Build series consistency section from FormatSignature
  const seriesConsistencySection = (() => {
    const fs = input.formatSignature;
    if (!fs) return '(No FormatSignature available — skip series consistency audit. Score 10 by default.)';
    return [
      'Check the script against the series FORMAT SIGNATURE below.',
      'The FORMAT SIGNATURE defines structural patterns that must be consistent across all episodes in a series.',
      '',
      `Hook template: ${fs.hookTemplate}`,
      `Closing template: ${fs.closingTemplate}`,
      `Reference rhythm (sentence lengths): [${(fs.sentenceLengthSequence ?? []).join(', ')}]`,
      `Arc allocation: ${(fs.arcStageLabels ?? []).map((l, i) => `${l}=${(fs.arcSentenceAllocation ?? [])[i] ?? 0}`).join(', ')}`,
      `Transition positions: [${(fs.transitionPositions ?? []).join(', ')}]`,
      `Signature phrases: ${(fs.signaturePhrases ?? []).join('; ')}`,
      '',
      'Scoring anchors:',
      '- 9-10: Hook/closing match template exactly, rhythm correlation high, arc allocation within ±1, transitions at correct positions.',
      '- 6-7: Hook or closing deviates slightly, rhythm partially matches, arc allocation off by 2+ sentences in one stage.',
      '- 1-3: Hook/closing completely different structure, rhythm uncorrelated, arc allocation severely mismatched.',
    ].join('\n');
  })();

  const prompt = fillTemplate(QA_REVIEW_PROMPT, {
    topic,
    script_text: scriptOutput.scriptText,
    target_word_count: scriptOutput.calibration?.target_word_count ?? 300,
    visual_style: styleCIR.visualStyle,
    tone: styleCIR.tone,
    narrative_arc: JSON.stringify(styleCIR.scriptTrack.narrativeArc),
    reference_transcript_sample: (styleCIR.computed.fullTranscript ?? '').slice(0, 500) || '(no reference transcript available)',
    series_consistency_section: seriesConsistencySection,
  }) + confidenceNotes;
  slog.debug('prompt_preview', { content: prompt.slice(0, 500) });

  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
  });
  slog.debug('response_received', { length: (result.text ?? '').length });
  slog.debug('response_preview', { content: (result.text ?? '').slice(0, 1000) });

  const reviewData = extractAndValidateJSON<any>(result.text ?? '', QA_REVIEW_SCHEMA, 'qaReview');
  slog.debug('parsed_result', { keys: reviewData ? Object.keys(reviewData).join(', ') : 'null' });

  if (!reviewData) {
    emit(log('QA review: could not parse AI response, failing this attempt', 'warning'));
    throw new QaReviewParseError();
  }

  const output: QaReviewOutput = {
    approved: reviewData.approved ?? reviewData.overall_score >= 8,
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
    contentContamination: reviewData.contentContamination ?? undefined,
    seriesConsistency: reviewData.seriesConsistency ?? undefined,
  };

  // B2: Score outlier detection — deterministic sanity check
  // Only run when explicit sub-scores were provided (all non-zero)
  if (output.scores && reviewData.scores) {
    const subScores = [
      output.scores.accuracy,
      output.scores.styleConsistency,
      output.scores.productionReadiness,
      output.scores.engagement,
    ];
    const hasRealScores = subScores.every(s => s > 0);
    if (hasRealScores) {
      const minSub = Math.min(...subScores);
      const maxSub = Math.max(...subScores);

      // Any sub-score < 5 but overall >= 8 → inconsistency, override to rejected
      if (minSub < 5 && (output.scores.overall >= 8 || output.approved)) {
        output.approved = false;
        const reason = `Score outlier detected: sub-score ${minSub}/10 contradicts overall ${output.scores.overall}/10. Overriding approval.`;
        output.issues = [...(output.issues ?? []), reason];
        emit(log(reason, 'warning'));
      }

      // Large spread between sub-scores → warning (but not rejection)
      if (maxSub - minSub > 4) {
        const spreadWarning = `Score spread warning: sub-scores range from ${minSub} to ${maxSub} (spread ${maxSub - minSub} > 4). Review for dimension-specific weaknesses.`;
        output.issues = [...(output.issues ?? []), spreadWarning];
        emit(log(spreadWarning, 'warning'));
      }

      // Positive override: LLM said not-approved but all scores indicate high quality.
      // Mirror of the B2 negative override — ensures score-based determinism.
      if (!output.approved && output.scores.overall >= 8 && minSub >= 5) {
        output.approved = true;
        const reason = `Score-based approval override: overall ${output.scores.overall}/10 with min sub-score ${minSub}/10 meets approval threshold. Overriding LLM rejection.`;
        output.issues = [...(output.issues ?? []), reason];
        emit(log(reason, 'info'));
      }
    }
  }

  // B2: Per-dimension detail logging for auditability
  if (output.scores) {
    const s = output.scores;
    slog.info('qa_scores', {
      accuracy: s.accuracy,
      styleConsistency: s.styleConsistency,
      productionReadiness: s.productionReadiness,
      engagement: s.engagement,
      overall: s.overall,
      approved: output.approved,
    });
    emit(log(
      `QA 维度评分: accuracy=${s.accuracy}, style=${s.styleConsistency}, production=${s.productionReadiness}, engagement=${s.engagement}, overall=${s.overall}/10`,
    ));
  }
  if (output.issues && output.issues.length > 0) {
    slog.info('qa_issues', { count: output.issues.length, items: output.issues });
  }
  if (output.suspiciousNumericClaims && output.suspiciousNumericClaims.length > 0) {
    slog.info('qa_suspicious_claims', { count: output.suspiciousNumericClaims.length, items: output.suspiciousNumericClaims });
  }
  if (output.styleDeviations && output.styleDeviations.length > 0) {
    slog.info('qa_style_deviations', { count: output.styleDeviations.length, items: output.styleDeviations });
  }
  if (output.unfilmableSentences && output.unfilmableSentences.length > 0) {
    slog.info('qa_unfilmable', { count: output.unfilmableSentences.length, items: output.unfilmableSentences });
  }
  if (output.contentContamination && output.contentContamination.score > 0) {
    slog.info('qa_contamination', output.contentContamination);
    if (output.contentContamination.score > 0.3) {
      output.approved = false;
      output.feedback = [
        output.feedback ?? '',
        `Content contamination detected (score=${output.contentContamination.score.toFixed(2)} > 0.30): script contains significant overlap with source material. Regenerate with more original wording.`,
      ].filter(Boolean).join('; ');
      emit(log(`QA: content contamination blocking (score=${output.contentContamination.score.toFixed(2)})`, 'warning'));
    }
  }

  if (output.approved) {
    emit(log(`QA review passed (score: ${output.scores?.overall ?? 'N/A'}/10)`, 'success'));
  } else {
    emit(log(`QA review: improvements needed (score: ${output.scores?.overall ?? 'N/A'}/10): ${output.feedback}`, 'warning'));
  }

  // P2: Deterministic word count deviation check — reject if script is way off target
  const targetWC = scriptOutput.calibration?.target_word_count;
  if (targetWC && targetWC > 0) {
    const actualWC = scriptOutput.totalWordCount ?? scriptOutput.scriptText.length;
    const deviation = Math.abs(actualWC - targetWC) / targetWC;
    if (deviation > 0.3) {
      output.approved = false;
      const wcMsg = `Word count deviation too large: actual ${actualWC} vs target ${targetWC} (${(deviation * 100).toFixed(0)}% off, max 30%). Rejecting.`;
      output.issues = [...(output.issues ?? []), wcMsg];
      output.feedback = [output.feedback ?? '', wcMsg].filter(Boolean).join('; ');
      emit(log(wcMsg, 'warning'));
    } else if (deviation > 0.2) {
      const wcWarn = `Word count drift: actual ${actualWC} vs target ${targetWC} (${(deviation * 100).toFixed(0)}% off)`;
      output.issues = [...(output.issues ?? []), wcWarn];
      emit(log(wcWarn, 'warning'));
    }
  }

  return output;
}

/**
 * Build confidence notes section for the QA prompt.
 * Tells the LLM which style constraints are uncertain so it won't penalize
 * the script for deviating from low-confidence metrics.
 */
function buildQaConfidenceNotes(styleCIR: StyleAnalysisCIR): string {
  const confidence = styleCIR.confidence ?? {};
  const notes: string[] = [];

  const fieldLabels: Array<[string, string]> = [
    ['hookStrategy', 'hook strategy'],
    ['narrativeArc', 'narrative arc structure'],
    ['sentenceLengthMax', 'max sentence length'],
    ['sentenceLengthAvg', 'average sentence length'],
    ['metaphorCount', 'metaphor count target'],
    ['rhetoricalCore', 'rhetorical devices'],
    ['ctaPattern', 'CTA pattern'],
  ];

  for (const [key, label] of fieldLabels) {
    const conf = confidence[key];
    if (conf === 'guess') {
      notes.push(`- "${label}" is LOW CONFIDENCE (guess) — do NOT penalize deviation from this metric`);
    } else if (conf === 'inferred') {
      notes.push(`- "${label}" is MEDIUM CONFIDENCE (inferred) — mild deviation is acceptable`);
    }
  }

  if (notes.length === 0) return '';
  return `\n\n## CONFIDENCE NOTES\nThe following style constraints have uncertain confidence. Adjust your scoring accordingly:\n${notes.join('\n')}`;
}
