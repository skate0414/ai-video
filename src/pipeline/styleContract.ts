/* ------------------------------------------------------------------ */
/*  StyleProfile Contract – source analysis field-level constraints   */
/*  Ensures downstream compilation passes receive reliable source    */
/*  analysis data (CRITICAL / IMPORTANT / OPTIONAL tiers).           */
/* ------------------------------------------------------------------ */

import type { StyleProfile } from './types.js';

export type FieldTier = 'CRITICAL' | 'IMPORTANT' | 'OPTIONAL';

export interface ContractField {
  tier: FieldTier;
  /** Dot-path to resolve the field from StyleProfile, e.g. 'meta.video_duration_sec' */
  path: string;
  /** Downstream stages that consume this field */
  consumers: string[];
}

export interface ContractValidationResult {
  /** Number of CRITICAL fields present */
  criticalPresent: number;
  /** Total CRITICAL fields */
  criticalTotal: number;
  /** Missing CRITICAL fields (path list) */
  missingCritical: string[];
  /** CRITICAL fields with nodeConfidence = 'guess' */
  lowConfidenceCritical: string[];
  /** Missing IMPORTANT fields (path list) */
  missingImportant: string[];
  /** 0-100 score: (criticalPresent / criticalTotal) * 100, penalised by guesses */
  score: number;
  /** Targeted retry prompt fragment listing missing/low-confidence fields */
  retryPromptFragment: string | null;
}

/* ---- Contract definition ---- */

export const STYLE_CONTRACT: readonly ContractField[] = Object.freeze([
  // CRITICAL — missing = retry extraction
  { tier: 'CRITICAL', path: 'meta.video_duration_sec', consumers: ['CALIBRATION', 'SCRIPT_GENERATION', 'SCRIPT_VALIDATOR', 'STORYBOARD'] },
  { tier: 'CRITICAL', path: 'meta.video_language', consumers: ['SCRIPT_GENERATION', 'SCRIPT_VALIDATOR', 'TTS'] },
  { tier: 'CRITICAL', path: 'track_a_script.sentence_length_max', consumers: ['SCRIPT_GENERATION', 'SCRIPT_VALIDATOR'] },
  { tier: 'CRITICAL', path: 'track_a_script.hook_strategy', consumers: ['SCRIPT_GENERATION'] },
  { tier: 'CRITICAL', path: 'track_b_visual.base_medium', consumers: ['SCRIPT_GENERATION', 'STORYBOARD', 'IMAGE_GENERATION'] },
  { tier: 'CRITICAL', path: 'track_b_visual.scene_avg_duration_sec', consumers: ['SCRIPT_GENERATION', 'SCRIPT_VALIDATOR', 'STORYBOARD'] },
  { tier: 'CRITICAL', path: 'fullTranscript', consumers: ['CALIBRATION', 'SCRIPT_GENERATION'] },

  // IMPORTANT — missing = warn + widen tolerance
  { tier: 'IMPORTANT', path: 'track_a_script.emotional_tone_arc', consumers: ['SCRIPT_GENERATION'] },
  { tier: 'IMPORTANT', path: 'track_a_script.rhetorical_core', consumers: ['SCRIPT_GENERATION'] },
  { tier: 'IMPORTANT', path: 'track_a_script.metaphor_count', consumers: ['SCRIPT_GENERATION'] },
  { tier: 'IMPORTANT', path: 'track_b_visual.visual_metaphor_mapping', consumers: ['SCRIPT_GENERATION', 'STORYBOARD'] },
  { tier: 'IMPORTANT', path: 'track_b_visual.lighting_style', consumers: ['STORYBOARD', 'IMAGE_GENERATION'] },
  { tier: 'IMPORTANT', path: 'meta.video_type', consumers: ['STYLE_EXTRACTION'] },
  { tier: 'IMPORTANT', path: 'narrativeStructure', consumers: ['NARRATIVE_MAP', 'SCRIPT_GENERATION'] },
  { tier: 'IMPORTANT', path: 'wordsPerMinute', consumers: ['CALIBRATION', 'SCRIPT_GENERATION'] },

  // OPTIONAL — missing = acceptable
  { tier: 'OPTIONAL', path: 'track_c_audio.bgm_genre', consumers: ['AUDIO_GENERATION'] },
  { tier: 'OPTIONAL', path: 'track_c_audio.bgm_mood', consumers: ['AUDIO_GENERATION'] },
  { tier: 'OPTIONAL', path: 'track_c_audio.voice_style', consumers: ['TTS'] },
  { tier: 'OPTIONAL', path: 'track_b_visual.b_roll_ratio', consumers: ['STORYBOARD'] },
  { tier: 'OPTIONAL', path: 'track_b_visual.composition_style', consumers: ['STORYBOARD'] },
  { tier: 'OPTIONAL', path: 'track_b_visual.transition_style', consumers: ['VIDEO_ASSEMBLY'] },
  { tier: 'OPTIONAL', path: 'audioStyle', consumers: ['AUDIO_GENERATION'] },
  { tier: 'OPTIONAL', path: 'keyElements', consumers: ['RESEARCH'] },
]);

