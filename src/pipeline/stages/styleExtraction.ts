/* ------------------------------------------------------------------ */
/*  Pass 2: Style Extraction – source analysis (lexing/parsing)       */
/*  Analyzes reference video to produce StyleAnalysisCIR – the       */
/*  compiler's "AST" of visual/audio/narrative style constraints.     */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, LogEntry } from '../types.js';
import { STYLE_EXTRACTION_PROMPT, ANALYSIS_SELF_ASSESSMENT_PROMPT } from '../prompts.js';
import { extractAndValidateJSON } from '../../adapters/responseParser.js';
import { STYLE_PROFILE_SCHEMA } from '../../adapters/schemaValidator.js';
import { createStageLog } from './stageLog.js';
import { createLogger } from '../../lib/logger.js';
import { validateStyleContract, computeDerivedFields } from '../styleContract.js';

const slog = createLogger('StyleExtraction');
import { compressVideoForUpload } from './videoCompress.js';

export interface StyleExtractionInput {
  videoFilePath: string;
  topic: string;
  /** Optional performance toggle: skip self-assessment pre-pass when latency matters. */
  enableSelfAssessment?: boolean;
}

export interface StyleExtractionOutput {
  styleProfile: StyleProfile;
}

const log = createStageLog('STYLE_EXTRACTION');

async function buildFilePart(adapter: AIAdapter, filePath: string, mimeType: string): Promise<{ fileData: { fileUri: string; mimeType: string } }> {
  if (adapter.uploadFile) {
    const uploaded = await adapter.uploadFile({
      name: filePath.split('/').pop() || 'upload-file',
      path: filePath,
      mimeType,
    });
    return {
      fileData: {
        fileUri: uploaded.uri,
        mimeType: uploaded.mimeType || mimeType,
      },
    };
  }

  return {
    fileData: {
      fileUri: filePath,
      mimeType,
    },
  };
}

/**
 * Run style extraction:
 * Upload reference video and extract StyleDNA profile.
 */
