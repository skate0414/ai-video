# AI 视频生成流水线审计报告

**项目**: `proj_1775959231425`  
**主题**: 生而为人有多难得  
**创建时间**: 2026-04-12 02:00:31 UTC  
**完成时间**: 2026-04-12 15:15:27 UTC  
**最终视频**: `生而为人有多难得_1776006926017.mp4` (75.6MB)  
**质量等级**: free  
**总耗时**: ~13 分钟（最后一次完整运行 783 秒）

---

## 流水线总览

| 序号 | 阶段 | 耗时 | AI 方法 | 提供方 |
|------|------|------|---------|--------|
| 1 | CAPABILITY_ASSESSMENT | 2ms | 无 AI 调用 | 本地 |
| 2 | STYLE_EXTRACTION | 293.6s | generateText × 2 | 浏览器 CHAT (Gemini) |
| 3 | RESEARCH | 38.1s | generateText × 2 | 浏览器 CHAT (Gemini) |
| 4 | NARRATIVE_MAP | 220.0s | generateText × 1 | 浏览器 CHAT (Gemini) |
| 5 | SCRIPT_GENERATION | 142.6s | generateText × 1 | 浏览器 CHAT (Gemini) |
| 6 | QA_REVIEW | 146.3s | generateText × 1 | 浏览器 CHAT (Gemini) |
| 7 | STORYBOARD | 60.7s | generateText × 1 | 浏览器 CHAT (Gemini) |
| 8 | REFERENCE_IMAGE | 273.0s | generateImage | Pollinations API |
| 9 | KEYFRAME_GEN | 90.0s | generateImage | Pollinations API |
| 10 | VIDEO_GEN | 366.4s | REST API (i2v) | aivideomaker.ai × 6 帐号 |
| 11 | TTS | 28.1s | REST API | Fish Audio |
| 12 | ASSEMBLY | 388.1s | ffmpeg | 本地 |
| 13 | REFINEMENT | 10ms | 验证检查 | 本地 |

**会话分组**:
- `analysis` 会话: CAPABILITY_ASSESSMENT → STYLE_EXTRACTION → RESEARCH（同一聊天窗口）
- `creation` 会话: NARRATIVE_MAP → SCRIPT_GENERATION → QA_REVIEW（同一聊天窗口，12 条消息）
- `visual` 会话: STORYBOARD → REFERENCE_IMAGE → KEYFRAME_GEN（同一聊天窗口，4 条消息）
- `production` 会话: VIDEO_GEN → TTS → ASSEMBLY → REFINEMENT（独立调用，不共享聊天）

---

## 阶段 1: CAPABILITY_ASSESSMENT（能力评估）

**目的**: 检测已配置的 AI 提供方及其能力  
**方法**: 本地检测，无 AI 调用  
**耗时**: 2ms

**检测到的提供方**:
| 提供方 | 文本 | 图像 | 视频 | 搜索 | 上传 | Profile 状态 |
|--------|------|------|------|------|------|-------------|
| gemini | ✅ | ✅ | ❌ | ✅ | ✅ | ✅ 存在 |
| deepseek | ✅ | ❌ | ❌ | ✅ | ❌ | ❌ 无 |
| kimi | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ 无 |
| klingai | ❌ | ❌ | ✅ | ❌ | ❌ | ❌ 无 |
| chatgpt | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ 无 |

**安全检查**: 已禁用 (`Safety check disabled`)

**输出**: `capability-assessment.json`

---

## 阶段 2: STYLE_EXTRACTION（风格提取）

**目的**: 从参考视频中提取视觉、叙事、音频风格 DNA  
**方法**: `generateText` × 2 次调用  
**提供方**: 浏览器 CHAT（Gemini 聊天界面自动化）  
**总耗时**: 293.6s（~98s + ~94s + 页面交互开销）

### 调用 1: 自评估 (self_assess)

**Prompt**:
```
（通过浏览器自动化发送到 Gemini 聊天界面。Prompt 内容为系统角色指令，
要求 AI 评估自身在文本/图像/视频生成方面的能力。）

role: "?", content: ""  — 浏览器自动化模式，具体 prompt 由 chatAdapter 构造
```

**响应摘要**:
AI 返回自评估 JSON，声明具备文本和图像生成能力，不具备视频生成能力。

### 调用 2: 风格 DNA 提取 (extract)

**Prompt**:
```
（将参考视频的完整转录文本发送给 AI，要求提取以下维度的风格 DNA：
视觉风格、色彩调色板、叙事结构、Hook 策略、语调、节奏等）
```

