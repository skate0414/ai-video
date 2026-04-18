/* ------------------------------------------------------------------ */
/*  Pass 6: Script Generation – IR generation (source → ScriptCIR)   */
/*  Two-step architecture:                                            */
/*    Step A (Skeleton): structural blueprint – stages, sentence      */
/*      slots, word budgets, fact/metaphor placement                  */
/*    Step B (Writing): creative text filling guided by skeleton      */
/*  Confidence-aware: guess fields excluded from hard constraints.    */
/* ------------------------------------------------------------------ */

import type { AIAdapter, ResearchData, CalibrationData, NarrativeMap, ScriptOutput, ScriptSkeleton, GenerationPlan, LogEntry } from '../types.js';
import type { StyleAnalysisCIR, FormatSignature } from '../../cir/types.js';
import {
  SCRIPT_SYSTEM_PROMPT, SCRIPT_USER_PROMPT,
  SKELETON_SYSTEM_PROMPT, SKELETON_USER_PROMPT,
  WRITING_SYSTEM_PROMPT, WRITING_USER_PROMPT,
  fillTemplate,
} from '../prompts.js';
import { resolvePrompt } from '../promptResolver.js';
import { extractAndValidateJSON } from '../../adapters/responseParser.js';
import { SCRIPT_OUTPUT_SCHEMA } from '../../adapters/schemaValidator.js';
import { runSafetyMiddleware } from '../safety.js';
import { SafetyBlockError } from '../orchestrator.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';
import { sanitizeTranscriptForStyle } from '../../lib/sanitize.js';
import { filterStyleFields, constraintLine } from './confidenceFilter.js';

export interface ScriptGenerationInput {
  topic: string;
  /** Validated CIR — primary source of all style constraints. */
  styleCIR: StyleAnalysisCIR;
  researchData: ResearchData;
  calibrationData?: CalibrationData;
  narrativeMap: NarrativeMap;
  generationPlan?: GenerationPlan;
  /** Feedback from validation/QA failure — injected into prompt for retry. */
  validationFeedback?: string;
  /** FormatSignature for series consistency (optional — absent on first-ever extraction). */
  formatSignature?: FormatSignature;
  /* ---- Non-critical optional fields not present in CIR ---- */
  targetAudience?: string;
  emotionalIntensity?: number;
  hookExample?: string;
  /** Runtime prompt overrides from project */
  promptOverrides?: Record<string, string>;
  /** User directive for this retry (e.g. "make it more casual") */
  retryDirective?: string;
}

const log = createStageLog('SCRIPT_GENERATION');
const slog = createLogger('ScriptGeneration');

/**
 * Run the script generation stage:
 * Two-step process: (A) generate skeleton → (B) creative writing fill.
 * Includes safety middleware check.
 */
