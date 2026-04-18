# AI Video Pipeline — Prompt 文档

**项目 ID**: `proj_1775959231425`  
**主题**: 生而为人有多难得  
**参考视频**: 你的身体有多爱你.mp4  
**运行时间**: 2026-04-12  
**模式**: Free（浏览器自动化）  
**AI 提供者**: Gemini 3.1 Pro (主), ChatGPT (备)  

---

## 目录

1. [流水线概览](#1-流水线概览)
2. [Stage 1: CAPABILITY_ASSESSMENT — 安全评估](#2-stage-1-capability_assessment--安全评估)
3. [Stage 2: STYLE_EXTRACTION — 风格提取](#3-stage-2-style_extraction--风格提取)
4. [Stage 3: RESEARCH — 主题研究](#4-stage-3-research--主题研究)
5. [Stage 4: NARRATIVE_MAP — 叙事结构](#5-stage-4-narrative_map--叙事结构)
6. [Stage 5: SCRIPT_GENERATION — 脚本生成](#6-stage-5-script_generation--脚本生成)
7. [Stage 6: QA_REVIEW — 质量审核](#7-stage-6-qa_review--质量审核)
8. [Stage 7: STORYBOARD — 分镜脚本](#8-stage-7-storyboard--分镜脚本)
9. [Stage 8: REFERENCE_IMAGE — 参考图生成](#9-stage-8-reference_image--参考图生成)
10. [Stage 9: KEYFRAME_GEN — 关键帧生成](#10-stage-9-keyframe_gen--关键帧生成)
11. [Stage 10: VIDEO_GEN — 视频生成](#11-stage-10-video_gen--视频生成)
12. [Stage 11-13: TTS / ASSEMBLY / REFINEMENT](#12-stage-11-13-tts--assembly--refinement)
13. [总结与统计](#13-总结与统计)

---

## 1. 流水线概览

```
CAPABILITY_ASSESSMENT → STYLE_EXTRACTION → RESEARCH → NARRATIVE_MAP
      → SCRIPT_GENERATION → QA_REVIEW → STORYBOARD → REFERENCE_IMAGE
      → KEYFRAME_GEN → VIDEO_GEN → TTS → ASSEMBLY → REFINEMENT
```

共 166 次 AI 调用，覆盖 9 种不同阶段/任务组合。

---

## 2. Stage 1: CAPABILITY_ASSESSMENT — 安全评估

**调用次数**: 0（安全检查已禁用）  
**耗时**: 0s  
**说明**: 此阶段检测已配置的 AI 提供者能力，不涉及 AI prompt。

**检测结果**:
| 提供者 | 文本 | 图片 | 视频 | 搜索 | 上传 |
|---------|------|------|------|------|------|
| gemini | ✅ | ✅ | ❌ | ✅ | ✅ |
| chatgpt | ✅ | ✅ | ❌ | ✅ | ✅ |
| klingai | ❌ | ❌ | ✅ | ❌ | ✅ |
| deepseek | ✅ | ❌ | ❌ | ✅ | ❌ |
| kimi | ✅ | ❌ | ❌ | ✅ | ✅ |

---

## 3. Stage 2: STYLE_EXTRACTION — 风格提取

**调用次数**: 2 次（自我评估 + StyleDNA 提取）  
**总耗时**: ~293.6s  
**方法**: generateText  
**提供者**: CHAT (Gemini)

### Step 2a: 自我评估 Prompt

> **模板来源**: `src/pipeline/prompts.ts` → `ANALYSIS_SELF_ASSESSMENT_PROMPT`

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
    and in what format?

Q2. For the VISUAL pipeline:
    Which fields can you extract accurately, and which
    fields are directly usable as image/video generation prompt keywords?

Q3. For the AUDIO pipeline:
    Which fields can you extract accurately?

Q4. CONFIDENCE SELF-ASSESSMENT:
    For each field you propose, explicitly state:
    - "confident" if you can extract it reliably
    - "inferred" if you are making an educated guess

Q5. BLIND SPOTS:
    Are there any fields you could extract from this video
    that I have NOT asked about, but that would have
    significant impact on downstream generation quality?
```

**AI 回复摘要**: AI 详细评估了自身在脚本/视觉/音频三个管线的提取能力，标注了 confident/inferred 信度。

### Step 2b: StyleDNA 提取 Prompt

> **模板来源**: `src/pipeline/prompts.ts` → `STYLE_EXTRACTION_PROMPT`

```
You are a video style analysis expert. Analyze the provided reference video
and extract a detailed "Style DNA" profile.

## ANALYSIS REQUIREMENTS
You must analyze THREE tracks with per-field confidence tagging:

### Track A – Script
Analyze: narrative structure, hook strategy, emotional tone arc, rhetorical
devices, sentence patterns, interaction cues, CTA pattern, jargon treatment,
metaphor usage.

### Track B – Visual
Analyze: base medium, lighting, camera motion, composition, color palette,
color temperature, scene duration, transition style, b-roll ratio,
visual metaphor mapping.

### Track C – Audio
Analyze: BGM genre/mood/tempo, voice style, relative volume, audio-visual sync.

## CONFIDENCE TAGGING
For EVERY field, assign: "confident" / "inferred" / "guess"

## OUTPUT FORMAT: Single JSON object with fields:
meta, visualStyle, pacing, tone, colorPalette, colorPaletteByMood,
targetAudience, narrativeStructure, hookType, wordCount, wordsPerMinute,
emotionalIntensity, audioStyle, track_a_script, track_b_visual,
track_c_audio, fullTranscript, nodeConfidence, suspiciousNumericClaims
```

**提取结果**:
| 属性 | 值 |
|------|-----|
| 视觉风格 | Cinematic 3D animation |
| 节奏 | medium |
| 基调 | emotional |
| 色彩 | `#0a0a0a`, `#8b0000`, `#1e90ff`, `#ffd700`, `#ffffff` |
| 叙事弧 | Hook → Mechanism ×4 → Climax → Reflect |
| 字数/语速 | 505 字 / 329 WPM |
| 情感强度 | 5/5 |
| 置信度 | 10 confident, 3 inferred, 0 guess, 4 computed |
| 可疑声明 | 3 条需验证 |

---

## 4. Stage 3: RESEARCH — 主题研究

**调用次数**: 2 次（事实研究 + 声明验证）  
**总耗时**: ~38.1s  
**方法**: generateText  
**提供者**: CHAT (Gemini)

### Step 3a: 事实研究 Prompt

> **模板来源**: `src/pipeline/prompts.ts` → `RESEARCH_PROMPT`

```
You are a research assistant for a science video production system.

New topic: 生而为人有多难得

Search for and compile research data on this topic.

Requirements:
1. Find 5-7 verified facts with reliable sources
2. Identify 2-3 common myths or misconceptions
3. Create a glossary of key terms (3-5 terms)
4. Each fact must be specific enough to use as a data point in a video script
   (include numbers/comparisons where possible)
5. Each fact must be visually imaginable as a 3D animation scene

ADDITIONAL TASK: The following numeric claims from the reference video
need verification:
- "1-5 cancer cells produced daily" (value: 1-5, severity: medium)
- "Kidneys filter 180 liters a day" (value: 180, severity: low)
- "Final 5% adrenaline distribution at death" (value: 5%, severity: high)

Output as JSON: { facts[], myths[], glossary[] }
```

**研究结果**:
| 事实 ID | 内容 | 置信度 | 状态 |
|---------|------|--------|------|
| fact-1 | 出生概率：400 万亿分之一 | 0.3 | ⚠ disputed |
| fact-2 | 体内原子：70 亿亿亿个 | 1.0 | ✅ verified |
| fact-3 | 心脏：每天跳动 10 万次 | 1.0 | ✅ verified |
| fact-4 | DNA 总长度：200 亿公里 | 1.0 | ✅ verified |
| fact-5 | 大脑：860 亿神经元 | 1.0 | ✅ verified |

### Step 3b: 声明验证 Prompt

```
Verify the following numeric claims independently. For each:
- Search for authoritative sources
- Compare with the claimed value
- Rate confidence 0.0-1.0

Claims to verify:
- "1-5 cancer cells produced daily" (from reference video)
- "Kidneys filter 180 liters a day" (from reference video)
- "Final 5% adrenaline distribution at death" (from reference video)

Also verify these research facts:
[5 facts from Step 3a]
```

**验证结果**: 5 facts adjusted, 1 flagged (fact-1 的 "400 万亿分之一" 为病毒式引用而非同行评审的生物学统计数据)

---

## 5. Stage 4: NARRATIVE_MAP — 叙事结构

**调用次数**: 6 次（含超时重试）  
**总耗时**: ~262s（含两次 120s 超时）  
**方法**: generateText  
**提供者**: CHAT (Gemini)

### 校准 + 叙事结构 Prompt

> **模板来源**: `src/pipeline/prompts.ts` → `CALIBRATION_PROMPT`

```
You are a narrative structure expert for science explainer videos.

Based on the following calibration data and style profile, generate
a narrative map.

Topic: 生而为人有多难得
Target duration: 92 seconds
Target word count: 505
Narrative arc: ["Hook","Mechanism","Mechanism","Mechanism","Mechanism","Climax","Reflect"]
Hook type: VisualHook

Verified facts available:
[Fact 1] 受精概率：千万分之一
[Fact 2] 37.2 万亿个细胞，每秒 380 万个更新
[Fact 3] 心脏每天跳动约 10 万次
[Fact 4] DNA 总长 200 亿公里
[Fact 5] 大脑 860 亿神经元

Output JSON: { narrative_map[] }
```

**校准结果**:
| 参数 | 值 |
|------|-----|
| 参考视频字数 | 505 |
| 参考视频时长 | 92s |
| 语速 | 329.35 字/分 |
| 目标字数 | 505 (范围: 454.5 - 555.5) |

**叙事地图**:
| 阶段 | 时长 | 目标字数 | 引用事实 |
|------|------|----------|----------|
| Hook | 12s | 66 字 | Fact 1 |
| Mechanism 1 (细胞更新) | 13s | 71 字 | Fact 2 |
| Mechanism 2 (DNA 蓝图) | 13s | 71 字 | Fact 4 |
| Mechanism 3 (心脏引擎) | 13s | 71 字 | Fact 3 |
| Mechanism 4 (神经宇宙) | 13s | 71 字 | Fact 5 |
| Climax (原子星尘) | 15s | 83 字 | All |
| Reflect (回归自我) | 13s | 72 字 | — |

---

## 6. Stage 5: SCRIPT_GENERATION — 脚本生成

**调用次数**: 4 次（3 次因字数/节奏不达标被拒，第 4 次通过）  
**成功耗时**: 29,070ms  
**方法**: generateText  
**提供者**: CHAT

### System Prompt

> **模板来源**: `src/pipeline/prompts.ts` → `SCRIPT_SYSTEM_PROMPT`

```
You are a science explainer video scriptwriter specializing in
emotionally resonant, high-retention short-form content.

Your scripts are for 3D animated videos. Each sentence will be
rendered as a separate 3D animation scene, so every sentence must
be visually concrete.

ABSOLUTE RULES:
1. Write entirely in Chinese
2. Every style constraint below is a HARD requirement
3. Content must be scientifically accurate
4. Never provide medical advice
5. Output strictly valid JSON only
6. NEVER include placeholder text
7. Every numeric claim MUST have a source marker
8. If you cannot verify a fact, omit it rather than guess
9. Maintain consistent tone throughout
10. Each sentence must be independently filmable as a 3D scene
```

### User Prompt（填充后的实际 Prompt）

```
# SCRIPT GENERATION — STYLE DNA CONSTRAINTS

## Section 1: Topic & Target
Target topic: 生而为人有多难得
Target audience: General public seeking emotional comfort and basic health awareness

## Section 2: Length Calibration
Target word count: 505 (HARD range: 454.5 - 555.5)
Target duration: 92 seconds
Reference speech rate: 329.35 words/characters per minute
Target sentence count: 26

## Section 3: Hook
Hook strategy: Direct emotional address combined with a startling
internal visual of the human anatomy.
Reference hook:「这可能是你第一次认识到，你的身体究竟有多爱你。」

## Section 3.5: Retention Architecture
- Sentence 1-3: Cognitive dissonance hook
- Sentence ~8: Pattern interrupt (counters 15s attention cliff)
- Every 4-5 sentences: Curiosity gap
- Sentence ~15: Second hook
- Final 3 sentences: Payoff + open loop

## Section 4-12: [Narrative structure, rhetorical requirements,
    sentence length, reference style, metaphor rules, CTA,
    fact integration, visual compatibility, narrative map]

## SELF-CHECK:
□ Total word count within range
□ Sentence count exactly 26
□ Every sentence is independently filmable
□ At least 3 facts with source markers
□ Emotional arc progresses correctly
□ No fabricated statistics
```

**验证过程**:
| 尝试 | 字数 | 结果 | 拒绝原因 |
|------|------|------|----------|
| 第 1 次 | 870 | ❌ | 字数超出 +57%；缺少数据锚点；句长过于均匀；情感弧线平坦 |
| 第 2 次 | 776 | ❌ | 字数超出 +40%；缺少数据锚点；情感弧线平坦 |
| 第 3 次 | 752 | ❌ | 字数超出 +35%；缺少数据锚点；情感弧线平坦 |
| 第 4 次 | 515 | ✅ | 通过 |

**自动修正审计**: 3 项修正
1. 修正拼写错误："不不可思议" → "不可思议"
2. 为 "三十七万亿个" 添加来源标记
3. 为心脏相关数据添加来源标记和具体说明

**质量分数**: style: 1.00, facts: 1.00

**最终脚本（26 句）**:

> 你或许从未察觉，你此刻的每一次呼吸都是一场千万分之一概率的神迹。  
> 据统计，受精过程中每一毫升精液含有一亿个精子，而最终只有一粒能冲破终点。  
> 你是从这场生死时速中唯一突围成功的超级英雄，这难道不可思议吗？  
> 但这还仅仅是个开始。  
> 据统计，你体内的三十七万亿个细胞正如同繁星般昼夜守望。  
> 科学家发现，每一秒钟就有三百八十万个细胞在为你进行着疯狂的更新。  
> 它们像是不眠不休的微小修理工，在你的生命工厂里争分夺秒地缝补伤痕。  
> 如果你以为这就是全部，那接下来的真相将让你目瞪口呆。  
> 你有没有想过，你的生命图纸竟然比星系还要辽阔？  
> 据基因组学计算，拉直你全身的DNA，其长度达两百亿公里，足以往返冥王星。  
> 这根金色的长线编织出了独一无二的你，它是跨越了宇宙级的浪漫注脚。  
> 那么，究竟是什么在驱动这台精密机器永不停歇地运转？  
> 研究显示，你的心脏每天跳动约十万次，泵出的血液足以填满一个巨大的油罐车。  
> 据研究显示，心脏产生的能量足以推动一辆重型卡车行驶三十二公里。  
> 这些律动背后，其实隐藏着一个更宏大的秘密。  
> 神经科学发现，你脑中的突触连接总数，甚至超过了已知银河系中所有星辰的数量。  
> 这意味着你每一次思考，都在脑海中引爆了一场小型的宇宙大爆炸。  
> 在这种极致的复杂面前，你真的还觉得自己只是一个普通人吗？  
> 科学家发现，你体内的原子数量高达七十亿亿亿个，这个数字堪称恐怖。  
> 它远远超过了全宇宙恒星的总和，你本身就是由星尘汇聚而成的星系。  
> 据统计，你出生的综合概率仅为四百万亿分之一，这本身就是个统计学奇迹。  
> 这种极致的偏爱，让你成为了这颗星球上最昂贵、最难得的碳基艺术品。  
> 但这难道还不足以让你感到被爱吗？  
> 当你以为自己一无所有，甚至被这个世界遗忘在角落的时候。  
> 不要忘了，你体内的每一个原子，每一刻都在为了让你活下去而拼命。  
> 你要相信，你的身体此刻还在以这种神迹般的方式，深沉且无声地爱着你。

---

## 7. Stage 6: QA_REVIEW — 质量审核

**调用次数**: 4 轮（AI 审核 + 确定性交叉验证）  
**方法**: generateText  
**提供者**: CHAT

### 自修正审计 Prompt

> **模板来源**: `src/pipeline/prompts.ts` → `QA_REVIEW_PROMPT`（此次实际使用的是 self-correction audit prompt）

```
You are a senior script editor performing a self-correction audit
on a science explainer video script.

## YOUR TASK
Review the script below and fix any issues. Do NOT rewrite the
entire script — only fix specific problems.

## SCRIPT TO AUDIT
[完整的 26 句脚本]

## STYLE DNA CONSTRAINTS TO CHECK AGAINST
- Target word count: 505 (range: 454.5 - 555.5)
- Target tone: emotional
- Hook strategy: Direct emotional address
- Narrative arc: Hook → Mechanism ×4 → Climax → Reflect
- Sentence length avg: 32 characters
- Sentence length max: 68 characters
- Metaphor count target: 6

## AUDIT CHECKLIST
1. Word count: Is total within range?
2. Factual integrity: Are all numeric claims sourced?
3. Style consistency: Does tone stay consistent?
4. Visual renderability: Can every sentence be independently rendered?
5. Safety: Any absolute medical/health claims?

Output JSON: { correctedScript, corrections[], auditResult }
```

### QA 审核 Prompt

```
You are a quality reviewer for science explainer video scripts.
Perform a 3-audit review.

## VIDEO INFO
Topic: 生而为人有多难得
Target word count: 505
Target style: Cinematic 3D animation, emotional

## AUDIT 1: ACCURACY & FACTUAL INTEGRITY (Score 1-10)
## AUDIT 2: STYLE CONSISTENCY (Score 1-10)
## AUDIT 3: PRODUCTION-READINESS (Score 1-10)
## AUDIT 4: CONTENT CONTAMINATION (Score 1-10)

Output JSON: { approved, feedback, scores, issues,
  suspiciousNumericClaims, styleDeviations, unfilmableSentences, 
  contentContamination }
```

**QA 结果**:
| 轮次 | AI 评分 | 确定性交叉验证 | 结果 |
|------|---------|---------------|------|
| 第 1 轮 | 9.5/10 ✅ | ❌ 字数超出 (675 > 555.5)；缺少数据锚点 | 被覆盖拒绝 |
| 第 2 轮 | 7.8/10 ❌ | — | 需要改进 |
| 第 3 轮 | 10/10 ✅ | ❌ 字数超出 (677 > 555.5) | 被覆盖拒绝 |
| 第 4 轮 | 9.8/10 ✅ | ❌ 字数超出 (675 > 555.5) | 4 次耗尽，best-effort 继续 |

**注**: AI 评分始终很高（9.5-10），但确定性验证器持续判定字数超标。最终以 best-effort 继续。

---

## 8. Stage 7: STORYBOARD — 分镜脚本

**调用次数**: 2 次  
**耗时**: ~40s  
**方法**: generateText  
**提供者**: CHAT

### 分镜 Prompt

> **模板来源**: `src/pipeline/prompts.ts` → `STORYBOARD_PROMPT`

```
You are a visual director for 3D animated science explainer videos.

Convert the following script into a scene-by-scene storyboard
with visual prompts suitable for AI image/video generation.

## CRITICAL: SCENE COUNT REQUIREMENT
You MUST generate EXACTLY ONE scene per script sentence.
The script has 26 sentences, so you MUST output exactly 26 scenes.

## CRITICAL: CROSS-TOPIC ADAPTATION
The STYLE DNA below is from a reference video about a DIFFERENT subject.
- KEEP: artistic medium (3D animation), lighting (high contrast cinematic),
  color palette, mood, camera motion
- REPLACE: subject-specific visual elements

## SCRIPT
[完整的 26 句脚本]

## STYLE DNA — VISUAL TRACK
- Base medium: 3D animation
- Lighting: high contrast cinematic
- Camera motion: [from style profile]
- Color temperature: [from style profile]
- Global color palette: #0a0a0a, #8b0000, #1e90ff, #ffd700, #ffffff
- Mood-specific palettes:
  - emotional: #8b0000, #ff4500, #3a0101
  - scientific: #000080, #1e90ff, #e0ffff
  - metaphorical: #1a1a1a, #7b68ee, #ffd700

## VISUAL METAPHOR MAPPINGS
Rule:「All abstract biology processes should be depicted as epic
cinematic 3D scenes with humanized emotions」

## REQUIREMENTS FOR EACH SCENE
1. Visual prompt (English, 30-80 words, self-contained)
2. Production specs (camera, lighting, sound)
3. Duration
4. Asset type (image/video)
5. Subject description
6. Emotional beat
7. Color mood
```

**输出**: 26 个场景分镜，全部通过主体隔离检查 (Subject Isolation Check)

---

## 9. Stage 8: REFERENCE_IMAGE — 参考图生成

**调用次数**: 6 次（1 参考表 + 3 场景 × 重试）  
**方法**: generateImage  
**提供者**: CHAT

### 参考表 Prompt

> **模板来源**: `src/pipeline/prompts.ts` → `REFERENCE_SHEET_PROMPT`

```
Create a "Style Reference Sheet" for an educational science video
about: 生而为人有多难得.

Style DNA (Strict Adherence):
- Art Style: Cinematic 3D animation
- Color Palette: #0a0a0a, #8b0000, #1e90ff, #ffd700, #ffffff
- Lighting: high contrast cinematic
- Aspect ratio: 16:9

Instructions:
- Show 3-4 representative visual vignettes in this exact style
- If the topic has a main character, show them in 2-3 poses
- Include sample backgrounds, props, and UI elements
- Quality: highly detailed, production-ready asset

Generate the image directly. Do not describe it in text.
```

### 场景参考图 Prompt

> **模板来源**: `src/pipeline/prompts.ts` → `IMAGE_GEN_PROMPT`

```
为科学科普视频场景生成一张高质量图片。

场景描述: [分镜中的 visualPrompt]

风格要求:
- 配色: #0a0a0a, #8b0000, #1e90ff, #ffd700, #ffffff
- 光影: high contrast cinematic
- 风格: Cinematic 3D animation
- 宽高比: 16:9

请直接生成这张图片，不要用文字描述。要求画面精美，适合专业科普视频使用。
```

**生成结果**: 3/3 参考图成功（Scene 1, 14, 26）

---

## 10. Stage 9: KEYFRAME_GEN — 关键帧生成

**调用次数**: 47 次  
**方法**: generateImage  
**提供者**: CHAT

### 关键帧 Prompt 示例（Scene 1）

```
为科学科普视频场景生成一张高质量图片。

场景描述: A high-fidelity 3D animation of a human silhouette made 
of glowing blue particles. As the figure inhales, a swirling vortex 
of golden light particles enters the chest. High contrast cinematic 
lighting, deep black background #0a0a0a, cool blue #1e90ff 
highlights, 8k resolution, macro shot.

风格要求:
- 配色: #0a0a0a, #8b0000, #1e90ff, #ffd700, #ffffff
- 光影: high contrast cinematic
- 风格: Cinematic 3D animation
- 宽高比: 16:9

请直接生成这张图片，不要用文字描述。
```

**生成结果**: 19/19 关键帧成功（100% fresh，无 fallback）

---

## 11. Stage 10: VIDEO_GEN — 视频生成

**调用次数**: 76 次（全部失败）  
**方法**: generateVideo  
**提供者**: CHAT → Kling AI  
**状态**: ❌ 失败

### 视频生成 Prompt 示例

> **模板来源**: `src/pipeline/prompts.ts` → `VIDEO_GEN_PROMPT`

```
3D macro view of a cellular surface where millions of glowing spheres
are popping and being replaced by new brilliant white lights #ffffff.
High speed motion, high contrast cinematic lighting, cool blue shadows,
dynamic and energetic movement.

Style: Cinematic 3D animation, high contrast cinematic, 
color palette #0a0a0a, #8b0000, #1e90ff, #ffd700, #ffffff.
Aspect ratio: 16:9. Duration: ~3.8s.
```

**失败原因**: Kling AI 视频服务商未登录或配额耗尽。所有 19 个场景均降级为静态图片。

---

## 12. Stage 11-13: TTS / ASSEMBLY / REFINEMENT

**状态**: ⏳ 未执行（因 VIDEO_GEN 失败而阻塞）

### TTS Prompt（模板）

TTS 使用 `edge-tts` 本地引擎，不涉及 AI prompt。将脚本文本直接转为语音。

### ASSEMBLY

使用 FFmpeg 进行视频组装，不涉及 AI prompt。将关键帧/视频片段 + TTS 音频 + BGM 合成为最终视频。

### REFINEMENT

最终质量检查阶段。

---

## 13. 总结与统计

### 完成状态

| 阶段 | 状态 | 耗时 | AI 调用次数 |
|------|------|------|------------|
| CAPABILITY_ASSESSMENT | ✅ | 0s | 0 |
| STYLE_EXTRACTION | ✅ | 293.6s | 2 |
| RESEARCH | ✅ | 38.1s | 2 |
| NARRATIVE_MAP | ✅ | 262.1s | 6 |
| SCRIPT_GENERATION | ✅ | ~120s | 4 |
| QA_REVIEW | ✅ (best-effort) | ~180s | 8 |
| STORYBOARD | ✅ | ~40s | 2 |
| REFERENCE_IMAGE | ✅ | ~360s | 6 |
| KEYFRAME_GEN | ✅ | ~600s | 47 |
| VIDEO_GEN | ❌ 失败 | 281s | 76 |
| TTS | ⏳ 未执行 | — | — |
| ASSEMBLY | ⏳ 未执行 | — | — |
| REFINEMENT | ⏳ 未执行 | — | — |

### Prompt 工程关键设计

1. **自我评估 (Self-Assessment)**: 在提取前先让 AI 评估自身能力上限，建立置信度基线
2. **三轨分析 (Track A/B/C)**: 脚本/视觉/音频三个独立维度，每个字段带置信度标注
3. **校准先行 (Calibration-First)**: 通过参考视频数据校准语速和字数目标，避免凭感觉估计
4. **硬约束注入 (Hard Constraints)**: System prompt 中的 10 条绝对规则不可违反
5. **留存架构 (Retention Architecture)**: 在 5 个关键位置植入留存设备，对抗注意力衰减
6. **确定性交叉验证 (Deterministic Cross-check)**: AI 通过后再用代码验证字数/钩子/情感弧等硬指标
7. **自修正审计 (Self-Correction Audit)**: 脚本生成后让 AI 自查并修正问题
8. **视觉隐喻映射 (Visual Metaphor Mapping)**: 将抽象概念映射为具体 3D 场景的规则
9. **风格锚定 (Style Anchor)**: 参考表 + 3 张样图建立视觉一致性基线
10. **主体隔离检查 (Subject Isolation)**: 验证每个分镜都有清晰的视觉主体

### 文件位置

- 项目目录: `~/Library/Application Support/ai-video-browser-shell/data/projects/proj_1775959231425/`
- AI 日志: `ai-logs/` (166 个 JSON 文件)
- Prompt 模板: `src/pipeline/prompts.ts`
- 提取的 Prompt 详情: `prompt-details.json`
- 流水线指标: `pipeline-metrics.json`