**参考视频转录文本**（用于提取风格）:
> 这可能是你第一次认识到，你的身体究竟有多爱你。在你的身体中，每天都会有1-5个细胞产生癌变。在每年超过1000多次的癌变中，都是身体在一次次的拯救你……当你以为全世界都没人爱你的时候，不要忘了，你的身体还在死心塌地地爱着你。

**提取结果** (`style-analysis.cir.json`):

| 维度 | 值 |
|------|-----|
| 视觉风格 | Cinematic 3D animation |
| 节奏 | medium |
| 语调 | emotional |
| 调色板 | `#0a0a0a` (深黑), `#8b0000` (暗红), `#1e90ff` (道奇蓝), `#ffd700` (金), `#ffffff` (白) |
| 视频时长 | 92 秒 |
| 目标字数 | 505 字 |
| 语言 | Chinese |
| 类型 | science explainer |
| Hook 策略 | Direct emotional address + startling internal visual |
| 叙事弧线 | Hook → Mechanism × 4 → Climax → Reflect |
| 情绪弧线 | Intrigue → Gratitude → Sadness → Awe → Comfort |
| 修辞核心 | Personification, Analogy, Hyperbole |
| 隐喻数量 | 6 |
| 句子平均长度 | 32 字符 |
| 句子最长 | 68 字符 |
| 灯光风格 | high contrast cinematic |
| 镜头运动 | dynamic tracking |
| 色温 | cool |
| 场景平均时长 | 3.5s |
| 转场风格 | cut |
| 构图风格 | centered |
| B-Roll 比例 | 90% |
| 背景音乐 | Cinematic Ambient, Ethereal |

**输出文件**: `style-analysis.cir.json`, `style-profile.json`

---

## 阶段 3: RESEARCH（事实研究）

**目的**: 围绕主题搜集经过验证的科学事实  
**方法**: `generateText` × 2 次调用  
**提供方**: 浏览器 CHAT (Gemini)  
**总耗时**: 38.1s (22.4s + 15.8s)

### 调用 1: 事实搜集 (facts)

**完整 Prompt**:
```
You are a research assistant for science explainer videos.

Topic: 生而为人有多难得
Target audience: General public seeking emotional comfort and basic health awareness

## TASK 1: Gather Facts (5-7)
Search for verified, recent scientific facts related to this topic. For each fact:
- Provide the factual claim in Chinese
- Include a credible source (URL + title)
- Rate confidence (0-1)

## TASK 2: Common Myths (2-3)
Identify popular misconceptions about this topic.

## TASK 3: Glossary (2-3 terms)
Define key scientific terms the script may reference.

Output JSON (no markdown):
{
  "facts": [{"id": "fact-N", "content": "...", "sources": [...], "confidence": 0.0-1.0}],
  "myths": ["..."],
  "glossary": [{"term": "...", "definition": "..."}]
}
```

**响应结果** (`research.cir.json`):

**事实 (5 条)**:

| ID | 内容 | 来源 | 置信度 | 验证状态 |
|----|------|------|--------|---------|
| fact-1 | 出生概率为 400 万亿分之一 | TEDx 视频 | 0.3 | ⚠️ disputed |
| fact-2 | 人体含约 70 亿亿亿个原子，超过宇宙恒星数 | Reddit 讨论 | 1.0 | ✅ verified |
| fact-3 | 每个细胞 DNA 每天遭受约 10,000 次损伤 | College Biology I | 1.0 | ✅ verified |
| fact-4 | 心脏每天产生能量可让卡车行驶 32 公里 | Bumrungrad Health | 1.0 | ✅ verified |
| fact-5 | 大脑约 860 亿神经元，突触连接极其复杂 | Salk Institute | 0.975 | ✅ verified |

**迷思 (3 条)**:
1. "人类只使用了大脑的 10%"（实际大部分区域活跃）
2. "死后指甲和头发还会继续生长"（实际是皮肤脱水）
3. "回光返照是精确分配 5% 肾上腺素"（实际机制更复杂）

**术语表**: DNA 修复机制、肾小球滤过率 (GFR)、突触 (Synapse)

### 调用 2: 事实验证 (verify)

**完整 Prompt**:
```
You are a senior fact-checker for a science explainer video.

Verify the following claims. For each claim, determine whether it is:
- "verified": Strong evidence supports it
- "disputed": Evidence is mixed or the claim is an oversimplification
- "false": The claim is demonstrably wrong

Claims to verify:
1. 受精过程中，平均每毫升精液含有1亿个精子，而最终只有1个能成功受精，概率约为千万分之一。
2. 人体内约有37.2万亿个细胞，每一秒钟就有约380万个细胞在进行自我更新和代谢。
3. 人类心脏每天跳动约10万次，泵出的血液量足以充满一个大型油罐车。
4. 如果将人体内所有DNA拉直并相连，其长度约为200亿公里，足以从地球飞抵冥王星并折返。
5. 大脑拥有约860亿个神经元，其突触连接的总数甚至超过了已知宇宙中银河系的星辰数量。

Output JSON with verification results for each claim.
```

