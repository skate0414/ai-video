/* ------------------------------------------------------------------ */
/*  scriptValidator – static analysis pass for generated scripts      */
/*  Deterministic constraint system: replaces LLM-scored dimensions  */
/*  with code-measurable checks that trigger recompilation on fail.   */
/* ------------------------------------------------------------------ */

import type { ScriptOutput, CalibrationData, Fact } from '../types.js';
import type { FormatSignature, StyleAnalysisCIR } from '../../cir/types.js';

/* ---- Error classification types ---- */

/** Error classes used for prioritized retry routing. */
export type ValidationErrorClass = 'structural' | 'quality' | 'format' | 'contamination';

export interface ClassifiedError {
  /** Check code, e.g. 'C0', 'C1', …, 'C13'. */
  code: string;
  /** Error class — determines retry strategy. */
  class: ValidationErrorClass;
  severity: 'error' | 'warning';
  message: string;
}

/** Configurable thresholds for script validation checks. */
export interface ScriptValidationThresholds {
  /** C2: Minimum cliffhanger count before error / warning */
  cliffhangerErrorMin: number;
  cliffhangerWarnMin: number;
  /** C3: N-gram deduplication rate */
  deduplicationErrorMin: number;
  deduplicationWarnMin: number;
  /** C4: Sentence rhythm CV */
  rhythmCVErrorMin: number;
  rhythmCVWarnMin: number;
  /** C5: Max repeated n-grams */
  repeatedNgramErrorMax: number;
  repeatedNgramWarnMax: number;
  /** C7: Curiosity gap frequency (1 per N sentences) */
  curiosityGapErrorPerSentences: number;
  curiosityGapWarnPerSentences: number;
  /** C8: Fact source marker ratio */
  sourceMarkerErrorMin: number;
  sourceMarkerWarnMin: number;
  /** C9: Rhythm correlation with FormatSignature */
  rhythmCorrelationErrorMin: number;
  rhythmCorrelationWarnMin: number;
  /** Min sentence length (characters/words) before short-sentence warning */
  minSentenceLength: number;
  /** Minimum fact references required */
  factReferenceMin: number;
  /** Word count tolerance multipliers (e.g. 0.8 = allow 20% under) */
  wordCountErrorLowFactor: number;
  wordCountErrorHighFactor: number;
}

export const DEFAULT_VALIDATION_THRESHOLDS: Readonly<ScriptValidationThresholds> = Object.freeze({
  cliffhangerErrorMin: 1,
  cliffhangerWarnMin: 2,
  deduplicationErrorMin: 0.70,
  deduplicationWarnMin: 0.80,
  rhythmCVErrorMin: 0.10,
  rhythmCVWarnMin: 0.15,
  repeatedNgramErrorMax: 3,
  repeatedNgramWarnMax: 0,
  curiosityGapErrorPerSentences: 5,
  curiosityGapWarnPerSentences: 4,
  sourceMarkerErrorMin: 0.50,
  sourceMarkerWarnMin: 0.75,
  rhythmCorrelationErrorMin: 0.30,
  rhythmCorrelationWarnMin: 0.50,
  minSentenceLength: 5,
  factReferenceMin: 2,
  wordCountErrorLowFactor: 0.80,
  wordCountErrorHighFactor: 1.20,
});

export interface ScriptValidationResult {
  passed: boolean;
  errors: string[];
  warnings: string[];
  /** Structured classified errors for retry routing. */
  classifiedErrors: ClassifiedError[];
  metrics: {
    actualWordCount: number;
    targetWordCountMin: number;
    targetWordCountMax: number;
    actualSentenceCount: number;
    targetSentenceCount: number;
    factReferenceCount: number;
    maxSentenceLength: number;
    maxSentenceLengthLimit: number;
    metaphorCount: number;
    shortSentenceCount: number;
    hookHasDataAnchor: boolean;
    cliffhangerCount: number;
    ngramDeduplicationRate: number;
    sentenceLengthVariance: number;
    repeatedNgramCount: number;
    emotionalArcPasses: boolean;
    curiosityGapCount: number;
    sourceMarkerRatio: number;
    /** C13: 4-gram overlap ratio between script and reference transcript (0–1) */
    transcriptOverlapRatio: number;
    /** C9: Rhythm correlation with FormatSignature (-1 to 1, or null if no signature) */
    rhythmCorrelation: number | null;
    /** C10: Hook structure matches FormatSignature template (or null if no signature) */
    hookStructureMatch: boolean | null;
    /** C11: Closing structure matches FormatSignature template (or null if no signature) */
    closingStructureMatch: boolean | null;
  };
}