export async function runScriptGeneration(
  adapter: AIAdapter,
  input: ScriptGenerationInput,
  onLog?: (entry: LogEntry) => void,
): Promise<ScriptOutput> {
  const emit = onLog ?? (() => {});
  const { topic, styleCIR, researchData, calibrationData } = input;

  // All structured fields come from validated CIR — no raw ?? fallback chains
  const { scriptTrack, visualTrack, meta, computed, confidence } = styleCIR;

  // Inline calibration: compute from CIR when calibrationData is absent
  const durationSec = meta.videoDurationSec;
  const wpm = computed.wordsPerMinute || 180;
  const wordCount = computed.wordCount || Math.round(wpm * durationSec / 60);
  const calibration = calibrationData?.calibration ?? {
    reference_total_words: wordCount,
    reference_duration_sec: durationSec,
    actual_speech_rate: `${wpm} ${meta.videoLanguage.includes('Chinese') ? 'characters' : 'words'} per minute`,
    new_video_target_duration_sec: durationSec,
    target_word_count: wordCount,
    target_word_count_min: String(Math.round(wordCount * 0.9)),
    target_word_count_max: String(Math.round(wordCount * 1.1)),
  };

  // Compile verified facts list — exclude disputed entries
  const verifiedFacts = calibrationData?.verified_facts ?? [];
  const allFacts = [
    ...verifiedFacts.map(f => `[Fact ${f.fact_id}] ${f.content} (${f.source_marker})`),
    ...researchData.facts.filter((f: any) => f.type !== 'disputed').map(f => `[${f.id}] ${f.content}`),
  ];
  const factsListStr = allFacts.slice(0, 10).join('\n');

  // Compute target sentence count from generation plan's estimated scene count.
  const targetSceneCount = input.generationPlan?.estimatedSceneCount
    ?? Math.round((Number(calibration.target_word_count) || 300) / (scriptTrack.sentenceLengthAvg || 20));

  // Extract a reference transcript excerpt (first 300 chars as style example)
  const referenceTranscript = computed.fullTranscript;
  const hookExample = input.hookExample ?? '';
  const { sanitized: sanitizedExcerpt } = sanitizeTranscriptForStyle(
    referenceTranscript.slice(0, 300) || undefined,
    [],
    hookExample,
  );
  const transcriptExcerpt = sanitizedExcerpt || '(no reference transcript available)';

  // Expanded narrative arc
  const rawNarrativeMap = input.narrativeMap ?? (calibrationData as any)?.narrative_map ?? [];
  const narrativeArcExpanded = (() => {
    if (Array.isArray(rawNarrativeMap) && rawNarrativeMap.length > 0 && typeof rawNarrativeMap[0] === 'object') {
      return (rawNarrativeMap as any[]).map((s: any) =>
        `Stage ${s.stage_index}: ${s.stage_title}\n  → ${s.description}\n  → Target: ~${s.target_word_count} characters / ${s.estimated_duration_sec}s`
      ).join('\n\n');
    }
    return scriptTrack.narrativeArc.map((s: string, i: number) => `Stage ${i + 1}: ${s}`).join('\n');
  })();

  // Build Format Signature section
  const formatSignatureSection = buildFormatSignatureSection(input.formatSignature);

  // ─── Confidence-aware field filtering ───
  const { hardConstraints, softGuidance, skipped } = filterStyleFields(styleCIR);
  slog.debug('confidence_filter', { hard: Object.keys(hardConstraints), soft: Object.keys(softGuidance), skipped });

  // Build confidence notes for skeleton prompt
  const confidenceNotes = buildConfidenceNotes(confidence, scriptTrack);

  // Effective sentence length max (confidence-aware) for skeleton slot caps
  const sentenceLengthMaxRaw = scriptTrack.sentenceLengthMax;
  const sentenceLengthConf = confidence['sentenceLengthMax'];
  const sentenceLengthMax = sentenceLengthConf === 'guess'
    ? Math.round(sentenceLengthMaxRaw * 1.3)
    : sentenceLengthConf === 'inferred'
      ? Math.round(sentenceLengthMaxRaw * 1.15)
      : sentenceLengthMaxRaw;

  // Effective metaphor count (confidence-aware)
  const metaphorCountRaw = scriptTrack.metaphorCount;
  const metaphorCountConf = confidence['metaphorCount'];
  const effectiveMetaphorCount = metaphorCountConf === 'guess'
    ? Math.max(1, metaphorCountRaw)  // at least 1 even for guesses
    : metaphorCountRaw;

  // ═══════════════════════════════════════════════════════════════
  //  STEP A: Skeleton Generation (structure only, ~5 constraints)
  // ═══════════════════════════════════════════════════════════════
  emit(log('Step A: Generating script skeleton (structure)...'));

  // P2: Compute max hook length from reference hook example (120% of reference)
  const hookMaxChars = hookExample
    ? Math.round(hookExample.length * 1.2)
    : undefined;

  const skeleton = await generateSkeleton(adapter, {
    topic,
    videoLanguage: meta.videoLanguage,
    targetWordCount: Number(calibration.target_word_count) || wordCount,
    targetWordCountMin: String(calibration.target_word_count_min ?? Math.round(wordCount * 0.9)),
    targetWordCountMax: String(calibration.target_word_count_max ?? Math.round(wordCount * 1.1)),
    targetSentenceCount: targetSceneCount,
    narrativeArcExpanded,
    hookStrategy: scriptTrack.hookStrategy,
    sentenceLengthMax,
    metaphorCount: effectiveMetaphorCount,
    minFacts: Math.min(3, allFacts.length),
    hookMaxChars,
    confidenceNotes,
    promptOverrides: input.promptOverrides,
  }, emit);

  slog.debug('skeleton_generated', { sentences: skeleton.sentences.length, totalTarget: skeleton.totalTargetWords });

  // ═══════════════════════════════════════════════════════════════
  //  STEP B: Writing (creative text filling, ~5 constraints)
  // ═══════════════════════════════════════════════════════════════
  emit(log('Step B: Writing script text from skeleton...'));

  // Build style guidance from confident/inferred fields only (not guess)
  const styleGuidance = buildStyleGuidance(confidence, scriptTrack, styleCIR);

  const scriptData = await generateWriting(adapter, {
    topic,
    videoLanguage: meta.videoLanguage,
    skeleton,
    targetAudience: input.targetAudience ?? 'general audience',
    emotionalToneArc: scriptTrack.emotionalToneArc,
    factsListStr,
    baseMedium: visualTrack.baseMedium,
    transcriptExcerpt,
    styleGuidance,
    formatSignatureSection,
    validationFeedback: input.validationFeedback,
    promptOverrides: input.promptOverrides,
    retryDirective: input.retryDirective,
  }, emit);

  const scriptText = scriptData?.script ?? '';

  // ═══════════════════════════════════════════════════════════════
  //  Skeleton-writing alignment check
  //  Verify the writing step respected the skeleton's structure.
  // ═══════════════════════════════════════════════════════════════
  const sentenceList: any[] = scriptData?.sentence_list ?? [];
  if (sentenceList.length > 0 && skeleton.sentences.length > 0) {
    const skeletonLen = skeleton.sentences.length;
    const writingLen = sentenceList.length;
    if (writingLen < skeletonLen * 0.7 || writingLen > skeletonLen * 1.3) {
      emit(log(`Skeleton alignment: sentence count mismatch — skeleton ${skeletonLen}, writing ${writingLen} (±30% tolerance)`, 'warning'));
    }
    // Per-slot word count check (±30% of skeleton target)
    let driftCount = 0;
    const checkLen = Math.min(skeletonLen, writingLen);
    for (let i = 0; i < checkLen; i++) {
      const target = skeleton.sentences[i].targetLength ?? 0;
      if (target <= 0) continue;
      const text: string = sentenceList[i]?.text ?? sentenceList[i]?.sentence ?? '';
      const actual = text.split(/\s+/).filter(Boolean).length;
      if (actual < target * 0.7 || actual > target * 1.3) {
        driftCount++;
      }
    }
    if (driftCount > checkLen * 0.3) {
      emit(log(`Skeleton alignment: ${driftCount}/${checkLen} slots exceed ±30% word count target`, 'warning'));
    }
  }

  // ═══════════════════════════════════════════════════════════════
  //  Safety check — two-pass: keyword pre-screen → LLM intent
  // ═══════════════════════════════════════════════════════════════
  emit(log('Running safety checks on generated script...'));
  const safetyReport = runSafetyMiddleware(scriptText);

  if (safetyReport.requiresManualReview) {
    emit(log(`Safety: keyword pre-screen flagged (${safetyReport.categories.join(', ')}) — running LLM intent classification...`, 'warning'));

    const flaggedExcerpts = safetyReport.excerptSpans
      .map(s => `[${s.category}] "${s.text}"`)
      .join('\n');
    const intentPrompt = [
      'You are a content safety classifier. A keyword-based pre-screen flagged the following excerpts from a science explainer video script.',
      'Determine whether the content PROMOTES or INSTRUCTS harmful behaviour, or merely DISCUSSES the topic in a positive, educational, or inspirational context.',
      '',
      `Topic: "${topic}"`,
      '',
      'Flagged excerpts:',
      flaggedExcerpts,
      '',
      'Full script (first 1000 chars):',
      scriptText.slice(0, 1000),
      '',
      'Respond with ONLY a JSON object: { "isGenuinelyHarmful": true/false, "reasoning": "one sentence" }',
    ].join('\n');

    let isGenuinelyHarmful = true;
    try {
      const intentResult = await adapter.generateText('', intentPrompt, { timeoutMs: 30_000 });
      const intentText = intentResult.text ?? '';
      const intentMatch = intentText.match(/\{[^}]*"isGenuinelyHarmful"\s*:\s*(true|false)[^}]*\}/);
      if (intentMatch) {
        isGenuinelyHarmful = intentMatch[1] === 'true';
      }
    } catch (_intentErr) {
      emit(log('Safety: LLM intent classification failed — defaulting to block', 'warning'));
    }

    if (isGenuinelyHarmful) {
      emit(log(`Safety: LLM confirmed genuinely harmful content — blocking`, 'error'));
      throw new SafetyBlockError(
        `Safety block: Script contains high-risk content: ${safetyReport.categories.join(', ')}`,
      );
    }

    emit(log('Safety: LLM classified as false positive (positive/educational context) — proceeding with warning', 'warning'));
    // LLM confirmed false positive → clear the manual review flag so the orchestrator safety gate won't block
    safetyReport.requiresManualReview = false;
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

  emit(log(`Script generated: ${scriptOutput.totalWordCount ?? '?'} words (2-step: skeleton → writing)`, 'success'));

  return scriptOutput;
}