**响应**: 对 5 条科学声明进行了逐一验证，标注了置信度和验证状态。

**输出文件**: `research.cir.json`, `research.json`, `fact-verification.json`

---

## 阶段 4: NARRATIVE_MAP（叙事地图）

**目的**: 基于风格 DNA 和事实数据规划叙事结构  
**方法**: `generateText` × 1  
**提供方**: 浏览器 CHAT (Gemini)  
**耗时**: 24.4s（API 调用时间） / 220.0s（含页面交互总时间）

**完整 Prompt**:
```
You are a narrative structure expert for science explainer videos.

Based on the following calibration data and style profile, generate a narrative map.

Topic: 生而为人有多难得
Target duration: 92 seconds
Target word count: 505
Narrative arc: ["Hook","Mechanism","Mechanism","Mechanism","Mechanism","Climax","Reflect"]
Hook type: VisualHook

Verified facts available:
[Fact 1] 受精过程中，平均每毫升精液含有1亿个精子，而最终只有1个能成功受精
[Fact 2] 人体内约有37.2万亿个细胞，每秒钟约380万个细胞在自我更新
[Fact 3] 人类心脏每天跳动约10万次，泵出血液量足以充满大型油罐车
[Fact 4] DNA拉直长度约200亿公里，足以从地球飞抵冥王星并折返
[Fact 5] 大脑约860亿个神经元，突触连接总数超过已知宇宙中银河系星辰数量

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

**生成的叙事地图** (`narrative-map.json`):

| 段落 | 描述 | 时长 | 目标字数 | 引用事实 |
|------|------|------|---------|---------|
| Hook | VisualHook: 受精竞赛的震撼内景，将观众定位为千万分之一彩票的幸存者 | 12s | 66 字 | Fact 1 |
| Mechanism 1 | 微观维护：展示体内每秒钟疯狂的细胞更新 | 13s | 71 字 | Fact 2 |
| Mechanism 2 | 宏观蓝图：将 DNA 结构扩展到宇宙尺度 | 14s | 77 字 | Fact 4 |
| Mechanism 3 | 不懈能量：可视化心脏每日巨大的工作量 | 13s | 71 字 | Fact 3 |
| Mechanism 4 | 意识复杂性：将大脑神经网络与银河系量级对比 | 13s | 71 字 | Fact 5 |
| Climax | 不可能性的汇聚：综合所有事实揭示观众是行走的生物学奇迹 | 12s | 66 字 | — |
| Reflect | CTA 模式：从自我怀疑转向情感认同 | 15s | 83 字 | — |

**输出文件**: `narrative-map.json`

---

## 阶段 5: SCRIPT_GENERATION（脚本生成）

**目的**: 基于叙事地图和风格 DNA 生成完整的视频脚本  
**方法**: `generateText` × 1  
**提供方**: 浏览器 CHAT (Gemini)  
**耗时**: 29.1s（API） / 142.6s（含页面交互）

**完整 Prompt** (核心部分):
```
# SCRIPT GENERATION — STYLE DNA CONSTRAINTS

## Section 1: Topic & Target
Target topic: 生而为人有多难得
Target audience: General public seeking emotional comfort and basic health awareness

## Section 2: Length Calibration
Target word count: 505 (HARD range: 454.5 - 555.5)
Target duration: 92 seconds
Reference speech rate: 329.35 words/characters per minute
Target sentence count: 26 (HARD requirement — each sentence becomes one video scene)

## Section 3: Hook
Hook strategy: Direct emotional address combined with a startling internal visual
Reference hook:「这可能是你第一次认识到，你的身体究竟有多爱你。」
- Use second-person address from the very first sentence

## Section 3.5: Retention Architecture
1. Sentence 1-3 (0-5s): Cognitive dissonance hook
2. Sentence ~8 (15-20s): Pattern interrupt
3. Every 4-5 sentences: Curiosity gap ("但这还不是最可怕的部分")
4. Sentence ~15 (30-40s): Second hook

## Section 4: Metaphor Mapping
[6 metaphors required, based on visual metaphor mapping from Style DNA]