/**
 * Count words/characters in text.
 * For Chinese: count characters (excluding spaces / punctuation).
 * For other languages: count whitespace-delimited words.
 */
function countWords(text: string, language: string): number {
  if (!text) return 0;
  const isChinese = language.toLowerCase().includes('chinese') || language.toLowerCase().includes('中文');
  if (isChinese) {
    // Count CJK characters + ASCII words
    const cjk = text.match(/[\u4e00-\u9fff\u3400-\u4dbf]/g)?.length ?? 0;
    const ascii = text.match(/[a-zA-Z]+/g)?.length ?? 0;
    return cjk + ascii;
  }
  return text.split(/\s+/).filter(Boolean).length;
}

/**
 * Split script into sentences.
 * Handles Chinese punctuation (。！？) and English (. ! ?).
 */
function splitSentences(text: string): string[] {
  if (!text) return [];
  return text
    .split(/(?<=[。！？.!?\n])/)
    .map(s => s.trim())
    .filter(s => s.length > 0);
}

/* ---- C1: Hook data anchor ---- */

/**
 * Check if the first 3 sentences contain at least one numeric data point.
 * Numbers like "4到6次", "90%", "100万" all count.
 */
function hookHasDataAnchor(sentences: string[]): boolean {
  const hookSentences = sentences.slice(0, 3).join('');
  // Match digits, including Chinese numeric patterns (万/亿/%) 
  return /\d/.test(hookSentences);
}

/* ---- C2: Cliffhanger / suspense detection ---- */

/**
 * Count sentences that end with suspense-creating patterns.
 * Checks for question marks, ellipsis, and Chinese rhetorical markers.
 */
function countCliffhangers(sentences: string[]): number {
  const suspensePattern = /[？?…]+\s*$|[吗呢吧嘛]\s*[？?。]?\s*$/;
  return sentences.filter(s => suspensePattern.test(s)).length;
}

/* ---- C3: Information density (n-gram deduplication) ---- */

/**
 * Extract character-level n-grams from text (for Chinese).
 * For other languages, use word-level n-grams.
 */
function extractNgrams(text: string, n: number, language: string): string[] {
  const isChinese = language.toLowerCase().includes('chinese') || language.toLowerCase().includes('中文');
  if (isChinese) {
    // Character-level n-grams for Chinese (strip punctuation/spaces)
    const chars = text.replace(/[\s\p{P}]/gu, '');
    const grams: string[] = [];
    for (let i = 0; i <= chars.length - n; i++) {
      grams.push(chars.slice(i, i + n));
    }
    return grams;
  }
  // Word-level n-grams for other languages
  const words = text.toLowerCase().split(/\s+/).filter(Boolean);
  const grams: string[] = [];
  for (let i = 0; i <= words.length - n; i++) {
    grams.push(words.slice(i, i + n).join(' '));
  }
  return grams;
}

/**
 * Calculate the ratio of unique n-grams to total n-grams.
 * Higher = more diverse content. Lower = more repetitive.
 */
function ngramDeduplicationRate(text: string, language: string): number {
  const grams = extractNgrams(text, 4, language);
  if (grams.length === 0) return 1.0;
  const unique = new Set(grams).size;
  return unique / grams.length;
}

/* ---- C4: Sentence length variance ---- */

/**
 * Calculate the coefficient of variation of sentence lengths.
 * Higher = more rhythm variety. Zero = all same length (robotic).
 */
function sentenceLengthVariance(lengths: number[]): number {
  if (lengths.length < 2) return 0;
  const mean = lengths.reduce((a, b) => a + b, 0) / lengths.length;
  if (mean === 0) return 0;
  const variance = lengths.reduce((sum, l) => sum + (l - mean) ** 2, 0) / lengths.length;
  return Math.sqrt(variance) / mean; // coefficient of variation
}

/* ---- C5: Repetition detection ---- */

/**
 * Count n-grams that appear 3+ times (excessive repetition).
 */
function countRepeatedNgrams(text: string, language: string): number {
  const grams = extractNgrams(text, 4, language);
  const freq = new Map<string, number>();
  for (const g of grams) {
    freq.set(g, (freq.get(g) ?? 0) + 1);
  }
  let repeated = 0;
  for (const count of freq.values()) {
    if (count >= 3) repeated++;
  }
  return repeated;
}

/* ---- C7: Curiosity gap density ---- */

/**
 * Forward-pull phrases that create curiosity gaps ("what happens next?").
 * Matches: transition+suspense combos, direct teasers, mid-script questions.
 */