/* ================================================================= */
/*  Step A: Skeleton Generation                                       */
/* ================================================================= */

interface SkeletonGenInput {
  topic: string;
  videoLanguage: string;
  targetWordCount: number;
  targetWordCountMin: string;
  targetWordCountMax: string;
  targetSentenceCount: number;
  narrativeArcExpanded: string;
  hookStrategy: string;
  sentenceLengthMax: number;
  metaphorCount: number;
  minFacts: number;
  confidenceNotes: string;
  /** P2: Max hook section character count (120% of reference). */
  hookMaxChars?: number;
  promptOverrides?: Record<string, string>;
}

/** Schema for skeleton JSON validation. */
const SKELETON_SCHEMA = {
  fields: {
    sentences: { type: 'array' as const, required: true },
    totalTargetWords: { type: 'number' as const, required: false },
    hookIndices: { type: 'array' as const, required: false, default: [] },
    ctaIndices: { type: 'array' as const, required: false, default: [] },
    stageBreakdown: { type: 'object' as const, required: false, default: {} },
  },
};

export async function generateSkeleton(
  adapter: AIAdapter,
  input: SkeletonGenInput,
  emit: (entry: LogEntry) => void,
): Promise<ScriptSkeleton> {
  const systemPrompt = fillTemplate(resolvePrompt('SKELETON_SYSTEM_PROMPT', { promptOverrides: input.promptOverrides }), {
    video_language: input.videoLanguage,
    target_word_count: input.targetWordCount,
    sentence_length_max: input.sentenceLengthMax,
    min_facts: input.minFacts,
    metaphor_count: input.metaphorCount,
  });

  const userPrompt = fillTemplate(resolvePrompt('SKELETON_USER_PROMPT', { promptOverrides: input.promptOverrides }), {
    topic: input.topic,
    target_word_count: input.targetWordCount,
    target_word_count_min: input.targetWordCountMin,
    target_word_count_max: input.targetWordCountMax,
    target_sentence_count: input.targetSentenceCount,
    narrative_arc_expanded: input.narrativeArcExpanded,
    hook_strategy: input.hookStrategy,
    metaphor_count: input.metaphorCount,
    min_facts: input.minFacts,
    confidence_notes: input.confidenceNotes
      + (input.hookMaxChars ? `\n- IMPORTANT: Hook section (sentences 1-3 combined) MUST NOT exceed ${input.hookMaxChars} characters total` : ''),
  });

  const result = await adapter.generateText('', userPrompt, {
    systemInstruction: systemPrompt,
    responseMimeType: 'application/json',
  });

  slog.debug('skeleton_response', { length: (result.text ?? '').length });

  const parsed = extractAndValidateJSON<any>(result.text ?? '', SKELETON_SCHEMA, 'skeletonGeneration');
  if (!parsed || !Array.isArray(parsed.sentences) || parsed.sentences.length === 0) {
    emit(log('Warning: skeleton parse failed, using fallback linear skeleton', 'warning'));
    return buildFallbackSkeleton(input);
  }

  return {
    sentences: parsed.sentences.map((s: any, i: number) => ({
      index: s.index ?? i + 1,
      stage: s.stage ?? 'unknown',
      targetLength: s.targetLength ?? 20,
      purposeTag: s.purposeTag ?? 'exposition',
      hasFact: s.hasFact ?? false,
      hasMetaphor: s.hasMetaphor ?? false,
    })),
    totalTargetWords: parsed.totalTargetWords ?? input.targetWordCount,
    hookIndices: parsed.hookIndices ?? [1, 2, 3],
    ctaIndices: parsed.ctaIndices ?? [parsed.sentences.length],
    stageBreakdown: parsed.stageBreakdown ?? {},
  };
}