export async function runStyleExtraction(
  adapter: AIAdapter,
  input: StyleExtractionInput,
  onLog?: (entry: LogEntry) => void,
): Promise<StyleExtractionOutput> {
  const emit = onLog ?? (() => {});

  emit(log('Uploading reference video for style analysis...'));

  // Compress large videos to speed up browser upload
  const uploadPath = await compressVideoForUpload(input.videoFilePath);

  const filePart = await buildFilePart(adapter, uploadPath, guessVideoMimeType(uploadPath));

  // Self-assessment pre-pass: ask LLM to reflect on its extraction capabilities
  // This improves confidence tagging accuracy (ai-suite strategy)
  let assessmentText = '';
  const runSelfAssessment = input.enableSelfAssessment ?? false;
  if (runSelfAssessment) {
    try {
      emit(log('Running self-assessment on extraction capabilities...'));
      const assessmentResult = await adapter.generateText('', [
        filePart,
        { text: ANALYSIS_SELF_ASSESSMENT_PROMPT },
      ], { timeoutMs: 1_200_000 });
      assessmentText = assessmentResult.text ?? '';
      emit(log('Self-assessment complete', 'info'));
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      slog.error('self_assessment_failed', { error: msg });
      emit(log(`Self-assessment failed (non-blocking): ${msg}`, 'warning'));
    }
  } else {
    emit(log('Skipping self-assessment pre-pass for faster style extraction', 'info'));
  }

  // Build extraction prompt with optional self-assessment injection
  let extractionPrompt = STYLE_EXTRACTION_PROMPT;
  if (assessmentText) {
    extractionPrompt += `\n\n─────────────────────────────────────────────────────────────
YOUR SELF-ASSESSMENT
─────────────────────────────────────────────────────────────
You previously assessed your own capabilities for this video:
${assessmentText}

INSTRUCTION:
Reflect on your assessment above.
- If you marked a field as "inferred" or "guess", explicitly mark it as such in nodeConfidence.
- If you identified any BLIND SPOTS in Q5 that map to the schema, capture them in the relevant fields.`;
  }

  const prompt: any[] = [
    filePart,
    { text: extractionPrompt },
  ];

  emit(log('Extracting StyleDNA from reference video...'));
  slog.debug('prompt_parts', { count: prompt.length, video: input.videoFilePath });
  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
    timeoutMs: 1_200_000,
  });
  slog.debug('response_received', { length: (result.text ?? '').length });
  slog.debug('response_preview', { content: (result.text ?? '').slice(0, 1000) });

  const styleData = extractAndValidateJSON<any>(result.text ?? '', STYLE_PROFILE_SCHEMA, 'styleExtraction');
  slog.debug('parsed_result', { keys: styleData ? Object.keys(styleData).join(', ') : 'null' });
  if (!styleData) {
    throw new Error('Failed to extract StyleDNA: could not parse AI response as JSON');
  }

  const styleProfile: StyleProfile = buildStyleProfile(styleData);

  // Contract validation: check CRITICAL / IMPORTANT field presence + confidence
  const contractResult = validateStyleContract(styleProfile);
  slog.info('contract_validation', {
    score: contractResult.score,
    criticalPresent: contractResult.criticalPresent,
    criticalTotal: contractResult.criticalTotal,
    missingCritical: contractResult.missingCritical,
    lowConfidenceCritical: contractResult.lowConfidenceCritical,
    missingImportant: contractResult.missingImportant,
  });

  if (contractResult.missingCritical.length > 0) {
    emit(log(`Contract: ${contractResult.missingCritical.length} CRITICAL fields missing — attempting targeted retry`, 'warning'));
  }
  if (contractResult.lowConfidenceCritical.length > 0) {
    emit(log(`Contract: ${contractResult.lowConfidenceCritical.length} CRITICAL fields tagged "guess"`, 'warning'));
  }
  if (contractResult.missingImportant.length > 0) {
    emit(log(`Contract: ${contractResult.missingImportant.length} IMPORTANT fields missing`, 'info'));
  }

  // Targeted retry: if CRITICAL fields missing or low-confidence, ask for just those fields
  if (contractResult.retryPromptFragment) {
    try {
      emit(log('Running targeted supplement extraction for missing/low-confidence fields...'));
      const supplementPrompt: any[] = [
        filePart,
        { text: contractResult.retryPromptFragment },
      ];
      const supplementResult = await adapter.generateText('', supplementPrompt, {
        timeoutMs: 1_200_000,
        responseMimeType: 'application/json',
      });
      const supplementData = extractAndValidateJSON<any>(supplementResult.text ?? '', { fields: {} }, 'styleExtractionSupplement');
      if (supplementData && typeof supplementData === 'object') {
        mergeSupplementData(styleProfile, supplementData);
        const recheck = validateStyleContract(styleProfile);
        slog.info('contract_recheck', { score: recheck.score, missingCritical: recheck.missingCritical });
        emit(log(`Contract after retry: score ${recheck.score}/100, ${recheck.missingCritical.length} CRITICAL still missing`, 'info'));
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      slog.error('supplement_extraction_failed', { error: msg });
      emit(log(`Supplement extraction failed (non-blocking): ${msg}`, 'warning'));
    }
  }

  // Compute derivable fields from fullTranscript (overrides AI guesses with precise values)
  computeDerivedFields(styleProfile);

  // Log confidence summary
  if (styleProfile.nodeConfidence) {
    const counts = { confident: 0, inferred: 0, guess: 0, computed: 0 };
    for (const val of Object.values(styleProfile.nodeConfidence)) {
      if (val in counts) counts[val as keyof typeof counts]++;
    }
    emit(log(`Confidence: ${counts.confident} confident, ${counts.inferred} inferred, ${counts.guess} guess, ${counts.computed} computed`, 'info'));
  }

  // Log suspicious claims for downstream research
  if (styleProfile.suspiciousNumericClaims?.length) {
    emit(log(`Found ${styleProfile.suspiciousNumericClaims.length} suspicious numeric claims to verify`, 'warning'));
  }

  emit(log(`StyleDNA extracted: ${styleProfile.visualStyle}, ${styleProfile.tone}, ${styleProfile.pacing} (contract score: ${contractResult.score}/100)`, 'success'));

  return { styleProfile };
}