const CURIOSITY_GAP_PATTERN = /但[是最]?[^，。！？]{0,6}(可怕|惊人|意外|恐怖|离谱|震撼|不可思议)|然而[^。！？]*[却竟]|不过[^。！？]*其实|接下来|下一个|你[绝猜想]|[？?]\s*$/;

/**
 * Count sentences containing curiosity-gap forward-pull devices.
 * These are retention beats that keep viewers watching.
 */
function countCuriosityGaps(sentences: string[]): number {
  return sentences.filter(s => CURIOSITY_GAP_PATTERN.test(s)).length;
}

/* ---- C8: Fact source marker density ---- */

/**
 * Patterns that attribute a claim to a source (e.g. "研究显示", "据统计").
 */
const SOURCE_MARKER_PATTERN = /研究显示|研究表明|研究发现|据统计|据调查|科学家发现|科学家认为|数据表明|数据显示|实验证明|实验发现|根据.{0,10}研究|according to|studies show/i;

/**
 * Calculate the ratio of numeric-claim sentences that have a source marker.
 * A numeric-claim sentence is one containing \d (digits).
 * Returns { ratio, numericSentenceCount, markedCount }.
 */
function sourceMarkerAnalysis(sentences: string[]): { ratio: number; numericSentenceCount: number; markedCount: number } {
  const numericSentences = sentences.filter(s => /\d/.test(s));
  if (numericSentences.length === 0) return { ratio: 1.0, numericSentenceCount: 0, markedCount: 0 };
  const marked = numericSentences.filter(s => SOURCE_MARKER_PATTERN.test(s)).length;
  return { ratio: marked / numericSentences.length, numericSentenceCount: numericSentences.length, markedCount: marked };
}

/* ---- C6: Emotional arc progression ---- */

/** Emotional intensity markers: exclamation, question, emphasis words.
 * Avoid common words like 太阳/太空/最近/最后 triggering false positives. */
const EMOTIONAL_MARKERS = /[！!？?]|居然|竟然|没想到|不可思议|简直|惊人|可怕|震撼|颠覆|万万|千万|太[了吧啊呢！!]|最[大小强多高低]|absolutely|incredible|shocking|amazing|unbelievable/g;

/**
 * Check that emotional intensity increases from first third to middle third
 * of the script. A flat or declining arc means the script lacks escalation.
 * Returns { firstDensity, middleDensity, passes }.
 */
function emotionalArcProgression(sentences: string[]): { firstDensity: number; middleDensity: number; passes: boolean } {
  if (sentences.length < 6) return { firstDensity: 0, middleDensity: 0, passes: true };

  const thirdLen = Math.floor(sentences.length / 3);
  const firstThird = sentences.slice(0, thirdLen).join('');
  const middleThird = sentences.slice(thirdLen, thirdLen * 2).join('');

  const firstCount = (firstThird.match(EMOTIONAL_MARKERS) || []).length;
  const middleCount = (middleThird.match(EMOTIONAL_MARKERS) || []).length;

  // Normalise by character length to get density
  const firstDensity = firstThird.length > 0 ? firstCount / firstThird.length * 100 : 0;
  const middleDensity = middleThird.length > 0 ? middleCount / middleThird.length * 100 : 0;

  return { firstDensity, middleDensity, passes: middleDensity > firstDensity };
}

/* ---- C9: Rhythm correlation with FormatSignature ---- */

/**
 * Compute Pearson correlation coefficient between two numeric arrays.
 * Truncates to the shorter length. Returns 0 if insufficient data.
 */
function pearsonCorrelation(a: number[], b: number[]): number {
  const n = Math.min(a.length, b.length);
  if (n < 3) return 0;
  const x = a.slice(0, n);
  const y = b.slice(0, n);
  const meanX = x.reduce((s, v) => s + v, 0) / n;
  const meanY = y.reduce((s, v) => s + v, 0) / n;
  let num = 0, denX = 0, denY = 0;
  for (let i = 0; i < n; i++) {
    const dx = x[i] - meanX;
    const dy = y[i] - meanY;
    num += dx * dy;
    denX += dx * dx;
    denY += dy * dy;
  }
  const den = Math.sqrt(denX * denY);
  return den === 0 ? 0 : num / den;
}

/* ---- C10/C11: Hook/Closing structure match ---- */

/**
 * Check if the opening sentences structurally match the hook template.
 * Uses heuristic: verifies structural markers (brackets) from template appear as sentence patterns.
 * Returns true if the hook contains at least 50% of the template's structural elements.
 */