/** Deterministic fallback skeleton when AI output is unparseable. */
function buildFallbackSkeleton(input: SkeletonGenInput): ScriptSkeleton {
  const n = input.targetSentenceCount;
  const avgLen = Math.round(input.targetWordCount / n);
  const sentences = Array.from({ length: n }, (_, i) => ({
    index: i + 1,
    stage: i < 3 ? 'hook' : i >= n - 2 ? 'closing' : 'body',
    targetLength: avgLen,
    purposeTag: i === 0 ? 'data_anchor' : i < 3 ? 'hook' : i >= n - 2 ? 'cta' : 'exposition',
    hasFact: i % 4 === 0,
    hasMetaphor: i === Math.floor(n / 3) || i === Math.floor(2 * n / 3),
  }));
  return {
    sentences,
    totalTargetWords: input.targetWordCount,
    hookIndices: [1, 2, 3],
    ctaIndices: [n - 1, n],
    stageBreakdown: { hook: [1, 2, 3], body: sentences.filter(s => s.stage === 'body').map(s => s.index), closing: [n - 1, n] },
  };
}

/* ================================================================= */
/*  Step B: Writing (creative text fill)                              */
/* ================================================================= */

interface WritingGenInput {
  topic: string;
  videoLanguage: string;
  skeleton: ScriptSkeleton;
  targetAudience: string;
  emotionalToneArc: string;
  factsListStr: string;
  baseMedium: string;
  transcriptExcerpt: string;
  styleGuidance: string;
  formatSignatureSection: string;
  validationFeedback?: string;
  promptOverrides?: Record<string, string>;
  retryDirective?: string;
}

