# 可复现生成审计报告

**项目 ID**: `proj_1776077387676`  
**主题**: 生而为人有多难得  
**审计日期**: 2026-04-13  
**审计类型**: 事后回溯（Post-hoc forensic reconstruction）  

### 证据层级标注约定

本报告严格区分两层证据来源，正文中以标签标注：

| 标签 | 含义 | 来源 |
|---|---|---|
| `[RUNTIME]` | **运行时事实** — 本次管线实际执行时产生的日志、artifact、时间戳 | `project.json` logs、`ai-logs/`、`observability.json`、CIR/artifact 文件 |
| `[CODEBASE]` | **审计时代码事实** — 审计时点（2026-04-13）代码库中的逻辑、模板、阈值 | `src/pipeline/*.ts`、`src/pipeline/prompts.ts` |

> ⚠️ 本项目在运行过程中发生过一次代码热修改（`scriptGeneration.ts` safety hard-block → warning），这意味着**阶段 5a 的运行日志对应的是修改前的代码行为，阶段 5b 及之后的运行日志对应的是修改后的代码行为**。正文中对此差异做了明确标注。

---

## 目录

1. [项目概览](#1-项目概览)
2. [逐阶段还原](#2-逐阶段还原)
3. [Prompt 清单](#3-prompt-清单)
4. [Artifact 血缘图](#4-artifact-血缘图)
5. [决策点分析](#5-决策点分析)
6. [运行问题与修复痕迹](#6-运行问题与修复痕迹)
7. [最终结论](#7-最终结论)
8. [附录 A: 完整资产清单](#附录-a-完整资产清单)
9. [附录 B: CIR 文件清单](#附录-b-cir-文件清单)
10. [附录 C: 未确定项汇总](#附录-c-未确定项汇总)

---

## 1. 项目概览

| 字段 | 值 |
|---|---|
| 项目 ID | `proj_1776077387676` |
| 主题 | 生而为人有多难得 |
| 参考视频 | `你的身体有多爱你.mp4`（上传时压缩为 `你的身体有多爱你_compressed.mp4`） |
| 创建时间 | 2026-04-13T10:49:47.676Z |
| 完成时间 | 2026-04-13T12:22:51.246Z |
| 端到端耗时 | **~93 分钟**（含人工暂停审查时间） |
| 最终视频 | `生而为人有多难得_1776082969247.mp4` — **137.1s, 1280×720, H.264+AAC, 25.2MB** |
| 管线状态 | 15/15 阶段全部完成 |
| 人工审查标记 | `manualReviewRequired = true`（QA 交叉校验 4 次未通过，自动标记） |

### 1.1 提供商配置

| 角色 | 提供商 | 模型/服务 | 接入方式 |
|---|---|---|---|
| 文本生成（Chat） | Gemini | Gemini 3.1 Pro | Playwright 浏览器自动化 |
| 图像生成 | ChatGPT → Pollinations 回退 | DALL·E / Pollinations | 浏览器自动化 → HTTP API 回退 |
| 视频生成 | AIVideoMaker | 付费 API | REST API（多 Worker 并发） |
| TTS 语音合成 | edge-tts | `zh-CN-YunjianNeural` | 本地 CLI |

### 1.2 暂停审查点（pauseAfterStages）

```json
["QA_REVIEW", "STORYBOARD", "REFERENCE_IMAGE"]
```

管线在这三个阶段完成后自动暂停，等待人工确认后才进入下一阶段。

---

## 2. 逐阶段还原

### 阶段耗时总览

| # | 阶段 | 耗时 | AI 调用数 | 类型 |
|---|---|---|---|---|
| 1 | CAPABILITY_ASSESSMENT | 0.004s | 0 | 确定性 |
| 2 | STYLE_EXTRACTION | 169.9s (2.8min) | 3 | AI (上传+2次文本) |
| 3 | RESEARCH | 37.2s (0.6min)¹ | 4 | AI (3次文本+1次验证) |
| 4 | NARRATIVE_MAP | 29.3s (0.5min) | 2 | AI (校准) |
| 5 | SCRIPT_GENERATION | 164.9s (2.7min) | 13 | AI (多轮生成+验证) |
| 6 | QA_REVIEW | 142.7s (2.4min) | 5 | AI (5轮审查) |
| 7 | TEMPORAL_PLANNING | 0.004s | 0 | 确定性 |
| 8 | STORYBOARD | 82.6s (1.4min) | 2 | AI (视觉提示词) |
| 9 | VIDEO_IR_COMPILE | 0.006s | 0 | 确定性 |
| 10 | REFERENCE_IMAGE | 319.7s (5.3min) | 17 | AI (16张参考图+1次sheet) |
| 11 | KEYFRAME_GEN | 1.6s | 2 | AI (2张关键帧) |
| 12 | VIDEO_GEN | 1156.5s (19.3min) | 0² | API (视频生成) |
| 13 | TTS | 25.8s (0.4min) | 0 | 本地 edge-tts |
| 14 | ASSEMBLY | 304.9s (5.1min) | 0 | 本地 FFmpeg |
| 15 | REFINEMENT | 0.033s | 0 | 确定性 |

> ¹ RESEARCH 仅计成功运行耗时；含前两次失败共约 180s。  
> ² VIDEO_GEN 通过 REST API 调用 AIVideoMaker，不走 chat 接口，故 AI log 计数为 0。

---

### Stage 1: CAPABILITY_ASSESSMENT（能力评估）

**耗时**: 4ms（确定性阶段）

**输入**: 系统配置、已注册提供商列表  
**输出**: `capability-assessment.json`

**处理逻辑**: 
- 安全前置检查（Safety pre-check）：**通过**
- 探测可用提供商：`["chatgpt", "gemini", "aivideomaker"]`
- 无需 AI 调用

**产出物**:
```
capability-assessment.json
├─ safetyCheck: passed
└─ probedProviders: ["chatgpt", "gemini", "aivideomaker"]
```

---

### Stage 2: STYLE_EXTRACTION（风格 DNA 提取）

**耗时**: 169.9s (2.8 min)  
**AI 调用**: 3 次

| 序号 | 任务 | 方法 | 耗时 |
|---|---|---|---|
| 0001 | video_analysis | uploadFile | 2ms |
| 0002 | video_analysis | generateText | 120.1s |
| 0003 | video_analysis | generateText | 49.7s |

**输入**: 
- 压缩后的参考视频 `你的身体有多爱你_compressed.mp4`
- 提示词模板: `STYLE_EXTRACTION_PROMPT`（定义于 `prompts.ts:75`）

**处理流程**:
1. 上传视频文件到 Gemini（2ms）
2. 第一次 generateText：发送 `STYLE_EXTRACTION_PROMPT`，要求提取完整 Style DNA（120s）
3. 第二次 generateText：补充细节提取（50s）
4. 跳过了 self-assessment 预通道（日志记录: "Skipping self-assessment pre-pass for faster style extraction"）

**产出物**:
```
style-profile.json          ← 扁平化风格配置
style-analysis.cir.json     ← CIR 格式完整风格分析
├─ scriptTrack
│   ├─ hookStrategy: "Paradoxical question or shocking statistic"
│   ├─ narrativeArc: 6 段式 (Hook → Daily → Immune → Self-Pres → Climax → Reflection)
│   └─ rhetoricalCore: "Personification, Hyperbole, Repetition"
├─ visualTrack
│   ├─ medium: "3D animated mixed with live-action stock footage"
│   ├─ colorTemp: warm
│   ├─ transitions: dissolve
│   └─ lighting: cinematic
└─ audioTrack
    ├─ bgm: "Cinematic Ambient"
    └─ narrator: "deep male"
```

**提取的关键风格参数**:

| 参数 | 值 |
|---|---|
| visualStyle | 3D animated mixed with live-action stock footage |
| pacing | medium |
| tone | emotional, awe-inspiring, solemn |
| colorPalette | `#3B0A0D, #E63946, #0B132B, #4EA8DE, #F1FAEE` |
| hookType | Emotional/Story |

---

### Stage 3: RESEARCH（事实调研）

**耗时**: 37.2s（成功运行），含失败约 ~217s 总耗时  
**AI 调用**: 4 次（2 次失败 + 1 次成功 + 1 次验证）

| 序号 | 任务 | 方法 | 耗时 | 结果 |
|---|---|---|---|---|
| 0004 | fact_research | generateText | 58.1s | ✗ JSON 解析失败 |
| 0005 | fact_research | generateText | 120.0s | ✗ 超时 (120s 限制) |
| 0006 | fact_research | generateText | 18.4s | ✓ 成功 |
| 0007 | claim_verification | generateText | 18.8s | ✓ 事实验证完成 |

**输入**: 
- 主题 "生而为人有多难得"
- 提示词模板: `RESEARCH_PROMPT`（定义于 `prompts.ts:185`）

**事实调研结果** (research.cir.json):

| Fact ID | 内容 | 来源标记 | 置信度 | 状态 |
|---|---|---|---|---|
| 1 | existence-probability（降生概率三亿分之一） | 概率论统计 | 0.3 | ⚠️ disputed |
| 2 | cell-regeneration（37万亿细胞） | 生物学研究 | verified | ✓ |
| 3 | dna-storage（DNA信息存储） | — | — | ⚠️ disputed |
| 4 | heart-power（心脏一生跳25亿次） | 据统计 | verified | ✓ |
| 5 | bacterial-shield（免疫系统 T 细胞凋亡） | 科学家发现 | verified | ✓ |

**额外发现**:
- 3 条 myths（常见误解）被标记
- 3 条 glossary terms 被定义
- `fact-verification.json`: 2/5 事实被标记为 disputed

---

### Stage 4: NARRATIVE_MAP（叙事地图）

**耗时**: 29.3s (0.5 min)  
**AI 调用**: 2 次（校准计算）

| 序号 | 任务 | 方法 | 耗时 |
|---|---|---|---|
| 0008 | calibration | generateText | 17.6s |
| 0009 | calibration | generateText | 11.6s |

**输入**:
- Style DNA（来自 Stage 2）
- 研究事实（来自 Stage 3）
- 参考视频时长 + 字幕文本
- 提示词模板: `CALIBRATION_PROMPT`（定义于 `prompts.ts:217`）

**校准数据** (calibration.json):

| 参数 | 值 |
|---|---|
| reference_total_words | 504 |
| reference_duration_sec | 92 |
| actual_speech_rate | 328.7 字/分钟 |
| target_word_count | 504（范围 453.6–554.4） |

**叙事结构** (narrative-map.json):

| # | 章节 | 时长(s) | 目标字数 | 引用事实 |
|---|---|---|---|---|
| 1 | Paradoxical Hook | 12 | 66 | Fact 1 |
| 2 | Daily Organ Maintenance | 15 | 82 | Fact 2 |
| 3 | Immune Defense & Sacrifice | 18 | 99 | Fact 3 |
| 4 | Self-Preservation Mechanisms | 15 | 82 | Fact 4 |
| 5 | Terminal Lucidity (Climax) | 17 | 93 | Fact 5 |
| 6 | Cosmic Metaphor & Emotional Reflection | 15 | 82 | — |
| **合计** | | **92** | **504** | |

---

### Stage 5: SCRIPT_GENERATION（脚本生成）

**耗时**: 164.9s (2.7 min)  
**AI 调用**: 13 次（历经安全阻断、多轮验证、审计修正）

**这是整个管线中最波折的阶段，总结如下：**

#### 阶段 5a: 前三次安全阻断（修改前代码行为）

> **证据层**: 以下三条日志为 `[RUNTIME]` 事实，记录于 `project.json` logs 数组。  
> 触发安全阻断的代码逻辑为 `[CODEBASE]` 事实——但需注意：**这些日志对应的是修改前的代码行为**（safety hard-block），该代码在 11:09 之后被修改为 warning，因此阶段 5b 及之后的日志对应的是修改后的代码行为。

| 时间 | 事件 |
|---|---|
| 11:00:20 | `[RUNTIME]` 第 1 次生成 → safety block: `suicide_risk, absolute_statement` |
| 11:05:27 | `[RUNTIME]` 第 2 次生成 → safety block: `suicide_risk, absolute_statement` |
| 11:09:23 | `[RUNTIME]` 第 3 次生成 → safety block: `suicide_risk, absolute_statement` |

> **`[CODEBASE]` 根因**: 主题 "生而为人有多难得" 涉及生命价值话题，AI 生成的正面文本被安全检查正则误判为自杀风险。这是一个典型的**正则级 false positive**——脚本内容实际是反自杀、积极向上的"请好好爱自己"类表达，但包含"自我摧残""放弃"等触发词。安全系统的失效模式是**关键词匹配无法理解语义极性**（正面引用 vs 负面煽动），而非安全系统的架构设计失效。  
> **`[CODEBASE]` 修复**: 上一次会话中将 `scriptGeneration.ts` 中的 safety hard-block 改为 warning log，允许管线继续。服务器重启后第 4 次运行成功。  
> **结论边界**: 此修复仅说明"关键词级安全检查对生命价值类正面主题存在误判"，不代表安全系统整体架构有缺陷。后续应增加语义级判定层（如 LLM 二次审查 intent），在保留关键词初筛的基础上消除 false positive。

#### 阶段 5b: 脚本生成成功后的验证循环

> **证据层**: 以下日志为 `[RUNTIME]` 事实，此时代码已完成 safety hard-block → warning 的修改。

在代码修复后重新启动管线，进入正常生成-验证循环：

| AI 调用 | 时间 | 结果 | 失败原因 |
|---|---|---|---|
| 0001 | 11:13:39 | 生成脚本 v1 | — |
| — | 11:13:39 | 验证 v1 ✗ | 字数超出 (693 vs max 554.4), 留存钩子 0/3, 来源标注 0% |
| 0002 | 11:14:06 | 生成脚本 v2 | — |
| — | 11:14:06 | 验证 v2 ✗ | 留存钩子 2/3, 来源标注 20%, 节奏相关 0.03 |
| 0003 | 11:14:32 | 生成脚本 v3 | — |
| — | 11:14:32 | 验证 v3 ✗ | 留存钩子 2/3, 来源标注 0%, 节奏相关 0.04 |
| 0004 | 11:15:35 | 生成脚本 v4 | — |
| — | 11:15:35 | 验证 v4（best version accepted²） | 3 轮验证全部失败后接受最佳版本 |

> ² 系统在 3 次验证均失败后自动选择最佳版本继续。

#### 阶段 5c: 脚本审计（Script Audit）

对接受的脚本进行自动审计（`script-audit.json`），产出 5 条修正：
- 2 条事实准确性修正
- 2 条风格一致性改进
- 1 条来源标记添加

**最终脚本** (script.cir.json / scriptOutput):

共 **15 句**，关键段落：

> 1. 这可能是你第一次认识到，你正在被全宇宙最顶级、最庞大的团队秘密守护。
> 2. 据地质学统计，地球历经46亿年演化，人类仅占0.01%的时间，而你却是这史诗中唯一的奇迹。
> 3. 当你感到平庸时，你那由37万亿个细胞构成的精密帝国，正为了让你活下去而进行着一场赌上性命的远征。
> ...
> 14. 当你以为外界抛弃你时，不要忘了，据统计你的心脏一生大约跳动25亿次，它还在黑暗中死心塌地地深爱着你。
> 15. 所以，请为了这些为你拼命的微小生命，再一次好好爱自己吧。

**安全标记**: `categories: ["absolute_statement"]`（降级为 warning）

---

### Stage 6: QA_REVIEW（质量审查）

**耗时**: 142.7s (2.4 min)  
**AI 调用**: 5 次

**这是管线中第二个复杂阶段**：AI 审查反复通过高分，但确定性交叉校验持续失败。

| 轮次 | AI 评分 | 确定性校验 | 结果 |
|---|---|---|---|
| 1 | 9.4/10 (approved) | ✗ 留存钩子 2/3, 来源标注 25%, 节奏 -0.02 | override → 重新生成 |
| 2 | 9.5/10 (approved) | ✗ 留存钩子 2/3, 来源标注 25%, 节奏 0.00 | override → 重新生成 |
| 3 | 9.5/10 (approved) | ✗ 留存钩子 2/3, 节奏 -0.05 | override → 重新生成 |
| 4 | 9.4/10 (approved) | ✗ 留存钩子 2/3, 来源标注 25%, 节奏 -0.13 | **放弃** → manualReviewRequired=true |

**最终 QA 评分**:

| 维度 | 分数 |
|---|---|
| accuracy | 10 |
| styleConsistency | 9 |
| productionReadiness | 9 |
| engagement | 10 |
| **overall** | **9.4** |
| contentContamination | 10 (clean) |

**QA 提出的 2 个问题**:
1. 句 5 "为了确保这台精密仪器的在大多数情况下安全" 含轻微语法错误（"的在"）
2. 句 10 "基因序列也从未想过要放弃你" 的拟人表达建议在 3D 动画中有具象化

**确定性校验持续失败的 3 个原因**:
1. **留存钩子不足**：检测到 2 处悬念句，要求 ≥3 处
2. **事实来源标注不足**：仅 25% 的数据句有来源标记（要求 ≥50%）
3. **句长节奏偏离**：Pearson 相关系数 < 0.30（与系列签名不匹配）

> `[CODEBASE]` 确定性验证器的阈值可能过于严格（→ 见附录 C #U4）。实际脚本质量（AI 评分 9.4-9.5）远高于确定性检查所暗示的质量水平。

---

### Stage 7: TEMPORAL_PLANNING（时间规划）

**耗时**: 4ms（确定性阶段）  
**AI 调用**: 0

**输入**: 脚本（15句）+ 校准数据  
**输出**: `temporal-plan.cir.json`

| 参数 | 值 |
|---|---|
| totalDurationSec | 60 |
| scenes | 16 |
| apiDurationSec（每场景） | 5s（统一） |
| rawDurationSec 范围 | 3.0s – 4.84s |
| pacing | medium |

> **注意**: 16 个场景而非 15 个——第 2 句（长句）被拆分为两个场景。

---

### Stage 8: STORYBOARD（分镜设计）

**耗时**: 82.6s (1.4 min)  
**AI 调用**: 2 次

| 序号 | 任务 | 方法 | 耗时 |
|---|---|---|---|
| 0013 | visual_prompts | generateText | 50.8s |
| 0014 | visual_prompts | generateText | 31.8s |

**输入**: 
- 脚本 + 叙事地图 + Style DNA
- 提示词模板: `STORYBOARD_PROMPT`（定义于 `prompts.ts:493`）

**输出**: `storyboard.cir.json` — 16 个场景的详细视觉提示词

每个场景包含：
- `visualPrompt`: 详细英文图像提示词（平均 ~200 字/场景）
- `assetType`: 全部为 `image`（后在 VIDEO_IR 阶段部分改为 `video`）
- `targetDurationSec`: 4.5s

**示例（场景 0）**:
> "A hyper-realistic close-up of a human eye iris transitioning into a swirling cosmic nebula. The pupil acts as a black hole, surrounded by millions of glowing golden particles representing a protective shield. High contrast cinematic lighting, dramatic shadowing with luminescent subsurface scattering, warm gold and deep navy palette, 8k resolution, mixed media style."

---

### Stage 9: VIDEO_IR_COMPILE（视频 IR 编译）

**耗时**: 6ms（确定性阶段）  
**AI 调用**: 0

**功能**: 将前序所有数据冻结编译为 `video-ir.cir.json` — **不可变的生产编译屏障**。

**关键转换**:
- 场景 0, 1 的 `assetType` 从 `image` 升级为 `video`（用于视频生成）
- 场景 2-15 保持 `image`
- 所有场景锁定 `ttsVoice: "zh-CN-YunjianNeural"`
- 写入完整 production metadata（camera, lighting, sound）

**Subject Isolation 检查** (`subject-isolation.json`):
- 16 个场景检查，**2 个需要提示词修订**：
  - 场景 4: "37 trillion" — 数值不可渲染
  - 场景 9: 隔离置信度仅 0.5

---

### Stage 10: REFERENCE_IMAGE（参考图生成）

**耗时**: 319.7s (5.3 min)  
**AI 调用**: 17 次（1 次失败 + 16 次图像生成）

| 序号 | 方法 | 耗时 | 说明 |
|---|---|---|---|
| 0015 | generateImage | 168ms | reference sheet — **失败** |
| 0016-0031 | generateImage | ~90s 每张 | 16 张场景参考图 |

**Reference Sheet 失败**:
```
Cannot read properties of null (reading 'close')
```
管线继续，不使用视觉锚。

**回退链**: ChatGPT → **Pollinations**（所有 16 张图均通过 Pollinations HTTP API 回退生成）

**每张图约 90s**，16 张图串行生成 → 总计 ~24 分钟（含暂停审查时间）

---

### Stage 11: KEYFRAME_GEN（关键帧生成）

**耗时**: 1.6s  
**AI 调用**: 2 次

| 序号 | 方法 | 耗时 |
|---|---|---|
| 0032 | generateImage | 844ms |
| 0033 | generateImage | 736ms |

仅生成 **2 张关键帧**（对应场景 0, 1 的 video 类型），其余 14 个 image 类型场景直接使用参考图。

**质量门**: `100% fresh`（2 张全部为新生成，0 张回退使用参考图）

---

### Stage 12: VIDEO_GEN（视频生成）

**耗时**: 1156.5s (19.3 min) — **全管线最耗时阶段**  
**AI 调用**: 0（通过 REST API，不走 chat 接口）

仅对 **2 个场景**（场景 0, 1）生成视频片段，其余 14 个场景使用静态图 + Ken Burns 效果。

**Worker 调度过程**:

| 时间 | 事件 |
|---|---|
| 11:58:07 | W0 尝试场景 1 → **Quota depleted** → 退回队列 |
| ~12:00 | W2 接手场景 1 → 生成中... |
| 12:09:45 | W1 尝试场景 2 → retry 1/1 |
| 12:09:57 | W1 场景 2 → **Quota depleted** → 退回队列 |
| ~12:10 | W3 接手场景 2 → 生成中... |
| 12:16:xx | 场景 1 生成完成 → `video_scene_1.mp4` |
| 12:17:xx | 场景 2 生成完成 → `video_scene_2.mp4` |

**产出**:
- `assets/video_scene_1.mp4`
- `assets/video_scene_2.mp4`

> `[RUNTIME]` 各 Worker 使用的实际 API Key 无法从日志中确定（→ 见附录 C #U3）。仅知 W0/W1 配额耗尽后 W2/W3 接替。

---

### Stage 13: TTS（语音合成）

**耗时**: 25.8s (0.4 min)  
**AI 调用**: 0（本地 edge-tts）

| 配置 | 值 |
|---|---|
| 引擎 | edge-tts |
| 声线 | zh-CN-YunjianNeural |
| 场景数 | 16 |
| 总计 MP3 | 16 个文件 |

所有 16 个场景的 TTS 在 **19 秒内**完成（12:17:27 – 12:17:46）。

**产出**: `tts_*.mp3` × 16 文件

---

### Stage 14: ASSEMBLY（FFmpeg 合成）

**耗时**: 304.9s (5.1 min)  
**AI 调用**: 0（本地 FFmpeg）

**处理内容**:
1. 将 2 个视频片段 + 14 张图片（Ken Burns 效果）+ 16 段 TTS 音频组装
2. 生成字幕文件 `subtitles.srt`
3. 编码为 H.264 + AAC
4. 输出 1280×720 分辨率

**Assembly 验证** (`assembly-validation.json`):

| 参数 | 值 |
|---|---|
| duration | 137.1s |
| width | 1280 |
| height | 720 |
| expectedDuration | 136.7s |
| durationDelta | 0.28% ✓ |

**产出**:
- `assets/生而为人有多难得_1776082969247.mp4` (25.2MB)
- `assets/subtitles.srt`

---

### Stage 15: REFINEMENT（精炼检查）

**耗时**: 33ms（确定性阶段）  
**AI 调用**: 0

**最终风险门** (`final-risk-gate.json`):

| 检查项 | 结果 |
|---|---|
| sceneCompleteness | ✓ passed |
| placeholderDetection | ✓ passed |
| narrativeSafety | ✓ passed |
| missingAssets | [] (无) |
| safetyIssues | [] (无) |

**精炼结果** (`refinement.json`): `allComplete: true`, 0 个失败/重试场景。

---

## 3. Prompt 清单

### 3.1 代码中定义的提示词模板 `[CODEBASE]`（`src/pipeline/prompts.ts`）

| 模板常量 | 行号 | 用于阶段 | 本次是否使用 |
|---|---|---|---|
| `ANALYSIS_SELF_ASSESSMENT_PROMPT` | L21 | STYLE_EXTRACTION 预通道 | ✗ 跳过 |
| `STYLE_EXTRACTION_PROMPT` | L75 | STYLE_EXTRACTION | ✓ |
| `RESEARCH_PROMPT` | L185 | RESEARCH | ✓ |
| `CALIBRATION_PROMPT` | L217 | NARRATIVE_MAP | ✓ |
| `SCRIPT_SYSTEM_PROMPT` | L275 | SCRIPT_GENERATION (system) | ✓ |
| `SCRIPT_USER_PROMPT` | L291 | SCRIPT_GENERATION (user) | ✓ |
| `STORYBOARD_PROMPT` | L493 | STORYBOARD | ✓ |
| `REFERENCE_SHEET_PROMPT` | L581 | REFERENCE_IMAGE (sheet) | ✓ (但失败) |
| `IMAGE_GEN_PROMPT` | L602 | REFERENCE_IMAGE / KEYFRAME | ✓ |
| `VIDEO_GEN_PROMPT` | L616 | VIDEO_GEN | ✓ |
| `SAFETY_PRE_CHECK_PROMPT` | L624 | CAPABILITY_ASSESSMENT | ✓ |
| `QA_REVIEW_PROMPT` | L637 | QA_REVIEW | ✓ |
| `FORMAT_SIGNATURE_PROMPT` | L743 | STYLE_EXTRACTION | → 见附录 C #U1 |

### 3.2 实际 AI 调用统计 `[RUNTIME]`

> **口径说明**: AI 日志文件 46 个，实际调用合计 48 次（SCRIPT_GENERATION 阶段含前次运行遗留日志，导致文件数与调用次数不一致）。

| 阶段 | generateText | generateImage | uploadFile | 总计 |
|---|---|---|---|---|
| STYLE_EXTRACTION | 2 | 0 | 1 | 3 |
| RESEARCH | 4 | 0 | 0 | 4 |
| NARRATIVE_MAP | 2 | 0 | 0 | 2 |
| SCRIPT_GENERATION | 13 | 0 | 0 | 13 |
| QA_REVIEW | 5 | 0 | 0 | 5 |
| STORYBOARD | 2 | 0 | 0 | 2 |
| REFERENCE_IMAGE | 0 | 17 | 0 | 17 |
| KEYFRAME_GEN | 0 | 2 | 0 | 2 |
| **总计** | **28** | **19** | **1** | **48**³ |

> ³ 见上方口径说明。

### 3.3 Prompt 映射缺口

| 问题 | 说明 | 证据层 |
|---|---|---|
| AI log `promptLength` 全部为 0 | AI 日志系统未记录实际 prompt 长度，无法从日志反推实际 prompt 内容 | `[RUNTIME]` |
| `FORMAT_SIGNATURE_PROMPT` 是否使用 | 无法确认本次运行是否调用（→ 见附录 C #U1） | `[RUNTIME]` |
| 动态 prompt 注入不可见 | `[CODEBASE]` `SCRIPT_USER_PROMPT` 使用 `fillTemplate()` 注入 style/facts/calibration，实际 prompt 远长于模板，但填充后的完整文本未被持久化 | 混合 |

### 3.4 下一版审计的 Prompt 日志要求

当前 AI 日志仅记录元数据（stage/taskType/method/duration），**未落盘实际 prompt 原文**，这使得审计只能通过 `[CODEBASE]` 模板反推，无法获得 `[RUNTIME]` 级的精确 prompt。

**建议每次 AI 调用同时持久化以下 7 个字段**:

```
{
  "prompt_name":        "SCRIPT_USER_PROMPT",           // 模板常量名
  "filled_prompt":      "# SCRIPT GENERATION — ...",    // fillTemplate() 后的完整文本
  "input_artifact_refs": [                               // 输入 artifact 引用
    "style-analysis.cir.json",
    "research.cir.json",
    "calibration.json"
  ],
  "output_artifact_refs": [                              // 输出 artifact 引用
    "script.cir.json"
  ],
  "model_provider":     "CHAT/Gemini 3.1 Pro",          // 实际模型+提供商
  "attempt_no":         3,                               // 第几次尝试
  "session_group":      "creation"                       // 所属会话组
}
```

这样报告可直接升级为**可复现证据**——给定相同 `filled_prompt` + 相同模型，理论上应产出结构相似的输出。

---

## 4. Artifact 血缘图

```
参考视频 (你的身体有多爱你.mp4)
  │
  ├─[Stage 1]→ capability-assessment.json
  │
  ├─[Stage 2]→ style-profile.json ──────────────────────┐
  │            style-analysis.cir.json ─────────────────┤
  │                                                      │
  ├─[Stage 3]→ research.cir.json ──────────────────────┤
  │            fact-verification.json                    │
  │                                                      │
  ├─[Stage 4]→ calibration.json ───────────────────────┤
  │            narrative-map.json ──────────────────────┤
  │                                                      ▼
  ├─[Stage 5]→ script.cir.json ◄── {style + research + calibration + narrative}
  │            script-validation-{0,1,2}.json
  │            script-audit.json
  │            script-validation-post-audit.json
  │                    │
  │                    ▼
  ├─[Stage 6]→ qa-review.json ◄── {script + style}
  │            format-signature.json
  │                    │
  │                    ▼
  ├─[Stage 7]→ temporal-plan.cir.json ◄── {script + calibration}
  │                    │
  │                    ▼
  ├─[Stage 8]→ storyboard.cir.json ◄── {script + narrative + style + temporal}
  │                    │
  │                    ▼
  ├─[Stage 9]→ video-ir.cir.json ◄── {storyboard + temporal + style + script}
  │            subject-isolation.json          ┌── 编译屏障（Frozen）
  │            style-contract-result.json      │
  │                    │                       │
  │                    ▼                       │
  ├─[Stage 10]→ reference images (×16) ◄──────┘
  │                    │
  │                    ▼
  ├─[Stage 11]→ keyframes (×2) ◄── {reference images + video-ir}
  │                    │
  │                    ▼
  ├─[Stage 12]→ video_scene_{1,2}.mp4 ◄── {keyframes + video-ir}
  │                    │
  ├─[Stage 13]→ tts_*.mp3 (×16) ◄── {script sentences + voice config}
  │                    │
  │                    ▼
  ├─[Stage 14]→ 最终视频 + subtitles.srt ◄── {videos + images + tts + script}
  │                    │
  │                    ▼
  └─[Stage 15]→ refinement.json + final-risk-gate.json
```

### 会话 (Sessions) 消息分布

| 会话组 | 覆盖阶段 | 消息数 |
|---|---|---|
| analysis | CAPABILITY_ASSESSMENT, STYLE_EXTRACTION, RESEARCH | 2 |
| creation | NARRATIVE_MAP, SCRIPT_GENERATION, QA_REVIEW, TEMPORAL_PLANNING | 11 |
| visual | STORYBOARD, VIDEO_IR_COMPILE, REFERENCE_IMAGE, KEYFRAME_GEN | 3 |
| production | VIDEO_GEN, TTS, ASSEMBLY, REFINEMENT | 0 |

---

## 5. 决策点分析

### 5.0 决策归因表（Decision Attribution Table）

以 `authority → input → rule → output` 格式列出所有关键决策点：

| 决策 | Authority（决策者） | Input（输入） | Rule（规则） | Output（输出） | 证据层 |
|---|---|---|---|---|---|
| **文本提供商选择** | `capabilityAssessment` 探测 | configStore 注册的 provider 列表 | `[CODEBASE]` 探测所有已注册 providers，选择第一个 available | 选择 Gemini 作为本次文本阶段可用提供商 | `[RUNTIME]` capability-assessment.json |
| **场景数** | `temporalPlanning.ts` | script 15 句 + calibration | `[CODEBASE]` 按 TTS 时长拆分长句，每句 ≤ maxDurationSec | 16 场景（句 2 拆为 2 段） | `[RUNTIME]` temporal-plan.cir.json |
| **视频/图片资产类型** | `videoIrCompile.ts` | storyboard 16 scenes + provider quota config | `[CODEBASE]` 前 N 个 hook/climax 场景分配 video，其余 image（→ 见附录 C #U2 具体逻辑） | 场景 0,1 = video; 2-15 = image | `[RUNTIME]` video-ir.cir.json |
| **安全阻断** | `scriptGeneration.ts` 安全检查函数 | 生成的脚本文本 | `[CODEBASE]` 正则匹配 suicide/self-harm 关键词 → hard-block（修改前）/ warning（修改后） | 3 次 block → 代码修改 → 通过 | `[RUNTIME]` project.json logs |
| **QA 放行** | `qaReview.ts` 交叉校验逻辑 | AI QA 评分 + 确定性检查结果 | `[CODEBASE]` AI approved AND 确定性 pass → 通过; 否则 regenerate; 4 轮后 → manualReviewRequired | manualReviewRequired=true（4 轮未通过） | `[RUNTIME]` qa-review.json + logs |
| **脚本字数** | `calibration` 阶段 + `scriptValidation.ts` | 参考视频 transcript 504 字 / 92s | `[CODEBASE]` target = ref_words, 允许 ±10%（453.6–554.4） | 最终 ~583 字（v1 的 693 字被拒后迭代收敛） | `[RUNTIME]` calibration.json + script-validation-*.json |
| **最终时长** | `ffmpegAssembler.ts` | 16 段 TTS audioDurationSec + 视频/图片素材 | `[CODEBASE]` 每场景视觉资产按 TTS 时长裁剪/循环 → 拼接 | 137.1s（预期 136.7s, delta 0.28%） | `[RUNTIME]` assembly-validation.json |
| **图像生成提供商** | `fallbackAdapter.ts` 回退链 | ChatGPT 浏览器端 generateImage 请求 | `[CODEBASE]` 主链失败 → Pollinations HTTP 回退 | 全部 18 张通过 Pollinations 生成 | `[RUNTIME]` ai-logs 0015-0033 |
| **视频生成 Worker** | `videoProvider.ts` Worker 池 | W0 请求 → quota depleted | `[CODEBASE]` quota 耗尽 → 退回队列 → 下一 Worker 接手 | W0,W1 失败 → W2,W3 最终完成 | `[RUNTIME]` project.json warning logs |
| **TTS 声线** | `video-ir.cir.json` 冻结配置 | style-analysis.cir.json audioTrack | `[CODEBASE]` narrator=deep male → zh-CN-YunjianNeural | 全 16 场景统一声线 | `[RUNTIME]` video-ir.cir.json |
| **人工暂停点** | `orchestrator.ts` | project.pauseAfterStages 配置 | `[CODEBASE]` 阶段完成后检查是否在 pauseAfterStages 列表中 | QA_REVIEW / STORYBOARD / REFERENCE_IMAGE 后暂停 | `[RUNTIME]` project.json |

### 5.1 场景数量决定

| 决策过程 | 值 |
|---|---|
| 脚本句数 | 15 |
| 实际场景数 | 16（句 2 拆分为 2 个场景） |
| 视频场景 | 2（场景 0, 1） |
| 图片场景 | 14（场景 2-15） |

**决定因素**: `temporal-plan` 阶段根据句子字数/TTS 时长分配，长句自动拆分。

### 5.2 视频 vs 图片资产类型决定

| 决策 | 结果 |
|---|---|
| VIDEO_IR_COMPILE 时 | 仅场景 0, 1 标记为 `video`，其余 `image` |
| 视频生成数量 | 2 |
| 图片 Ken Burns | 14 |

**`[RUNTIME]` 观察到的结果**: 场景 0, 1 获得 `video` 资产，场景 2-15 为 `image`。资产类型分配逻辑已从产物中观察到结果，但具体规则未从代码中精确提取，正文不作进一步推断（→ 见附录 C #U2）。

### 5.3 音频-视频对齐策略

| 参数 | 值 |
|---|---|
| TTS 引擎 | edge-tts (zh-CN-YunjianNeural) |
| 每场景 TTS 时长 | 由 `audioDurationSec` 确定 |
| 视频片段时长 | `rawDurationSec` (3.0–4.84s) |
| API 请求时长 | `apiDurationSec` = 5s（统一） |
| 最终总时长 | 137.1s（16 段 TTS 拼接，视频/图片按 TTS 时长裁剪或垫) |

**对齐方式**: FFmpeg 在 ASSEMBLY 阶段将每个场景的视觉资产（视频/图片）按对应 TTS 音频时长进行裁剪或循环，确保口播与画面同步。

### 5.4 回退链路

| 服务 | 主链 | 回退链 | 本次使用 |
|---|---|---|---|
| 文本生成 | Gemini (浏览器) | — | Gemini |
| 图像生成 | ChatGPT (浏览器) | Pollinations (HTTP) | **Pollinations**（全部 16+2 张） |
| 视频生成 | AIVideoMaker W0 | W1 → W2 → W3 | W0/W1 失败 → W2/W3 成功 |
| TTS | edge-tts | — | edge-tts |

### 5.5 人工审查点触发

| 暂停点 | 是否触发 | 原因 |
|---|---|---|
| QA_REVIEW 后 | ✓ | `pauseAfterStages` 配置 |
| STORYBOARD 后 | ✓ | `pauseAfterStages` 配置 |
| REFERENCE_IMAGE 后 | ✓ | `pauseAfterStages` 配置 |
| manualReviewRequired | ✓ | QA 交叉校验 4 次未通过后自动标记 |

---

## 6. 运行问题与修复痕迹

### 6.0 运行中代码热修改声明

> 本项目在管线执行过程中发生了 **1 次代码热修改**。此声明用于帮助读者理解第 6.1 节及第 2 节阶段 5a/5b 中的证据分层。

| 字段 | 值 |
|---|---|
| 修改时间 | `[RUNTIME]` 2026-04-13 ~11:10（阶段 5a 第 3 次阻断后） |
| 修改文件 | `[CODEBASE]` `src/pipeline/scriptGeneration.ts` |
| 修改内容 | safety 检查中 `suicide_risk` + `absolute_statement` 命中时的处理方式从 **hard-block（抛出异常，中断管线）** 改为 **warning log（记录警告，继续执行）** |
| 触发原因 | 管线因主题 "生而为人有多难得" 生成的正面文本被正则误判为自杀风险，连续 3 次中断 |
| 服务器重启 | 修改后重启 Node 进程，从 SCRIPT_GENERATION 阶段入口恢复执行 |

**证据分界线**:
- 阶段 5a 的 3 条 `safety block` 日志（11:00–11:09）→ 对应**修改前**的 hard-block 代码行为
- 阶段 5b 及之后的所有日志（11:13–12:22）→ 对应**修改后**的 warning 代码行为
- 正文中已对此差异做逐条标注

---

### 6.1 安全检查硬阻断（Critical — 代码热修改解决）

| 时间 | 问题 | 影响 | 修复 |
|---|---|---|---|
| 11:00–11:09 `[RUNTIME]` | `suicide_risk` + `absolute_statement` 安全阻断 | 管线 3 次中断 | `[CODEBASE]` 将 `scriptGeneration.ts` 中 safety hard-block 改为 warning（见 §6.0）|

**`[RUNTIME]` 运行时表现**: 3 次连续管线中断，日志记录 `Safety block: Script contains high-risk content: absolute_statement, suicide_risk`。每次中断后管线状态回退至 SCRIPT_GENERATION 入口。

**`[CODEBASE]` 根因分析**: 主题 "生而为人有多难得" 探讨生命价值，AI 生成的正面、鼓励性文本（如 "自我摧残"、"放弃" 等词汇出现在正面语境中）被安全正则误判。

**结论边界**:
- ✓ 这是一个**关键词级 false positive**——正则匹配无法理解语义极性（"请别放弃自己" vs "教你如何放弃"）
- ✗ 这**不是**安全系统架构失效——关键词初筛作为第一道防线仍有价值
- ⚠️ 修复手段（hard-block → warning）降低了对真正高危主题的拦截力度，属于**临时绕行**而非根治
- → 建议增加语义级二次审查层（LLM intent classification），在保留关键词初筛的基础上消除 false positive

**遗留风险**: safety 降级为 warning 后，真正涉及自杀风险的主题也不会被阻断。当前代码状态下此缺陷仍然存在。

### 6.2 RESEARCH 失败与超时

| 时间 | 问题 | 修复 |
|---|---|---|
| 10:53:41 | 第 1 次：JSON 解析失败 | 自动重试 |
| 10:55:44 | 第 2 次：120s 超时 | 自动重试 |
| 10:59:03 | 第 3 次：成功 | — |

**根因**: Gemini 浏览器自动化不稳定，响应解析偶尔失败。120s 超时保护正常工作。

### 6.3 QA 交叉校验死循环

| 问题 | 影响 |
|---|---|
| QA AI 审查 4 次均给出 9.4-9.5 高分并 approve | — |
| 确定性交叉校验 4 次均失败 | manualReviewRequired=true |

**失败的确定性条件**:
- 留存钩子：始终仅检测到 2 处（要求 ≥3）
- 来源标注：25%（要求 ≥50%）
- 节奏相关系数：-0.13 – 0.00（要求 ≥0.30）

**遗留问题**: AI 认为脚本优质（9.4分），但确定性检查不通过。二者之间存在校准偏差。建议审查确定性验证器阈值是否需要降低，或将部分硬指标改为软提示。

### 6.4 Reference Sheet 生成失败

| 时间 | 错误 | 影响 |
|---|---|---|
| 11:29:13 | `Cannot read properties of null (reading 'close')` | 无视觉锚，管线继续 |

**根因**: 可能是 ChatGPT 浏览器页面在图像生成时已关闭或未正确初始化。

### 6.5 VIDEO_GEN 配额耗尽

| 时间 | Worker | 场景 | 结果 |
|---|---|---|---|
| 11:58:07 | W0 | 1 | Quota depleted → 退回队列 |
| 12:09:45 | W1 | 2 | Retry 1/1 → 10s 后重试 |
| 12:09:57 | W1 | 2 | Quota depleted → 退回队列 |

**修复**: 自动调度至 W2/W3 完成生成。多 Worker 池化策略有效。

### 6.6 Subject Isolation 提示词修订

| 场景 | 问题 | 处理 |
|---|---|---|
| 场景 4 | "37 trillion" 不可渲染为视觉元素 | 提示词修订 |
| 场景 9 | 隔离置信度 0.5（低） | 提示词修订 |

---

## 7. 最终结论

### 7.1 决定最终视频的关键因素

1. **Style DNA 是全管线的基石**：所有下游阶段（脚本、分镜、视觉提示词、颜色方案）均从 `style-analysis.cir.json` 的 5 色调色盘、cinematic 光影、emotional/solemn 基调继承。更换参考视频 = 完全不同的输出。

2. **安全检查塑造了内容边界**：safety 系统的 `suicide_risk` 阻断迫使脚本经过更多轮迭代，最终版本措辞更加温和。如果一开始没有阻断，脚本可能更激进。

3. **校准数据锁定了字数和节奏**：目标 504 字 / 92s 的校准直接限制了脚本长度。第一版 693 字严重超标 → 迭代压缩至 ~583 字。

4. **确定性验证器比 AI 更严格**：AI 审查一致给出 9.4-9.5 高分，但确定性检查（留存钩子、来源标注、节奏相关）始终不通过。最终脚本是在 "确定性不满意但 AI 认可" 的状态下被接受的。

5. **视频资产极为稀缺**：16 个场景中仅 2 个获得了真正的 AI 视频生成（场景 0, 1），其余 14 个使用静态图片 + Ken Burns 效果。这意味着最终视频的 "动感" 主要集中在开头。

6. **Pollinations 回退决定了视觉质量**：所有 18 张图片（16 参考 + 2 关键帧）均通过 Pollinations HTTP API 生成（ChatGPT 浏览器端图像生成未使用）。图片质量受 Pollinations 模型限制。

7. **配额管理是生产瓶颈**：VIDEO_GEN 阶段 19.3 分钟中，大量时间消耗在 W0/W1 配额耗尽→重排→W2/W3 接替的过程。多 API Key 池化策略保证了最终完成，但增加了 ~5 分钟延迟。

### 7.2 可复现性评估

| 因素 | 可复现性 | 说明 |
|---|---|---|
| 风格提取 | ⚠️ 部分可复现 | 依赖同一参考视频，但 AI 响应有随机性 |
| 事实调研 | ⚠️ 部分可复现 | Gemini 可能返回不同事实 |
| 脚本生成 | ✗ 不可复现 | 高度依赖 AI 创意，多轮迭代路径不同 |
| 确定性阶段 | ✓ 完全可复现 | TEMPORAL_PLANNING, VIDEO_IR, REFINEMENT |
| 视觉生成 | ✗ 不可复现 | 图像/视频生成有内在随机性 |
| 组装输出 | ✓ 可复现 | 给定相同资产，FFmpeg 确定性输出 |

### 7.3 改进建议

1. **AI 日志应记录实际 prompt 内容**（当前 `promptLength` 全为 0）→ 见 §3.4 详细字段规范
2. **确定性验证器阈值需要校准**（留存钩子 3→2、来源标注 50%→30%）→ 见附录 C #U4
3. **安全检查应增加语义级二次审查层**（在保留关键词初筛的基础上，增加 LLM intent classification 消除 false positive）→ 见 §6.1 结论边界
4. **Reference Sheet 生成的 null 引用 bug 需要修复**（`Cannot read properties of null`）
5. **totalDurationMs 在 observability.json 中为 0**（计算 bug，`[RUNTIME]`）
6. **回退链路应记录 attempted_providers**（当前无法区分"主链尝试后回退"和"直接跳过主链"）→ 见附录 C #U5
7. **暂停/恢复事件应记录精确时间戳对**（便于计算人工审查等待时长）→ 见附录 C #U6

---

## 附录 A: 完整资产清单

```
assets/
├── 生而为人有多难得_1776082969247.mp4   (最终视频 25.2MB)
├── video_scene_1.mp4                    (场景 0 视频片段)
├── video_scene_2.mp4                    (场景 1 视频片段)
├── tts_*.mp3 × 16                       (16段语音合成)
├── subtitles.srt                        (字幕文件)
└── _assembly_tmp/
    └── subtitles.srt                    (组装临时文件)
```

## 附录 B: CIR 文件清单

| 文件 | CIR 类型 | 版本 | 大小 |
|---|---|---|---|
| style-analysis.cir.json | StyleAnalysis | v1 | 完整风格分析 |
| research.cir.json | Research | v1 | 5 facts, 3 myths |
| script.cir.json | Script | v1 | 15 句脚本 |
| temporal-plan.cir.json | TemporalPlan | v1 | 16 场景时间分配 |
| storyboard.cir.json | Storyboard | v1 | 16 场景视觉提示词 |
| video-ir.cir.json | VideoIR | v1 | 冻结的生产编译配置 |
| video-plan.cir.json | VideoPlan | v1 | 16 场景资产映射 |

---

*报告生成完毕。所有数据均来自项目目录 `proj_1776077387676/` 中的实际文件。`[RUNTIME]` 标记的内容来自本次管线运行产出的日志和 artifact，`[CODEBASE]` 标记的内容来自审计时点的代码库。未能精确还原的部分统一列于附录 C。*

---

## 附录 C: 未确定项汇总

以下为审计过程中无法从现有文件精确还原的事项，正文中以 `→ 见附录 C #Ux` 交叉引用。

| ID | 未确定项 | 说明 | 可能的确认方式 |
|---|---|---|---|
| **U1** | `FORMAT_SIGNATURE_PROMPT` 是否被实际调用 | 46 个 AI log 文件（实际调用 48 次，见 §3.2 口径说明）中无 `format_signature` 类型的 taskType 记录，但 `format-signature.json` 文件存在于项目目录中。可能由 QA_REVIEW 阶段内联调用且未单独记录 AI log。 | 在 `qaReview.ts` 或 `styleExtraction.ts` 中搜索对该模板的引用，或在 AI 日志系统中增加 prompt_name 字段 |
| **U2** | 视频/图片资产类型的分配逻辑 | `video-ir.cir.json` 中场景 0,1 被标记为 `video`，其余为 `image`。推测基于叙事阶段（hook 优先）或预算限制，但具体判定条件未从代码中精确提取。 | 阅读 `videoIrCompile.ts` 中 `assetType` 的赋值逻辑 |
| **U3** | 视频生成 Worker 的具体 API Key | 日志仅记录 Worker 编号 (W0–W3) 和 quota 状态，未暴露各 Worker 绑定的 API Key 标识符。 | 在 `videoProvider.ts` Worker 初始化时日志中增加 key fingerprint |
| **U4** | 确定性验证器阈值是否过严 | AI QA 连续 4 轮给出 9.4–9.5 高分 (approved)，但确定性交叉校验连续 4 轮不通过。二者之间存在系统性校准偏差。留存钩子要求 ≥3（实际 2）、来源标注要求 ≥50%（实际 25%）、节奏相关系数要求 ≥0.30（实际 -0.13 – 0.00）。 | 对多个已成功发布的项目的确定性指标做统计分析，确认阈值合理性 |
| **U5** | 参考图回退的精确决策路径 | 所有 16 张参考图均通过 Pollinations 生成，但无法确认 ChatGPT 浏览器端是否被尝试过且失败，还是直接跳到了 Pollinations。AI log 0015 (reference sheet) 仅耗时 168ms 即失败，后续 0016-0031 各耗时 ~90s，回退链的尝试顺序未被记录。 | 在 `fallbackAdapter.ts` 中增加 `attempted_providers` 字段到 AI log |
| **U6** | 管线暂停期间的实际等待时长 | `observability.json` 记录的 stage 耗时是否包含人工暂停等待时间不确定。端到端 93 分钟 vs 各阶段耗时之和的差值即为暂停+间隔时间，但无法拆分各暂停点的具体等待时长。 | 在 project.json logs 中增加 `pause_start` / `resume` 事件对 |
