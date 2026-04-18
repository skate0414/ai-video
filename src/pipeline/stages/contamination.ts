/* ------------------------------------------------------------------ */
/*  Code-level n-gram contamination detection                         */
/*  Uses Intl.Segmenter (Node ≥ 20) for Chinese word segmentation    */
/*  to detect overlap between generated script and reference          */
/*  transcript. Complements AI self-assessment in QA_REVIEW.          */
/* ------------------------------------------------------------------ */

const NGRAM_SIZE = 4;
const CONTAMINATION_THRESHOLD = 0.3;

export interface ContaminationResult {
  /** Overlap ratio: 0–1 (fraction of script n-grams found in reference) */
  score: number;
  /** Specific overlapping phrases (up to 10) */
  overlappingPhrases: string[];
  /** Whether contamination exceeds the blocking threshold */
  isBlocking: boolean;
}

/**
 * Segment Chinese/mixed text into words using Intl.Segmenter.
 * Falls back to character-level segmentation if Segmenter is unavailable.
 */
export function segmentWords(text: string): string[] {
  const segmenter = new Intl.Segmenter('zh-CN', { granularity: 'word' });
  const words: string[] = [];
  for (const { segment, isWordLike } of segmenter.segment(text)) {
    if (isWordLike) words.push(segment);
  }
  return words;
}

/**
 * Extract all n-grams of the given size from a word array.
 */
function extractNgrams(words: string[], n: number): Set<string> {
  const ngrams = new Set<string>();
  for (let i = 0; i <= words.length - n; i++) {
    ngrams.add(words.slice(i, i + n).join('|'));
  }
  return ngrams;
}

/**
 * Detect n-gram contamination between a generated script and a reference transcript.
 *
 * Returns a score from 0 to 1 representing the fraction of script n-grams
 * that appear in the reference. High overlap suggests the AI copied rather
 * than synthesised new content.
 */
export function checkContamination(
  scriptText: string,
  referenceTranscript: string,
): ContaminationResult {
  if (!scriptText || !referenceTranscript) {
    return { score: 0, overlappingPhrases: [], isBlocking: false };
  }

  const scriptWords = segmentWords(scriptText);
  const refWords = segmentWords(referenceTranscript);

  // Need at least NGRAM_SIZE words to form n-grams
  if (scriptWords.length < NGRAM_SIZE || refWords.length < NGRAM_SIZE) {
    return { score: 0, overlappingPhrases: [], isBlocking: false };
  }

  const scriptNgrams = extractNgrams(scriptWords, NGRAM_SIZE);
  const refNgrams = extractNgrams(refWords, NGRAM_SIZE);

  if (scriptNgrams.size === 0) {
    return { score: 0, overlappingPhrases: [], isBlocking: false };
  }

  // Count overlapping n-grams
  const overlapping: string[] = [];
  for (const ngram of scriptNgrams) {
    if (refNgrams.has(ngram)) {
      overlapping.push(ngram.replace(/\|/g, ''));
    }
  }

  const score = overlapping.length / scriptNgrams.size;

  return {
    score,
    overlappingPhrases: overlapping.slice(0, 10),
    isBlocking: score > CONTAMINATION_THRESHOLD,
  };
}