export async function generateWriting(
  adapter: AIAdapter,
  input: WritingGenInput,
  emit: (entry: LogEntry) => void,
): Promise<any> {
  const systemPrompt = fillTemplate(resolvePrompt('WRITING_SYSTEM_PROMPT', { promptOverrides: input.promptOverrides }), {
    video_language: input.videoLanguage,
  });

  const skeletonJson = JSON.stringify(input.skeleton.sentences, null, 2);

  let userPrompt = fillTemplate(resolvePrompt('WRITING_USER_PROMPT', { promptOverrides: input.promptOverrides }), {
    topic: input.topic,
    target_audience: input.targetAudience,
    skeleton_json: skeletonJson,
    emotional_tone_arc: input.emotionalToneArc,
    verified_facts_list: input.factsListStr,
    base_medium: input.baseMedium,
    reference_transcript_excerpt: input.transcriptExcerpt,
    style_guidance: input.styleGuidance,
    format_signature_section: input.formatSignatureSection,
  });

  // Inject validation/QA feedback for retry attempts
  if (input.validationFeedback) {
    userPrompt += `\n\n─────────────────────────────────────────────────────────────\nCRITICAL: ${input.validationFeedback}\n─────────────────────────────────────────────────────────────`;
  }

  // Inject user directive from retryStage
  if (input.retryDirective) {
    userPrompt += `\n\n─────────────────────────────────────────────────────────────\nUSER DIRECTIVE: ${input.retryDirective}\n─────────────────────────────────────────────────────────────`;
  }

  const result = await adapter.generateText('', userPrompt, {
    systemInstruction: systemPrompt,
    responseMimeType: 'application/json',
  });

  slog.debug('writing_response', { length: (result.text ?? '').length });

  const parsed = extractAndValidateJSON<any>(result.text ?? '', SCRIPT_OUTPUT_SCHEMA, 'scriptWriting');
  if (!parsed) {
    emit(log('Warning: could not parse writing output as JSON, using raw text', 'warning'));
    return { script: result.text ?? '', sentence_list: [], total_length: 0 };
  }
  return parsed;
}

/* ================================================================= */
/*  Helpers                                                           */
/* ================================================================= */