/* ---- Helpers ---- */

function buildStyleProfile(styleData: any): StyleProfile {
  return {
    visualStyle: styleData.visualStyle ?? 'cinematic',
    pacing: styleData.pacing ?? 'medium',
    tone: styleData.tone ?? 'informative',
    colorPalette: styleData.colorPalette ?? ['#000000', '#FFFFFF'],
    narrativeStructure: styleData.narrativeStructure ?? ['Hook', 'Body', 'Conclusion'],
    hookType: styleData.hookType,
    callToActionType: styleData.callToActionType,
    wordCount: styleData.wordCount,
    wordsPerMinute: styleData.wordsPerMinute,
    emotionalIntensity: styleData.emotionalIntensity,
    audioStyle: styleData.audioStyle,
    fullTranscript: styleData.fullTranscript,
    meta: styleData.meta,
    track_a_script: styleData.track_a_script,
    track_b_visual: styleData.track_b_visual,
    track_c_audio: styleData.track_c_audio,
    nodeConfidence: styleData.nodeConfidence,
    targetAudience: styleData.targetAudience,
    keyElements: styleData.keyElements,
    sourceDuration: styleData.meta?.video_duration_sec,
    suspiciousNumericClaims: styleData.suspiciousNumericClaims,
  };
}

/**
 * Merge supplement extraction data into an existing StyleProfile.
 * Only fills in missing fields — does NOT overwrite existing confident values.
 */
function mergeSupplementData(profile: StyleProfile, data: Record<string, unknown>): void {
  // Merge nested objects: meta, track_a_script, track_b_visual, track_c_audio
  for (const nested of ['meta', 'track_a_script', 'track_b_visual', 'track_c_audio'] as const) {
    if (data[nested] && typeof data[nested] === 'object') {
      const existing = (profile[nested] as Record<string, unknown> | undefined) ?? {};
      const supplement = data[nested] as Record<string, unknown>;
      for (const [key, value] of Object.entries(supplement)) {
        if (value !== undefined && value !== null && (existing[key] === undefined || existing[key] === null)) {
          existing[key] = value;
        }
      }
      (profile as any)[nested] = existing;
    }
  }

  // Merge top-level fields
  for (const key of ['fullTranscript', 'wordsPerMinute', 'wordCount'] as const) {
    if (data[key] !== undefined && data[key] !== null && profile[key] === undefined) {
      (profile as any)[key] = data[key];
    }
  }

  // Merge nodeConfidence
  if (data.nodeConfidence && typeof data.nodeConfidence === 'object') {
    if (!profile.nodeConfidence) profile.nodeConfidence = {};
    for (const [key, value] of Object.entries(data.nodeConfidence as Record<string, string>)) {
      // Don't downgrade: if existing is 'confident', don't overwrite
      const existing = profile.nodeConfidence[key];
      if (!existing || existing === 'guess') {
        profile.nodeConfidence[key] = value as any;
      }
    }
  }
}

function guessVideoMimeType(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase();
  switch (ext) {
    case 'mp4': return 'video/mp4';
    case 'webm': return 'video/webm';
    case 'mov': return 'video/quicktime';
    case 'avi': return 'video/x-msvideo';
    default: return 'video/mp4';
  }
}

/**
 * Manual analysis: parse pasted text from Gemini web into a StyleProfile.
 * Used when multimodal upload is not available in free mode.
 */
export function runStyleExtractionManual(
  pastedText: string,
  topic: string,
): StyleExtractionOutput {
  const styleData = extractAndValidateJSON<any>(pastedText, STYLE_PROFILE_SCHEMA, 'styleExtractionManual');
  if (!styleData) {
    throw new Error('Could not parse pasted style data as JSON');
  }

  const styleProfile: StyleProfile = buildStyleProfile(styleData);
  computeDerivedFields(styleProfile);

  return { styleProfile };
}