## Section 5: Narrative Arc
Hook → Mechanism × 4 → Climax → Reflect

## Section 6: Safety
- No absolute medical/health claims
- Soften with hedging language ("据研究...", "科学家发现...")
```

**生成的脚本** (26 句, 541 字):

| 句号 | 段落 | 脚本文本 | 字数 |
|------|------|---------|------|
| 1 | Hook | 你或许从未察觉，你此刻的每一次呼吸都是一场千万分之一概率的终极神迹。 | 34 |
| 2 | Hook | 据统计，受精过程中每毫升精液含有一亿个精子，而最终只有唯一的你冲破终点。 | 35 |
| 3 | Hook | 你是这场生死时速中唯一突围成功的超级英雄，这难道不可思议吗？ | 30 |
| 4 | Hook | 但这还仅仅是个开始。 | 9 |
| 5 | Mechanism | 据统计，你体内的三十七万亿个细胞正如同繁星般昼夜守望。 | 26 |
| 6 | Mechanism | 科学家发现，每一秒钟就有三百八十万个细胞在为你进行着疯狂的更新。 | 31 |
| 7 | Mechanism | 它们像是不眠不休的微小修理工，在你的生命工厂里争分夺秒地缝补伤痕。 | 32 |
| 8 | Mechanism | 但这还不是最震撼的部分。 | 11 |
| 9 | Mechanism | 你有没有想过，你的生命图纸竟然比整个星系还要辽阔？ | 24 |
| 10 | Mechanism | 据计算，拉直你全身的DNA，长度达两百亿公里，足以往返冥王星。 | 29 |
| 11 | Mechanism | 这根金色的长线编织出了独一无二的你，它是跨越宇宙级的浪漫注脚。 | 30 |
| 12 | Mechanism | 那么，究竟是什么在驱动这台精密机器永不停歇地运转？ | 23 |
| 13 | Mechanism | 研究显示，你的心脏每天跳动十万次，泵出的血液足以填满巨大的油罐车。 | 32 |
| 14 | Mechanism | 心脏产生的动力极其惊人，每天足以推动一辆重型卡车行驶三十二公里。 | 31 |
| 15 | Mechanism | 接下来的发现将彻底颠覆你的认知。 | 15 |
| 16 | Mechanism | 神经科学发现，你脑中的突触连接总数，甚至超过了已知银河系的星辰数量。 | 33 |
| 17 | Mechanism | 这意味着你每一次思考，都在脑海中引爆了一场小型的宇宙大爆炸。 | 29 |
| 18 | Climax | 在这种极致的复杂面前，你真的还觉得自己只是个普通人吗？ | 26 |
| 19 | Climax | 科学家发现，你体内的原子数量高达七十亿亿亿个，多到令人毛骨悚然。 | 31 |
| 20 | Climax | 这远远超过了全宇宙恒星的总和，你本身就是由星尘汇聚而成的星系。 | 30 |
| 21 | Climax | 每一个危险瞬间，身体的防御机制都会筑起高墙，为你挡下死神的镰刀。 | 31 |
| 22 | Climax | 这种极致的偏爱，让你成为了这颗星球上最昂贵、最难得的碳基艺术品。 | 31 |
| 23 | Reflect | 当你以为自己一无所有，甚至被这个世界遗忘在角落的时候。 | 26 |
| 24 | Reflect | 不要忘了，你体内的每一个原子，每一刻都在为了让你活下去而拼命。 | 30 |
| 25 | Reflect | 你的身体还在为你修复隐秘的裂痕，它是你最忠诚的信徒。 | 25 |
| 26 | Reflect | 你的身体此刻还在以这种神迹般的方式，深沉且无声地爱着你。 | 27 |

**引用的事实**: Fact 1 (精子竞争), Fact 2 (细胞更新), Fact 3 (DNA 长度), Fact 4 (心脏能量), Fact 5 (神经元)

**安全元数据**:
- `isHighRisk`: false
- `riskCategories`: 无
- `softenedWordingApplied`: false
- `needsManualReview`: false

**输出文件**: `script.json`, `script.cir.json`

---

## 阶段 6: QA_REVIEW（质量审核）

**目的**: 对生成脚本进行自动审核与纠错  
**方法**: `generateText` × 1  
**提供方**: 浏览器 CHAT (Gemini)  
**耗时**: 16.6s（API） / 146.3s（含页面交互）

**完整 Prompt**:
```
You are a senior script editor performing a self-correction audit on a science explainer video script.

## YOUR TASK
Review the script below and fix any issues. Do NOT rewrite the entire script — only fix specific problems.

## SCRIPT TO AUDIT
[完整 26 句脚本文本]