/** Build confidence notes for skeleton prompt — tells AI which fields are uncertain. */
function buildConfidenceNotes(
  confidence: Record<string, string>,
  scriptTrack: StyleAnalysisCIR['scriptTrack'],
): string {
  const notes: string[] = [];
  const slConf = confidence['sentenceLengthMax'];
  if (slConf === 'guess') {
    notes.push(`- Sentence length max (${scriptTrack.sentenceLengthMax}) is ESTIMATED — use as loose upper bound, prioritize natural flow`);
  } else if (slConf === 'inferred') {
    notes.push(`- Sentence length max (${scriptTrack.sentenceLengthMax}) has moderate confidence — slight flexibility OK`);
  }
  const mcConf = confidence['metaphorCount'];
  if (mcConf === 'guess') {
    notes.push(`- Metaphor count (${scriptTrack.metaphorCount}) is ESTIMATED — aim for at least 1, up to ${scriptTrack.metaphorCount + 2}`);
  } else if (mcConf === 'inferred') {
    notes.push(`- Metaphor count (${scriptTrack.metaphorCount}) is approximate — ±1 is fine`);
  }
  return notes.length > 0 ? `\n## Confidence Notes (adjust flexibility accordingly)\n${notes.join('\n')}` : '';
}

/** Build style guidance string from confident/inferred fields (not guess). */
function buildStyleGuidance(
  confidence: Record<string, string>,
  scriptTrack: StyleAnalysisCIR['scriptTrack'],
  styleCIR: StyleAnalysisCIR,
): string {
  const lines: string[] = ['## Style Guidance'];

  // Rhetorical core
  const rcLine = constraintLine('Rhetorical devices', scriptTrack.rhetoricalCore, confidence['rhetoricalCore'] as any);
  if (rcLine) lines.push(rcLine);

  // Pacing
  const pacingLine = constraintLine('Pacing', styleCIR.pacing, confidence['pacing'] as any);
  if (pacingLine) lines.push(pacingLine);

  // Jargon treatment
  const jargonLine = constraintLine('Jargon treatment', scriptTrack.jargonTreatment, confidence['jargonTreatment'] as any);
  if (jargonLine) lines.push(jargonLine);

  // Interaction cues
  const icLine = constraintLine('Interaction cues target', scriptTrack.interactionCuesCount, confidence['interactionCuesCount'] as any);
  if (icLine) lines.push(icLine);

  // CTA pattern
  const ctaLine = constraintLine('CTA pattern', scriptTrack.ctaPattern, confidence['ctaPattern'] as any);
  if (ctaLine) lines.push(ctaLine);

  // Sentence length avg (guidance for the writer)
  const slLine = constraintLine('Average sentence length', `${scriptTrack.sentenceLengthAvg} ${scriptTrack.sentenceLengthUnit}`, confidence['sentenceLengthAvg'] as any);
  if (slLine) lines.push(slLine);

  return lines.length > 1 ? lines.join('\n') : '';
}

/** Build Format Signature section — hard structural constraints for series consistency. */
function buildFormatSignatureSection(formatSignature?: FormatSignature): string {
  if (!formatSignature) return '(No FormatSignature available — this is the first video in the series.)';

  const fs = formatSignature;
  const lines: string[] = [
    '## Format Signature (Series Style Reference)',
    'NOTE: The following series style patterns were auto-extracted from reference video analysis.',
    'They are guidelines for consistency, not rigid rules — deviate if it improves the script.',
    '',
    '### Hook Structure',
    `Pattern: ${fs.hookTemplate}`,
    'Opening 2-3 sentences should follow this structural pattern with new topic content.',
    '',
    '### Closing Structure',
    `Pattern: ${fs.closingTemplate}`,
    'Final 2-3 sentences should follow this structural pattern with new topic content.',
    '',
    '### Rhythm Fingerprint',
    `Reference sentence lengths: [${fs.sentenceLengthSequence.join(', ')}]`,
    `Target Pearson correlation ≥ 0.6 with this pattern.`,
    '',
    '### Arc Allocation',
    ...fs.arcStageLabels.map((label, i) => `- ${label}: ${fs.arcSentenceAllocation[i] ?? '?'} sentences`),
    '',
    '### Transition Positions',
    `Major transitions at sentence indices: [${fs.transitionPositions.join(', ')}]`,
    `Patterns: ${fs.transitionPatterns.map(p => `「${p}」`).join(', ')}`,
    '',
    '### Signature Phrases (adapt to new topic)',
    ...fs.signaturePhrases.map(p => `- ${p}`),
    '',
    '### Emotional Waveform',
    `Target intensity: [${fs.emotionalArcShape.map(v => v.toFixed(1)).join(', ')}]`,
  ];
  return lines.join('\n');
}