function hookStructureMatches(sentences: string[], hookTemplate: string): boolean {
  if (!hookTemplate || sentences.length < 2) return true; // can't verify
  // Extract structural slots from template: text in brackets like [反直觉数据]
  const slots = hookTemplate.match(/\[([^\]]+)\]/g);
  if (!slots || slots.length === 0) return true; // no structured template
  const hookText = sentences.slice(0, 3).join('');
  // Check for presence of structural indicators:
  // [数据/statistic] → digits, [第二人称/second-person] → 你/you, [悬念/suspense] → ？/...
  let matched = 0;
  for (const slot of slots) {
    const content = slot.replace(/[[\]]/g, '').toLowerCase();
    if ((content.includes('数据') || content.includes('data') || content.includes('statistic')) && /\d/.test(hookText)) matched++;
    else if ((content.includes('第二人称') || content.includes('second') || content.includes('人称')) && /你|你的|your|you/i.test(hookText)) matched++;
    else if ((content.includes('悬念') || content.includes('suspense') || content.includes('问')) && /[？?…]/.test(hookText)) matched++;
    else if ((content.includes('挑战') || content.includes('challenge')) && /你|你的|your|you/i.test(hookText)) matched++;
    else matched += 0.5; // partial credit for unrecognized slots
  }
  return matched / slots.length >= 0.5;
}

/**
 * Check if the closing sentences structurally match the closing template.
 */
function closingStructureMatches(sentences: string[], closingTemplate: string): boolean {
  if (!closingTemplate || sentences.length < 2) return true;
  const slots = closingTemplate.match(/\[([^\]]+)\]/g);
  if (!slots || slots.length === 0) return true;
  const closingText = sentences.slice(-3).join('');
  let matched = 0;
  for (const slot of slots) {
    const content = slot.replace(/[[\]]/g, '').toLowerCase();
    if ((content.includes('情感') || content.includes('emotional') || content.includes('升华')) && /[！!]|[感叹震撼美丽]/.test(closingText)) matched++;
    else if ((content.includes('行动') || content.includes('号召') || content.includes('cta') || content.includes('action')) && /[好好|关注|点赞|下次|记住]/.test(closingText)) matched++;
    else if ((content.includes('问题') || content.includes('question') || content.includes('开放')) && /[？?]/.test(closingText)) matched++;
    else matched += 0.5;
  }
  return matched / slots.length >= 0.5;
}

/**
 * Validate a generated script against calibration targets and style constraints.
 * Returns pass/fail with specific errors for feedback injection.
 */