## STYLE DNA CONSTRAINTS TO CHECK AGAINST
- Target word count: 505 (range: 454.5 - 555.5)
- Target tone: emotional
- Hook strategy: Direct emotional address + startling internal visual
- Narrative arc: ["Hook","Mechanism","Mechanism","Mechanism","Mechanism","Climax","Reflect"]
- Sentence length avg: 32 characters / max: 68 characters
- Metaphor count target: 6
- Video language: Chinese

## AUDIT CHECKLIST
1. Word count: Is total within [454.5, 555.5]?
2. Factual integrity: Are all numeric claims sourced?
3. Style consistency: Does tone stay consistent?
4. Visual renderability: Can every sentence be independently rendered as a 3D animation scene?
5. Safety: Any absolute medical/health claims? Any fabricated statistics?

## OUTPUT FORMAT (JSON):
{
  "correctedScript": "...",
  "changes": [{"sentence": N, "original": "...", "corrected": "...", "reason": "..."}],
  "flaggedIssues": [...]
}
```

**审核结果**:
- 修正了"不不可思议"为"不可思议"（重复字错误）
- 对"据统计"等措辞进行了微调以增强可信度
- 调整了部分句子的视觉可渲染性
- 最终状态: `approved: true`（由 `run-free-pipeline.mjs` 自动批准）

**输出文件**: `qa-review.json`, `script-audit.json`, `script-validation-{0,1,2}.json`

---

## 阶段 7: STORYBOARD（分镜头脚本）

**目的**: 将脚本逐句转换为场景视觉描述（visual prompts）  
**方法**: `generateText` × 1  
**提供方**: 浏览器 CHAT (Gemini)  
**耗时**: 40.2s（API） / 60.7s（含交互）

**完整 Prompt**:
```
You are a visual director for 3D animated science explainer videos.

Convert the following script into a scene-by-scene storyboard with visual prompts
suitable for AI image/video generation.

## CRITICAL: SCENE COUNT REQUIREMENT
You MUST generate EXACTLY ONE scene per script sentence. The script has 26 sentences,
so you MUST output exactly 26 scenes. Do NOT merge multiple sentences into one scene.

## CRITICAL: CROSS-TOPIC ADAPTATION
The STYLE DNA below is from a reference video about a potentially DIFFERENT subject.
You MUST ADAPT the visual style to fit the NEW topic "生而为人有多难得".
- KEEP: artistic medium (3D animation), lighting (high contrast cinematic), color palette, mood, camera motion
- REPLACE: subject-specific visual elements with ones appropriate for the new topic

## SCRIPT
[完整 26 句脚本]

