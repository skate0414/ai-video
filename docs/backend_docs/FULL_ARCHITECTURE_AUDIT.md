# 全系统架构审计报告

> 审计时间：2025-01  
> 审计范围：ai-video-main 完整代码库（简化后版本）  
> 审计性质：只读，无代码变更

---

## 目录

1. [项目结构总览](#1-项目结构总览)
2. [核心数据流](#2-核心数据流)
3. [关键类型定义](#3-关键类型定义)
4. [逐模块审计](#4-逐模块审计)
   - [A. 视频分析模块](#a-视频分析模块-capability_assessment--style_extraction--research)
   - [B. CIR 编译层](#b-cir-编译层)
   - [C. 脚本生成模块](#c-脚本生成模块-script_generation--qa_review)
   - [D. 分镜模块](#d-分镜模块-storyboard)
   - [E. 视觉生成模块](#e-视觉生成模块-reference_image--keyframe_gen--video_gen)
   - [F. 组装模块](#f-组装模块-tts--assembly--refinement)
   - [G. UI 交互层](#g-ui-交互层)
   - [H. 模型路由与适配器](#h-模型路由与适配器)
5. [系统级问题](#5-系统级问题)
6. [优先级建议](#6-优先级建议)

---

## 1. 项目结构总览

### 1.1 目录结构

```
ai-video-main/
├── src/                           # 后端（Node.js + TypeScript）
│   ├── server.ts                  # Express HTTP 服务 + SSE 事件流
│   ├── workbench.ts               # Playwright 浏览器自动化核心
│   ├── browserManager.ts          # 浏览器实例管理（Chromium 检测、隐身模式）
│   ├── configStore.ts             # 配置持久化（schema 迁移）
│   ├── resourceManager.ts         # AI 资源统一管理（账号、配额）
│   ├── taskQueue.ts               # FIFO 任务队列
│   ├── rateLimiter.ts             # 滑动窗口限流（每 IP）
│   ├── electronBridge.ts          # Electron IPC 桥接
│   ├── providers.ts               # 模型提供商定义
│   ├── types.ts                   # 后端补充类型
│   ├── adapters/                  # 外部服务适配器
│   │   ├── chatAdapter.ts         # Playwright 聊天自动化（免费层）
│   │   ├── geminiAdapter.ts       # Google Gemini API（付费层）
│   │   ├── fallbackAdapter.ts     # 免费→付费切换策略
│   │   ├── videoProvider.ts       # 即梦/可灵 浏览器自动化
│   │   ├── ttsProvider.ts         # edge-tts 本地语音合成
│   │   ├── ffmpegAssembler.ts     # FFmpeg 视频组装（5 步流程）
│   │   ├── imageExtractor.ts      # 图片提取工具
│   │   ├── responseParser.ts      # AI 回复 JSON 解析
│   │   └── schemaValidator.ts     # JSON Schema 验证
│   ├── pipeline/                  # 15 阶段流水线
│   │   ├── orchestrator.ts        # 流水线编排器（暂停/恢复/SSE）
│   │   ├── sessionManager.ts      # 聊天会话分组复用
│   │   ├── qualityRouter.ts       # 质量路由（免费/付费选择）
│   │   ├── providerRegistry.ts    # 提供商能力注册
│   │   ├── prompts.ts             # 17 个提示词模板
│   │   ├── types.ts               # 流水线类型定义
│   │   ├── stages/                # 阶段实现
│   │   │   ├── analysisStages.ts  # 分析阶段编排
│   │   │   ├── creationStages.ts  # 创作阶段编排
│   │   │   ├── visualStages.ts    # 视觉阶段编排
│   │   │   ├── productionStages.ts# 生产阶段编排
│   │   │   └── defs/              # 各阶段定义
│   │   └── ...
│   ├── cir/                       # CIR 中间表示层（已简化）
│   │   ├── types.ts               # CIR 类型定义（9 种 IR）
│   │   ├── loader.ts              # 薄加载器（仅 _cir 标签检查）
│   │   ├── parsers.ts             # CIR 解析器
│   │   └── contracts.ts           # 合约定义（当前不强制执行）
│   ├── routes/                    # HTTP 路由
│   └── lib/                       # 工具库（日志、临时文件、路径安全）
├── ui/                            # 前端（Vite + React/Vue）
│   └── src/                       # 7 个页面视图
├── browser-shell/                 # Electron 多标签浏览器壳
├── shared/                        # 前后端共享类型
├── data/                          # 静态数据（模型、提供商预设）
└── scripts/                       # 构建 & 部署脚本
```

### 1.2 技术栈

| 层     | 技术                                   |
|--------|---------------------------------------|
| 语言   | TypeScript (strict)                   |
| 运行时 | Node.js ≥ 20.9.0                     |
| 后端框架 | Express + SSE                       |
| 前端框架 | Vite + React/Vue                     |
| 浏览器自动化 | Playwright                      |
| 桌面壳 | Electron（可选）                       |
| 测试框架 | Vitest 4.1+                          |
| 视频处理 | FFmpeg（libx264 编码）               |
| 语音合成 | edge-tts（本地 CLI）                  |
| 当前基线 | tsc clean, 118 测试文件, 2075 测试通过 |

### 1.3 运行模式

```
┌─ 模式 A: 纯后端 ─────────────────────────────┐
│  npm start → Express server :3000              │
│  浏览器打开 UI，Playwright 后台运行             │
└───────────────────────────────────────────────┘

┌─ 模式 B: Electron 壳 ────────────────────────┐
│  electron main.ts → 多标签浏览器               │
│  内嵌 Express + CDP 自动化                     │
│  Tab 1: UI | Tab 2-N: AI 聊天窗口（隐身）      │
└───────────────────────────────────────────────┘
```

---

## 2. 核心数据流

### 2.1 完整流水线（15 阶段）

```
输入: 参考视频 + 主题文本
  │
  ▼
┌─────────────────── 分析阶段（会话组: Analysis）──────────────────┐
│ ① CAPABILITY_ASSESSMENT ─ 安全筛查 + 提供商探测（0 次 AI 调用）  │
│ ② STYLE_EXTRACTION ─ 视觉/脚本/音频风格提取（2-3 次 AI 调用）    │
│ ③ RESEARCH ─ 事实研究 + 交叉验证（2 次 AI 调用，双适配器）       │
└──────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────── 创作阶段（会话组: Creation）──────────────────┐
│ ④ NARRATIVE_MAP ─ 叙事结构 + 语速校准（2 次 AI: 校准+叙事）      │
│ ⑤ SCRIPT_GENERATION ─ 两步脚本生成（2 次 AI: 骨架→写作）         │
│   ├─ 安全两遍筛查（本地关键词 + LLM 意图分类）                    │
│   ├─ FormatSignature 系列一致性约束                               │
│   └─ 置信度感知字段过滤                                           │
│ ⑥ QA_REVIEW ─ 质量评审（1 次 AI，单遍，无重试循环）              │
│   ├─ 5 维评分 + B2 异常检测                                       │
│   └─ 污染检测（C12/C13 标记，人工审查）                           │
│ ⑦ TEMPORAL_PLANNING ─ 时间分配（纯计算，0 次 AI 调用）            │
│                                              ◄─ 暂停点: 人工审查脚本│
└──────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────── 视觉阶段（会话组: Visual）───────────────────┐
│ ⑧ STORYBOARD ─ 分镜生成（1 次 AI + 主体隔离子步骤）             │
│ ⑨ VIDEO_IR_COMPILE ─ 纯逻辑编译屏障（0 次 AI，对齐断言）        │
│ ⑩ REFERENCE_IMAGE ─ 风格锚定图（N 次图片生成 + 一致性门控）      │
│ ⑪ KEYFRAME_GEN ─ 视频帧生成（仅 video 类型场景）                │
│                                              ◄─ 暂停点: 审批参考图 │
└──────────────────────────────────────────────────────────────────┘
  │
  ▼
┌─────────────────── 生产阶段（独立会话）─────────────────────────┐
│ ⑫ VIDEO_GEN ─ 视频合成（配额感知工作池，i2v）                    │
│ ⑬ TTS ─ 语音合成（edge-tts 本地，并发信号量）                     │
│ ⑭ ASSEMBLY ─ FFmpeg 组装（5 步：合并→标准化→拼接→字幕→编码）      │
│ ⑮ REFINEMENT ─ 完整性验证 + 最终安全门                           │
└──────────────────────────────────────────────────────────────────┘
  │
  ▼
输出: 最终 MP4 视频文件
```

### 2.2 每阶段 AI 调用统计

| 阶段 | AI 调用次数 | 方法 | 提供商类型 |
|------|-----------|------|----------|
| CAPABILITY_ASSESSMENT | 0 | 本地安全中间件 | — |
| STYLE_EXTRACTION | 2-3 | generateText | 视频分析（聊天） |
| RESEARCH | 2 | generateText × 2 | 事实研究 + 交叉验证（不同适配器） |
| NARRATIVE_MAP（含校准） | 2 | generateText × 2 | 校准 |
| SCRIPT_GENERATION | 2 | generateText × 2 | 脚本生成（聊天） |
| QA_REVIEW | 1 | generateText | 质量评审 |
| TEMPORAL_PLANNING | 0 | 纯计算 | — |
| STORYBOARD | 1+1 | generateText × 2 | 视觉提示 + 主体隔离 |
| VIDEO_IR_COMPILE | 0 | 纯逻辑 | — |
| REFERENCE_IMAGE | N | generateImage × 场景数 | 图片生成（ChatGPT 聊天） |
| KEYFRAME_GEN | M | generateImage × video场景数 | 图片生成 |
| VIDEO_GEN | M | generateVideo × video场景数 | aivideomaker API |
| TTS | N | generateSpeech × 场景数 | edge-tts（本地） |
| ASSEMBLY | 0 | FFmpeg | 本地 |
| REFINEMENT | 0 | 本地检查 | — |

**总计文本 AI 调用：~10-12 次**（取决于验证/补充路径）  
**总计图片 AI 调用：~N+M 次**（N = 场景总数，M = video 类型场景数）  
**总计视频 AI 调用：~M 次**

### 2.3 CIR 中间表示传递链

```
STYLE_EXTRACTION → StyleAnalysisCIR ──────────────────────────────────┐
                    + FormatSignature ──────────────────────────┐     │
                    + ShotCIR ─────────────────────────────┐   │     │
RESEARCH ─────────→ ResearchCIR ──────────────────────┐   │   │     │
CALIBRATION ──────→ CalibrationData ─────────────┐   │   │   │     │
NARRATIVE_MAP ────→ NarrativeMap ────────────┐   │   │   │   │     │
SCRIPT_GEN ───────→ ScriptCIR ─────────┐   │   │   │   │   │     │
                                        │   │   │   │   │   │     │
TEMPORAL_PLANNING → TemporalPlanCIR ─┐ │   │   │   │   │   │     │
                                      │ │   │   │   │   │   │     │
STORYBOARD ──────→ StoryboardCIR ─┐  │ │   │   │   │   │   │     │
                                   │  │ │   │   │   │   │   │     │
VIDEO_IR_COMPILE → VideoIR ◄───────┴──┴─┘   │   │   │   │   │     │
     (对齐断言: 场景数一致)                   │   │   │   │   │     │
                                              │   │   │   │   │     │
后续阶段全部从 VideoIR 读取 ◄─────────────────┴───┴───┴───┴───┘     │
                                                                      │
QA_REVIEW 读取 ScriptCIR + StyleCIR + FormatSignature ◄───────────────┘
```

---

## 3. 关键类型定义

### 3.1 CIR 类型系统（9 种 IR）

| CIR 类型 | 用途 | 字段摘要 |
|----------|------|---------|
| `StyleAnalysisCIR` | 风格 DNA | visualTrack (介质/灯光/运镜/色温/构图/转场/时长), scriptTrack (修辞/节奏/术语/CTA), audioTrack (语速/语调/BGM), meta (语言/时长/受众) |
| `ResearchCIR` | 事实库 | facts[] (来源+置信度+验证状态), myths[], glossary[] |
| `ScriptCIR` | 脚本结构 | sentences[] (文本+时长), totalWordCount, safety metadata |
| `FormatSignature` | 系列 DNA | hook/closing 模板, sentenceRhythm 序列, arcAllocation, transitions, signaturePhrases |
| `TemporalPlanCIR` | 时间分配 | scenes[] (分配时长), totalSentences |
| `StoryboardCIR` | 分镜描述 | scenes[] (narrative/visualPrompt/productionSpecs/estimatedDuration) |
| `ShotCIR` | 参考视频镜头 | shots[] (时长/运镜/主体/色彩), totalShots, videoDurationSec |
| `VideoPlanCIR` | 资产就绪度 | scene assets + readiness score |
| `VideoIR` | 最终生产计划 | scenes[] (完整解析: prompt/assetType/apiDuration/ttsVoice/ttsRate/palette/lighting), resolution, fps, avSyncPolicy, bgmVolume |

### 3.2 核心运行时类型

```typescript
// 15 阶段枚举
type PipelineStage = 
  | 'CAPABILITY_ASSESSMENT' | 'STYLE_EXTRACTION' | 'RESEARCH'
  | 'NARRATIVE_MAP' | 'SCRIPT_GENERATION' | 'QA_REVIEW' | 'TEMPORAL_PLANNING'
  | 'STORYBOARD' | 'VIDEO_IR_COMPILE' | 'REFERENCE_IMAGE' | 'KEYFRAME_GEN'
  | 'VIDEO_GEN' | 'TTS' | 'ASSEMBLY' | 'REFINEMENT'

// AI 适配器接口
interface AIAdapter {
  generateText(model, prompt, options?): Promise<GenerationResult>
  generateImage(model, prompt, aspectRatio?, negativePrompt?, options?): Promise<GenerationResult>
  generateVideo?(model, prompt, options?): Promise<GenerationResult>
  generateSpeech?(text, config): Promise<GenerationResult>
  uploadFile?(filePath, mimeType): Promise<{ uri: string }>
}

// 场景（贯穿视觉→生产全阶段）
interface Scene {
  id: string; number: number
  narrative: string; visualPrompt: string
  productionSpecs: { camera?, lighting?, sound?, notes? }
  estimatedDuration: number; audioDuration?: number
  assetUrl?: string; assetType: 'image' | 'video' | 'placeholder'
  keyframeUrl?: string; referenceImageUrl?: string; audioUrl?: string
  status: 'pending' | 'generating' | 'done' | 'error' | 'pending_review'
  reviewStatus?: 'pending' | 'pending_review' | 'approved' | 'rejected'
  logs: string[]
}

// 风格置信度标记
type NodeConfidence = 'confident' | 'inferred' | 'guess' | 'computed'
```

---

## 4. 逐模块审计

### A. 视频分析模块 (CAPABILITY_ASSESSMENT + STYLE_EXTRACTION + RESEARCH)

**A1. 每个参考视频有多少次 AI 调用？输入是视频/音频/帧/转录文字？**

| 阶段 | AI 调用 | 输入形式 |
|------|---------|---------|
| CAPABILITY_ASSESSMENT | 0 | 仅主题文本（本地安全中间件） |
| CV_PREPROCESS（子步骤） | 0 | 视频文件 → FFmpeg scene 检测 + 关键帧提取 |
| STYLE_EXTRACTION | 2-3 | 压缩视频文件（upload）→ generateText 分析 |
| RESEARCH | 2 | 主题文本 + 可疑数字声明 → generateText（含 web 搜索） |

- STYLE_EXTRACTION 对参考视频调用 `compressVideoForUpload()` 后上传给 AI
- 可选自我评估预传递（enableSelfAssessment）增加 1 次调用
- 如果关键字段缺失或低置信度，触发定向补充再增加 1 次
- CV_PREPROCESS 使用 FFmpeg `select='gt(scene,0.3)'` + ffprobe，完全本地
- RESEARCH 使用两个不同适配器交叉验证（防自我一致性偏差）

**A2. 置信度标注如何工作？**

- StyleProfile 每个字段携带 `nodeConfidence` 标记：`confident | inferred | guess | computed`
- `computed` = 从转录文字精确计算覆盖 AI 猜测（如语速 WPM、总词数）
- `computeDerivedFields()` 用精确值覆盖 AI 猜测值
- 下游使用方式：
  - `guess` 字段：排除出硬约束，容差放宽 1.3×
  - `inferred` 字段：中等约束，容差放宽 1.15×
  - `confident` 字段：硬约束不放宽
  - QA_REVIEW 中标记为 `[LOW CONFIDENCE]` 的字段不扣分

**A3. 风格提取输出了哪些维度？**

| 维度 | 字段 |
|------|------|
| 视觉轨 | baseMedium, lightingStyle, cameraMotion, colorTemperature, compositionStyle, transitionStyle, sceneAvgDurationSec, visualMetaphorMapping |
| 脚本轨 | rhetoricalCore, pacingPattern, jargonLevel, ctaPattern, toneArc |
| 音频轨 | voiceStyle, pacing, bgmGenre |
| 元数据 | videoLanguage, estimatedDuration, targetAudience |
| 色板 | colorPalette[] |
| 镜头分析 | shots[] (时长/运镜/主体/色彩) via ShotCIR |

**A4. 事实研究的交叉验证机制？**

1. 适配器 A（`fact_research`）执行初始研究（含 web 搜索）
2. 适配器 B（`claim_verification`，不同提供商/会话）独立验证
3. 两个结果合并，冲突时标记低置信度
4. 可疑数字声明（C12）单独处理验证附录
5. 验证步骤如果第二适配器失败则为非阻塞

---

### B. CIR 编译层

**B5. CIR 加载器当前做什么？**

简化后的加载器（loader.ts）仅执行：
- `_cir` 标签存在性检查（薄标签验证）
- 不执行 schema 深度验证
- 不执行 `deepFreeze()`
- 不执行 `enforceContract()`

**B6. 哪些 CIR 类型仍在实际使用中？**

| CIR 类型 | 使用状态 | 生产者 | 消费者 |
|----------|---------|--------|--------|
| StyleAnalysisCIR | ✅ 活跃 | STYLE_EXTRACTION | 全部后续阶段 |
| FormatSignature | ✅ 活跃 | STYLE_EXTRACTION | SCRIPT_GEN, QA_REVIEW, TEMPORAL_PLANNING |
| ShotCIR | ✅ 活跃 | CV_PREPROCESS | STORYBOARD（可选） |
| ResearchCIR | ✅ 活跃 | RESEARCH | CALIBRATION, SCRIPT_GEN |
| ScriptCIR | ✅ 活跃 | SCRIPT_GEN | VIDEO_IR_COMPILE, QA_REVIEW |
| TemporalPlanCIR | ✅ 活跃 | TEMPORAL_PLANNING | VIDEO_IR_COMPILE |
| StoryboardCIR | ✅ 活跃 | STORYBOARD | VIDEO_IR_COMPILE |
| VideoIR | ✅ 活跃 | VIDEO_IR_COMPILE | 全部生产阶段 |
| VideoPlanCIR | ⚠️ 弱使用 | TTS（后处理） | 仅快照 |

**B7. VIDEO_IR_COMPILE 的对齐断言做什么？**

```
assertAligned():
  scriptCIR.sentences.length 
  === storyboardCIR.scenes.length 
  === temporalPlanCIR.scenes.length 
  === temporalPlanCIR.totalSentences
```

- 如果不对齐 → 抛出 `CIRValidationError`，流水线停止
- 这是硬屏障，无降级路径
- 还包含视频场景最低数量保证：`ensureMinVideoScenes()` 将最长的 image 场景提升为 video

---

### C. 脚本生成模块 (SCRIPT_GENERATION + QA_REVIEW)

**C8. 两步生成的具体过程？**

**步骤 A: 骨架生成**
- 输入：主题 + 叙事弧 + 约束（词数、场景数、结构要求）
- 输出：`ScriptSkeleton` — 句子槽位数组，每个槽位包含 index, stage, targetLength, purposeTag, hasFact, hasMetaphor
- 包含 totalTargetWords, hookIndices, ctaIndices, stageBreakdown
- 置信度感知调整：
  - `sentenceLengthMax`：guess → 放宽 1.3×，inferred → 放宽 1.15×
  - `metaphorCount`：即使 guess 也保证最少 1 个

**步骤 B: 写作填充**
- 输入：骨架 + 事实 + 风格指导 + FormatSignature
- 注入风格约束：修辞核心、节奏模式、术语水平、CTA 模式、情绪弧
- FormatSignature 约束：hook/closing 模板、句子节奏相关性 ≥ 0.6（Pearson）、弧段分配、转场标记
- 输出：`ScriptOutput` — sentence_list + total_length + scene metadata

**骨架-写作对齐验证**：
- 句子数在骨架的 ±30% 以内
- 每槽位词数在目标的 ±30% 以内
- 超过 30% 的槽位偏差 → 告警

**C9. 提示词如何约束 AI？**

17 个预定义模板（`prompts.ts`），通过 `fillTemplate()` 替换 `{variable}` 占位符：

| 模板 | 用途 |
|------|------|
| SKELETON_SYSTEM_PROMPT + SKELETON_USER_PROMPT | 骨架生成的系统+用户提示 |
| WRITING_SYSTEM_PROMPT + WRITING_USER_PROMPT | 写作填充的系统+用户提示 |
| SAFETY_PRE_CHECK_PROMPT | 安全预筛查 |
| QA_REVIEW_PROMPT | 质量评审 |
| FORMAT_SIGNATURE_PROMPT | 系列一致性提取 |
| 其余 10 个 | 分析/研究/分镜/图片/视频 |

**C10. 验证器做了什么？**

| 验证器 | 位置 | 行为 |
|--------|------|------|
| SKELETON_SCHEMA | 骨架解析 | JSON Schema 验证；失败 → 回退确定性线性骨架 |
| SCRIPT_OUTPUT_SCHEMA | 写作解析 | JSON Schema 验证；失败 → 回退原始文本 |
| 骨架-写作对齐 | 写作后 | 句子数 ±30%，词数 ±30%；超标 → 告警 |
| 安全两遍 | 写作后 | 关键词预筛 + LLM 意图分类；确认有害 → 抛 SafetyBlockError |
| QA_REVIEW_SCHEMA | QA 阶段 | JSON Schema 验证；失败 → 抛 QaReviewParseError |
| B2 异常检测 | QA 评分后 | min(子分) < 5 但 overall ≥ 8 → 强制拒绝；反之强制通过 |

**C11. 简化后的重试行为？**

- SCRIPT_GENERATION：**无重试循环**。骨架失败 → 确定性回退；写作失败 → 原始文本回退。单次验证 + 日志记录供人工审查。
- QA_REVIEW：**单遍评审**，无重试。拒绝 → 暂停等待人工干预（编辑脚本或覆盖），而非自动重试。

**C12. 相似度/污染检测？**

QA_REVIEW 输出包含 `contentContamination` 字段：
- `score`：污染分数
- `copiedPhrases`：复制短语列表
- `reusedFacts`：重复使用的事实
- `reusedMetaphors`：重复使用的比喻

当前行为：**C12/C13 标记被突出记录供人工审查**，不自动阻塞。在 `creationStages.ts` 中、QA 阶段完成后，污染检测结果以 LOG artifact 形式保存。

---

### D. 分镜模块 (STORYBOARD)

**D13. 分镜的输入和输出？**

**输入：**
- ScriptCIR（句子列表 → 每句对应一个场景）
- StyleAnalysisCIR（视觉风格约束：介质、灯光、运镜、色温、色板）
- ShotCIR（可选：参考视频镜头节奏）
- FormatSignature（可选：系列视觉母题 hookMotif/mechanismMotif/climaxMotif/reflectionMotif）
- ReplicationSettings（可选：从历史项目复制风格）

**输出：**
- `Scene[]`：每个场景包含 id, number, narrative, visualPrompt, productionSpecs (camera/lighting/sound), estimatedDuration, assetType='image'
- `StoryboardCIR`：结构化分镜 artifact

**D14. 视觉提示如何生成？**

1. AI 生成初始视觉提示（基于脚本句子 + 风格约束）
2. `enforceSceneQuality()` 后处理：
   - 提示词最低 80 字符
   - 不足 → 追加风格后缀：`Style: ${visualStyle}. Camera: ${camera}. Lighting: ${lighting}. Color palette: ${palette}.`
3. 主体隔离子步骤（额外 1 次 AI 调用）：
   - 批量检查所有场景是否有清晰的视觉主体
   - 无主体 → 使用修正提示词或降级为 image-only
4. CharacterTracker 提取场景中的角色身份，注入角色锚定到视觉提示

**D15. 分镜验证？**

`validateStoryboard(scenes, scriptCIR)`：
- 场景数在句子数 ±2 范围内
- 每个视觉提示最低 80 字符
- 重复视觉提示检测
- 资产类型分布：≥ 80% 应为 image
- 输出 `{ passed, errors[], warnings[] }`

JSON 解析失败 → 确定性回退：直接从脚本句子生成基础场景

---

### E. 视觉生成模块 (REFERENCE_IMAGE + KEYFRAME_GEN + VIDEO_GEN)

**E16. 使用哪些 API？**

| 阶段 | 服务 | 方法 | 模式 |
|------|------|------|------|
| REFERENCE_IMAGE | ChatGPT（聊天自动化） | generateImage | 文本→图片 |
| KEYFRAME_GEN | ChatGPT（聊天自动化） | generateImage | 文本→图片 |
| VIDEO_GEN | aivideomaker.ai API | generateVideo (i2v) | 图片→视频 |

备选回退：
- 图片生成：Pollinations 免费 API → 本地占位图
- 视频生成：失败 → Ken Burns 效果（静态图 + 平移/缩放动画）

**E17. 风格一致性如何保证？**

**参考表机制：**
1. 第一个场景生成参考风格表（reference sheet），缓存到磁盘
2. 后续每个场景图片生成时注入 refSheetBase64 作为风格参考
3. 生成后提取 VisualDNA（dominantColors, brightness, colorTemperature）
4. 计算视觉一致性分数 = `scoreVisualConsistency(sceneDNA, refDNA)`
5. 计算 CV 指标 = SSIM + sharpness vs 参考表

**质量门控：**
- visualScore < 阈值 且 retries < max → 带强化色板提示重试
- overall < 阈值 → 降级为 image-only
- 相邻场景 SSIM < 0.3 → 用前一场景色板重试

**多候选选择：**
- candidateCount > 1 时并行生成 N 张，分别评分，取最佳

**E18. 视频生成的容错策略？**

**配额感知工作池：**
```
WorkerPool {
  workers[] ← 每个 aivideomaker 账号一个 worker
  queue ← 共享任务队列
  depletedWorkers ← 配额用完的 worker 集合
  
  当 worker 收到 quotaError:
    1. 标记 worker 为 depleted
    2. 将场景退回队列
    3. 其他 worker 接手
}
```

**每场景重试：**
- 指数退避：3s → 9s → 27s（上限 30s），最多 2 次重试
- 配额错误：不算重试，交给其他 worker
- 质量不达标：重试或降级为 Ken Burns 图片

**最坏情况：**
- 所有 worker 配额耗尽 → 剩余场景标记 error，可选回退为 image
- 零视频生成成功 → 抛出错误

---

### F. 组装模块 (TTS + ASSEMBLY + REFINEMENT)

**F19. FFmpeg 组装的 5 步流程？**

| 步骤 | 操作 | 输入 | 输出 |
|------|------|------|------|
| 1 | 逐场景合并 | 视频/图片 + 音频 | scene_N.mp4 |
| 1b | SFX 混合（可选） | scene_N.mp4 + 音效 | sfx_scene_N.mp4 |
| 2 | 格式标准化 | 各场景 → 统一分辨率/帧率/色彩 | norm_N.mp4 |
| 3 | 拼接 + 转场 | 所有 norm → concat/xfade | concatenated.mp4 |
| 4 | 字幕烧录（可选） | SRT + 拼接视频 | with_subs.mp4 |
| 5 | 最终编码 + BGM | 单/双遍编码 + 背景音乐 | final.mp4 |

**场景类型处理：**
- 视频场景：A/V 同步（音频优先策略）— 视频循环或裁剪以匹配音频时长
- 图片场景：Ken Burns 效果（平移/缩放变体按场景索引循环）
- 无资产场景：黑帧占位 + 静音/音频

**全局色彩校正：**
- 从场景 0 提取参考色彩统计
- 后续场景应用色彩校正滤镜向参考对齐

**F20. 音频处理细节？**

- TTS：edge-tts 本地 CLI（Python 子进程），60s 超时，5000 字符限制
- 并发控制：信号量，默认 2 并发
- 语音选择：从 StyleCIR audioTrack.voiceStyle 解析（EN/ZH 男/女/深沉变体）
- 语速：从 StyleCIR pacing 解析（ttsRate 注入 VideoIR）
- 静音检测：`getAudioMeanVolume()` < -60 dB → 跳过该场景音频
- 时长校准：`getMediaDuration()` 实际测量覆盖估计值

**A/V 同步策略（audio-primary）：**
- 音频 > 视频 → 循环视频
- 视频 > 音频 → 裁剪视频或填充静音
- VideoIR.avSyncPolicy 固定为 `'audio-primary'`（唯一实现的策略）

**F21. 组装后质量检查？**

4 项后检查：

| 检查 | 方法 | 阈值 | 行为 |
|------|------|------|------|
| 时长偏差 | ffprobe 实际 vs 预期 | > 20% | 告警 |
| 感知 QA | blackframe + silencedetect + volumedetect | 黑帧/静音/音量异常 | 告警 |
| 时间一致性 | 场景边界 SSIM | < 0.15（非 cut 转场） | 不连续性告警 |
| 资产完整性 | 全场景检查 | 缺失 assetUrl/audioUrl/占位符 | 列入 failedScenes |

**REFINEMENT 阶段：**
- 检查所有场景完整性
- 缺失资产 → 可选重试（orchestrator 决策）
- 最终安全门：4 点检查（完整性、占位符检测、叙事安全、资产分布）
- 叙事安全失败 → 硬阻塞（抛出 SafetyBlockError）

---

### G. UI 交互层

**G22. 暂停点和用户干预方式？**

| 暂停点 | 阶段后 | UI 视图 | 用户操作 |
|--------|--------|---------|---------|
| 脚本审查 | SCRIPT_GENERATION / QA_REVIEW | ScriptPage | 批准（恢复）/ 编辑脚本 + 恢复 / 覆盖跳过 QA |
| 参考图审批 | REFERENCE_IMAGE | StoryboardPage | 逐场景批准/拒绝/重新生成 + 反馈 |

**暂停机制：**
- `project.pauseAfterStages[]` 配置哪些阶段后暂停
- `requestPause(projectId)` 手动暂停
- UI 检测 `isPaused=true` + `pausedAtStage` → 显示审批界面
- 用户调用 `POST /resume` 或 `POST /qa-override` 恢复

**G23. 用户编辑如何回流？**

| 操作 | API | 效果 |
|------|-----|------|
| 编辑脚本 | `updateScript()` | 保存旧版本，重建 ScriptCIR，下游阶段需重跑 |
| 编辑场景 | `updateScenes()` | 修改 narrative/visualPrompt |
| 模型覆盖 | `updateModelOverrides()` | 每任务类型覆盖（Method C） |
| 阶段提供商覆盖 | `updateStageProviderOverrides()` | 每阶段选择提供商 |
| 场景审批 | `approveScene()` / `rejectScene()` | reviewStatus 变更 |
| QA 覆盖 | `POST /qa-override` | 强制跳过 QA 拒绝 |

**7 个 UI 页面：**

| 页面 | 功能 |
|------|------|
| PipelinePage | 项目仪表盘：创建/搜索/排序/导入导出，14 阶段进度条 |
| StylePage | 参考风格配置（粘贴示例或手动配置） |
| ScriptPage | 3 栏布局：研究/叙事图/编辑器，审计报告（修正/一致性分/问题） |
| StoryboardPage | 场景网格（缩略图/编号/时长），逐场景审批/拒绝/重新生成 |
| ProductionPage | 实时场景完成进度，视频播放器，逐场景 TTS 播放，开始/停止/重试 FAB |
| ReplayPage | 最终视频播放 + 元数据 + 下载 |
| SettingsPage | API 密钥、账号管理、TTS 语音选择、工具安装 |

---

### H. 模型路由与适配器

**H24. 使用了哪些模型？**

| 任务类型 | 默认路由 | 提供商 | 免费/付费 |
|---------|---------|--------|----------|
| 安全/分析/研究 | chat | Gemini Pro（聊天自动化） | 免费 |
| 脚本生成 | chat | Gemini Pro（聊天自动化） | 免费 |
| 图片生成 | chat | ChatGPT（聊天自动化） | 免费 |
| 视频生成 | API | aivideomaker.ai | 免费层 |
| TTS | local | edge-tts | 免费（本地） |

**付费 fallback：**
- Gemini API（Google GenAI SDK）作为 chat 的付费替代
- FallbackAdapter 封装 auto/confirm/block 策略

**H25. 路由逻辑？**

```
selectAdapter(taskType, stageOverrides, modelOverrides):
  1. 检查 stageOverrides（用户手动指定阶段提供商）
  2. 检查 modelOverrides（Method C 每任务类型覆盖）
  3. 回退默认路由表（qualityRouter defaultRoutes）
  4. 包装 FallbackAdapter（如果配置了 apiKey）
```

**会话管理（SessionManager）：**
- 4 个会话组复用聊天上下文：
  - Analysis: CAPABILITY_ASSESSMENT, STYLE_EXTRACTION, RESEARCH
  - Creation: NARRATIVE_MAP, SCRIPT_GENERATION, QA_REVIEW, TEMPORAL_PLANNING
  - Visual: STORYBOARD, VIDEO_IR_COMPILE, REFERENCE_IMAGE, KEYFRAME_GEN
  - Production: VIDEO_GEN, TTS, ASSEMBLY, REFINEMENT（各独立）
- 同组内 continueChat=true 复用对话

**H26. 错误处理与配额管理？**

| 适配器 | 重试策略 | 配额处理 |
|--------|---------|---------|
| ChatAdapter | MAX_CONTINUATIONS（截断续传）| 检测回复文本中的配额模式 → 标记 quotaExhausted |
| GeminiAdapter | withRetry() 指数退避（1s base），429 特殊等待 30s | 429/503/500 重试；非瞬态立即失败 |
| FallbackAdapter | N/A（策略层） | auto: 静默切换 / confirm: 用户确认 / block: 拒绝付费 |
| VideoProvider | ETA 正则检测排队 | 健康监控 + 可用性跟踪 |
| TTSProvider | 60s 超时 | edge-tts 不可用 → 跳过整个 TTS 阶段 |

**ResourceManager：**
- 统一 AI 资源存储（chat/video/image/API 类型）
- 轮询选择 + 配额跟踪（24 小时自动重置）
- 内置提供商：ChatGPT, Gemini, DeepSeek, Kimi
- `findProviders()` 排序：未耗尽的优先

---

## 5. 系统级问题

### 5.1 数据一致性

| 编号 | 问题 | 严重度 | 说明 |
|------|------|--------|------|
| D1 | CIR 对齐依赖运行时断言 | 中 | VIDEO_IR_COMPILE 的 `assertAligned()` 是唯一保证场景数一致的屏障。如果上游阶段产出不一致的场景数，只能在此硬崩溃，无法自愈。 |
| D2 | Scene 对象贯穿多阶段可变 | 低 | Scene 从 STORYBOARD 到 REFINEMENT 被就地修改（mutated），无快照版本控制。用户编辑后的回溯依赖 orchestrator 手动重建。 |
| D3 | FormatSignature 提取非阻塞 | 低 | 如果 FormatSignature 提取失败，写作阶段没有系列一致性约束，但不会报错——只是静默降级。 |
| D4 | avSyncPolicy 只实现了 audio-primary | 信息 | VideoIR 类型定义允许多种策略，但代码只实现了 `audio-primary`。不影响功能，但类型暗示了不存在的能力。 |

### 5.2 架构

| 编号 | 问题 | 严重度 | 说明 |
|------|------|--------|------|
| A1 | CIR 层已成为透传 | 低 | 简化后 loader 仅做 `_cir` 标签检查，contracts 存在但不执行，deepFreeze 已移除。CIR 类型仍提供 TypeScript 编译时安全，但运行时保护已空洞化。 |
| A2 | VideoPlanCIR 弱使用 | 低 | 仅 TTS 阶段生成快照，无消费者依赖它。可考虑移除。 |
| A3 | scriptAudit.ts 存在但未连接 | 低 | 文件存在，有完整实现，但 creationStages 不调用它。死代码。 |
| A4 | 50+ HTTP 端点无版本化 | 低 | 所有路由在 `/api/` 下，无 v1/v2 前缀。单用户场景下不是问题，但如果未来加功能可能冲突。 |

### 5.3 缺失能力

| 编号 | 问题 | 严重度 | 说明 |
|------|------|--------|------|
| M1 | 无持久化运行日志 | 中 | SSE 事件是临时的（100 个客户端限制），无持久日志存储。如果 UI 断连，丢失事件流。 |
| M2 | 无项目版本历史 | 低 | 用户编辑脚本时保存旧版本，但无法浏览/回退到历史版本。 |
| M3 | 无批量导出 | 低 | 单项目导出存在，批量导出不存在。 |
| M4 | 字幕样式不可配置 | 低 | 字幕烧录使用默认 FFmpeg subtitles 滤镜样式。 |

### 5.4 过度工程残留

| 编号 | 问题 | 严重度 | 说明 |
|------|------|--------|------|
| O1 | 9 种 CIR 类型 vs 实际需要 | 低 | VideoPlanCIR 弱使用，ShotCIR 可选。实际核心流程依赖 5 种：StyleAnalysisCIR, ScriptCIR, StoryboardCIR, TemporalPlanCIR, VideoIR。 |
| O2 | contracts.ts 文件仍存在 | 低 | 合约定义存在但 `enforceContract()` 不再被调用。死代码。 |
| O3 | loader.ts 保留了简化前的接口 | 低 | 函数签名暗示丰富的验证，实际只做标签检查。可简化接口或用 TypeScript 类型守卫替代。 |
| O4 | 相邻场景 SSIM 检查 in REFERENCE_IMAGE | 低 | 为科普视频场景（通常视觉差异大），相邻 SSIM < 0.3 的阈值可能过于严格，导致不必要的重试。 |

---

## 6. 优先级建议

### 6.1 可以安全清理的（低风险）

| 项目 | 原因 | 工作量 |
|------|------|--------|
| 删除 scriptAudit.ts | 未被连接，死代码 | 小 |
| 删除 contracts.ts 中未使用的合约 | enforceContract 不再调用 | 小 |
| 移除 VideoPlanCIR | 仅 TTS 快照用，无消费者 | 小 |
| 简化 loader.ts 接口 | 当前只做标签检查，接口过度设计 | 小 |

### 6.2 值得保留的设计

| 项目 | 原因 |
|------|------|
| 两步脚本生成（骨架→写作） | 结构保证 + 创意分离，核心质量保障 |
| FormatSignature 系列一致性 | 多集系列风格统一的关键机制 |
| 置信度感知字段过滤 | 防止 AI 猜测值成为硬约束的唯一防线 |
| 双适配器事实验证 | 交叉偏差检测，科普准确性保障 |
| 参考表 + 视觉一致性门控 | 视觉风格统一的实际有效机制 |
| 配额感知工作池 | 多账号轮换的实用策略 |
| B2 异常检测（QA 评分） | 捕捉 LLM 自相矛盾评分的简单有效防线 |
| audio-primary A/V 同步 | 适合科普视频的正确策略 |

### 6.3 可以进一步简化的

| 项目 | 当前状态 | 建议 |
|------|---------|------|
| 主体隔离子步骤 | 每次分镜额外 1 次 AI 调用 | 如果经验表明大多数场景通过，考虑移为可选 |
| 多候选图片选择 | candidateCount 可 > 1 | 单用户科普场景下 candidateCount=1 足够 |
| SSIM 相邻检查 | REFERENCE_IMAGE 阶段 | 科普视频场景差异大，阈值可能过严 |
| 双遍视频编码 | ASSEMBLY 步骤 5 可选 | 科普视频单遍 CRF 足够，省一半编码时间 |

---

## 附录：端到端时间估算（10 场景，1080p）

| 阶段 | 预计耗时 |
|------|---------|
| 分析（①②③） | 30-90s |
| 创作（④⑤⑥⑦） | 30-60s |
| 分镜（⑧⑨） | 15-60s |
| 参考图（⑩，3 样本） | 60-300s |
| 关键帧（⑪） | 90-300s |
| 视频生成（⑫） | 450-900s |
| TTS（⑬） | 30-50s |
| 组装（⑭） | 600-1200s |
| 验证（⑮） | < 1s |
| **总计** | **~20-45 分钟** |

> 瓶颈：视频生成（⑫，依赖 aivideomaker API 响应速度和账号数量）和 FFmpeg 编码（⑭，依赖硬件）