/* ---- Helpers ---- */

/**
 * Resolve a dot-path like 'meta.video_duration_sec' on a StyleProfile.
 * Returns undefined if any segment is missing.
 */
export function resolvePath(profile: StyleProfile, path: string): unknown {
  let current: unknown = profile;
  for (const key of path.split('.')) {
    if (current === null || current === undefined || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

function isPresent(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  if (Array.isArray(value) && value.length === 0) return false;
  return true;
}

/**
 * Extract the top-level key from a dot-path for nodeConfidence lookup.
 * 'meta.video_duration_sec' → 'video_duration_sec'
 * 'fullTranscript' → 'fullTranscript'
 */
function confidenceKey(path: string): string {
  const parts = path.split('.');
  return parts[parts.length - 1];
}

/* ---- Main validation ---- */

export function validateStyleContract(profile: StyleProfile): ContractValidationResult {
  const criticalFields = STYLE_CONTRACT.filter(f => f.tier === 'CRITICAL');
  const importantFields = STYLE_CONTRACT.filter(f => f.tier === 'IMPORTANT');

  const missingCritical: string[] = [];
  const lowConfidenceCritical: string[] = [];
  const missingImportant: string[] = [];

  const confidence = profile.nodeConfidence ?? {};

  for (const field of criticalFields) {
    const value = resolvePath(profile, field.path);
    if (!isPresent(value)) {
      missingCritical.push(field.path);
    } else if (confidence[confidenceKey(field.path)] === 'guess' || confidence[confidenceKey(field.path)] === 'inferred') {
      lowConfidenceCritical.push(field.path);
    }
  }

  for (const field of importantFields) {
    const value = resolvePath(profile, field.path);
    if (!isPresent(value)) {
      missingImportant.push(field.path);
    }
  }

  const criticalPresent = criticalFields.length - missingCritical.length;
  // Score: base = present/total, penalise low-confidence critical
  // 'guess' penalised 50%, 'inferred' penalised 25%
  const guessCount = lowConfidenceCritical.filter(p => confidence[confidenceKey(p)] === 'guess').length;
  const inferredCount = lowConfidenceCritical.length - guessCount;
  const effectivePresent = criticalPresent - guessCount * 0.5 - inferredCount * 0.25;
  const score = criticalFields.length > 0
    ? Math.round(Math.max(0, effectivePresent / criticalFields.length) * 100)
    : 100;

  // Build targeted retry prompt if needed
  let retryPromptFragment: string | null = null;
  if (missingCritical.length > 0 || lowConfidenceCritical.length > 0) {
    const lines: string[] = [];
    if (missingCritical.length > 0) {
      lines.push('The following CRITICAL fields were missing from your previous response. Please extract them carefully:');
      for (const path of missingCritical) {
        lines.push(`  - ${path}`);
      }
    }
    if (lowConfidenceCritical.length > 0) {
      lines.push('The following CRITICAL fields were marked as "guess". Please re-examine the video and provide more confident values:');
      for (const path of lowConfidenceCritical) {
        lines.push(`  - ${path}`);
      }
    }
    lines.push('Return ONLY a JSON object with these fields. Do not repeat fields you already provided confidently.');
    retryPromptFragment = lines.join('\n');
  }

  return {
    criticalPresent,
    criticalTotal: criticalFields.length,
    missingCritical,
    lowConfidenceCritical,
    missingImportant,
    score,
    retryPromptFragment,
  };
}

/* ---- Computed fields ---- */

/**
 * Compute derivable fields from fullTranscript, overriding AI guesses.
 * Mutates the profile in place and updates nodeConfidence.
 */
export function computeDerivedFields(profile: StyleProfile): void {
  const transcript = profile.fullTranscript;
  if (!transcript || transcript.trim().length === 0) return;

  const language = profile.meta?.video_language ?? 'Chinese';
  const isChinese = language.toLowerCase().includes('chinese') || language.toLowerCase().includes('中文');
  const durationSec = profile.meta?.video_duration_sec;

  // Word/character count
  let wordCount: number;
  if (isChinese) {
    const cjk = transcript.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0;
    const ascii = transcript.match(/[a-zA-Z]+/g)?.length ?? 0;
    wordCount = cjk + ascii;
  } else {
    wordCount = transcript.split(/\s+/).filter(Boolean).length;
  }
  profile.wordCount = wordCount;

  // Words per minute
  if (durationSec && durationSec > 0) {
    profile.wordsPerMinute = Math.round(wordCount / (durationSec / 60));
  }

  // Sentence analysis
  // Split on Chinese/English sentence-ending punctuation, but NOT on
  // ASCII periods between digits (e.g. "0.01%" must stay intact).
  const sentences = transcript
    .split(/(?<=[。！？!?\n])|(?<=\.)(?!\d)(?<!\d\.)/)
    .map(s => s.trim())
    .filter(s => s.length > 0);

  const countSentenceWords = (s: string) => {
    if (isChinese) {
      return (s.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0)
        + (s.match(/[a-zA-Z]+/g)?.length ?? 0);
    }
    return s.split(/\s+/).filter(Boolean).length;
  };

  if (sentences.length > 0) {
    let lengths = sentences.map(countSentenceWords);
    let avg = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
    let max = Math.max(...lengths);

    // Sanity check: if avg is unreasonably high (> wordCount / 3), the
    // transcript likely lacks punctuation (e.g. ASR output with spaces only).
    // Fall back to space-based splitting for Chinese text.
    if (avg > wordCount / 3 && wordCount > 30 && isChinese) {
      const spaceSentences = transcript.split(/\s+/).filter(s => s.trim().length > 0);
      if (spaceSentences.length > sentences.length) {
        lengths = spaceSentences.map(countSentenceWords);
        avg = Math.round(lengths.reduce((a, b) => a + b, 0) / lengths.length);
        max = Math.max(...lengths);
      }
    }

    if (!profile.track_a_script) profile.track_a_script = {};
    profile.track_a_script.sentence_length_avg = avg;
    profile.track_a_script.sentence_length_max = max;
  }

  // Mark computed fields in nodeConfidence
  if (!profile.nodeConfidence) profile.nodeConfidence = {};
  profile.nodeConfidence['wordCount'] = 'computed' as any;
  if (durationSec && durationSec > 0) {
    profile.nodeConfidence['wordsPerMinute'] = 'computed' as any;
  }
  if (sentences.length > 0) {
    profile.nodeConfidence['sentence_length_avg'] = 'computed' as any;
    profile.nodeConfidence['sentence_length_max'] = 'computed' as any;
  }
}
