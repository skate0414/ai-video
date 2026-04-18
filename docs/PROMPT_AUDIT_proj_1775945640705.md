# Prompt 全流程审计文档

> **项目**: `proj_1775945640705` — 生而为人有多难得  
> **参考视频**: 你的身体有多爱你.mp4（92 秒，504 字，中文）  
> **生成日期**: 2026-04-12  
> **管线**: 13 阶段（CAPABILITY_ASSESSMENT → REFINEMENT）

---

## 目录

1. [Stage 0 — CAPABILITY_ASSESSMENT](#stage-0--capability_assessment)
2. [Stage 1 — STYLE_EXTRACTION（风格提取）](#stage-1--style_extraction风格提取)
3. [Stage 2 — RESEARCH（主题研究）](#stage-2--research主题研究)
4. [Stage 3 — NARRATIVE_MAP（叙事地图）](#stage-3--narrative_map叙事地图)
5. [Stage 4 — SCRIPT_GENERATION（脚本生成）](#stage-4--script_generation脚本生成)
6. [Stage 5 — QA_REVIEW（质量审核）](#stage-5--qa_review质量审核)
7. [Stage 6 — STORYBOARD（分镜脚本）](#stage-6--storyboard分镜脚本)
8. [Stage 7 — REFERENCE_IMAGE（参考图生成）](#stage-7--reference_image参考图生成)
9. [Stage 8 — KEYFRAME_GEN（关键帧生成）](#stage-8--keyframe_gen关键帧生成)
10. [Stage 9 — VIDEO_GEN（视频片段生成）](#stage-9--video_gen视频片段生成)
11. [Stage 10 — TTS（语音合成）](#stage-10--tts语音合成)
12. [Stage 11 — ASSEMBLY（视频组装）](#stage-11--assembly视频组装)
13. [Stage 12 — REFINEMENT（补全修复）](#stage-12--refinement补全修复)
14. [全流程 AI 调用统计](#全流程-ai-调用统计)

---

## Stage 0 — CAPABILITY_ASSESSMENT

| 属性 | 值 |
|------|-----|
| **AI 调用次数** | 0 |
| **输出** | `{ safe: true, reason: "Safety check disabled" }` |

**无 Prompt**。此阶段为纯确定性逻辑——通过 Provider 注册表探测当前可用的文本/图片/视频/搜索/上传能力，不发送任何 LLM 请求。

**设计分析**：安全检查功能已被禁用（`always returns safe: true`），仅保留 Provider 能力探测。原始设计包含内容安全预检，但因科普主题不需要内容审查而在上一轮迭代中移除。

---

## Stage 1 — STYLE_EXTRACTION（风格提取）

### Call 1: 自我评估（Self-Assessment）

| 属性 | 值 |
|------|-----|
| **类型** | `generateText` |
| **响应格式** | 纯文本（非 JSON） |
| **输入** | 压缩后的参考视频 + Prompt |
| **超时** | 1,200,000 ms (20 分钟) |
| **失败策略** | 非阻塞——失败后静默跳过 |

**Prompt 全文**:

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

**设计分析**：

- **为什么先让 AI 自我评估？** 这是一种"元认知引导"策略——让 LLM 先评估自己能力，而不是直接要求提取。好处是：
  1. LLM 在评估能力时会思考 video→text 的信息损失边界
  2. Q4 强制它区分 "能观察到的" 和 "推断的"，为后续 `nodeConfidence` 标注建立基准
  3. Q5 让它主动发现盲点字段
- **为什么用纯文本而非 JSON？** 明确标注 "This is a dialogue, not an extraction task" —— 自由格式允许 LLM 更自然地表达不确定性，避免 JSON 格式迫使它在每个字段填一个值
- **非阻塞设计**：即使自我评估失败，提取仍可继续。自我评估输出被注入 Call 2 的 prompt 中，起到"上下文增强"作用

---

### Call 2: 风格 DNA 提取（Main Extraction）

| 属性 | 值 |
|------|-----|
| **类型** | `generateText` |
| **响应格式** | `application/json` |
| **输入** | 压缩后的参考视频 + 主提取 Prompt（末尾附加 Call 1 的自我评估文本） |
| **超时** | 1,200,000 ms (20 分钟) |

**Prompt 全文**:

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
color temperature, scene duration, transition style, b-roll ratio, visual
metaphor mapping.

### Track C – Audio
Analyze: BGM genre/mood/tempo, voice style, relative volume, audio-visual
sync points.

## CONFIDENCE TAGGING
For EVERY field, assign a confidence level in the "nodeConfidence" object:
- "confident" — directly observed from video
- "inferred" — educated guess based on limited evidence
- "guess" — no direct evidence, using domain defaults

## SUSPICIOUS CLAIMS
If the video contains numeric claims that seem exaggerated or unverifiable,
list them in "suspiciousNumericClaims" for downstream research verification.

## OUTPUT FORMAT
Output a single JSON object (no markdown code blocks, first char must be {,
last must be }):
{
  "meta": {
    "video_language": "Chinese or English",
    "video_duration_sec": number,
    "video_type": "e.g. science explainer, educational, documentary"
  },
  "visualStyle": "...",
  "pacing": "fast/medium/slow",
  "tone": "...",
  "colorPalette": ["#hex1", "#hex2", ...],
  "colorPaletteByMood": { ... },
  "targetAudience": "...",
  "narrativeStructure": ["Hook", "Problem", "Mechanism", "Climax", "CTA"],
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
    "transition_style": "...",
    "visual_metaphor_mapping": {
      "rule": "...",
      "examples": [...]
    },
    "b_roll_ratio": 0.0-1.0,
    "composition_style": "..."
  },
  "track_c_audio": { ... },
  "fullTranscript": "complete transcript of the video",
  "nodeConfidence": { ... },
  "suspiciousNumericClaims": [...]
}
```

**（末尾附加 Call 1 自我评估文本作为上下文）**

**本项目提取结果**:

| 字段 | 提取值 | 置信度 |
|------|--------|--------|
| `meta.video_language` | Chinese | confident |
| `meta.video_duration_sec` | 92 | confident |
| `pacing` | fast | confident |
| `tone` | emotional, awe-inspiring, solemn | confident |
| `emotionalIntensity` | 5 | guess |
| `wordCount` | 504 (从 transcript 计算覆盖) | computed |
| `wordsPerMinute` | 329 (从 transcript 计算覆盖) | computed |
| `hookType` | Emotional/VisualHook | confident |
| `track_a.sentence_length_avg` | 46 (字符) | confident |
| `track_a.sentence_length_max` | 68 (字符) | confident |
| `track_a.metaphor_count` | 5 | confident |
| `track_b.base_medium` | mixed | confident |
| `track_b.lighting_style` | cinematic, low-key, high contrast, volumetric glowing for cells | confident |
| `colorPaletteByMood` | null | inferred |

**可疑数据声称（传递给下游 RESEARCH 验证）**:

| 声称 | 严重度 |
|------|--------|
| "每天都会有1-5个细胞产生癌变" | medium |
| "将身体中仅剩5%的肾上腺素全部分配给神经系统和声带肌肉" | high |

**设计分析**：

- **三轨分析（Script/Visual/Audio）**：对应下游三条管线的精确数据需求，避免提取无用字段
- **nodeConfidence 三级标注**：`confident` / `inferred` / `guess` 三级，直接驱动下游脚本生成的约束宽松度（guess +30%，inferred +15%，confident 严格匹配）
- **suspiciousNumericClaims**：视频中可能夸大的数字会被提取出来，传递给 RESEARCH 阶段的事实核查系统
- **fullTranscript**：关键字段——后续会从 transcript 重新计算 `wordCount` 和 `wordsPerMinute`（覆盖 LLM 的估计值），确保校准精度
- **JSON 输出格式化**：明确要求 "first char must be {, last must be }" —— 防止 LLM 输出 markdown 代码块

---

### Call 3: 补充提取（Supplement，条件触发）

| 属性 | 值 |
|------|-----|
| **触发条件** | `validateStyleContract()` 发现 CRITICAL 字段缺失或标记为 guess/inferred |
| **响应格式** | `application/json` |
| **输入** | 参考视频 + 动态构建的补充 prompt |

**Prompt 格式（动态生成）**:

```
The following CRITICAL fields were missing from your previous response.
Please extract them carefully:
  - [字段路径 1]
  - [字段路径 2]
The following CRITICAL fields were marked as "guess". Please re-examine
the video and provide more confident values:
  - [字段路径 3]
Return ONLY a JSON object with these fields. Do not repeat fields you
already provided confidently.
```

**设计分析**：

- **合约验证驱动**：`styleContract.ts` 定义了每个字段的 CRITICAL/NICE_TO_HAVE 级别，只有 CRITICAL 字段缺失才触发补充
- **定向补充**：不要求重新提取全部字段，只要求缺失部分——降低 token 消耗和重复错误风险
- **非阻塞**：即使补充失败也不阻塞管线，仅影响下游置信度评分

---

## Stage 2 — RESEARCH（主题研究）

### Call 1: 主题研究

| 属性 | 值 |
|------|-----|
| **类型** | `generateText` |
| **响应格式** | `application/json` |
| **工具增强** | Gemini 适配器会启用 `googleSearch` grounding |
| **模板变量** | `{topic}` = "生而为人有多难得" |

**Prompt 全文**:

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

**（如果 Stage 1 提取到 suspiciousNumericClaims，会在此 prompt 末尾附加验证请求）**

本项目附加内容:
```
Additionally, please verify the following suspicious claims found in the
reference video:
- "每天都会有1-5个细胞产生癌变" (severity: medium)
- "将身体中仅剩5%的肾上腺素全部分配给神经系统和声带肌肉" (severity: high)
```

**设计分析**：

- **facts 包含 `aggConfidence`**：0-1 浮点数，让下游脚本决定引用哪些事实
- **`type` 字段**：`verified` / `disputed` / `unverifiable` —— 被标记为 `disputed` 的事实不会进入脚本
- **视觉可行性要求**：每个事实必须"visually imaginable as a 3D animation scene"——直接服务于后续视觉管线
- **Gemini grounding**：当使用 Gemini 适配器时，启用 Google Search 工具进行实时检索，提高事实可靠性

---

### Call 2: 事实核查（交叉验证）

| 属性 | 值 |
|------|-----|
| **类型** | `generateText` |
| **响应格式** | `application/json` |
| **适配器** | 使用不同模型（`claim_verification` 任务类型）进行交叉验证 |
| **模板变量** | `{topic}`, `{facts_list}` |

**Prompt 全文**:

```
You are a fact-checking specialist. Your ONLY task is to verify the accuracy
of the following claims about "生而为人有多难得".

For each claim below, check whether it is factually accurate. Be skeptical —
treat each claim as potentially wrong until you can confirm it.

## CLAIMS TO VERIFY
[Fact fact-6] 你身体里的每一个原子，其实都源自数十亿年前恒星爆炸后的残骸……
[Fact fact-7] 人类嗅觉可以分辨超过1万亿种不同的气味……
...

## OUTPUT FORMAT (JSON only, no markdown):
{
  "verifications": [
    {
      "factId": "fact-1",
      "verdict": "confirmed" | "disputed" | "unverifiable",
      "confidence": 0.0-1.0,
      "correction": "if disputed: the correct information (null if confirmed)",
      "reason": "brief explanation of your verdict"
    }
  ]
}

RULES:
- If you are not sure, mark as "unverifiable" with low confidence
- Do NOT confirm claims just because they sound plausible
- If a number is cited, check the order of magnitude at minimum
- Common misconceptions should be flagged even if widely believed
```

**设计分析**：

- **交叉模型验证**：使用不同 LLM 模型（`claim_verification`）进行独立事实核查，避免同一模型自我验证的偏差
- **怀疑心态指令**："Be skeptical — treat each claim as potentially wrong" —— 对抗 LLM 确认偏差
- **数量级检查**："If a number is cited, check the order of magnitude" —— 科普视频对数字准确性要求高

---

## Stage 3 — NARRATIVE_MAP（叙事地图）

### Call 1: 校准（Calibration）

| 属性 | 值 |
|------|-----|
| **类型** | `generateText` |
| **响应格式** | `application/json` |

**Prompt 全文（变量已填入）**:

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

Reference narrative arc stages: ["Thesis introduction","Statistical proof of
invisible battles","Highlighting organ dedication (Heart, Kidneys, White Blood
Cells)","The impossibility of easy self-destruction","The romanticized death
sequence (Terminal lucidity)","Micro-to-macro cosmic metaphor","Concluding
emotional reassurance"]

Hook type: Direct personification of the human body combined with an empathetic
second-person address.
CTA pattern: Conditional emotional state (当你以为...) + Imperative anchor
(不要忘了) + Reaffirming thesis (你的身体还在...)
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

**校准结果**:

| 参数 | 值 |
|------|-----|
| 参考词数 | 504 |
| 参考时长 | 92s |
| 计算语速 | 328.7 字/分 |
| 目标词数 | 504 |
| 目标词数范围 | 453.6 - 554.4 |

**设计分析**：

- **语速校准**：从参考视频的 实际字数/实际时长 计算出目标语速，确保新视频与样本节奏匹配
- **±10% 范围**：`target_word_count_min/max` 给脚本生成留出弹性空间
- **事实绑定 `verified_facts`**：将核查过的事实关联到叙事阶段的 `recommended_stage`，指导脚本生成器在正确位置引用数据

---

### Call 2: 叙事地图生成

| 属性 | 值 |
|------|-----|
| **类型** | `generateText` |
| **响应格式** | `application/json` |

**Prompt 全文**:

```
You are a narrative structure expert for science explainer videos.

Based on the following calibration data and style profile, generate a
narrative map.

Topic: 生而为人有多难得
Target duration: 92 seconds
Target word count: 504
Narrative arc: ["Hook","Problem (Cellular threats & neglect)","Mechanism
(Organ hyper-efficiency & sacrifice)","Climax (Terminal lucidity & ultimate
defense)","Resolution (Cosmic connection)","CTA (Emotional reflection)"]
Hook type: Emotional/VisualHook

Verified facts available:
[Fact 1] 人类受精成功的概率约为两亿五千万分之一，堪比在超级头彩中连续中奖。
[Fact 2] 人体内每秒有380万个细胞在进行自我更新和替换，以维持生命运转。
[Fact 3] 大脑在极度缺氧状态下，会牺牲非核心区域的能量供给，全力守护意识中枢。

Output JSON (no markdown):
{
  "narrative_map": [
    {
      "stage_title": "stage name",
      "description": "what this stage achieves",
      "estimated_duration_sec": number,
      "target_word_count": number,
      "fact_references": [1, 2]
    }
  ]
}
```

**生成结果（6 个叙事阶段）**:

| 阶段 | 时长 | 目标字数 | 事实引用 |
|------|------|----------|----------|
| Hook | 12s | 66 | Fact 1 |
| Problem (Cellular threats & neglect) | 15s | 82 | — |
| Mechanism (Organ hyper-efficiency & sacrifice) | 20s | 110 | Fact 2 |
| Climax (Terminal lucidity & ultimate defense) | 20s | 110 | Fact 3 |
| Resolution (Cosmic connection) | 15s | 82 | — |
| CTA (Emotional reflection) | 10s | 54 | — |

**设计分析**：

- **叙事弧形继承**：`narrativeStructure` 直接来自样本视频的风格 DNA，确保新视频遵循相同的情感曲线
- **字数分配**：按时长比例分配每个阶段的字数配额，维持整体节奏一致性
- **事实锚点**：通过 `fact_references` 将核查事实绑定到具体叙事阶段

---

## Stage 4 — SCRIPT_GENERATION（脚本生成）

### System Prompt

```
You are a science explainer video scriptwriter specializing in emotionally
resonant, high-retention short-form content.

Your scripts are for 3D animated videos. Each sentence will be rendered as a
separate 3D animation scene, so every sentence must be visually concrete.

ABSOLUTE RULES:
1. Write entirely in Chinese
2. Every style constraint below is a HARD requirement — deviation means failure
3. Content must be scientifically accurate — never fabricate data
4. This is science communication, not medical advice
5. Output strictly valid JSON only (first char must be {, last must be })
6. NEVER include placeholder text like [INSERT], [TODO], or TBD
7. Every numeric claim MUST have a source marker (研究显示/据统计/科学家发现)
8. If you cannot verify a fact, omit it rather than guess
9. Maintain consistent tone throughout
10. Each sentence must be independently filmable as a 3D scene
```

### User Prompt（变量已填入本项目实际值）

```
# SCRIPT GENERATION — STYLE DNA CONSTRAINTS

## Section 1: Topic & Target
Target topic: 生而为人有多难得
Target audience: General public experiencing stress, depression, or lack of
self-care, seeking emotional validation through scientific metaphors.

## Section 2: Length Calibration
Target word count: 504 (HARD range: 453.6 - 554.4)
Target duration: 92 seconds
Reference speech rate: 328.7 字/分
Target sentence count: 37 (HARD requirement — each sentence becomes one
video scene)

## Section 3: Hook
Hook strategy: Direct personification of the human body combined with an
empathetic second-person address.

Reference hook from original video（学习句式结构和情感冲击方式，不抄内容）:
「这可能是你第一次认识到，你的身体究竟有多爱你」

Your opening must:
- Use the primary opening strategy
- Complete the hook within 3 sentences
- Use second-person address from the very first sentence
- Achieve the same emotional punch as the reference hook

## Section 3.5: Retention Architecture
1. Sentence 1-3 (0-5s): Cognitive dissonance hook — present an unexpected fact
2. Sentence ~8 (15-20s): Pattern interrupt — break the established rhythm
3. Every 4-5 sentences: Curiosity gap
4. Sentence ~15 (30-40s): Second hook — new surprising angle
5. Final 3 sentences: Payoff + open loop

## Section 4: Narrative Structure
Follow this exact stage sequence:
- Hook → Problem (Cellular threats & neglect) → Mechanism → Climax →
  Resolution → CTA
Emotional tone arc: Intrigue -> Guilt -> Awe -> Sorrow/Solemnity ->
Epic/Uplifting Reassurance

## Section 5: Rhetorical Requirements
Personification (organs as loyal servants/heroes), extreme statistical
contrast, macro/micro analogy.

## Section 6: Sentence Length
Unit: characters
Average: 46 characters
Hard maximum: 68 characters
  Exception context: [根据置信度调整 — confident 时严格执行]
Interaction cues target: 0
Jargon treatment: mixed
Pacing: fast
Emotional intensity: 5 (1-5 scale)

## Section 7: Reference Style Example
[参考视频前 300 字 transcript 的脱敏版本]

## Section 8: Metaphor & Visual Rule
Include exactly 5 metaphors or analogies.
Visual metaphor rule:
「Biological mechanisms are visualized as vast landscapes or epic conflicts,
pairing microscopic 3D renders with matching human behavioral b-roll.」

Reference examples:
- Terminal Lucidity → Glowing synaptic flashes + person waking up with EEG cap
- Cellular scale → Microscopic cells dissolving into glowing galaxy

## Section 9: Call to Action
CTA structural template:
Conditional emotional state (当你以为...) + Imperative anchor (不要忘了) +
Reaffirming thesis (你的身体还在...)

## Section 10: Fact Integration
Verified facts to use (use at least 3 with source markers):
[Fact 1] 人类受精成功的概率约为两亿五千万分之一 (source: 统计学家估算)
[Fact 2] 人体内每秒有380万个细胞在进行自我更新和替换 (source: 生物学家发现)
[Fact 3] 大脑在极度缺氧状态下会牺牲非核心区域 (source: 神经科学研究显示)

## Section 11: Visual Compatibility
Base medium: mixed
Every sentence must describe something that can be rendered as a mixed scene.

## Section 12: Narrative Map
[JSON 叙事地图 — 6 个阶段的时长和字数配额]

## SELF-CHECK
□ Total word count is within [453.6, 554.4]
□ Sentence count is exactly 37 (±2 allowed)
□ Every sentence can be filmed independently
□ At least 3 verified facts with source markers
□ Metaphor count matches 5 ±1
□ Hook follows specified strategy
□ Emotional arc progresses as specified
□ No fabricated statistics
□ CTA follows structural template
□ Output is valid JSON
```

**生成结果**: 37 个句子，总字数 515

| 句子 | 文本 | 阶段 |
|------|------|------|
| 1 | 也许你从未发现，你的身体其实比任何人都更渴望让你活下去。 | Hook |
| ... | ... | ... |
| 37 | 请务必好好爱自己，因为你值得被这万千星辰温柔以待。 | CTA |

**设计分析**：

- **12 个 Section 设计**：每个 Section 对应风格 DNA 的一个维度，形成全方位约束网
- **Retention Architecture (Section 3.5)**：基于短视频观众注意力衰减曲线设计的留存节拍点——5s/15s/30s 是关键流失点
- **Reference Style Example (Section 7)**：注入参考 transcript 的前 300 字作为"句式节奏参考"，但明确说明"学习句式结构和情感冲击方式，不抄内容"
- **SELF-CHECK 清单**：要求 LLM 在输出前自检 10 个维度——相当于给 LLM 植入一个内部 QA 循环
- **置信度感知的约束宽松**：`sentence_length_max` 和 `metaphor_count` 根据 `nodeConfidence` 动态调整：
  - `guess` → +30% / 宽范围
  - `inferred` → +15% / 窄范围
  - `confident` → 严格匹配

---

### 脚本验证循环（deterministic，非 AI）

生成后，`validateScript()` 进行确定性检查：
- 字数范围
- 句子数量
- 最大句长
- 事实引用数

如果验证失败，将反馈注入下一轮 prompt 重试（最多 3 次）。

---

### 脚本审计（Script Audit）

| 属性 | 值 |
|------|-----|
| **类型** | `generateText` |
| **适配器** | 不同模型（`quality_review` 任务类型） |
| **响应格式** | `application/json` |

**Prompt 全文**:

```
You are a senior script editor performing a self-correction audit on a
science explainer video script.

## YOUR TASK
Review the script below and fix any issues. Do NOT rewrite the entire
script — only fix specific problems.

## SCRIPT TO AUDIT
[37 句脚本全文]

## STYLE DNA CONSTRAINTS TO CHECK AGAINST
- Target word count: 504 (range: 453.6 - 554.4)
- Target tone: emotional, awe-inspiring, solemn
- Hook strategy: Direct personification...
- Narrative arc: [...]
- Sentence length avg: 46 characters
- Sentence length max: 68 characters
- Metaphor count target: 5
- Video language: Chinese

## AUDIT CHECKLIST
1. Word count: within range?
2. Factual integrity: all claims sourced?
3. Style consistency: tone consistent?
4. Visual renderability: every sentence filmable as mixed scene?
5. Safety: any absolute medical/health claims?

## OUTPUT FORMAT (JSON only):
{
  "correctedScript": "...",
  "corrections": [...],
  "styleConsistencyScore": 0.0-1.0,
  "factCoverageScore": 0.0-1.0,
  "wordCountDelta": number,
  "passed": true/false
}
```

**设计分析**：

- **交叉模型审计**：使用不同模型进行审计，避免同一模型的系统性偏差
- **修复而非重写**："Do NOT rewrite the entire script — only fix specific problems" —— 防止审计模型推翻整个脚本
- **五维检查清单**：事实完整性、风格一致性、视觉可行性、安全性、字数

---

## Stage 5 — QA_REVIEW（质量审核）

| 属性 | 值 |
|------|-----|
| **类型** | `generateText`，最多 4 次重试 |
| **响应格式** | `application/json` |
| **模板变量** | `{topic}`, `{script_text}`, `{target_word_count}`, `{visual_style}`, `{tone}`, `{narrative_arc}`, `{reference_transcript_sample}` |

**Prompt 全文**:

```
You are a quality reviewer for science explainer video scripts.
Perform a 3-audit review.

## VIDEO INFO
Topic: 生而为人有多难得
Target word count: 504
Target style: mixed, emotional, awe-inspiring, solemn
Target narrative arc: ["Hook","Problem (Cellular threats & neglect)",
"Mechanism (Organ hyper-efficiency & sacrifice)","Climax (Terminal lucidity
& ultimate defense)","Resolution (Cosmic connection)","CTA (Emotional
reflection)"]

## SCRIPT TO REVIEW
[完整 37 句脚本]

## AUDIT 1: ACCURACY & FACTUAL INTEGRITY (Score 1-10)
Check for:
- Fabricated statistics without source markers
- Misleading implications
- Medical/health claims
- Suspicious numeric claims
- Missing source markers

Scoring anchors:
- 9-10: All facts sourced, no fabrication
- 6-7: 2+ unsourced claims
- 1-3: Multiple fabricated facts

## AUDIT 2: STYLE CONSISTENCY (Score 1-10)
Check against Style DNA:
- Tone matches throughout?
- Sentence length within range?
- Hook follows strategy?
- Emotional arc progresses?
- Metaphor count appropriate?

Scoring anchors:
- 9-10: Tone fully consistent, rhythm matches
- 6-7: 2+ register shifts
- 1-3: Tone inconsistent

## AUDIT 3: PRODUCTION-READINESS (Score 1-10)
Check for:
- Every sentence independently renderable as 3D scene?
- Pacing appropriate?
- CTA feels natural?
- Word count within range?

## AUDIT 4: CONTENT CONTAMINATION (Score 1-10)
Reference transcript excerpt:
---
[参考视频前 500 字 transcript]
---

Compare generated script against reference:
- Copied sentences (>8 chars verbatim)?
- Same facts/statistics reused?
- Same visual metaphors?
- Subject-specific terminology bleeding in?

## OUTPUT FORMAT (JSON only):
{
  "approved": true/false (true if overall_score >= 8),
  "feedback": "brief summary",
  "scores": {
    "accuracy": 1-10,
    "styleConsistency": 1-10,
    "productionReadiness": 1-10,
    "engagement": 1-10,
    "overall": 1-10
  },
  "issues": [...],
  "suspiciousNumericClaims": [...],
  "styleDeviations": [...],
  "unfilmableSentences": [...],
  "contentContamination": {
    "score": 1-10,
    "copiedPhrases": [...],
    "reusedFacts": [...],
    "reusedMetaphors": [...]
  }
}
```

**本项目结果**: `approved: true`（由 `run-free-pipeline.mjs` 自动批准）

**设计分析**：

- **四维审计**：准确性、风格一致性、生产就绪性、内容污染——每维独立评分
- **内容污染检测 (Audit 4)**：这是防抄袭机制——通过注入参考 transcript 原文，让 QA 检查新脚本是否抄了样本视频的内容（应该只学风格，不抄内容）
- **评分锚点（Scoring Anchors）**：给 LLM 提供每个分数段对应的具体标准，减少评分的主观漂移
- **分数异常检测**：如果某维度 < 5 但总体 >= 8，自动否决——防止某维度严重缺陷被平均分掩盖
- **重试机制**：QA 失败时，将 QA 反馈注入脚本生成器重新生成脚本，最多 3 轮

---

## Stage 6 — STORYBOARD（分镜脚本）

### Call 1: 分镜生成

| 属性 | 值 |
|------|-----|
| **类型** | `generateText` |
| **响应格式** | `application/json` |

**Prompt 全文（变量已填入）**:

```
You are a visual director for 3D animated science explainer videos.

Convert the following script into a scene-by-scene storyboard with visual
prompts suitable for AI image/video generation.

## CRITICAL: SCENE COUNT REQUIREMENT
You MUST generate EXACTLY ONE scene per script sentence. The script has 37
sentences, so you MUST output exactly 37 scenes. Do NOT merge sentences.

## CRITICAL: CROSS-TOPIC ADAPTATION
The STYLE DNA below is from a reference video about a potentially DIFFERENT
subject. You MUST ADAPT the visual style to fit the NEW topic "生而为人有多难得".
- KEEP: artistic medium (mixed), lighting (cinematic, low-key, high contrast),
  color palette, mood, camera motion
- REPLACE: subject-specific visual elements

## SCRIPT
[完整 37 句脚本]

## STYLE DNA — VISUAL TRACK
- Base medium: mixed
- Lighting: cinematic, low-key, high contrast, volumetric glowing for cells
- Camera motion: slow dolly in, dynamic microscopic orbit, rapid zoom
- Color temperature: warm
- Color palette: ["#4A0404","#000000","#1A365D","#F5F5F5","#8B0000"]
- Composition: centered
- Transition: hard cut, interspersed with digital morphs
- Average scene duration: 2.5s

## VISUAL METAPHOR MAPPINGS
Rule:「Biological mechanisms are visualized as vast landscapes or epic
conflicts, pairing microscopic 3D renders with matching human behavioral
b-roll.」

Examples:
- Terminal Lucidity → Glowing synaptic flashes + EEG cap
- Cellular scale → Microscopic cells → glowing galaxy

## REQUIREMENTS FOR EACH SCENE
1. Visual prompt: English, self-contained, 30-80 words
2. Production specs: camera, lighting, sound
3. Duration in seconds
4. Asset type: image or video
5. Subject description
6. Emotional beat
7. Color mood

Output JSON: { "scenes": [...] }
```

**设计分析**：

- **跨主题适配指令**："KEEP artistic medium, lighting... REPLACE subject-specific visual elements" —— 核心设计理念：传输风格而非内容
- **视觉 Prompt 语言**：明确要求 "Write the visual prompt in ENGLISH for best AI generation quality" —— 英文 prompt 在图像生成模型中效果更好
- **自包含要求**："Must be independently renderable (no reference to previous scene)" —— 每个 prompt 独立，因为图像生成器看不到上下文
- **资产类型决策**：`image` vs `video` —— 由 AI 根据场景动态程度决定

---

### Call 2: 主体隔离检查

| 属性 | 值 |
|------|-----|
| **类型** | `generateText` |
| **响应格式** | `application/json` |

**Prompt 全文**:

```
You are a visual prompt QA specialist. Your job is to check whether each
scene's visual prompt has a CLEAR, IDENTIFIABLE primary subject that an AI
image generator can render.

## SCENES TO CHECK
[37 个场景的 narrative + visualPrompt JSON]

## WHAT TO CHECK FOR EACH SCENE
1. Is there a clear primary subject?
2. Is the subject concrete enough for AI rendering?
3. Are there too many competing subjects?
4. If abstract, is there a concrete visual metaphor?

Output JSON: { "results": [...] }
```

**设计分析**：

- **为什么要主体隔离检查？** AI 图像生成器（如 ChatGPT、Pollinations）在面对"多个竞争主体"的 prompt 时容易生成混乱画面。此检查确保每个场景有唯一明确的视觉焦点
- **修复机制**：如果检查失败，会提供 `revisedPrompt` 替换原始 prompt

---

## Stage 7 — REFERENCE_IMAGE（参考图生成）

### Call 1: 参考样式表

| 属性 | 值 |
|------|-----|
| **类型** | `generateImage` |

**Prompt 全文**:

```
Create a "Style Reference Sheet" for an educational science video about:
生而为人有多难得.

Style DNA (Strict Adherence):
- Art Style: mixed
- Color Palette: ["#4A0404","#000000","#1A365D","#F5F5F5","#8B0000"]
- Key Visual Elements: [从 storyboard 提取的关键视觉元素]
- Lighting: cinematic, low-key, high contrast, volumetric glowing for cells
- Pedagogical Approach: [从 style profile 推导]

Instructions:
- Show 3-4 representative visual vignettes in this exact style on a single sheet
- If the topic has a main character or mascot, show them in 2-3 poses
- Include sample backgrounds, props, and UI elements that match the style
- Background: Neutral studio backdrop
- Quality: highly detailed, production-ready asset, consistent palette
- Aspect ratio: 16:9

Generate the image directly. Do not describe it in text.
```

### Call 2-4: 场景参考图（采样模式，3 张）

```
为科学科普视频场景生成一张高质量图片。

场景描述: [场景 visual prompt, 英文]

风格要求:
- 配色: ["#4A0404","#000000","#1A365D","#F5F5F5","#8B0000"]
- 光影: cinematic, low-key, high contrast, volumetric glowing for cells
- 风格: mixed
- 宽高比: 16:9

请直接生成这张图片，不要用文字描述。要求画面精美，适合专业科普视频使用。
```

**设计分析**：

- **参考样式表**：生成一张"风格锚点"图，后续所有关键帧生成都会以此为 `referenceImage` 参数传入，确保视觉一致性
- **采样模式**：默认只生成首/中/末三张场景参考图（`sampleOnly=true`），供人工审核。省资源的同时覆盖叙事弧的不同阶段
- **中文 Prompt**：与分镜的英文 visualPrompt 不同，图像生成 prompt 使用中文——因为场景描述通常包含中文特有的情感表达

---

## Stage 8 — KEYFRAME_GEN（关键帧生成）

| 属性 | 值 |
|------|-----|
| **类型** | `generateImage` × N |
| **每场景重试** | 最多 3 次（间隔 5s/10s） |
| **失败降级** | 使用该场景的 referenceImageUrl |

**每个场景的 Prompt**（与 REFERENCE_IMAGE 相同模板）:

```
为科学科普视频场景生成一张高质量图片。

场景描述: [场景的 visualPrompt]

风格要求:
- 配色: ["#4A0404","#000000","#1A365D","#F5F5F5","#8B0000"]
- 光影: cinematic, low-key, high contrast, volumetric glowing for cells
- 风格: mixed
- 宽高比: 16:9

请直接生成这张图片，不要用文字描述。
```

**本项目情况**：
- 37 个场景中 23 个有关键帧
- 14 个场景没有关键帧（Pollinations 429 限流或 ChatGPT 配额耗尽）
- 4 个场景被标记为 `video` 类型

**设计分析**：

- **批量+重试**：每个场景独立生成，失败不阻塞其他场景
- **referenceImage 锚定**：传入参考样式表作为风格锚点，提升批次间视觉一致性
- **降级策略**：失败时降级为该场景在 REFERENCE_IMAGE 阶段生成的参考图

---

## Stage 9 — VIDEO_GEN（视频片段生成）

| 属性 | 值 |
|------|-----|
| **类型** | Web 自动化（即梦/可灵） |
| **每场景重试** | 最多 2 次 |
| **失败降级** | 保留静态关键帧图 |

**Prompt 模板**:

```
[场景 visualPrompt]

Style: mixed, cinematic, low-key, high contrast, volumetric glowing for cells,
color palette ["#4A0404","#000000","#1A365D","#F5F5F5","#8B0000"].
Aspect ratio: 16:9. Duration: ~2.5s.
[style_anchor: 首个成功场景的 prompt 片段，保持风格一致]
```

**本项目结果**: 4 个视频场景（scene 0/2/4/6）由 KlingAI 生成，每个 ~5s

**设计分析**：

- **风格锚（style_anchor）**：取第一个成功生成的场景 prompt 片段附加到后续所有视频 prompt 中，确保批次内风格一致性
- **Web 自动化路径**：使用浏览器自动化操作即梦/可灵等免费视频生成服务
- **多账户轮换**：失败时轮换到备用 profile 目录重试
- **降级到静态图**：如果视频生成完全失败，保留关键帧图作为静态画面（Ken Burns 效果）

---

## Stage 10 — TTS（语音合成）

| 属性 | 值 |
|------|-----|
| **AI 调用** | 0（无 LLM 调用） |
| **引擎** | edge-tts（Microsoft Edge TTS，免费本地） |
| **语音选择** | 从 `voice_style` + `video_language` 推导 |
| **语速** | 从 `pacing` 推导 |

**无 Prompt**。根据风格 DNA 的 `track_c_audio.voice_style`（"Deep, resonant, authoritative male voiceover"）和 `pacing`（"fast"）确定性地选择语音和语速参数。

**本项目结果**: 37 个 TTS 文件，并发度 2

**设计分析**：

- **无 AI 调用**：TTS 是确定性工具调用，不需要 prompt
- **语速校准**：从参考视频的 pacing 字段推导，确保新视频的语音节奏与样本匹配
- **实际时长测量**：生成后用 ffprobe 实测每段音频时长，回写 `audioDuration` 字段——此值驱动后续 ASSEMBLY 的视频片段时长

---

## Stage 11 — ASSEMBLY（视频组装）

| 属性 | 值 |
|------|-----|
| **AI 调用** | 0 |
| **引擎** | FFmpeg |

**无 Prompt**。纯确定性的 FFmpeg 组装：

1. 每个场景 → `scene_N.mp4`（视频/图片 + TTS 音频合并）
2. 归一化（1280×720, 30fps, libx264+aac）
3. Concat 拼接
4. SRT 字幕烧录
5. BGM 混音（如有）
6. 最终输出 + `movflags +faststart`

**设计分析**：

- **Ken Burns 效果**：静态图场景自动添加慢速缩放（1.0→1.2），避免视觉静止感
- **视频循环/裁剪**：当视频片段比 TTS 短 > 0.5s 时自动循环，否则用 `-shortest` 裁剪
- **字幕**：从 `narrative` 字段自动生成 SRT，字幕不阻塞——失败则跳过

---

## Stage 12 — REFINEMENT（补全修复）

| 属性 | 值 |
|------|-----|
| **AI 调用** | 0（自身无调用；识别缺失后触发上游重试） |

**无 Prompt**。确定性扫描所有场景，找出：
- 缺少 `assetUrl` 的场景
- 缺少 `audioUrl` 的场景
- 状态为 `error` 的场景

找到后触发上游 KEYFRAME_GEN / VIDEO_GEN / TTS 对特定场景重新执行。

**本项目结果**: 14 个场景缺少关键帧图片，尝试补全

---

## 全流程 AI 调用统计

| 阶段 | generateText | generateImage | generateVideo | 主要 Prompt |
|------|:---:|:---:|:---:|---|
| CAPABILITY_ASSESSMENT | 0 | 0 | 0 | — |
| STYLE_EXTRACTION | 2-3 | 0 | 0 | `ANALYSIS_SELF_ASSESSMENT_PROMPT`, `STYLE_EXTRACTION_PROMPT` |
| RESEARCH | 2 | 0 | 0 | `RESEARCH_PROMPT`, `FACT_VERIFICATION_PROMPT` |
| NARRATIVE_MAP | 2 | 0 | 0 | `CALIBRATION_PROMPT`, 内联叙事地图 prompt |
| SCRIPT_GENERATION | 2-5 | 0 | 0 | `SCRIPT_SYSTEM_PROMPT` + `SCRIPT_USER_PROMPT`, `SCRIPT_AUDIT_PROMPT` |
| QA_REVIEW | 1-4 | 0 | 0 | `QA_REVIEW_PROMPT` |
| STORYBOARD | 2 | 0 | 0 | `STORYBOARD_PROMPT`, `SUBJECT_ISOLATION_PROMPT` |
| REFERENCE_IMAGE | 0 | ~4 | 0 | `REFERENCE_SHEET_PROMPT`, `IMAGE_GEN_PROMPT` |
| KEYFRAME_GEN | 0 | 23-37 | 0 | `IMAGE_GEN_PROMPT` |
| VIDEO_GEN | 0 | 0 | 4 | `VIDEO_GEN_PROMPT` |
| TTS | 0 | 0 | 0 | — (edge-tts) |
| ASSEMBLY | 0 | 0 | 0 | — (FFmpeg) |
| REFINEMENT | 0 | 0 | 0 | — (触发上游重试) |
| **合计** | **~11-16** | **~27-41** | **~4** | |

### Prompt 设计核心理念

1. **风格转移而非内容复制**：在多个 prompt 中反复强调"学习风格、不抄内容"
2. **三级置信度驱动**：`confident/inferred/guess` 从提取一直传递到脚本生成的约束宽松度
3. **交叉模型验证**：关键检查步骤（事实核查、脚本审计、QA审核）使用不同模型
4. **确定性兜底**：所有 LLM 输出均经过确定性验证（字数、句数、格式），不信任纯 LLM 判断
5. **渐进信息注入**：每个阶段的输出成为下一阶段的输入变量——信息逐阶段丰富
6. **降级与容错**：图像/视频生成失败有多层降级（重试 → 备用提供商 → 参考图降级 → 黑帧）
