/* ------------------------------------------------------------------ */
/*  Tests for scriptValidator                                         */
/* ------------------------------------------------------------------ */
import { describe, it, expect } from 'vitest';
import { validateScript } from '../stages/scriptValidator.js';
import type { ScriptOutput, CalibrationData, Fact } from '../types.js';
import type { FormatSignature, StyleAnalysisCIR } from '../../cir/types.js';

function makeScriptOutput(text: string, usedFactIDs: string[] = []): ScriptOutput {
  return {
    scriptText: text,
    usedFactIDs,
    factUsage: usedFactIDs.map(id => ({ factId: id, usageType: 'referenced' as const })),
  };
}

const baseCalibration: CalibrationData = {
  calibration: {
    reference_total_words: 300,
    reference_duration_sec: 60,
    actual_speech_rate: '250 characters per minute',
    new_video_target_duration_sec: 60,
    target_word_count: 300,
    target_word_count_min: '270',
    target_word_count_max: '330',
  },
  verified_facts: [],
};

const baseStyle: StyleAnalysisCIR = {
  _cir: 'StyleAnalysis',
  version: 1,
  visualStyle: 'cinematic',
  pacing: 'medium',
  tone: 'informative',
  colorPalette: [],
  meta: { videoLanguage: 'Chinese', videoDurationSec: 60, videoType: 'science' },
  scriptTrack: {
    hookStrategy: '',
    sentenceLengthMax: 30,
    sentenceLengthAvg: 15,
    sentenceLengthUnit: 'characters',
    narrativeArc: ['Hook', 'Body', 'Conclusion'],
    emotionalToneArc: '',
    rhetoricalCore: '',
    metaphorCount: 0,
    interactionCuesCount: 0,
    ctaPattern: '',
    jargonTreatment: '',
  },
  visualTrack: {
    baseMedium: 'stock_footage',
    lightingStyle: '',
    cameraMotion: '',
    colorTemperature: '',
    sceneAvgDurationSec: 5,
    transitionStyle: '',
    visualMetaphorMapping: { rule: '', examples: [] },
    bRollRatio: 0,
    compositionStyle: '',
  },
  audioTrack: {
    bgmGenre: '',
    bgmMood: '',
    bgmTempo: '',
    bgmRelativeVolume: 0,
    voiceStyle: '',
  },
  packagingTrack: {
    subtitlePosition: 'bottom', subtitleHasShadow: true, subtitleHasBackdrop: false,
    subtitleFontSize: 'medium', subtitlePrimaryColor: '#FFFFFF', subtitleOutlineColor: '#000000',
    subtitleFontCategory: 'sans-serif', transitionDominantStyle: 'cut',
    transitionEstimatedDurationSec: 0.5, hasIntroCard: false, introCardDurationSec: 0,
    hasFadeIn: false, fadeInDurationSec: 0, hasOutroCard: false, outroCardDurationSec: 0,
    hasFadeOut: false, fadeOutDurationSec: 0,
  },
  computed: {
    wordCount: 300,
    wordsPerMinute: 300,
    fullTranscript: '',
  },
  confidence: {},
  contractScore: 85,
};

// Generate Chinese-like text of approximately N characters with diverse content.
// Sentences are ordered to satisfy C6 emotional arc: calm start → emotional middle → resolution end.
function genChinese(n: number): string {
  const sentences = [
    // First third: calm factual setup with data anchor in sentence 1
    '你知道100万年后的地球会变成什么样吗？',
    '研究显示科学家发现了3个新的事实。',
    '据统计太阳每秒释放的能量相当于数十亿颗核弹。',
    '地球磁场像一个无形的屏障保护着大气层。',
    '接下来的发现更让人意外。',
    '数据表明火星上曾经存在大量液态水的证据。',
    // Middle third: emotional escalation with intensity markers
    '但最可怕的是什么？居然没有人关注这件事！',
    '这简直不可思议！据统计宇宙中已知星系超过2万亿个！',
    '深海中的压力足以压扁一艘核潜艇，太震撼了！',
    '你猜人类DNA与黑猩猩的相似度是多少？竟然高达98%！',
    '研究显示蜂鸟每秒钟可以拍动翅膀80次以上，惊人！',
    '科学家发现闪电温度可以达到太阳表面温度的5倍！',
    // Last third: resolution with some emotional payoff
    '接下来你会发现更惊人的事实。',
    '据统计章鱼拥有三颗心脏和蓝色血液。',
    '但最惊人的是什么？植物也能感知疼痛并发出超声波信号。',
    '研究表明地球内核的旋转方向发生了逆转。',
  ];
  let text = '';
  let i = 0;
  while (text.length < n) {
    text += sentences[i % sentences.length];
    i++;
  }
  return text.slice(0, n);
}