export function validateScript(
  scriptOutput: ScriptOutput,
  calibrationData: CalibrationData | undefined,
  styleCIR: StyleAnalysisCIR,
  formatSignature?: FormatSignature,
  facts?: Fact[],
  thresholds: ScriptValidationThresholds = DEFAULT_VALIDATION_THRESHOLDS,
): ScriptValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];
  const language = styleCIR.meta.videoLanguage;
  const { scriptTrack } = styleCIR;
  const confidence = styleCIR.confidence ?? {};

  // --- Word count validation ---
  const actualWordCount = countWords(scriptOutput.scriptText, language);
  const calibration = calibrationData?.calibration ?? scriptOutput.calibration;
  const targetMin = Number(calibration?.target_word_count_min ?? Math.round((calibration?.target_word_count ?? 300) * 0.9));
  const targetMax = Number(calibration?.target_word_count_max ?? Math.round((calibration?.target_word_count ?? 300) * 1.1));

  if (actualWordCount < targetMin * thresholds.wordCountErrorLowFactor) {
    errors.push(`字数严重不足: 实际 ${actualWordCount}, 最低要求 ${targetMin} (允许 -${Math.round((1 - thresholds.wordCountErrorLowFactor) * 100)}% 容差)`);
  } else if (actualWordCount < targetMin) {
    warnings.push(`字数略低: 实际 ${actualWordCount}, 目标范围 [${targetMin}, ${targetMax}]`);
  } else if (actualWordCount > targetMax * thresholds.wordCountErrorHighFactor) {
    errors.push(`字数严重超出: 实际 ${actualWordCount}, 最高要求 ${targetMax} (允许 +${Math.round((thresholds.wordCountErrorHighFactor - 1) * 100)}% 容差)`);
  } else if (actualWordCount > targetMax) {
    warnings.push(`字数略多: 实际 ${actualWordCount}, 目标范围 [${targetMin}, ${targetMax}]`);
  }

  // --- Sentence count validation ---
  const sentences = splitSentences(scriptOutput.scriptText);
  const actualSentenceCount = sentences.length;
  const sentenceLengthAvg = scriptTrack.sentenceLengthAvg;
  const targetWordCount = calibration?.target_word_count ?? 300;
  const wordBasedSceneCount = Math.round(Number(targetWordCount) / sentenceLengthAvg);
  const durationBasedSceneCount = Math.round(styleCIR.meta.videoDurationSec / styleCIR.visualTrack.sceneAvgDurationSec);
  const targetSceneCount = Math.min(wordBasedSceneCount, durationBasedSceneCount);
  // Confidence-aware: widen sentence count tolerance when sentenceLengthAvg is a guess
  const sentenceLengthAvgConf = confidence['sentenceLengthAvg'];
  const sceneCountFloor = sentenceLengthAvgConf === 'guess' ? 0.35
    : sentenceLengthAvgConf === 'inferred' ? 0.4
    : 0.5;
  if (actualSentenceCount < targetSceneCount * sceneCountFloor) {
    errors.push(`句数严重不足: 实际 ${actualSentenceCount}, 目标约 ${targetSceneCount}${sentenceLengthAvgConf === 'guess' ? ' (目标基于低置信度推算, 已加宽容差)' : ''}`);
  }

  // --- Max sentence length validation ---
  // Widen tolerance when sentence_length_max is a guess or inferred (confidence-aware)
  const sentenceLengthConf = confidence['sentenceLengthMax'];
  const sentenceLengthIsGuess = sentenceLengthConf === 'guess';
  const sentenceLengthIsInferred = sentenceLengthConf === 'inferred';
  // guess: 100% tolerance, inferred: 75% tolerance, confident: 50% tolerance
  const toleranceMultiplier = sentenceLengthIsGuess ? 2.0 : sentenceLengthIsInferred ? 1.75 : 1.5;
  const rawMax = scriptTrack.sentenceLengthMax;
  const maxSentenceLengthLimit = rawMax * toleranceMultiplier;
  const sentenceLengths = sentences.map(s => countWords(s, language));
  const maxSentenceLength = Math.max(...sentenceLengths, 0);
  if (maxSentenceLength > maxSentenceLengthLimit) {
    const confLabel = sentenceLengthIsGuess ? ', 置信度低已加宽容差' : sentenceLengthIsInferred ? ', 置信度中等已适度加宽' : '';
    errors.push(`最长句超出限制: ${maxSentenceLength} > ${maxSentenceLengthLimit} (目标最大 ${rawMax}${confLabel})`);
  }

  // --- Min sentence length validation --- (avoid TTS audio fragmentation)
  const shortSentences = sentenceLengths.filter(len => len > 0 && len < thresholds.minSentenceLength);
  if (shortSentences.length > 1) {
    warnings.push(`存在 ${shortSentences.length} 句过短句子 (< ${thresholds.minSentenceLength} 字), 可能导致 TTS 碎片化和节奏崩塌`);
  }

  // --- Metaphor count validation --- (science explainer needs visual metaphors)
  const metaphorTarget = scriptTrack.metaphorCount;
  const actualMetaphorCount = (scriptOutput as any).scenes
    ?.filter((s: any) => s?.has_metaphor)?.length ?? 0;
  if (metaphorTarget > 0 && actualMetaphorCount === 0) {
    errors.push(`视觉隐喻缺失: 0 个隐喻, 3D 科普内容必须至少包含 1 个视觉隐喻`);
  } else if (metaphorTarget > 0 && actualMetaphorCount < Math.max(1, metaphorTarget - 2)) {
    warnings.push(`视觉隐喻不足: 实际 ${actualMetaphorCount} 个, 目标 ${metaphorTarget} 个`);
  }

  // --- Fact reference count ---
  const factReferenceCount = scriptOutput.usedFactIDs?.length ?? 0;
  if (factReferenceCount < thresholds.factReferenceMin) {
    errors.push(`事实引用不足: 仅 ${factReferenceCount} 个, 科普内容至少需要 ${thresholds.factReferenceMin} 个有来源标注的事实`);
  }

  // --- C1: Hook data anchor --- (front 3 sentences must have a number)
  // Confidence-aware: downgrade to warning when hookStrategy is a guess
  const hasDataAnchor = hookHasDataAnchor(sentences);
  const hookStrategyConf = confidence['hookStrategy'];
  if (!hasDataAnchor && actualSentenceCount >= 3) {
    if (hookStrategyConf === 'guess') {
      warnings.push('Hook 缺少数据锚点: 前 3 句未包含数字/数据 (hookStrategy 置信度低, 降级为警告)');
    } else {
      errors.push('Hook 缺少数据锚点: 前 3 句未包含任何数字/数据, 科普视频开头需要反直觉数据吸引注意力');
    }
  }

  // --- C2: Cliffhanger / suspense ---
  const cliffhangers = countCliffhangers(sentences);
  if (cliffhangers < thresholds.cliffhangerErrorMin && actualSentenceCount >= 6) {
    errors.push(`悬念缺失: 全文 ${cliffhangers} 处悬念句 (问句/省略号), 观众留存无保障`);
  } else if (cliffhangers < thresholds.cliffhangerWarnMin && actualSentenceCount >= 6) {
    warnings.push(`悬念推进不足: 仅 ${cliffhangers} 处悬念句 (问句/省略号), 建议 ≥ ${thresholds.cliffhangerWarnMin} 处保持观众留存`);
  }

  // --- C3: Information density ---
  const deduplicationRate = ngramDeduplicationRate(scriptOutput.scriptText, language);
  if (deduplicationRate < thresholds.deduplicationErrorMin) {
    errors.push(`信息密度过低: 4-gram 去重率 ${(deduplicationRate * 100).toFixed(1)}% < ${(thresholds.deduplicationErrorMin * 100).toFixed(0)}%, 存在大量重复表述`);
  } else if (deduplicationRate < thresholds.deduplicationWarnMin) {
    warnings.push(`信息密度偏低: 4-gram 去重率 ${(deduplicationRate * 100).toFixed(1)}%, 建议 ≥ ${(thresholds.deduplicationWarnMin * 100).toFixed(0)}%`);
  }

  // --- C4: Sentence rhythm variance ---
  const rhythmCV = sentenceLengthVariance(sentenceLengths);
  if (rhythmCV < thresholds.rhythmCVErrorMin && actualSentenceCount >= 6) {
    errors.push(`句长严重均匀 (CV=${rhythmCV.toFixed(2)} < ${thresholds.rhythmCVErrorMin.toFixed(2)}): 无长短句交替, TTS 输出机械单调`);
  } else if (rhythmCV < thresholds.rhythmCVWarnMin && actualSentenceCount >= 6) {
    warnings.push(`句长过于均匀 (CV=${rhythmCV.toFixed(2)}): 缺乏长短句交替的节奏变化, TTS 听感机械`);
  }

  // --- C5: Repetition detection ---
  const repeatedNgrams = countRepeatedNgrams(scriptOutput.scriptText, language);
  if (repeatedNgrams > thresholds.repeatedNgramErrorMax) {
    errors.push(`过度重复: ${repeatedNgrams} 个 4-gram 出现 ≥ 3 次, 请精简重复表述`);
  } else if (repeatedNgrams > thresholds.repeatedNgramWarnMax) {
    warnings.push(`轻微重复: ${repeatedNgrams} 个 4-gram 出现 ≥ 3 次`);
  }

  // --- C6: Emotional arc progression --- (middle third must exceed first third)
  const emotionalArc = emotionalArcProgression(sentences);
  if (!emotionalArc.passes && actualSentenceCount >= 6) {
    errors.push(`情感弧线平坦: 中段情感密度 (${emotionalArc.middleDensity.toFixed(2)}%) ≤ 开头 (${emotionalArc.firstDensity.toFixed(2)}%), 缺乏 tension → climax 的递进`);
  }

  // --- C7: Curiosity gap density ---
  // Confidence-aware: widen thresholds when hookStrategy is guess (curiosity gaps
  // are retention beats that relate to the overall engagement strategy)
  const curiosityGaps = countCuriosityGaps(sentences);
  const curiosityGapErrorPerSentences = hookStrategyConf === 'guess'
    ? thresholds.curiosityGapErrorPerSentences + 2  // relax: 1 per 7 instead of 1 per 5
    : thresholds.curiosityGapErrorPerSentences;
  const curiosityGapWarnPerSentences = hookStrategyConf === 'guess'
    ? thresholds.curiosityGapWarnPerSentences + 2
    : thresholds.curiosityGapWarnPerSentences;
  const minGapsError = Math.floor(actualSentenceCount / curiosityGapErrorPerSentences);
  const minGapsWarn = Math.floor(actualSentenceCount / curiosityGapWarnPerSentences);
  if (curiosityGaps < minGapsError && actualSentenceCount >= 6) {
    errors.push(`留存钩子不足: ${curiosityGaps} 处前瞻悬念句, 需要至少 ${minGapsError} 处 (每 5 句至少 1 处), 观众中途流失风险高`);
  } else if (curiosityGaps < minGapsWarn && actualSentenceCount >= 6) {
    warnings.push(`留存钩子偏少: ${curiosityGaps} 处前瞻悬念句, 建议 ≥ ${minGapsWarn} 处 (每 4 句 1 处)`);
  }

  // --- C8: Fact source marker density ---
  const sourceAnalysis = sourceMarkerAnalysis(sentences);
  if (sourceAnalysis.numericSentenceCount > 0 && sourceAnalysis.ratio < thresholds.sourceMarkerErrorMin) {
    errors.push(`事实来源标注不足: ${sourceAnalysis.markedCount}/${sourceAnalysis.numericSentenceCount} (${(sourceAnalysis.ratio * 100).toFixed(0)}%) 的数据句有来源标注, 需要 ≥ ${(thresholds.sourceMarkerErrorMin * 100).toFixed(0)}%, 降低可信度`);
  } else if (sourceAnalysis.numericSentenceCount > 0 && sourceAnalysis.ratio < thresholds.sourceMarkerWarnMin) {
    warnings.push(`事实来源标注偏少: ${sourceAnalysis.markedCount}/${sourceAnalysis.numericSentenceCount} (${(sourceAnalysis.ratio * 100).toFixed(0)}%) 的数据句有来源标注, 建议 ≥ ${(thresholds.sourceMarkerWarnMin * 100).toFixed(0)}%`);
  }

  // --- C12: Disputed / low-confidence fact filter ---
  if (facts && facts.length > 0 && scriptOutput.usedFactIDs?.length) {
    const factMap = new Map(facts.map(f => [f.id, f]));
    for (const factId of scriptOutput.usedFactIDs) {
      const fact = factMap.get(factId);
      if (!fact) continue;
      if (fact.type === 'disputed') {
        errors.push(`争议事实引用: ${factId} 已标记为 disputed (置信度 ${fact.aggConfidence}), 不得用于脚本`);
      } else if (fact.aggConfidence < 0.5) {
        warnings.push(`低置信度事实引用: ${factId} 置信度仅 ${fact.aggConfidence}, 建议替换为高置信度事实`);
      }
    }
  }

  // --- C13: Plagiarism / transcript regurgitation check ---
  const referenceTranscript = styleCIR.computed.fullTranscript;
  let transcriptOverlapRatio = 0;
  if (referenceTranscript && referenceTranscript.length > 20) {
    const scriptGrams = new Set(extractNgrams(scriptOutput.scriptText, 4, language));
    const refGrams = extractNgrams(referenceTranscript, 4, language);
    if (scriptGrams.size > 0 && refGrams.length > 0) {
      const overlapCount = refGrams.filter(g => scriptGrams.has(g)).length;
      transcriptOverlapRatio = overlapCount / scriptGrams.size;
    }
    if (transcriptOverlapRatio > 0.15) {
      errors.push(`原文照搬: 脚本与参考转录的 4-gram 重叠率 ${(transcriptOverlapRatio * 100).toFixed(1)}% > 15%, 需要原创改写而非复制`);
    } else if (transcriptOverlapRatio > 0.10) {
      warnings.push(`原文相似度偏高: 与参考转录的 4-gram 重叠率 ${(transcriptOverlapRatio * 100).toFixed(1)}%, 建议进一步改写`);
    }
  }

  const validationResult: ScriptValidationResult = {
    passed: errors.length === 0,
    errors,
    warnings,
    classifiedErrors: [], // populated after C9–C13 checks
    metrics: {
      actualWordCount,
      targetWordCountMin: targetMin,
      targetWordCountMax: targetMax,
      actualSentenceCount,
      targetSentenceCount: targetSceneCount,
      factReferenceCount,
      maxSentenceLength,
      maxSentenceLengthLimit,
      metaphorCount: actualMetaphorCount,
      shortSentenceCount: shortSentences.length,
      hookHasDataAnchor: hasDataAnchor,
      cliffhangerCount: cliffhangers,
      ngramDeduplicationRate: deduplicationRate,
      sentenceLengthVariance: rhythmCV,
      repeatedNgramCount: repeatedNgrams,
      emotionalArcPasses: emotionalArc.passes,
      curiosityGapCount: curiosityGaps,
      sourceMarkerRatio: sourceAnalysis.ratio,
      transcriptOverlapRatio,
      rhythmCorrelation: null as number | null,
      hookStructureMatch: null as boolean | null,
      closingStructureMatch: null as boolean | null,
    },
  };

  // --- C9/C10/C11: FormatSignature-aware checks (only when signature is available) ---
  if (formatSignature != null) {
    // C9: Rhythm correlation
    if (formatSignature.sentenceLengthSequence.length >= 3 && sentenceLengths.length >= 3) {
      const correlation = pearsonCorrelation(sentenceLengths, formatSignature.sentenceLengthSequence);
      validationResult.metrics.rhythmCorrelation = correlation;
      if (correlation < thresholds.rhythmCorrelationErrorMin) {
        errors.push(`句长节奏偏离: 与系列签名的 Pearson 相关系数 ${correlation.toFixed(2)} < ${thresholds.rhythmCorrelationErrorMin.toFixed(2)}, 节奏模式不匹配`);
      } else if (correlation < thresholds.rhythmCorrelationWarnMin) {
        warnings.push(`句长节奏偏弱: 与系列签名的 Pearson 相关系数 ${correlation.toFixed(2)}, 建议 ≥ ${thresholds.rhythmCorrelationWarnMin.toFixed(2)}`);
      }
    }

    // C10: Hook structure match
    if (formatSignature.hookTemplate) {
      const hookMatch = hookStructureMatches(sentences, formatSignature.hookTemplate);
      validationResult.metrics.hookStructureMatch = hookMatch;
      if (!hookMatch) {
        errors.push(`Hook 结构不符: 未匹配系列签名模板「${formatSignature.hookTemplate}」, 开头需遵循相同结构模式`);
      }
    }

    // C11: Closing structure match
    if (formatSignature.closingTemplate) {
      const closingMatch = closingStructureMatches(sentences, formatSignature.closingTemplate);
      validationResult.metrics.closingStructureMatch = closingMatch;
      if (!closingMatch) {
        errors.push(`结尾结构不符: 未匹配系列签名模板「${formatSignature.closingTemplate}」, 收尾需遵循相同结构模式`);
      }
    }

    // Re-evaluate passed status after C9/C10/C11
    validationResult.passed = errors.length === 0;
  }

  // Build classified errors from all errors + warnings
  validationResult.classifiedErrors = [
    ...errors.map(msg => classifyMessage(msg, 'error')),
    ...warnings.map(msg => classifyMessage(msg, 'warning')),
  ];

  return validationResult;
}