## STYLE DNA — VISUAL TRACK
- Base medium: 3D animation
- Lighting: high contrast cinematic
- Camera motion: dynamic tracking
- Color temperature: cool
- Global color palette: #0a0a0a, #8b0000, #1e90ff, #ffd700, #ffffff
- Composition: centered
- Transition style: cut
- Average scene duration: 3.5s
```

**生成的 26 个场景视觉描述** (`storyboard.cir.json`):

| 场景 | 视觉 Prompt 摘要 | 镜头 |
|------|------------------|------|
| 1 | 蓝色粒子构成的人体轮廓，吸气时金色光粒子涡旋进入胸腔 | Medium shot, slow dolly in |
| 2 | 大量银色细胞在暗色有机隧道中游动，前方一个发光最亮 | Low angle tracking shot |
| 3 | 单个金色细胞穿透巨大卵细胞膜，冲击波般的光爆发 | Extreme close-up, slow motion |
| 4 | 黑暗虚空中单个火花开始快速分裂 | Wide establishing shot |
| 5 | 37万亿微小星星组成的宇宙人体形状 | Slow zoom out revealing scale |
| 6 | 细胞表面数百万发光球体爆裂并被新白光替代 | Macro tracking shot |
| 7 | 微观机械-生物纳米机器人编织金色线条修补裂痕 | Dolly along the repair line |
| 8 | 人眼虹膜变形为旋转星系 | Push into the pupil |
| 9 | 巨大3D建筑蓝图漂浮在深空中，蓝色发光 | Epic wide shot |
| 10 | 金色DNA双螺旋拉伸从地球到冥王星 | Extreme wide, tracking line |
| 11 | 数千金色DNA线编织成人类心脏形状 | Slow orbit around heart |
| 12 | 高科技3D机械心脏与生物组织融合 | Close-up, slow rotation |
| 13 | 巨大油罐车在暗虚空中被红色发光液体填满 | Epic scale comparison |
| 14 | 3D重型卡车在暗色高速公路上奔驰，引擎红色心跳节奏 | Dynamic tracking with motion blur |
| 15 | 黑屏白色心电脉冲线突然变为复杂神经网络 | Static to explosive transition |
| 16 | 人脑中每个突触是明亮白星，大脑如密集星系 | Slow zoom into brain |
| 17 | 透明头骨内爆发鲜艳颜色和光的超新星 | Explosion outward |
| 18 | 镜中普通人，但倒影由精密金色钟表和宇宙星星构成 | Static medium shot |
| 19 | 3D放大至人手：皮肤→肌肉→海量振动白色球体(原子) | Macro zoom sequence |
| 20 | 3D人形溶解为宇宙尘埃和星星的漩涡 | Pull back to cosmic scale |
| 21 | 单个金色骰子在太空玻璃面滚动，数百万暗色骰子显示空白 | Overhead tracking |
| 22 | 透明钻石和碳纤维制成的3D人类雕塑，内部发光 | Slow orbiting shot |
| 23 | 手伸向温暖金色光，光如液态包裹 | Close-up, warm tone |
| 24 | 孤独人物坐在暗蓝冷色房间，单一小光源 | Static, moody wide |
| 25 | 体内微观视角：数百万原子和细胞像同步军队工作 | Dynamic macro tracking |
| 26 | 场景1的粒子人物，现在带有温暖金红色心脏，自我拥抱并溶入星云 | Final pull back, emotional |

**输出文件**: `storyboard.cir.json`, `scenes.json`

---

## 阶段 8: REFERENCE_IMAGE（参考图生成）

**目的**: 生成风格参考图，确保后续关键帧的视觉一致性  
**方法**: `generateImage` (Pollinations API)  
**提供方**: Pollinations (pollinations.ai)  
**耗时**: 273.0s（含多张图片生成）

**Prompt**:
```
Create a "Style Reference Sheet" for an educational science video about: 生而为人有多难得.

Style DNA (Strict Adherence):
- Art Style: Cinematic 3D animation
- Color Palette: #0a0a0a, #8b0000, #1e90ff, #ffd700, #ffffff
- Lighting: high contrast cinematic

Instructions:
- Show 3-4 representative visual vignettes in this exact style on a single sheet.
- Include sample backgrounds, props, and UI elements that match the style.
- Background: Neutral studio backdrop compatible with the art style.
- Quality: highly detailed, production-ready asset, consistent palette throughout.
- Aspect ratio: 16:9
```

> 注：CHAT 提供方 (Gemini) 上标记为 `[chat-skipped] provider exhausted`，实际通过 Pollinations HTTP API 生成。

**生成的参考图文件**: 每个场景生成了对应的参考图（如 `img_1775960565642_pollinations.jpg` 等），共为有关键帧的场景生成了参考图像。

**输出文件**: `assets/img_*_pollinations.jpg` (多个)

---

## 阶段 9: KEYFRAME_GEN（关键帧生成）

**目的**: 为每个场景生成关键帧图像，作为 i2v（图生视频）的输入  
**方法**: `generateImage` (Pollinations API)  
**提供方**: Pollinations (pollinations.ai)  
**耗时**: 90.0s

**每个场景的 Prompt 模式**:
```
为科学科普视频场景生成一张高质量图片。

场景描述: [来自 STORYBOARD 阶段的 visualPrompt]

风格要求:
- 配色: #0a0a0a, #8b0000, #1e90ff, #ffd700, #ffffff
- 光影: high contrast cinematic
- 风格: Cinematic 3D animation
- 宽高比: 16:9

请直接生成这张图片，不要用文字描述。要求画面精美，适合专业科普视频使用。
```

**场景 1 关键帧 Prompt 示例**:
```
为科学科普视频场景生成一张高质量图片。

场景描述: A high-fidelity 3D animation of a human silhouette made of glowing blue particles. 
As the figure inhales, a swirling vortex of golden light particles enters the chest. 
High contrast cinematic lighting, deep black background #0a0a0a, cool blue #1e90ff highlights, 
8k resolution, macro shot.