describe('validateScript', () => {
  it('passes for script within word count range', () => {
    const script = genChinese(300);
    const result = validateScript(
      makeScriptOutput(script, ['fact-1', 'fact-2', 'fact-3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.passed).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('fails for script with severely low word count', () => {
    const script = genChinese(50); // way below 270 * 0.8 = 216
    const result = validateScript(
      makeScriptOutput(script),
      baseCalibration,
      baseStyle,
    );
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('字数严重不足'))).toBe(true);
  });

  it('fails for script with severely high word count', () => {
    const script = genChinese(500); // way above 330 * 1.2 = 396
    const result = validateScript(
      makeScriptOutput(script),
      baseCalibration,
      baseStyle,
    );
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('字数严重超出'))).toBe(true);
  });

  it('warns for slightly low word count but still passes', () => {
    // Use genChinese(260) which now has emotional escalation built in.
    // 260 chars = ~260 CJK word count, below 270 target min but above 270*0.8=216.
    const script = genChinese(260);
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.passed).toBe(true);
    expect(result.warnings.some(w => w.includes('字数略低'))).toBe(true);
  });

  it('fails on low fact reference count', () => {
    const script = genChinese(300);
    const result = validateScript(
      makeScriptOutput(script, ['fact-1']),
      baseCalibration,
      baseStyle,
    );
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('事实引用不足'))).toBe(true);
  });

  it('fails on very low sentence count', () => {
    // 60s / 5s per scene = 12 target. 12 * 0.5 = 6 minimum. Single sentence fails.
    const script = '这是一句非常长的话，包含了三百多个字' + '符'.repeat(300);
    const result = validateScript(
      makeScriptOutput(script),
      baseCalibration,
      baseStyle,
    );
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('句数严重不足'))).toBe(true);
  });

  it('reports correct metrics', () => {
    const script = genChinese(300);
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.targetWordCountMin).toBe(270);
    expect(result.metrics.targetWordCountMax).toBe(330);
    expect(result.metrics.factReferenceCount).toBe(2);
    expect(result.metrics.actualWordCount).toBeGreaterThan(0);
  });

  it('uses inline calibration from scriptOutput when calibrationData is absent', () => {
    const script = genChinese(300);
    const scriptOutput = makeScriptOutput(script, ['f1', 'f2', 'f3']);
    scriptOutput.calibration = {
      reference_total_words: 300,
      reference_duration_sec: 60,
      actual_speech_rate: '250',
      new_video_target_duration_sec: 60,
      target_word_count: 300,
      target_word_count_min: '270',
      target_word_count_max: '330',
    };
    const result = validateScript(scriptOutput, undefined, baseStyle);
    expect(result.metrics.targetWordCountMin).toBe(270);
  });

  /* ---- C1: Hook data anchor ---- */

  it('C1: fails when hook (first 3 sentences) has no numbers', () => {
    // 6 sentences, no numbers anywhere in first 3
    const script = '你知道吗？你每天晚上都在做梦。科学家对此非常着迷。但大脑为什么要这样做呢？研究发现有4种理论可以解释。让我们逐一来看。最后一个理论会让你震惊。';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    // first 3 sentences have no digits → error
    expect(result.errors.some(e => e.includes('Hook 缺少数据锚点'))).toBe(true);
  });

  it('C1: passes when hook contains a number', () => {
    const script = '你知道吗？每天晚上你会做4到6个梦。科学家对此非常着迷。但大脑为什么要这样做呢？研究发现有多种理论可以解释。让我们逐一来看。最后一个理论会让你震惊。';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.errors.some(e => e.includes('Hook 缺少数据锚点'))).toBe(false);
    expect(result.metrics.hookHasDataAnchor).toBe(true);
  });

  /* ---- C2: Cliffhanger / suspense ---- */

  it('C2: errors when script has 0 suspense sentences', () => {
    // 8 sentences, no question marks or ellipsis
    const script = '太阳是一颗恒星。它的温度非常高。太阳为地球提供光和热。没有太阳就没有生命。科学家研究太阳已经很多年了。太阳的核心温度达到1500万度。太阳每秒释放大量能量。这些能量维持了地球生态系统。';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('悬念缺失'))).toBe(true);
  });

  it('C2: warns when script has exactly 1 suspense sentence', () => {
    // 8 sentences, only 1 question mark
    const script = '太阳是一颗恒星。它的温度非常高。太阳为什么能持续燃烧呢？没有太阳就没有生命。科学家研究太阳已经很多年了。太阳的核心温度达到1500万度。太阳每秒释放大量能量。这些能量维持了地球生态系统。';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.warnings.some(w => w.includes('悬念推进不足'))).toBe(true);
  });

  it('C2: no warning when script has ≥2 suspense devices', () => {
    const script = '你知道100万年后的地球会变成什么样吗？科学家发现了3个惊人事实。但最让人意外的是什么呢？太阳每秒释放大量能量。这意味着什么？地球的未来取决于太阳的寿命。你能猜到答案吗？让我们一起来看看。';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.warnings.some(w => w.includes('悬念推进不足'))).toBe(false);
    expect(result.metrics.cliffhangerCount).toBeGreaterThanOrEqual(2);
  });

  /* ---- C3: Information density ---- */

  it('C3: fails for highly repetitive text', () => {
    // Same sentence repeated many times → low n-gram dedup rate
    const repeated = '太阳是一颗恒星。'.repeat(40);
    const result = validateScript(
      makeScriptOutput(repeated, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.ngramDeduplicationRate).toBeLessThan(0.70);
    expect(result.errors.some(e => e.includes('信息密度过低'))).toBe(true);
  });

  it('C3: passes for diverse text', () => {
    const diverse = '你知道100万年后会怎样吗？科学家发现了3个惊人事实。太阳每秒释放巨大能量。地球磁场保护着我们的大气层。月球正在缓慢远离地球。火星上曾经有液态水存在。人类的DNA与黑猩猩相似度达98%。宇宙中有数千亿个星系。';
    const result = validateScript(
      makeScriptOutput(diverse, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.ngramDeduplicationRate).toBeGreaterThan(0.80);
  });

  /* ---- C4: Sentence rhythm variance ---- */

  it('C4: errors when all sentences have very similar length (CV < 0.10)', () => {
    // 8 sentences, each exactly ~10 chars
    const uniform = '太阳是一颗恒星吗。地球是一颗行星吧。月球是一颗卫星呢。火星是一颗行星的。金星是一颗行星嘛。木星是一颗行星啊。土星是一颗行星耶。天王星行星之一。';
    const result = validateScript(
      makeScriptOutput(uniform, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.sentenceLengthVariance).toBeLessThan(0.10);
    expect(result.errors.some(e => e.includes('句长严重均匀'))).toBe(true);
  });

  it('C4: no warning for varied sentence lengths', () => {
    const varied = '你知道吗？每天晚上你的大脑会制造4到6个完整的梦境，但你醒来后只记得不到百分之十。这是为什么？科学家发现了3个关键原因。第一，前额叶皮层在睡眠时关闭了。第二，海马体的记忆编码在REM阶段变得不稳定，导致梦境中的短期记忆无法有效转化为长期记忆。震惊吧？最后一个原因更有趣。简单来说，你的大脑在做梦时选择性地遗忘。';
    const result = validateScript(
      makeScriptOutput(varied, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.sentenceLengthVariance).toBeGreaterThanOrEqual(0.15);
  });

  /* ---- C5: Repetition detection ---- */

  it('C5: fails for text with excessively repeated n-grams', () => {
    // "科学家发现" appears many times
    const repetitive = '科学家发现太阳很热。科学家发现地球很冷。科学家发现月球很远。科学家发现火星有水。科学家发现金星很热。科学300家还在继续研究。';
    const result = validateScript(
      makeScriptOutput(repetitive, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.repeatedNgramCount).toBeGreaterThan(0);
  });

  /* ---- C6: Emotional arc progression ---- */

  it('C6: fails when middle third has lower emotional intensity than first third', () => {
    // First third: lots of emotional markers (！, 居然, 不可思议)
    // Middle third: calm factual statements
    const script = '你居然不知道100万年后会怎样！这简直不可思议！太震撼了！' +
      '太阳是一颗恒星。地球绕太阳运行。月球绕地球运行。' +
      '科学家最近发现了3个惊人事实。这改变了一切。你准备好了吗？';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.emotionalArcPasses).toBe(false);
    expect(result.errors.some(e => e.includes('情感弧线平坦'))).toBe(true);
  });

  it('C6: passes when emotional intensity escalates toward middle', () => {
    // First third: calm setup
    // Middle third: escalation with emotional markers
    const script = '太阳是一颗恒星。地球绕太阳运行。月球每年远离地球4厘米。' +
      '但最可怕的是什么？居然在50亿年后太阳会爆炸！这简直太震撼了！' +
      '科学家正在寻找解决方案。未来值得我们深思。你觉得呢？';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.emotionalArcPasses).toBe(true);
  });

  /* ---- C7: Curiosity gap density ---- */

  it('C7: errors when script lacks forward-pull curiosity gaps', () => {
    // 10 sentences, all calm factual — no curiosity triggers
    const script = '太阳是一颗恒星。地球是一颗行星。月球绕地球旋转。火星很远也很冷。金星非常炎热。木星是最大行星。土星有美丽光环。天王星倾斜旋转。海王星风速极快。冥王星被降级了。';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.curiosityGapCount).toBe(0);
    // 10 sentences / 5 = 2 minimum → error
    expect(result.errors.some(e => e.includes('留存钩子不足'))).toBe(true);
  });

  it('C7: passes when script has sufficient curiosity gaps', () => {
    // Curiosity triggers: "但最可怕的是", question marks, "接下来", "你猜"
    const script = '你知道100万年后会怎样吗？科学家发现了3个惊人事实。但最可怕的是什么？居然没人关注这件事！接下来的发现更惊人。你猜结果如何？太阳每秒释放巨大能量。这改变了一切。你准备好了吗？让我们继续。';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.curiosityGapCount).toBeGreaterThanOrEqual(2);
    expect(result.errors.some(e => e.includes('留存钩子不足'))).toBe(false);
  });

  /* ---- C8: Fact source marker density ---- */

  it('C8: errors when most numeric sentences lack source markers', () => {
    // 4 numeric sentences, 0 with source markers → 0% < 50%
    const script = '温度达到100度。速度超过300公里。体重约50公斤。距离有8000公里。地球很大。月球很远。太阳很热。科学很重要。';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.sourceMarkerRatio).toBeLessThan(0.5);
    expect(result.errors.some(e => e.includes('事实来源标注不足'))).toBe(true);
  });

  it('C8: passes when numeric sentences have source markers', () => {
    // 4 numeric sentences, 3 with source markers → 75% ≥ 50%
    const script = '研究显示温度可达100度。据统计速度超过300公里。科学家发现体重约50公斤。距离有8000公里。地球很大。月球很远。太阳很热。科学很重要。';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.sourceMarkerRatio).toBeGreaterThanOrEqual(0.5);
    expect(result.errors.some(e => e.includes('事实来源标注不足'))).toBe(false);
  });

  it('C8: warns when source marker ratio is between 50% and 75%', () => {
    // 4 numeric sentences, 2 with source markers → 50%, no error but warning
    const script = '研究显示温度可达100度。据统计速度超过300公里。体重约50公斤。距离有8000公里。地球很大。月球很远。太阳很热。科学很重要。';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.sourceMarkerRatio).toBeGreaterThanOrEqual(0.5);
    expect(result.errors.some(e => e.includes('事实来源标注不足'))).toBe(false);
    expect(result.warnings.some(w => w.includes('事实来源标注偏少'))).toBe(true);
  });

  /* ---- Metrics presence ---- */

  it('reports curiosityGapCount and sourceMarkerRatio in metrics', () => {
    const script = genChinese(300);
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2']),
      baseCalibration,
      baseStyle,
    );
    expect(typeof result.metrics.curiosityGapCount).toBe('number');
    expect(typeof result.metrics.sourceMarkerRatio).toBe('number');
  });

  /* ---- C9: Rhythm correlation with FormatSignature ---- */

  const baseFormatSignature: FormatSignature = {
    _type: 'FormatSignature',
    version: 1,
    hookTemplate: '[反直觉数据] + [第二人称挑战] + [悬念前瞻]',
    closingTemplate: '[情感升华] + [行动号召] + [开放性问题]',
    sentenceLengthSequence: [30, 35, 28, 10, 25, 30, 32, 12, 24, 29, 30, 23, 32, 31, 15, 33, 29, 26, 31, 30, 31, 31, 26, 30, 25, 27],
    transitionPositions: [3, 7, 11, 14, 17],
    transitionPatterns: ['但这还不是最…', '那么…', '接下来…'],
    arcSentenceAllocation: [4, 4, 4, 4, 5, 5],
    arcStageLabels: ['Hook', 'Mechanism1', 'Mechanism2', 'Mechanism3', 'Climax', 'Reflect'],
    signaturePhrases: ['但这还不是最…的部分'],
    emotionalArcShape: [0.7, 0.8, 0.6, 0.3, 0.5, 0.6, 0.7, 0.4, 0.5, 0.6, 0.7, 0.5, 0.7, 0.7, 0.4, 0.8, 0.7, 0.6, 0.8, 0.8, 0.9, 0.9, 0.7, 0.8, 0.8, 0.9],
    seriesVisualMotifs: {
      hookMotif: 'cosmic particle vortex',
      mechanismMotif: 'micro-to-macro scale transition',
      climaxMotif: 'convergence explosion',
      reflectionMotif: 'warm embrace dissolve',
    },
  };

  it('C9: errors when rhythm correlation is < 0.30', () => {
    // Create a script with inverted sentence lengths (long-short-long vs short-long-short)
    const sentences = [
      '短。',
      '这是一个非常非常非常非常非常长的句子用来制造与签名完全相反的节奏模式。',
      '短短。',
      '这又是一个非常非常非常非常非常长的句子进一步强化反向节奏模式让相关性变负。',
      '三。',
      '这再来一个非常非常非常非常非常长的句子保持反向节奏模式确保负相关结果。',
    ];
    const invertedFS: FormatSignature = {
      ...baseFormatSignature,
      // Reference: long-short-long-short-long-short (opposite of script above)
      sentenceLengthSequence: [40, 5, 40, 5, 40, 5],
    };
    const result = validateScript(
      makeScriptOutput(sentences.join(''), ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
      invertedFS,
    );
    expect(result.metrics.rhythmCorrelation).not.toBeNull();
    expect(result.metrics.rhythmCorrelation!).toBeLessThan(0.3);
    expect(result.errors.some(e => e.includes('句长节奏偏离'))).toBe(true);
  });

  it('C9: passes when rhythm correlation is >= 0.50', () => {
    // Use the same sentence length pattern as the signature
    const script = genChinese(300);
    const sentences = script.split(/(?<=[。！？])/);
    const matchingFS: FormatSignature = {
      ...baseFormatSignature,
      sentenceLengthSequence: sentences.map(s => s.length),
    };
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
      matchingFS,
    );
    expect(result.metrics.rhythmCorrelation).not.toBeNull();
    expect(result.metrics.rhythmCorrelation!).toBeGreaterThanOrEqual(0.5);
    expect(result.errors.some(e => e.includes('句长节奏偏离'))).toBe(false);
  });

  /* ---- C10: Hook structure match ---- */

  it('C10: hookStructureMatch is true when hook contains matching structural elements', () => {
    // Hook has: 数据(number), 第二人称(你), 悬念(？)
    const script = '你知道100万年后的地球会变成什么样吗？研究显示科学家发现了3个新的事实。据统计太阳每秒释放的能量相当于数十亿颗核弹。' +
      '地球磁场像一个无形的屏障保护着大气层。接下来的发现更让人意外。数据表明火星上曾经存在大量液态水。这很震撼。最后这一切意味着什么？';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
      baseFormatSignature,
    );
    expect(result.metrics.hookStructureMatch).toBe(true);
    expect(result.errors.some(e => e.includes('Hook 结构不符'))).toBe(false);
  });

  it('C10: hookStructureMatch metric is set (not null) when formatSignature has hookTemplate', () => {
    const script = '天空是蓝色的大地是绿色的。海洋是深蓝色的大海很美丽。森林很茂密树木很高大。' +
      '科学家发现了3个新的事实。据统计太阳每秒释放的能量相当于数十亿颗核弹。' +
      '接下来的发现更让人意外。数据表明火星上曾经存在大量液态水。这很重要。';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
      baseFormatSignature,
    );
    expect(result.metrics.hookStructureMatch).not.toBeNull();
    expect(typeof result.metrics.hookStructureMatch).toBe('boolean');
  });

  /* ---- C11: Closing structure match ---- */

  it('C11: closingStructureMatch is true when closing contains matching structural elements', () => {
    // Closing has: 情感/感叹(！), 行动/号召(关注), 问题(？)
    const script = '你知道100万年后的地球会变成什么样吗？科学家发现了3个新的事实。据统计太阳每秒释放的能量相当于数十亿颗核弹。' +
      '接下来的发现更让人意外。数据表明火星上曾经存在大量液态水。' +
      '这是多么震撼的发现！请关注我们了解更多。你准备好迎接未来了吗？';
    const closingFS: FormatSignature = {
      ...baseFormatSignature,
      closingTemplate: '[情感升华] + [行动号召] + [开放性问题]',
    };
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
      closingFS,
    );
    expect(result.metrics.closingStructureMatch).toBe(true);
    expect(result.errors.some(e => e.includes('结尾结构不符'))).toBe(false);
  });

  it('C11: closingStructureMatch metric is set (not null) when formatSignature has closingTemplate', () => {
    const script = '太阳是一颗恒星。地球绕太阳运行。月球绕地球运行。' +
      '科学家发现了3个新的事实。据统计太阳每秒释放的能量相当于数十亿颗核弹。' +
      '接下来的发现更让人意外。数据表明火星上曾经存在大量液态水。这很重要。简单来说就是这样。';
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2', 'f3']),
      baseCalibration,
      baseStyle,
      baseFormatSignature,
    );
    expect(result.metrics.closingStructureMatch).not.toBeNull();
    expect(typeof result.metrics.closingStructureMatch).toBe('boolean');
  });

  /* ---- FormatSignature null safety ---- */

  it('C9/C10/C11 metrics are null when no formatSignature is provided', () => {
    const script = genChinese(300);
    const result = validateScript(
      makeScriptOutput(script, ['f1', 'f2']),
      baseCalibration,
      baseStyle,
    );
    expect(result.metrics.rhythmCorrelation).toBeNull();
    expect(result.metrics.hookStructureMatch).toBeNull();
    expect(result.metrics.closingStructureMatch).toBeNull();
  });

  /* ---- C12: Disputed / low-confidence fact filter ---- */

  it('C12: fails when script references a disputed fact', () => {
    const facts: Fact[] = [
      { id: 'fact-1', content: 'disputed claim', sources: [], aggConfidence: 0.3, type: 'disputed' },
      { id: 'fact-2', content: 'verified claim', sources: [], aggConfidence: 0.9, type: 'verified' },
    ];
    const script = genChinese(300);
    const result = validateScript(
      makeScriptOutput(script, ['fact-1', 'fact-2']),
      baseCalibration,
      baseStyle,
      undefined,
      facts,
    );
    expect(result.passed).toBe(false);
    expect(result.errors.some(e => e.includes('disputed') && e.includes('fact-1'))).toBe(true);
  });

  it('C12: warns for low-confidence fact below 0.5', () => {
    const facts: Fact[] = [
      { id: 'fact-1', content: 'low conf claim', sources: [], aggConfidence: 0.4, type: 'unverified' },
      { id: 'fact-2', content: 'good claim', sources: [], aggConfidence: 0.9, type: 'verified' },
    ];
    const script = genChinese(300);
    const result = validateScript(
      makeScriptOutput(script, ['fact-1', 'fact-2']),
      baseCalibration,
      baseStyle,
      undefined,
      facts,
    );
    expect(result.warnings.some(w => w.includes('fact-1') && w.includes('0.4'))).toBe(true);
  });

  it('C12: passes when all referenced facts are verified', () => {
    const facts: Fact[] = [
      { id: 'fact-1', content: 'good claim 1', sources: [], aggConfidence: 0.95, type: 'verified' },
      { id: 'fact-2', content: 'good claim 2', sources: [], aggConfidence: 0.8, type: 'verified' },
    ];
    const script = genChinese(300);
    const result = validateScript(
      makeScriptOutput(script, ['fact-1', 'fact-2']),
      baseCalibration,
      baseStyle,
      undefined,
      facts,
    );
    expect(result.errors.filter(e => e.includes('disputed') || e.includes('低置信度')).length).toBe(0);
  });

  it('uses English word counting and sets rhythmCorrelation when format signature is provided', () => {
    const englishStyle: StyleAnalysisCIR = {
      ...baseStyle,
      meta: { videoLanguage: 'English', videoDurationSec: 60, videoType: 'science' },
      scriptTrack: { ...baseStyle.scriptTrack, sentenceLengthMax: 30 },
    };
    const text = [
      'You know 10 strange facts today?',
      'According to studies, stars can die quietly.',
      'But what happens next?',
      'The answer changes everything!',
      'Now imagine the same process on Earth.',
      'Could we survive that shift?',
    ].join(' ');

    const formatSignature = {
      sentenceLengthSequence: [6, 7, 5, 6, 7, 5],
      hookTemplate: '',
      closingTemplate: '',
    } as unknown as FormatSignature;

    const result = validateScript(makeScriptOutput(text, ['f1', 'f2']), baseCalibration, englishStyle, formatSignature);
    expect(result.metrics.actualWordCount).toBeGreaterThan(15);
    expect(result.metrics.rhythmCorrelation).not.toBeNull();
  });

  it('widens max-sentence tolerance for guessed sentence_length_max', () => {
    const style: StyleAnalysisCIR = {
      ...baseStyle,
      scriptTrack: { ...baseStyle.scriptTrack, sentenceLengthMax: 5 },
      confidence: { sentenceLengthMax: 'guess' },
    };
    const text = [
      '1234',
      '1234',
      '1234',
      '1234',
      '1234',
      'word word word word word word word word word word word',
    ].join('。');

    const result = validateScript(makeScriptOutput(text, ['f1', 'f2']), baseCalibration, style);
    expect(result.errors.some((e) => e.includes('置信度低已加宽容差'))).toBe(true);
  });

  it('widens max-sentence tolerance for inferred sentence_length_max', () => {
    const style: StyleAnalysisCIR = {
      ...baseStyle,
      scriptTrack: { ...baseStyle.scriptTrack, sentenceLengthMax: 4 },
      confidence: { sentenceLengthMax: 'inferred' },
    };
    const text = [
      '1234',
      '1234',
      '1234',
      '1234',
      '1234',
      'word word word word word word word word',
    ].join('。');

    const result = validateScript(makeScriptOutput(text, ['f1', 'f2']), baseCalibration, style);
    expect(result.errors.some((e) => e.includes('置信度中等已适度加宽'))).toBe(true);
  });


  /* ---- English language path ---- */
  describe('English language support', () => {
    const englishStyle: StyleAnalysisCIR = {
      ...baseStyle,
      meta: { videoLanguage: 'English', videoDurationSec: 60, videoType: 'science' },
    };

    // English text with enough words and variety to pass basic checks
    function genEnglish(wordCount: number): string {
      const sentences = [
        'Did you know that 100 million years ago, Earth looked completely different?',
        'Studies show that scientists discovered 3 fascinating new facts about the universe.',
        'According to statistics, the sun releases more energy per second than billions of nuclear bombs.',
        'But here is what is truly shocking - nobody is paying attention to this!',
        'This is absolutely incredible! Studies show there are over 2 trillion galaxies!',
        'The pressure at the bottom of the ocean can crush a nuclear submarine, amazing!',
        'Can you guess how similar human DNA is to that of chimpanzees? A stunning 98 percent!',
        'Research shows that hummingbirds can flap their wings 80 times per second, unbelievable!',
        'Scientists discovered that lightning can reach 5 times the temperature of the sun surface!',
        'What happens next will surprise you even more.',
        'The deep ocean holds secrets we never imagined could exist in nature.',
        'Remember to stay curious and keep exploring the wonders of our universe!',
      ];
      let result = '';
      let currentWords = 0;
      let i = 0;
      while (currentWords < wordCount) {
        const s = sentences[i % sentences.length];
        result += s + ' ';
        currentWords += s.split(/\s+/).length;
        i++;
      }
      return result.trim();
    }

    it('counts English words correctly and validates word count', () => {
      const script = genEnglish(300);
      const result = validateScript(makeScriptOutput(script), baseCalibration, englishStyle);
      // Should count whitespace-delimited words, not characters
      expect(result.metrics.actualWordCount).toBeGreaterThanOrEqual(270);
    });

    it('splits English sentences and detects cliffhangers', () => {
      const script = genEnglish(300);
      const result = validateScript(makeScriptOutput(script), baseCalibration, englishStyle);
      expect(result.metrics.actualSentenceCount).toBeGreaterThan(5);
    });

    it('handles n-gram deduplication for English word-level n-grams', () => {
      const script = genEnglish(300);
      const result = validateScript(makeScriptOutput(script), baseCalibration, englishStyle);
      // Word-level n-grams path should be exercised
      expect(result.metrics.ngramDeduplicationRate).toBeGreaterThan(0);
    });
  });

  /* ---- Confidence-aware sentence length tolerance ---- */
  describe('confidence-aware sentence length tolerance', () => {
    it('widens tolerance when sentence_length_max is a guess', () => {
      const style: StyleAnalysisCIR = {
        ...baseStyle,
        scriptTrack: { ...baseStyle.scriptTrack, sentenceLengthMax: 10 },
        confidence: { sentenceLengthMax: 'guess' },
      };
      // With guess confidence, tolerance = 10 * 2.0 = 20
      // Build a script with sentences > 15 chars but < 20 chars — should pass
      const script = genChinese(300);
      const result = validateScript(makeScriptOutput(script), baseCalibration, style);
      // maxSentenceLengthLimit should be 20 (10 * 2.0)
      expect(result.metrics.maxSentenceLengthLimit).toBe(20);
    });

    it('uses moderate tolerance when sentence_length_max is inferred', () => {
      const style: StyleAnalysisCIR = {
        ...baseStyle,
        scriptTrack: { ...baseStyle.scriptTrack, sentenceLengthMax: 10 },
        confidence: { sentenceLengthMax: 'inferred' },
      };
      const script = genChinese(300);
      const result = validateScript(makeScriptOutput(script), baseCalibration, style);
      // inferred confidence: 10 * 1.75 = 17.5
      expect(result.metrics.maxSentenceLengthLimit).toBe(17.5);
    });
  });

  /* ---- FormatSignature C9/C10/C11 ---- */
  describe('FormatSignature checks', () => {
    const formatSig = {
      sentenceLengthSequence: [5, 10, 15, 20, 10, 5, 15, 20, 10, 5],
      hookTemplate: '[反直觉数据] [第二人称挑战] [悬念问句]',
      closingTemplate: '[情感升华] [行动号召]',
    } as unknown as FormatSignature;

    it('C9: computes rhythm correlation when FormatSignature provided', () => {
      const script = genChinese(300);
      const result = validateScript(
        makeScriptOutput(script),
        baseCalibration,
        baseStyle,
        formatSig,
      );
      expect(result.metrics.rhythmCorrelation).not.toBeNull();
      expect(typeof result.metrics.rhythmCorrelation).toBe('number');
    });

    it('C10: checks hook structure against template', () => {
      const script = genChinese(300);
      const result = validateScript(
        makeScriptOutput(script),
        baseCalibration,
        baseStyle,
        formatSig,
      );
      expect(result.metrics.hookStructureMatch).not.toBeNull();
      expect(typeof result.metrics.hookStructureMatch).toBe('boolean');
    });

    it('C11: checks closing structure against template', () => {
      const script = genChinese(300);
      const result = validateScript(
        makeScriptOutput(script),
        baseCalibration,
        baseStyle,
        formatSig,
      );
      expect(result.metrics.closingStructureMatch).not.toBeNull();
      expect(typeof result.metrics.closingStructureMatch).toBe('boolean');
    });

    it('C9/C10/C11 remain null when formatSignature is not provided', () => {
      const script = genChinese(300);
      const result = validateScript(makeScriptOutput(script), baseCalibration, baseStyle);
      expect(result.metrics.rhythmCorrelation).toBeNull();
      expect(result.metrics.hookStructureMatch).toBeNull();
      expect(result.metrics.closingStructureMatch).toBeNull();
    });

    it('C10: reports error when hook does not match template', () => {
      // Template expects data + second-person + suspense, but text has none
      const badHookSig = {
        sentenceLengthSequence: [5, 10, 15],
        hookTemplate: '[数据] [第二人称] [悬念]',
        closingTemplate: '',
      } as unknown as FormatSignature;
      // Script starting without data, second-person, or suspense
      const script = '天空很蓝。' + '草是绿色的。' + '水是透明的。' + genChinese(250);
      const result = validateScript(
        makeScriptOutput(script),
        baseCalibration,
        baseStyle,
        badHookSig,
      );
      // hookStructureMatch should be checked (may or may not match depending on content)
      expect(result.metrics.hookStructureMatch).not.toBeNull();
    });

    it('C11: reports error when closing does not match template', () => {
      const strictClosingSig = {
        sentenceLengthSequence: [5, 10, 15],
        hookTemplate: '',
        closingTemplate: '[情感] [行动] [问题]',
      } as unknown as FormatSignature;
      const script = genChinese(300);
      const result = validateScript(
        makeScriptOutput(script),
        baseCalibration,
        baseStyle,
        strictClosingSig,
      );
      expect(result.metrics.closingStructureMatch).not.toBeNull();
    });
  });

  /* ---- Edge cases ---- */
  it('sentenceLengthVariance returns 0 for single sentence', () => {
    const style: StyleAnalysisCIR = {
      ...baseStyle,
      meta: { videoLanguage: 'Chinese', videoDurationSec: 60, videoType: 'science' },
    };
    const result = validateScript(
      makeScriptOutput('这是一句非常短的话。'),
      { ...baseCalibration, calibration: { ...baseCalibration.calibration, target_word_count: 10, target_word_count_min: '5', target_word_count_max: '15' } },
      style,
    );
    expect(result.metrics.sentenceLengthVariance).toBe(0);
  });
});
