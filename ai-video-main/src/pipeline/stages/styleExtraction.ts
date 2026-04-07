/* ------------------------------------------------------------------ */
/*  Stage 2: Style Extraction – reference video analysis + StyleDNA   */
/* ------------------------------------------------------------------ */

import type { AIAdapter, StyleProfile, LogEntry } from '../types.js';
import { STYLE_EXTRACTION_PROMPT, ANALYSIS_SELF_ASSESSMENT_PROMPT } from '../prompts.js';
import { extractJSON } from '../../adapters/responseParser.js';
import { createStageLog } from './stageLog.js';
import { compressVideoForUpload } from './videoCompress.js';

export interface StyleExtractionInput {
  videoFilePath: string;
  topic: string;
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
  try {
    emit(log('Running self-assessment on extraction capabilities...'));
    const assessmentResult = await adapter.generateText('', [
      filePart,
      { text: ANALYSIS_SELF_ASSESSMENT_PROMPT },
    ]);
    assessmentText = assessmentResult.text ?? '';
    emit(log('Self-assessment complete', 'info'));
  } catch {
    emit(log('Self-assessment failed (non-blocking), continuing extraction', 'warning'));
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
  console.log('[STYLE_EXTRACTION] prompt parts:', prompt.length, 'video:', input.videoFilePath);
  const result = await adapter.generateText('', prompt, {
    responseMimeType: 'application/json',
  });
  console.log('[STYLE_EXTRACTION] raw response length:', (result.text ?? '').length);
  console.log('[STYLE_EXTRACTION] raw response preview:', (result.text ?? '').slice(0, 1000));

  const styleData = extractJSON<any>(result.text ?? '');
  console.log('[STYLE_EXTRACTION] parsed styleData keys:', styleData ? Object.keys(styleData).join(', ') : 'null');
  if (!styleData) {
    throw new Error('Failed to extract StyleDNA: could not parse AI response as JSON');
  }

  const styleProfile: StyleProfile = {
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

  // Log confidence summary
  if (styleProfile.nodeConfidence) {
    const counts = { confident: 0, inferred: 0, guess: 0 };
    for (const val of Object.values(styleProfile.nodeConfidence)) {
      if (val in counts) counts[val as keyof typeof counts]++;
    }
    emit(log(`Confidence: ${counts.confident} confident, ${counts.inferred} inferred, ${counts.guess} guess`, 'info'));
  }

  // Log suspicious claims for downstream research
  if (styleProfile.suspiciousNumericClaims?.length) {
    emit(log(`Found ${styleProfile.suspiciousNumericClaims.length} suspicious numeric claims to verify`, 'warning'));
  }

  emit(log(`StyleDNA extracted: ${styleProfile.visualStyle}, ${styleProfile.tone}, ${styleProfile.pacing}`, 'success'));

  return { styleProfile };
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
  const styleData = extractJSON<any>(pastedText);
  if (!styleData) {
    throw new Error('Could not parse pasted style data as JSON');
  }

  const styleProfile: StyleProfile = {
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
    sourceDuration: styleData.meta?.video_duration_sec,
    suspiciousNumericClaims: styleData.suspiciousNumericClaims,
  };

  return { styleProfile };
}