风格要求:
- 配色: #0a0a0a, #8b0000, #1e90ff, #ffd700, #ffffff
- 光影: high contrast cinematic
- 风格: Cinematic 3D animation
- 宽高比: 16:9
```

**生成结果**: 成功为 19 个视频场景生成了关键帧图像（7 个纯文字/过渡场景使用静态图像处理）。

**输出文件**: `assets/img_*_pollinations.jpg`（关键帧），存储于全局 assets 目录

---

## 阶段 10: VIDEO_GEN（视频生成）

**目的**: 使用关键帧 + 提示词通过 i2v 模型生成视频片段  
**方法**: REST API (`/api/videos/generate` → 轮询)  
**提供方**: aivideomaker.ai (6 个 API Key 并行)  
**耗时**: 366.4s (~6 分钟)  
**模型**: Image-to-Video (i2v)

**6 个 API Key**:
| Worker | API Key (前缀) | 状态 |
|--------|---------------|------|
| 0 | `ak_e150b53...` | ❌ 额度耗尽 |
| 1 | `ak_68fa26a...` | ✅ 正常 |
| 2 | `ak_e5c9d09...` | ✅ 正常 |
| 3 | `ak_5b4068c...` | ✅ 正常 |
| 4 | `ak_f3c5f20...` | ✅ 正常 |
| 5 | `ak_4f3b7dd...` | ✅ 正常 |

**运行机制**:
- 6 个 Worker 并行从场景队列中取任务
- Worker 0 检测到额度不足后标记为 depleted，将场景返回队列
- Re-dispatch 循环将返回的场景分配给健康 Worker
- 每个场景：上传关键帧 → 调用 i2v 生成 → 轮询等待完成 → 下载 MP4

**每个场景的 Video Prompt 模式**:
```
[来自 STORYBOARD 的 visualPrompt]

Style: Cinematic 3D animation, high contrast cinematic, 
color palette #0a0a0a, #8b0000, #1e90ff, #ffd700, #ffffff.
Aspect ratio: 16:9. Duration: ~3.8s.
```

**场景 6 的 Prompt 示例**:
```
3D macro view of a cellular surface where millions of glowing spheres are popping and 
being replaced by new brilliant white lights #ffffff. High speed motion, high contrast 
cinematic lighting, cool blue shadows, dynamic and energetic movement.

