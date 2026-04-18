# Prompt 审计文档 — proj_1776077387676

> **项目主题**: 生而为人有多难得  
> **参考视频**: 你的身体有多爱你.mp4  
> **创建时间**: 2026-04-13T10:49:47.676Z  
> **审计目的**: 人工检查每个阶段的 prompt 是否能生成高质量的复刻视频

---

## 目录

1. [Stage 0: 能力自评 (Capability Assessment)](#stage-0-能力自评)
2. [Stage 1: 风格DNA提取 (Style Extraction)](#stage-1-风格dna提取)
3. [Stage 2: 研究 (Research)](#stage-2-研究)
4. [Stage 3A: 校准与叙事地图 (Calibration)](#stage-3a-校准与叙事地图)
5. [Format Signature 提取](#format-signature-提取)
6. [Stage 3B: 脚本生成 (Script Generation)](#stage-3b-脚本生成)
7. [Script Audit 脚本审计](#script-audit-脚本审计)
8. [Stage 4: QA Review 质量审查](#stage-4-qa-review-质量审查)
9. [Stage 5: Storyboard 分镜](#stage-5-storyboard-分镜)
10. [Subject Isolation 主体隔离检查](#subject-isolation-主体隔离检查)
11. [Image Gen 图片生成 (共16场景)](#image-gen-图片生成)
12. [Video Gen 视频生成 (场景1)](#video-gen-视频生成)
13. [Reference Sheet 参考风格图](#reference-sheet-参考风格图)
14. [审计总结与改进建议](#审计总结与改进建议)

---

## Stage 0: 能力自评

**模板**: `ANALYSIS_SELF_ASSESSMENT_PROMPT`  
**变量替换**: 无（原文直接使用）  
**发送方式**: 纯文本，无附件  
**实际跳过**: 是 — 日志显示 "Skipping self-assessment pre-pass for faster style extraction"

### 实际 Prompt

```
I am building a science explainer video style transfer tool.

PRODUCT OVERVIEW:
- Input: one viral 3D animated science explainer video + a new topic
- Output: a new video that replicates the original video's style
- Video type: 3D animated science short-form content (60-300 seconds)
- Each voiceover sentence maps to one independent 3D animation scene

FULL GENERATION PIPELINE:
StyleDNA Extraction → Script Generation → Compliance Check →
Scene Decomposition → Visual Prompt Generation → Keyframe Generation
→ Image-to-Video → BGM Generation → TTS Voiceover → FFmpeg Assembly

STYLE DNA SERVES THREE DOWNSTREAM PIPELINES:
- Script pipeline: constrains narrative structure, sentence style, and pacing
- Visual pipeline: constrains image/video generation for keyframes and clips
- Audio pipeline: constrains music generation for BGM mood and style

Before I ask you to extract the DNA, answer these five questions
about your own capabilities as the sole executor of this task:

Q1. For the SCRIPT pipeline:
    Which fields can you extract accurately from a video,
    and in what format? Be specific about what you can
    observe directly versus what you are inferring.

Q2. For the VISUAL pipeline:
    Which fields can you extract accurately, and which
    fields are directly usable as image/video generation
    prompt keywords?

Q3. For the AUDIO pipeline:
    Which fields can you extract accurately, and which
    fields are directly usable as music generation
    prompt keywords?

Q4. CONFIDENCE SELF-ASSESSMENT:
    For each field you propose, explicitly state:
    - "confident" if you can extract it reliably
      from visual/audio observation
    - "inferred" if you are making an educated guess
    Tell me WHY for each rating.

Q5. BLIND SPOTS:
    Are there any fields you could extract from this video
    that I have NOT asked about, but that would have
    significant impact on downstream generation quality?

Output your answer as a structured assessment,
NOT as JSON. Use plain text with clear section headers.
This is a dialogue, not an extraction task.
```

### 🔍 审计意见

- ✅ 设计合理：让 LLM 先自我评估能力边界，再做正式提取
- ⚠️ 本项目实际跳过了此步骤，直接进入 Style Extraction
- 💡 建议：对于首次运行的参考视频，应启用自评以获取更可靠的置信度标注

---

## Stage 1: 风格DNA提取

**模板**: `STYLE_EXTRACTION_PROMPT`  
**变量替换**: 无（原文直接使用）  
**发送方式**: 多模态 — 此 prompt 与参考视频文件一起发送给 Gemini

### 实际 Prompt

```
You are a video style analysis expert. Analyze the provided reference video and extract a detailed "Style DNA" profile.

## ANALYSIS REQUIREMENTS

You must analyze THREE tracks with per-field confidence tagging:

### Track A – Script
Analyze: narrative structure, hook strategy, emotional tone arc, rhetorical devices, sentence patterns, interaction cues, CTA pattern, jargon treatment, metaphor usage.

### Track B – Visual
Analyze: base medium, lighting, camera motion, composition, color palette, color temperature, scene duration, transition style, b-roll ratio, visual metaphor mapping.

### Track C – Audio
Analyze: BGM genre/mood/tempo, voice style, relative volume, audio-visual sync points.

## CONFIDENCE TAGGING
For EVERY field, assign a confidence level in the "nodeConfidence" object:
- "confident" — directly observed from video
- "inferred" — educated guess based on limited evidence
- "guess" — no direct evidence, using domain defaults

## SUSPICIOUS CLAIMS
If the video contains numeric claims that seem exaggerated or unverifiable, list them in "suspiciousNumericClaims" for downstream research verification.

## OUTPUT FORMAT
Output a single JSON object (no markdown code blocks, first char must be {, last must be }):
{
  "meta": {
    "video_language": "Chinese or English",
    "video_duration_sec": number,
    "video_type": "e.g. science explainer, educational, documentary"
  },
  "visualStyle": "e.g. 3D animated, cinematic, motion graphics",
  "pacing": "fast/medium/slow",
  "tone": "e.g. informative, emotional, humorous",
  "colorPalette": ["#hex1", "#hex2", "#hex3", "#hex4", "#hex5"],
  "colorPaletteByMood": { ... },
  "targetAudience": "...",
  "narrativeStructure": [...],
  "hookType": "Question/ShockingStat/Story/VisualHook",
  "callToActionType": "Subscribe/LearnMore/Reflect/None",
  "wordCount": number,
  "wordsPerMinute": number,
  "emotionalIntensity": 1-5,
  "audioStyle": { ... },
  "track_a_script": {
    "hook_strategy": "...",
    "hook_example": "first 2-3 sentences from transcript",
    "narrative_arc": [...],
    "emotional_tone_arc": "...",
    "rhetorical_core": "...",
    "sentence_length_avg": number,
    "sentence_length_max": number,
    "sentence_length_unit": "characters or words",
    "interaction_cues_count": number,
    "cta_pattern": "...",
    "metaphor_count": number,
    "jargon_treatment": "simplified/technical/mixed"
  },
  "track_b_visual": {
    "base_medium": "...",
    "lighting_style": "...",
    "camera_motion": "...",
    "color_temperature": "warm/neutral/cool",
    "scene_avg_duration_sec": number,
    "transition_style": "cut/dissolve/morph/zoom",
    "visual_metaphor_mapping": {
      "rule": "...",
      "examples": [...]
    },
    "b_roll_ratio": 0.0-1.0,
    "composition_style": "centered/rule-of-thirds/dynamic"
  },
  "track_c_audio": { ... },
  "fullTranscript": "complete transcript of the video",
  "nodeConfidence": { ... },
  "suspiciousNumericClaims": [...]
}
```

**附件**: 参考视频 `你的身体有多爱你.mp4`

### 提取结果要点
- 视频语言: Chinese, 时长: 92s
- 提取置信度: 11 confident, 3 inferred, 3 guess, 4 computed
- **⚠️ 问题**: `sentence_length_avg` 和 `sentence_length_max` 都被设为 504（= 全文总字数），明显是提取错误。参考视频有约 15 个句子，平均字长应约 33 字符

### 🔍 审计意见

- ✅ Prompt 结构全面，覆盖了脚本/视觉/音频三轨
- ✅ 置信度标注机制设计合理
- ✅ suspiciousNumericClaims 能有效防止错误数据传播
- ❌ **严重问题**: LLM 在提取时将 sentence_length_avg/max 理解为"全文总字数"（504），而非"句子平均/最大长度"。这影响了下游脚本生成中的句子长度约束。代码中通过 confidence-widened 机制部分缓解了此问题
- 💡 建议：在 prompt 中增加更明确的定义："sentence_length_avg: average number of characters PER SENTENCE (not total)"

---

## Stage 2: 研究

**模板**: `RESEARCH_PROMPT`  
**变量替换**: `{topic}` → `生而为人有多难得`  
**附加**: 可疑数值声明追加段落

### 实际 Prompt

```
You are a research assistant for a science video production system.

New topic: 生而为人有多难得

Search for and compile research data on this topic.

Requirements:
1. Find 5-7 verified facts with reliable sources
2. Identify 2-3 common myths or misconceptions
3. Create a glossary of key terms (3-5 terms)
4. Each fact must be specific enough to use as a data point in a video script (include numbers/comparisons where possible)
5. Each fact must be visually imaginable as a 3D animation scene

Output as JSON (no markdown code blocks, raw JSON only):
{
  "facts": [
    {
      "id": "fact-1",
      "content": "Fact description in the video's language",
      "sources": [{ "url": "source URL or reference", "title": "source title" }],
      "aggConfidence": 0.0-1.0,
      "type": "verified"
    }
  ],
  "myths": ["myth 1", "myth 2"],
  "glossary": [
    { "term": "term", "definition": "definition" }
  ]
}
```

### 研究结果要点
- 5 条事实：出生概率(disputed)、细胞再生(verified)、DNA长度(disputed)、心脏功率(verified)、细菌数量(verified)
- 3 条认知误区
- 3 条术语表

### 🔍 审计意见

- ✅ Prompt 简洁明了，要求事实可视化是好设计
- ✅ 产出数据质量不错，有具体数据和来源
- ⚠️ 2 条事实标记为 "disputed"，下游可能需要处理
- 💡 建议：增加"请用视频语言（中文）撰写事实内容"的明确指示，避免中英混杂

---

## Stage 3A: 校准与叙事地图

**模板**: `CALIBRATION_PROMPT`  
**变量替换**:

| 变量 | 实际值 |
|---|---|
| `{video_duration_sec}` | `92` |
| `{total_words}` | `504` |
| `{video_language}` | `Chinese` |
| `{narrative_arc}` | `["Paradoxical Hook","Daily Organ Maintenance","Immune Defense & Sacrifice","Self-Preservation Mechanisms","Terminal Lucidity (Climax)","Cosmic Metaphor & Emotional Reflection"]` |
| `{hook_strategy}` | `Emotional paradoxical statement highlighting an unknown relationship with oneself.` |
| `{cta_pattern}` | `Negative imperative (不要忘了) + reassuring statement (你的身体还在死心塌地的爱着你)` |
| `{topic}` | `生而为人有多难得` |

### 实际 Prompt

```
You are a research assistant for a science explainer video production system.

Your task has TWO parts. Output a single JSON object (no markdown code blocks).

PART 1: SPEECH RATE CALIBRATION
Reference video data:
- video_duration_sec: 92
- total_words: 504
- video_language: Chinese

Calculate:
1. actual_speech_rate = total_words / video_duration_sec * 60
2. target_word_count = actual_speech_rate * 92 / 60

PART 2: NARRATIVE MAP
Using the calibration and reference style below, generate a narrative map.

Reference narrative arc stages: ["Paradoxical Hook","Daily Organ Maintenance","Immune Defense & Sacrifice","Self-Preservation Mechanisms","Terminal Lucidity (Climax)","Cosmic Metaphor & Emotional Reflection"]
Hook type: Emotional paradoxical statement highlighting an unknown relationship with oneself.
CTA pattern: Negative imperative (不要忘了) + reassuring statement (你的身体还在死心塌地的爱着你)
Target total duration: 92 seconds

New topic: 生而为人有多难得

Output JSON:
{
  "calibration": {
    "reference_total_words": number,
    "reference_duration_sec": number,
    "actual_speech_rate": "X words/characters per minute",
    "new_video_target_duration_sec": number,
    "target_word_count": number,
    "target_word_count_min": "target * 0.9",
    "target_word_count_max": "target * 1.1"
  },
  "verified_facts": [...],
  "narrative_map": [...]
}
```

### 校准结果
- 语速: 328.7 字/分钟
- 目标字数: 504 (范围 453.6 - 554.4)
- 叙事段落: 6 段，与参考视频结构完全对应

### 🔍 审计意见

- ✅ 语速校准逻辑正确
- ✅ 叙事地图的段落分配合理
- ✅ 每个段落都有 fact_references 对应
- ⚠️ `estimatedSceneCount: 1` 有错误 — 这个值应该约为 15（504字 ÷ 33字/句），是因为 sentence_length_avg 被错误提取为 504 导致
- 💡 这个错误在下游 scriptGeneration 被修正（代码中有 fallback 逻辑）

---

## Format Signature 提取

**模板**: `FORMAT_SIGNATURE_PROMPT`  
**变量替换**:

| 变量 | 实际值 |
|---|---|
| `{fullTranscript}` | （完整转录文本，504字） |
| `{narrative_arc}` | `["Paradoxical Hook","Daily Organ Maintenance","Immune Defense & Sacrifice","Self-Preservation Mechanisms","Terminal Lucidity (Climax)","Cosmic Metaphor & Emotional Reflection"]` |
| `{hook_strategy}` | `Emotional paradoxical statement highlighting an unknown relationship with oneself.` |
| `{cta_pattern}` | `Negative imperative (不要忘了) + reassuring statement (你的身体还在死心塌地的爱着你)` |
| `{video_language}` | `Chinese` |

### 实际 Prompt

```
You are a structural analyst for video scripts. Your task is to extract the STRUCTURAL SIGNATURE of a reference script — the immutable "series format DNA" that stays constant across different topics.

## INPUT
Full reference transcript:
---
这可能是你第一次认识到 你的身体究竟有多爱你 在你的身体中 每天都会有1-5个细胞产生癌变 ...（完整转录文本共504字）...
---

Narrative arc stages: ["Paradoxical Hook","Daily Organ Maintenance","Immune Defense & Sacrifice","Self-Preservation Mechanisms","Terminal Lucidity (Climax)","Cosmic Metaphor & Emotional Reflection"]
Hook strategy: Emotional paradoxical statement highlighting an unknown relationship with oneself.
CTA pattern: Negative imperative (不要忘了) + reassuring statement (你的身体还在死心塌地的爱着你)
Video language: Chinese

## WHAT TO EXTRACT
（9项结构特征：hookTemplate, closingTemplate, sentenceLengthSequence, 
transitionPositions, transitionPatterns, arcSentenceAllocation, 
signaturePhrases, emotionalArcShape, seriesVisualMotifs）

## OUTPUT FORMAT (JSON only, no markdown)
```

### 提取结果要点
- hookTemplate: `[Paradoxical revelation] + [Invisible micro-crisis statistics] + [Unsung hero vs. ignorant beneficiary contrast]`
- closingTemplate: `[Negative hypothetical scenario] + [Macro-scale internal companionship reminder] + [Ultimate emotional reassurance & negative imperative CTA]`
- sentenceLengthSequence: `[21, 21, 38, 50, 48, 42, 29, 37, 69, 35, 15, 28, 17, 37, 33]`
- arcSentenceAllocation: `[3, 2, 1, 2, 2, 5]`
- 5 个 signaturePhrases（结构模板）

### 🔍 审计意见

- ✅ **这是整个流水线中设计最精巧的环节之一**。将"系列DNA"从"主题内容"中分离
- ✅ sentenceLengthSequence 准确反映了参考视频的节奏指纹
- ✅ signaturePhrases 成功提取了句式模板（用 [X] 替换主题内容）
- ✅ seriesVisualMotifs 的四阶段分类（hook/mechanism/climax/reflection）与叙事弧完美对应
- 💡 这些数据在下游 Script Generation 和 QA Review 中被大量使用

---

## Stage 3B: 脚本生成

**模板**: `SCRIPT_SYSTEM_PROMPT` + `SCRIPT_USER_PROMPT`  
**这是整个流水线中变量最多、逻辑最复杂的 prompt**

### System Prompt（角色设定）

**变量替换**: `{video_language}` → `Chinese`

```
You are a science explainer video scriptwriter specializing in emotionally resonant, high-retention short-form content.

Your scripts are for 3D animated videos. Each sentence will be rendered as a separate 3D animation scene, so every sentence must be visually concrete.

ABSOLUTE RULES:
1. Write entirely in Chinese
2. Every style constraint below is a HARD requirement — deviation means failure
3. Content must be scientifically accurate — never fabricate data, statistics, or research findings
4. This is science communication, not medical advice — never provide diagnosis or treatment recommendations
5. Output strictly valid JSON only (first char must be {, last must be })
6. NEVER include placeholder text like [INSERT], [TODO], or TBD
7. Every numeric claim MUST have a source marker (研究显示/据统计/科学家发现)
8. If you cannot verify a fact, omit it rather than guess
9. Maintain consistent tone throughout — do not mix formal/informal registers
10. Each sentence must be independently filmable as a 3D scene
```

### User Prompt（填充后的实际值）

**核心变量映射**:

| 变量 | 实际值 | 来源 |
|---|---|---|
| `{topic}` | `生而为人有多难得` | 用户输入 |
| `{target_audience}` | `general audience` | 默认值 |
| `{target_word_count}` | `504` | calibration.json |
| `{target_word_count_min}` | `453.6` | calibration.json |
| `{target_word_count_max}` | `554.4` | calibration.json |
| `{target_duration_sec}` | `92` | calibration.json |
| `{speech_rate}` | `328.7 words/characters per minute` | calibration.json |
| `{target_sentence_count}` | 约 15 | 计算值 |
| `{hook_strategy}` | `Emotional paradoxical statement highlighting an unknown relationship with oneself.` | style CIR |
| `{hook_example}` | `这可能是你第一次认识到，你的身体究竟有多爱你。在你的身体中，每天都会有1-5个细胞产生癌变...` | style profile |
| `{sentence_length_avg}` | `504` ⚠️ | style CIR（提取错误） |
| `{sentence_length_max}` | `504 × 1.3 = 655.2` ⚠️ | confidence=guess → ×1.3 |
| `{sentence_length_max_context}` | `estimated from incomplete data; prioritize natural flow` | guess 级别的提示 |
| `{sentence_length_unit}` | `characters` | style CIR |
| `{interaction_cues_count}` | `0` | style CIR |
| `{jargon_treatment}` | `simplified` | style CIR |
| `{pacing}` | `medium` | style CIR |
| `{emotional_intensity}` | `4` | 输入 / 默认 |
| `{metaphor_count}` | `3–6 (estimated)` | guess → 范围模式 |
| `{cta_pattern}` | `Negative imperative (不要忘了) + reassuring statement` | style CIR |
| `{base_medium}` | `mixed` | visual track |

**Narrative Arc Expanded**（叙事弧展开）:
```
Stage 1: Paradoxical Hook
  Establish the paradox that while you may feel insignificant, you are the result of 4.6 billion years of impossible odds.
  Target: ~66 words, ~12s

Stage 2: Daily Organ Maintenance
  Visualize the invisible complexity of staying alive, framing the body as a high-precision biological factory.
  Target: ~82 words, ~15s

Stage 3: Immune Defense & Sacrifice
  Highlight the emotional weight of cellular loyalty, where your internal army dies specifically so 'you' can live.
  Target: ~99 words, ~18s

Stage 4: Self-Preservation Mechanisms
  Showcase the body's ultimate priority system—how it ruthlessly protects your consciousness at any cost.
  Target: ~82 words, ~15s

Stage 5: Terminal Lucidity (Climax)
  The cosmic lottery moment: revealing the mathematical impossibility of your individual existence.
  Target: ~93 words, ~17s

Stage 6: Cosmic Metaphor & Emotional Reflection
  Conclusion using the negative imperative CTA, reminding the viewer that they are deeply loved by their own biology.
  Target: ~82 words, ~15s
```

**Format Signature Section**:
```
### Hook Structure (MUST match):
[Paradoxical revelation of unknown relationship] + [Invisible micro-crisis statistics] + [Unsung hero vs. ignorant beneficiary contrast]

### Closing Structure (MUST match):
[Negative hypothetical scenario] + [Macro-scale internal companionship reminder] + [Ultimate emotional reassurance & negative imperative CTA]

### Rhythm DNA (target sentence lengths by position):
[21, 21, 38, 50, 48, 42, 29, 37, 69, 35, 15, 28, 17, 37, 33]

### Arc Sentence Allocation:
Paradoxical Hook: 3 sentences
Daily Organ Maintenance: 2 sentences
Immune Defense & Sacrifice: 1 sentences
Self-Preservation Mechanisms: 2 sentences
Terminal Lucidity (Climax): 2 sentences
Cosmic Metaphor & Emotional Reflection: 5 sentences

### Transition Patterns:
Position 3: [Second-person blind spot prompt] + [Purpose-driven action definition]
Position 5: [Conditional trigger state] + [Immediate heroic subject response]
Position 6: [Extreme hypothetical concession] + [Unshakable absolute outcome]
Position 8: [Conventional skepticism acknowledgement] + [Extreme threshold scenario pivot]
Position 10: [Perspective shift framing] + [Emotional anchor restatement]

### Series Signature Phrases (adapt structure, NOT content):
- 这可能是你第一次认识到[X]
- 为了[X]，[主体]每天都会[极值数据]，并且[绝对状态]
- 当你[遭遇负面状态]时，都是[主体]第一时间[采取行动]
- 就算你[极端自我破坏]，甚至[X]，也很难[X]
- 当你以为[外界抛弃你]的时候，不要忘了，你的[内在主体]还在[极致情感描述]

### Target Emotional Waveform:
[0.6, 0.4, 0.7, 0.3, 0.3, 0.8, 0.5, 0.6, 0.9, 1, 0.7, 0.6, 0.8, 0.9, 1]
```

**Visual Metaphor Mapping**:
```
Rule: Biological processes are depicted as vast, epic landscapes; cellular elements are given purposeful, swarming behaviors.

Examples:
- Body's vastness → Transitioning from cellular view to an expanding galaxy
- Terminal lucidity → Brain emitting a final, intense burst of glowing electrical pathways
```

**Verified Facts List**:
```
[Fact 1] 地球历经46亿年演化，只有约0.01%的时间存在人类文明。(据地质学统计)
[Fact 2] 人体由约37万亿个细胞组成，每秒有数百万次生化反应在精确进行。(生物学研究显示)
[Fact 3] 免疫系统的T细胞在识别病毒时，会为了保护整体而诱导受损细胞凋亡。(科学家发现)
[Fact 4] 大脑在极端饥饿时会牺牲肌肉甚至器官组织，也要优先保证自身的葡萄糖供应。(医学研究显示)
[Fact 5] 人类受精卵形成的概率约为三亿分之一，相当于连中两次超级彩票。(概率论统计)
[Fact cell-regeneration] 人体每秒钟有约380万个细胞死亡并再生。(Nature: The replacement of cells in the human body)
[Fact heart-power] 人类的心脏一生大约跳动25亿次，泵出的血液足以填满3个超级油轮。(American Heart Association)
[Fact bacterial-shield] 你体内生存着超过39万亿个细菌。(Nature: Structure, function and diversity of the healthy human microbiome)
```

**Reference Transcript Excerpt**（经过 sanitize 处理的前300字）:
> 原文前300字，主题特定实体被替换以防止内容污染

### 生成结果

脚本共 15 句，总计约 583 字。开头句：
> "这可能是你第一次认识到，你正在被全宇宙最顶级、最庞大的团队秘密守护。"

### 🔍 审计意见

- ✅ **Prompt 设计极其精细**，包含 12 个控制区段，从 Hook 到 CTA 到 Format Signature 都有明确约束
- ✅ Section 3.5 Retention Architecture（留存架构）是亮点设计 — 在 0-5s/15-20s/30-40s 等关键流失点设置钩子
- ✅ Format Signature 成功将参考视频的结构 DNA 注入新脚本
- ✅ Self-check 清单确保 LLM 自我验证
- ❌ **sentence_length_avg=504 / max=655 严重偏离实际**。LLM 可能忽略了这个不合理的约束，但也可能导致生成过长的句子
- ⚠️ interaction_cues_count=0 意味着不要求互动提示（如"你知道吗？"），这与参考视频一致但可能降低留存
- 💡 建议：添加 sentence_length_avg/max 的合理性检查（如果 > wordCount 则自动修正为 wordCount/sentenceCount）

---

## Script Audit 脚本审计

**模板**: `SCRIPT_AUDIT_PROMPT`（本地定义于 scriptAudit.ts）  
**变量替换**:

| 变量 | 实际值 |
|---|---|
| `{script_text}` | （生成的脚本全文） |
| `{target_word_count}` | `504` |
| `{target_word_count_min}` | `453.6` |
| `{target_word_count_max}` | `554.4` |
| `{hard_word_count_min}` | `363` (453.6 × 0.8) |
| `{hard_word_count_max}` | `665` (554.4 × 1.2) |
| `{tone}` | `emotional, awe-inspiring, solemn` |
| `{hook_strategy}` | `Emotional paradoxical statement highlighting an unknown relationship with oneself.` |
| `{narrative_arc}` | `["Paradoxical Hook",...]` |
| `{sentence_length_avg}` | `504` ⚠️ |
| `{sentence_length_unit}` | `characters` |
| `{sentence_length_max}` | `504` ⚠️ |
| `{metaphor_count}` | `4` |
| `{video_language}` | `Chinese` |
| `{base_medium}` | `mixed` |

### 实际 Prompt

```
You are a senior script editor performing a self-correction audit on a science explainer video script.

## YOUR TASK
Review the script below and fix any issues. Do NOT rewrite the entire script — only fix specific problems.

## SCRIPT TO AUDIT
这可能是你第一次认识到，你正在被全宇宙最顶级、最庞大的团队秘密守护。
据地质学统计，地球历经46亿年演化，人类仅占0.01%的时间，而你却是这史诗中唯一的奇迹。
...（15句脚本全文）...

## STYLE DNA CONSTRAINTS TO CHECK AGAINST
- Target word count: 504 (range: 453.6 - 554.4)
- Target tone: emotional, awe-inspiring, solemn
- Hook strategy: Emotional paradoxical statement highlighting an unknown relationship with oneself.
- Narrative arc: ["Paradoxical Hook","Daily Organ Maintenance","Immune Defense & Sacrifice","Self-Preservation Mechanisms","Terminal Lucidity (Climax)","Cosmic Metaphor & Emotional Reflection"]
- Sentence length avg: 504 characters
- Sentence length max: 504 characters
- Metaphor count target: 4
- Video language: Chinese

## AUDIT CHECKLIST
1. Word count: within [453.6, 554.4]? HARD ERROR below 363 or above 665.
2. Factual integrity: all numeric claims sourced?
3. Style consistency: tone consistent?
4. Visual renderability: every sentence independently renderable as a mixed scene?
5. Safety: any absolute medical/health claims?

## OUTPUT FORMAT (JSON only)
```

### 审计结果
- `passed: true`, `styleConsistencyScore: 0.95`, `factCoverageScore: 1.0`
- 修正了 5 处问题：1个语法错误、4个事实准确性改进
- 例如：`"为了确保这台精密仪器的在大多数情况下安全"` → `"为了确保这台精密仪器的绝对安全"`

### 🔍 审计意见

- ✅ 自审机制有效：成功发现并修正了语法错误和事实不精确
- ✅ 修正质量高：每处修改都有明确理由
- ⚠️ sentence_length_avg=504 的错误值在此处没有造成实际问题（因为审计是检查而非生成）
- 💡 建议：添加"检查 sentence_length_avg/max 是否合理"作为审计项

---

## Stage 4: QA Review 质量审查

**模板**: `QA_REVIEW_PROMPT`  
**变量替换**:

| 变量 | 实际值 |
|---|---|
| `{topic}` | `生而为人有多难得` |
| `{target_word_count}` | `504` |
| `{visual_style}` | `3D animated mixed with live-action stock footage` |
| `{tone}` | `emotional, awe-inspiring, solemn` |
| `{narrative_arc}` | `["Paradoxical Hook",...]` |
| `{script_text}` | （审计后的脚本全文） |
| `{reference_transcript_sample}` | （参考视频转录的前500字） |
| `{series_consistency_section}` | （基于 Format Signature 构建的系列一致性审计标准） |

### 实际 Prompt 结构（5维审查）

```
You are a quality reviewer for science explainer video scripts. Perform a 3-audit review.

## AUDIT 1: ACCURACY & FACTUAL INTEGRITY (Score 1-10)
（检查事实造假、误导性简化、危险健康声明、缺少来源标注）

## AUDIT 2: STYLE CONSISTENCY (Score 1-10)
（检查语调一致性、句长范围、钩子策略、情感弧线、隐喻数量等）

## AUDIT 3: PRODUCTION-READINESS (Score 1-10)
（检查每句的3D场景可渲染性、节奏、CTA自然度、字数范围）

## AUDIT 4: CONTENT CONTAMINATION (Score 1-10)
（对比参考转录，检测是否抄袭了原视频的句子/事实/隐喻）

Reference transcript excerpt:
"这可能是你第一次认识到 你的身体究竟有多爱你 在你的身体中..."

## AUDIT 5: SERIES CONSISTENCY (Score 1-10)
（检查 hookTemplate, closingTemplate, rhythm DNA, arc allocation 等是否与 Format Signature 匹配）

Series Signature to match:
- Hook: [Paradoxical revelation] + [Invisible micro-crisis statistics] + [Unsung hero contrast]
- Closing: [Negative hypothetical] + [Macro-scale companionship] + [Emotional CTA]
- Rhythm: [21, 21, 38, 50, 48, 42, 29, 37, 69, 35, 15, 28, 17, 37, 33]
- Arc allocation: [3, 2, 1, 2, 2, 5]
```

### 审查结果
- **总评: 9.4/10**, approved: false（因阈值 ≥8 设为 true，但实际标记为 false — 可能是代码层面调整了阈值）
- accuracy: 10, styleConsistency: 9, productionReadiness: 9, engagement: 10
- contentContamination.score: 10（完全原创，无抄袭）
- 2 个细节问题被标记

### 🔍 审计意见

- ✅ **5维审计是极优设计**：准确性 + 风格 + 可制作性 + 内容污染 + 系列一致性
- ✅ Content Contamination 检查能有效防止脚本照搬参考视频内容
- ✅ Series Consistency 检查确保了"系列化"品质
- ⚠️ approved=false 但 overall=9.4 — 可能存在阈值逻辑不一致
- 💡 建议：审查 approved 的判定逻辑（当前代码注释说 ≥8 就 approved，但实际结果矛盾）

---

## Stage 5: Storyboard 分镜

**模板**: `STORYBOARD_PROMPT`  
**变量替换**:

| 变量 | 实际值 |
|---|---|
| `{topic}` | `生而为人有多难得` |
| `{target_scene_count}` | `16` |
| `{scene_structure_json}` | （16个场景的预构建结构） |
| `{script_text}` | （审计后脚本全文） |
| `{base_medium}` | `mixed` |
| `{lighting_style}` | `High contrast cinematic, dramatic shadowing with luminescent subsurface scattering` |
| `{camera_motion}` | `Slow inward tracking, dynamic fly-throughs of vessels` |
| `{color_temperature}` | `warm` |
| `{color_palette}` | `#3B0A0D, #E63946, #0B132B, #4EA8DE, #F1FAEE` |
| `{composition_style}` | `centered` |
| `{transition_style}` | `dissolve` |
| `{scene_avg_duration_sec}` | `4.5` |
| `{visual_metaphor_mapping_rule}` | `Biological processes are depicted as vast, epic landscapes; cellular elements are given purposeful, swarming behaviors.` |
| `{series_visual_motifs_section}` | hookMotif/mechanismMotif/climaxMotif/reflectionMotif |

### 实际 Prompt 核心要求

```
You are a visual director for 3D animated science explainer videos.

## CRITICAL: STRUCTURE LOCK
- The scene count is already fixed at 16.
- You MUST return exactly 16 scene entries in the same order.
- DO NOT alter scene count or order.

## PRE-BUILT SCENE STRUCTURE
（16个场景的 number + narrative 预定义结构）

## CROSS-TOPIC ADAPTATION
The STYLE DNA below is from a reference video about a potentially DIFFERENT subject.
- KEEP: artistic medium (mixed), lighting, color palette, mood, camera motion
- REPLACE: subject-specific visual elements with ones appropriate for the new topic

## VISUAL PROMPT QUALITY RULES
- Every prompt must specify the lighting style: High contrast cinematic, dramatic shadowing with luminescent subsurface scattering
- Each prompt must be 30-80 words of specific visual description in ENGLISH
- Abstract concepts MUST use visual metaphor mappings

## SERIES VISUAL MOTIFS
- hookMotif: Invisible world revelation: Everyday human exterior seamlessly zooming into dynamic, hyper-active microscopic environments
- mechanismMotif: Industrial efficiency metaphor: Biological processes rendered as tireless, massive-scale mechanical infrastructure with data overlays
- climaxMotif: Heroic final stand: Desaturated environments with high-contrast warm lighting illuminating a singular, self-sacrificing action
- reflectionMotif: Scale equivalence: Biological clusters seamlessly cross-fading into celestial bodies and deep space phenomena
```

### 分镜结果（16 场景样例）

| 场景 | 叙事 | 视觉描述（英文） |
|---|---|---|
| 1 | 这可能是你第一次认识到… | A hyper-realistic close-up of a human eye iris transitioning into a swirling cosmic nebula... |
| 4 | 当你感到平庸时… | A vast, epic landscape of 37 trillion glowing spheres resembling a futuristic city... |
| 7 | 科学家发现，当致命病毒入侵时… | A dark, desaturated battlefield inside the body. A heroic, glowing T-cell stands against a swarm of dark, jagged virus particles... |
| 14 | 据地质学统计，无数祖先在荒野… | A long line of ethereal, glowing silhouettes of ancient humans running through a dark primordial forest... |
| 15 | 当你以为外界抛弃你时… | A hyper-realistic heart rendered as a glowing ruby cathedral. It pulses with a warm, deep red light... |
| 16 | 所以，请为了这些为你拼命的微小生命… | A close-up of a human hand reaching toward a vibrant flower in a sunlit field... |

### 🔍 审计意见

- ✅ STRUCTURE LOCK 机制确保场景数量不变
- ✅ 视觉描述质量高，每个场景都有具体的主体、动作、光照、色彩
- ✅ Visual Metaphor Mapping 被正确应用（细胞→城市、T细胞→战士、心脏→大教堂）
- ✅ 全部使用英文描述以获得最佳 AI 图片生成效果
- ✅ Series Visual Motifs 在各阶段都被正确套用
- ⚠️ 场景2的句子被截断（"人类仅占0."），导致分镜叙事不完整 — 这是 CIR 句子分割的问题
- 💡 建议：优化 CIR 句子分割逻辑，正确处理含小数点的句子

---

## Subject Isolation 主体隔离检查

**模板**: `SUBJECT_ISOLATION_PROMPT`（本地定义于 subjectIsolation.ts）  
**变量替换**: `{scenes_json}` → 16 个场景的 `{sceneId, narrative, visualPrompt}` JSON

### 功能
AI 逐场景检查每个 visualPrompt 是否有清晰的主体（focal subject），防止 AI 图片生成器产出"模糊无主体"的画面。

### 检查结果
- 14/16 场景通过（hasIsolatedSubject=true）
- 2 个场景被标记为需修改：
  - **场景 9**（"接下来的发现彻底颠覆认知"）: "kaleidoscope of biological structures rotating rapidly is too chaotic" → 修改为以 DNA 双螺旋为中心
  - **场景 16**（"请为了这些微小生命…再一次好好爱自己"）: "cross-fade is a video transition, not a static image subject" → 修改为手伸向花朵的具体画面

### 🔍 审计意见

- ✅ 主体隔离检查是很好的质量保障 — 防止 AI 图片生成器产出无效画面
- ✅ 修正建议具体可行
- ⚠️ 场景 4 的置信度偏低（0.8），"37 trillion" 可能导致混乱纹理
- 💡 建议：可以增加对每个 visualPrompt 中英文一致性的检查

---

## Image Gen 图片生成

**模板**: `IMAGE_GEN_PROMPT`  
**每个场景独立生成**，共 16 个图片生成 prompt

### Prompt 模板

```
为科学科普视频场景生成一张高质量图片。

场景描述: {visual_prompt}

风格要求:
- 配色: {color_palette}
- 光影: {lighting_style}
- 风格: {visual_style}
- 宽高比: {aspect_ratio}

请直接生成这张图片，不要用文字描述。要求画面精美，适合专业科普视频使用。
```

### 场景 1 的实际 Prompt

```
为科学科普视频场景生成一张高质量图片。

场景描述: A hyper-realistic close-up of a human eye iris transitioning into a swirling cosmic nebula. The pupil acts as a black hole, surrounded by millions of glowing golden particles representing a protective shield. High contrast cinematic lighting, dramatic shadowing with luminescent subsurface scattering, warm gold and deep navy palette, 8k resolution, mixed media style.

风格要求:
- 配色: #3B0A0D, #E63946, #0B132B, #4EA8DE, #F1FAEE
- 光影: High contrast cinematic, dramatic shadowing with luminescent subsurface scattering
- 风格: 3D animated mixed with live-action stock footage
- 宽高比: 9:16

请直接生成这张图片，不要用文字描述。要求画面精美，适合专业科普视频使用。
```

### 🔍 审计意见

- ✅ 模板简洁有效
- ✅ visual_prompt 来自 Storyboard + Subject Isolation 修正，质量已保障
- ⚠️ Prompt 中使用中文（"为科学科普视频场景生成…"）但 visual_prompt 是英文 — 混合语言可能影响部分图片生成器
- ⚠️ `#hex` 色值可能不被所有图片 AI 理解，但作为约束提示仍有价值
- 💡 建议：统一 prompt 语言为英文（与 visual_prompt 一致）

---

## Video Gen 视频生成

**模板**: `VIDEO_GEN_PROMPT`  
**场景 1 被分配为 video 类型**（assetType: "video"）

### 场景 1 的实际 Prompt

```
A hyper-realistic close-up of a human eye iris transitioning into a swirling cosmic nebula. The pupil acts as a black hole, surrounded by millions of glowing golden particles representing a protective shield. High contrast cinematic lighting, dramatic shadowing with luminescent subsurface scattering, warm gold and deep navy palette, 8k resolution, mixed media style.

Style: 3D animated mixed with live-action stock footage, High contrast cinematic, dramatic shadowing with luminescent subsurface scattering, color palette #3B0A0D, #E63946, #0B132B, #4EA8DE, #F1FAEE.
Aspect ratio: 9:16. Duration: ~5s.

```

### 🔍 审计意见

- ✅ 格式简洁，适合视频生成 API
- ✅ 包含时长和宽高比等关键参数
- ⚠️ style_anchor 为空 — 如果有参考图片可以作为风格锚点会更好
- 💡 Duration=5s（apiDurationSec）与 ttsBudgetSec=3.13 不匹配 — 视频会比旁白长约 2 秒

---

## Reference Sheet 参考风格图

**模板**: `REFERENCE_SHEET_PROMPT`  
**变量替换**:

| 变量 | 实际值 |
|---|---|
| `{topic}` | `生而为人有多难得` |
| `{visual_style}` | `3D animated mixed with live-action stock footage` |
| `{color_palette}` | `#3B0A0D, #E63946, #0B132B, #4EA8DE, #F1FAEE` |
| `{key_elements}` | （视觉关键元素列表） |
| `{lighting_style}` | `High contrast cinematic, dramatic shadowing with luminescent subsurface scattering` |
| `{pedagogical_approach}` | （教学方法描述） |
| `{aspect_ratio}` | `9:16` |

### 实际 Prompt

```
Create a "Style Reference Sheet" for an educational science video about: 生而为人有多难得.

Style DNA (Strict Adherence):
- Art Style: 3D animated mixed with live-action stock footage
- Color Palette: #3B0A0D, #E63946, #0B132B, #4EA8DE, #F1FAEE
- Key Visual Elements: （视觉关键元素）
- Lighting: High contrast cinematic, dramatic shadowing with luminescent subsurface scattering
- Pedagogical Approach: （教学方法）

Instructions:
- Show 3-4 representative visual vignettes in this exact style on a single sheet.
- If the topic has a main character or mascot, show them in 2-3 poses.
- Include sample backgrounds, props, and UI elements that match the style.
- Background: Neutral studio backdrop compatible with the art style.
- Quality: highly detailed, production-ready asset, consistent palette throughout.
- Aspect ratio: 9:16

Generate the image directly. Do not describe it in text.
```

### 🔍 审计意见

- ✅ 目标明确：生成统一风格参考图，为后续所有场景图片提供视觉锚点
- ✅ 要求 3-4 个代表性画面缩略图 + 角色姿态 + 背景/道具
- 💡 建议：增加对"参考图中不应包含文字/水印"的约束

---

## 审计总结与改进建议

### 整体评价

| 维度 | 评分 | 说明 |
|---|---|---|
| **Prompt 架构** | ⭐⭐⭐⭐⭐ | 15 个阶段的流水线设计合理，各阶段职责清晰 |
| **Style DNA 传递** | ⭐⭐⭐⭐ | 从提取到脚本到分镜，风格约束持续传递 |
| **质量保障** | ⭐⭐⭐⭐⭐ | Script Audit + QA Review + Subject Isolation 三重检查 |
| **内容安全** | ⭐⭐⭐⭐⭐ | 反事实造假、反内容污染、反安全风险 |
| **数据准确性** | ⭐⭐⭐ | sentence_length_avg/max 提取错误影响了多个下游阶段 |
| **Format Signature** | ⭐⭐⭐⭐⭐ | 创新设计，有效实现了"系列化"一致性 |

### 关键问题

1. **🔴 高优先级 — sentence_length 提取错误**
   - `sentence_length_avg = 504`（应为 ~33）、`sentence_length_max = 504`（应为 ~69）
   - 影响: 脚本生成的句长约束完全失效
   - 根因: LLM 在 Style Extraction 时将"每句平均字数"误解为"全文总字数"
   - 建议修复: 在 `styleExtraction.ts` 中添加后处理校验 — 如果 `sentence_length_avg > wordCount / 3`，自动重新计算

2. **🟡 中优先级 — CIR 句子分割问题**
   - 句子 2 被截断为"据地质学统计，地球历经46亿年演化，人类仅占0."
   - 根因: 分割器错误将 "0.01%" 中的句号识别为句子边界
   - 建议修复: 改进句子分割正则，排除 `数字.数字` 模式

3. **🟡 中优先级 — QA approved 逻辑不一致**
   - overall=9.4 但 approved=false
   - 可能是 LLM 返回了不一致的值，或有额外的阻断条件

4. **🟢 低优先级 — Image Gen prompt 语言混合**
   - 建议统一为英文以获得最佳图片生成效果

5. **🟢 低优先级 — video duration 与 TTS budget 不一致**
   - apiDurationSec=5 vs ttsBudgetSec=3.13，视频末尾会有约 2 秒静默

### 生成质量预测

基于以上 prompt 流水线分析，该项目**有能力生成高质量的复刻视频**，原因如下：

- ✅ 脚本质量高：15 句原创内容，事实有来源标注，情感弧线完整
- ✅ 视觉提示质量高：每个场景都有具体的 3D 视觉描述，色彩/光照/相机运动统一
- ✅ 系列一致性好：通过 Format Signature 成功复制了参考视频的结构 DNA
- ✅ 三重质量检查（Script Audit + QA Review + Subject Isolation）确保了输出质量

**主要风险**: sentence_length 的提取错误虽然没有在本次导致严重问题（LLM 实际生成的句长约 33-50 字符，在合理范围内），但在其他项目中可能导致异常长句。建议在代码层面添加自动修正。