/* ---- Error classification patterns ---- */

/** Map a validation message to a structured ClassifiedError by pattern matching. */
function classifyMessage(msg: string, severity: 'error' | 'warning'): ClassifiedError {
  // C0: Word count / sentence count / sentence length / short sentences / metaphor / fact count
  if (/字数|word.?count/i.test(msg))
    return { code: 'C0', class: 'structural', severity, message: msg };
  if (/句数|最长句|过短句子/i.test(msg))
    return { code: 'C0', class: 'structural', severity, message: msg };
  if (/隐喻|metaphor/i.test(msg))
    return { code: 'C0', class: 'structural', severity, message: msg };
  if (/事实引用不足/i.test(msg))
    return { code: 'C0', class: 'structural', severity, message: msg };
  // C1: Hook data anchor
  if (/数据锚点|Hook.*数据|data.?anchor/i.test(msg))
    return { code: 'C1', class: 'structural', severity, message: msg };
  // C2: Cliffhanger / suspense
  if (/悬念/i.test(msg))
    return { code: 'C2', class: 'quality', severity, message: msg };
  // C3: Information density
  if (/信息密度|去重率/i.test(msg))
    return { code: 'C3', class: 'quality', severity, message: msg };
  // C4: Rhythm variance
  if (/句长.*均匀|CV=/i.test(msg))
    return { code: 'C4', class: 'quality', severity, message: msg };
  // C5: Repetition
  if (/重复.*4-gram|4-gram.*重复/i.test(msg))
    return { code: 'C5', class: 'quality', severity, message: msg };
  // C6: Emotional arc
  if (/情感弧线|emotional.?arc/i.test(msg))
    return { code: 'C6', class: 'quality', severity, message: msg };
  // C7: Curiosity gap
  if (/留存钩子|curiosity.?gap/i.test(msg))
    return { code: 'C7', class: 'quality', severity, message: msg };
  // C8: Fact source markers
  if (/来源标注/i.test(msg))
    return { code: 'C8', class: 'quality', severity, message: msg };
  // C9: Rhythm correlation
  if (/句长节奏|Pearson.*相关/i.test(msg))
    return { code: 'C9', class: 'format', severity, message: msg };
  // C10: Hook structure
  if (/Hook.*结构不符/i.test(msg))
    return { code: 'C10', class: 'format', severity, message: msg };
  // C11: Closing structure
  if (/结尾结构不符/i.test(msg))
    return { code: 'C11', class: 'format', severity, message: msg };
  // C12: Disputed facts
  if (/争议事实|低置信度事实/i.test(msg))
    return { code: 'C12', class: 'contamination', severity, message: msg };
  // C13: Plagiarism
  if (/原文照搬|原文相似度|重叠率/i.test(msg))
    return { code: 'C13', class: 'contamination', severity, message: msg };
  // Fallback
  return { code: 'C?', class: 'quality', severity, message: msg };
}