Style: Cinematic 3D animation, high contrast cinematic, 
color palette #0a0a0a, #8b0000, #1e90ff, #ffd700, #ffffff.
Aspect ratio: 16:9. Duration: ~3.8s.
```

**生成结果 (19 个视频场景)**:

| 场景 | 文件 | 大小 | 状态 |
|------|------|------|------|
| 1 | video_scene_1.mp4 | 5.5MB | ✅ |
| 2 | video_scene_2.mp4 | 14.8MB | ✅ |
| 3 | video_scene_3.mp4 | 7.0MB | ✅ |
| 4 | video_scene_4.mp4 | 3.3MB | ✅ |
| 6 | video_scene_6.mp4 | 7.2MB | ✅ |
| 7 | video_scene_7.mp4 | 7.5MB | ✅ |
| 8 | video_scene_8.mp4 | 14.1MB | ✅ |
| 10 | video_scene_10.mp4 | 6.0MB | ✅ |
| 11 | video_scene_11.mp4 | 7.0MB | ✅ |
| 13 | video_scene_13.mp4 | 7.1MB | ✅ |
| 14 | video_scene_14.mp4 | 7.6MB | ✅ |
| 15 | video_scene_15.mp4 | 5.5MB | ✅ |
| 16 | video_scene_16.mp4 | 4.7MB | ✅ |
| 17 | video_scene_17.mp4 | 8.7MB | ✅ |
| 19 | video_scene_19.mp4 | 4.9MB | ✅ |
| 20 | video_scene_20.mp4 | 9.1MB | ✅ |
| 21 | video_scene_21.mp4 | 4.4MB | ✅ |
| 25 | video_scene_25.mp4 | 6.3MB | ✅ |
| 26 | video_scene_26.mp4 | 6.8MB | ✅ |

> 场景 5, 9, 12, 15, 18, 22, 23, 24 无关键帧或为短句场景，未生成视频（使用静态图像+动画处理）

**输出文件**: `assets/video_scene_*.mp4`

---

## 阶段 11: TTS（语音合成）

**目的**: 为 26 个场景生成中文语音旁白  
**方法**: REST API  
**提供方**: Fish Audio  
**耗时**: 28.1s  

**运行机制**:
- 将每句脚本文本发送到 Fish Audio API
- 返回 MP3 音频文件
- 每个场景独立生成一个音频文件

**音频时长分布**:
| 场景 | 音频时长 |
|------|---------|
| 1 | 6.84s |
| 2 | 8.28s |
| 3 | 6.98s |
| 4 | 2.64s |
| ... | ... |
| 总计 | ~92s |

**生成了 4 轮 TTS**（因之前的流水线重试），最终使用第 4 轮 (`tts_1776006511625` 开头的文件)。

**输出文件**: `assets/tts_*.mp3` (26 个音频文件)

---

## 阶段 12: ASSEMBLY（视频合成）

**目的**: 将所有视频片段、音频、字幕合成为最终视频  
**方法**: ffmpeg（本地命令行工具）  
**提供方**: 本地 ffmpeg  
**耗时**: 388.1s (~6.5 分钟)

**合成流程**:
1. 对每个场景：视频/图像 + 对应 TTS 音频 → 单场景带音频片段
2. 生成 `subtitles.srt` 字幕文件
3. 使用 `ffmpeg concat` 将 26 个片段连接成完整视频
4. 叠加字幕

**最终视频文件**: `生而为人有多难得_1776006926017.mp4`
- 大小: 75.6 MB
- 时长: ~92 秒
- 分辨率: 16:9
- 包含: 19 个实际视频场景 + 7 个静态图动画场景

**输出文件**: `assets/生而为人有多难得_1776006926017.mp4`, `assets/subtitles.srt`

---

## 阶段 13: REFINEMENT（质量验证）

**目的**: 验证最终视频的完整性  
**方法**: 自动验证检查  
**提供方**: 本地  
**耗时**: 10ms

**验证结果**:
```json
{
  "allComplete": true,
  "failedScenes": [],
  "retriedScenes": [],
  "retryCount": 0
}
```

**输出文件**: `refinement.json`

---

## 完整数据文件清单

| 文件 | 描述 | 阶段 |
|------|------|------|
| `project.json` | 项目元数据和阶段状态 | 全局 |
| `capability-assessment.json` | 提供方能力评估 | 1 |
| `style-analysis.cir.json` | 完整风格 DNA | 2 |
| `style-profile.json` | 风格配置摘要 | 2 |
| `style-contract-result.json` | 风格契约验证 | 2 |
| `research.cir.json` | 研究事实 + 迷思 + 术语 | 3 |
| `research.json` | 研究数据 | 3 |
| `fact-verification.json` | 事实验证结果 | 3 |
| `calibration.json` | 叙事校准数据 | 4 |
| `narrative-map.json` | 叙事地图 | 4 |
| `subject-isolation.json` | 主题隔离验证 | 4 |
| `script.json` | 完整脚本 + 场景分析 | 5 |
| `script.cir.json` | 脚本 CIR 格式 | 5 |
| `qa-review.json` | QA 审核结果 | 6 |
| `script-audit.json` | 脚本审计日志 | 6 |
| `script-validation-{0,1,2}.json` | 脚本验证迭代 | 6 |
| `storyboard.cir.json` | 分镜头脚本 (26 场景) | 7 |
| `scenes.json` | 场景数据（视觉描述+资源路径） | 7 |
| `video-plan.cir.json` | 视频生成计划 | 9-10 |
| `prompt-details.json` | 所有 AI 调用的完整 Prompt 记录 | 全局 |
| `prompt-extraction.json` | Prompt 提取索引 | 全局 |
| `pipeline-metrics.json` | 流水线性能指标 | 全局 |
| `sessions.json` | 浏览器会话管理 | 全局 |
| `observability.json` | 可观测性数据 | 全局 |
| `final-risk-gate.json` | 最终风险门控 | 全局 |
| `assembly-validation.json` | 合成验证 | 12 |
| `refinement.json` | 最终验证 | 13 |

---

## 人工校验检查项

### ✅ 已通过
- [ ] 所有 13 个流水线阶段均标记为 `completed`
- [ ] 脚本字数 541 在目标范围 454.5-555.5 内
- [ ] 26 个场景均有视觉描述
- [ ] 19 个视频场景均生成了 MP4 文件
- [ ] 26 个场景均有 TTS 音频
- [ ] 最终视频文件存在 (75.6MB)
- [ ] 无 `needsManualReview` 标记

### ⚠️ 需要注意
- [ ] fact-1 (出生概率 400 万亿分之一) 的置信度仅 0.3，标记为 `disputed` — 请验证数据来源
- [ ] QA_REVIEW 为自动批准 (`auto-approved by run-free-pipeline.mjs`)，未经人工审核
- [ ] 安全检查已禁用 (`Safety check disabled`)
- [ ] 7 个场景 (5, 9, 12, 18, 22, 23, 24) 无关键帧视频，使用静态图像处理

### 📊 质量指标
- 事实引用率: 13/26 句子引用了已验证事实
- 视频覆盖率: 19/26 场景为实际视频 (73%)
- API 成功率: 19/19 视频生成最终成功 (经重试)
- 总 API 密钥使用: 6 个中的 5 个有效
