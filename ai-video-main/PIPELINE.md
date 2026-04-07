# 流水线设计文档

## 目录

- [概述](#概述)
- [设计原则](#设计原则)
- [流水线全景图](#流水线全景图)
- [13 步流水线 + 4 个质量子步骤](#13-步流水线--4-个质量子步骤)
  - [第 1 页 · 风格初始化](#第-1-页--风格初始化stylepage)
  - [第 2 页 · 脚本创作](#第-2-页--脚本创作scriptpage)
  - [第 3 页 · 视觉设计](#第-3-页--视觉设计storyboardpage)
  - [第 4 页 · 制作交付](#第-4-页--制作交付productionpage)
- [安全体系](#安全体系)
- [质量路由详解](#质量路由详解)
- [会话管理](#会话管理)
- [资源规划](#资源规划)
- [暂停与恢复机制](#暂停与恢复机制)
- [Prompt 体系](#prompt-体系)
- [可观测性](#可观测性)
- [脚本版本历史](#脚本版本历史)
- [产物存储](#产物存储)
- [错误处理与重试](#错误处理与重试)
- [SSE 事件类型](#sse-事件类型)

## 概述

AI Video 使用 **13 步主流水线 + 4 个质量子步骤**将视频生成过程拆解为可控的独立步骤。与整体式"一键生成"方案不同，这种设计允许在关键节点暂停、人工审查、编辑后恢复，从而在利用 AI 能力的同时保证输出质量。

**核心升级**（相比原始 13 步设计）：
- **硬安全拦截**：安全检查不再只是标记，而是直接阻断流水线（`SafetyBlockError`）
- **CV 预处理**：FFmpeg 提取缩略图 + AI 色彩/人脸分析，用真实数据覆盖 LLM 猜测的色彩方案
- **脚本自审**：生成后自动二次 LLM 审计（风格一致性 ≥ 0.78 才通过）
- **主体隔离验证**：每个场景的视觉描述必须有明确可拍摄的主体
- **终审风控门**：合成前 4 项检查（完整性 + 占位符 + 安全 + 资产）
- **可观测性遥测**：每阶段计时、LLM 调用计数、质量评分自动记录
- **脚本版本历史**：用户编辑时自动保存历史版本，支持回滚

## 流水线全景图

```
┌─ 第 1 页 · 风格初始化 ─────────────────────────────────────────────┐
│ ① CAPABILITY_ASSESSMENT → ★安全门 → [CV预处理] → ② STYLE_EXTRACTION │
│     (安全检查+硬拦截)                (FFmpeg+AI)   (Style DNA 提取)  │
│                                                    → ③ RESEARCH     │
│                                                      (事实研究)      │
└─────────────────────────────────────────────────────────────────────┘
                                    ▼
┌─ 第 2 页 · 脚本创作 ───────────────────────────────────────────────┐
│ ④ NARRATIVE_MAP → ⑤ SCRIPT_GENERATION → [脚本自审] → ⑥ QA_REVIEW  │
│   (校准+叙事)       (脚本写作+安全中间件)  (二次LLM审计)  (三合一审查) │
│                                                         ★暂停      │
└─────────────────────────────────────────────────────────────────────┘
                                    ▼
┌─ 第 3 页 · 视觉设计 ───────────────────────────────────────────────┐
│ ⑦ STORYBOARD → [主体隔离验证] → ⑧ REFERENCE_IMAGE ★暂停            │
│   (分镜规划)    (视觉可拍摄性检查)  (风格锚定图)                      │
└─────────────────────────────────────────────────────────────────────┘
                                    ▼
┌─ 第 4 页 · 制作交付 ───────────────────────────────────────────────┐
│ ⑨ KEYFRAME_GEN → ⑩ VIDEO_GEN ∥ ⑪ TTS → ⑫ ASSEMBLY                │
│   (关键帧)        (img2video)    (语音)   (FFmpeg合成)              │
│                                            → [终审风控门]           │
│                                               → ⑬ REFINEMENT       │
│                                                  (自动精修)         │
└─────────────────────────────────────────────────────────────────────┘

图例：① 主阶段   [xxx] 质量子步骤   ★ 暂停/拦截点
```

## 设计原则

1. **人在回路（Human-in-the-loop）**：在 QA 审查和参考图生成后自动暂停，用户可审阅/编辑后再继续
2. **断点续行**：每阶段产物保存到磁盘 JSON，服务重启后可从上次完成的阶段继续
3. **独立重试**：任何阶段失败后可单独重试，无需从头开始
4. **成本最优**：通过质量路由智能分配免费/付费资源，视频等稀缺资源优先使用付费
5. **渐进式产物**：每阶段产出明确的结构化产物，供后续阶段消费
6. **上下文复用**：同一会话组的阶段共享聊天上下文，减少重复描述，提高一致性
7. **多层安全**：入口安全检查 + 脚本安全中间件 + 终审风控门，三道安全屏障
8. **自我纠错**：脚本自审（第二次 LLM 调用）对比风格 DNA 进行自我修正，降低人工返修率
9. **视觉真实性**：CV 预处理用 FFmpeg 提取真实色彩覆盖 LLM 猜测，主体隔离确保每帧可拍摄

---

## 13 步流水线

### 第 1 页 · 风格初始化（StylePage）

#### 步骤 1：CAPABILITY_ASSESSMENT（能力评估）

**目的**：在投入任何资源前，先检查主题是否安全合规。

**输入**：`topic`（用户输入的视频主题）

**输出**：`safetyCheck`（安全分类结果）

**路由**：所有质量级别均使用 `chat` 适配器（安全检查是简单分类任务）

**行为**：
- 对主题进行有害内容检测（暴力、歧视、医疗误导等）
- 生成安全分类标签
- 如果被标记为不安全，后续阶段不会执行

---

#### 步骤 2：STYLE_EXTRACTION（风格提取）

**目的**：从参考视频或主题描述中提取风格 DNA（StyleProfile）。

**输入**：
- `videoFilePath`（参考视频路径，可选）
- `topic`（视频主题）

**输出**：`StyleProfile`（包含时长、色调、节奏、配乐风格、字幕样式等）

**路由**：
| 级别 | 适配器 | 原因 |
|------|--------|------|
| free | chat (gemini) | Gemini 免费聊天支持视频上传 |
| balanced | chat (gemini) | 同上 |
| premium | API (gemini-pro) | API 获取更可靠的结构化输出 |

**备选**：如果没有参考视频，可通过 `POST /:id/style-profile` 手动输入风格描述。

---

#### 步骤 3：RESEARCH（事实研究）

**目的**：基于主题进行在线事实研究，收集可靠数据和引用来源。

**输入**：`topic`, `styleProfile`

**输出**：`ResearchData`（事实列表、来源 URL、可信度评分）

**路由**：
| 级别 | 适配器 | 原因 |
|------|--------|------|
| free | chat (gemini) | Gemini 内置 Google Search |
| balanced | chat (gemini) | 同上 |
| premium | API (gemini-pro) | API + grounding 提供更可靠结果 |

**特性**：
- 使用 Google Search grounding 工具获取实时信息
- 交叉验证关键事实的准确性
- 为后续脚本生成提供事实基础

---

### 第 2 页 · 脚本创作（ScriptPage）

#### 步骤 4：NARRATIVE_MAP（叙事地图）

**目的**：基于风格和研究数据进行语速校准，规划叙事结构。

**子步骤**：
1. **校准（Calibration）**：根据风格指定的目标时长，计算目标字数、语速、段落分配
2. **叙事结构（Narrative Map）**：规划视频的叙事弧线（开场 → 发展 → 高潮 → 结尾）

**输入**：`topic`, `styleProfile`, `researchData`

**输出**：
- `CalibrationData`（目标字数、语速、段落字数分配）
- `NarrativeMap`（叙事弧线结构）
- `GenerationPlan`（生成计划）

**路由**：所有级别均使用 `chat`（文本分析任务，无需付费）

---

#### 步骤 5：SCRIPT_GENERATION（脚本生成）

**目的**：基于叙事地图、风格 DNA 和研究数据生成完整视频脚本。

**输入**：`topic`, `styleProfile`, `researchData`, `calibrationData`, `narrativeMap`

**输出**：`ScriptOutput`（完整脚本文本 + 结构化段落）

**路由**：
| 级别 | 适配器 | 原因 |
|------|--------|------|
| free / balanced | chat | 创意写作在聊天中效果良好 |
| premium | API (gemini-pro) | API 获取可靠 JSON 输出 |

---

#### 步骤 6：QA_REVIEW（QA 审查）★ 暂停点

**目的**：对脚本进行三合一审查 — 安全合规 + 事实一致性 + 质量评分。

**输入**：`scriptOutput`, `topic`, `styleProfile`

**输出**：`QaReviewResult`
- `overallScore`（0-100 质量评分）
- `issues[]`（问题列表，含严重程度和修复建议）
- `factConsistencyScore`（事实一致性评分）
- `safetyScore`（安全合规评分）

**暂停行为**：
- QA 完成后流水线自动暂停
- 用户可审阅脚本和 QA 报告
- 用户可编辑脚本（`PUT /:id/script`）
- 用户可手动通过 QA（`POST /:id/qa-override`）
- 调用 `POST /:id/resume` 恢复流水线

---

### 第 3 页 · 视觉设计（StoryboardPage）

#### 步骤 7：STORYBOARD（分镜）

**目的**：将脚本拆分为场景分镜，为每个场景生成视觉描述（visual prompt）。

**输入**：`topic`, `styleProfile`, `scriptOutput`

**输出**：`Scene[]`（场景列表，含叙事文本、视觉描述、预估时长、制作规格）

**路由**：
| 级别 | 适配器 | 原因 |
|------|--------|------|
| free / balanced | chat | 视觉描述生成是文本任务 |
| premium | API | 结构化 JSON 分镜输出 |

---

#### 步骤 8：REFERENCE_IMAGE（参考图）★ 暂停点

**目的**：生成全局风格锚定参考图，确保后续场景视觉一致性。

**输入**：`scenes`, `styleProfile`, `assetsDir`

**输出**：`Scene[]`（更新 `referenceImageUrl`）

**路由**：
| 级别 | 适配器 | 原因 |
|------|--------|------|
| free | chat (gemini) | Gemini 免费聊天可生成图片 |
| balanced | chat → FallbackAPI | 免费优先，额度耗尽自动降级 |
| premium | API (imagen-3-pro) | 付费 API 获取最高质量 |

**暂停行为**：
- 参考图生成后流水线自动暂停
- 用户可审阅/编辑分镜和参考图
- 可批准/驳回单个场景（`POST /:id/scenes/:sceneId/approve|reject`）
- 可批准所有参考图（`POST /:id/approve-reference`）
- 调用 `POST /:id/resume` 恢复

---

### 第 4 页 · 制作交付（ProductionPage）

#### 步骤 9：KEYFRAME_GEN（关键帧生成）

**目的**：为每个场景生成关键帧图片，作为 img2video 的输入。

**输入**：`scenes`, `styleProfile`, `assetsDir`

**输出**：`Scene[]`（更新 `keyframeUrl`）

**路由**：与 REFERENCE_IMAGE 相同（图片生成任务）

---

#### 步骤 10：VIDEO_GEN（视频生成）

**目的**：从关键帧图片生成视频片段（img2video）。

**输入**：`scenes`, `styleProfile`, `assetsDir`, `videoProviderConfig`, `concurrency`

**输出**：`Scene[]`（更新 `assetUrl`）

**路由**：
| 级别 | 适配器 | 原因 |
|------|--------|------|
| free | chat (gemini) | 使用免费额度生成视频 |
| balanced | API (veo) | **视频是最稀缺资源，优先付费** |
| premium | API (veo) | 付费 API |

**特性**：
- 支持并发生成多个场景（默认 concurrency=2）
- 实时推送每个场景的生成进度

---

#### 步骤 11：TTS（语音合成）

**目的**：为每个场景的旁白文本生成语音。

**输入**：`scenes`, `ttsConfig`

**输出**：`Scene[]`（更新 `audioUrl`, `audioDuration`）

**引擎**：使用 edge-tts（微软免费 TTS），不消耗 AI 额度。

**特性**：
- 支持多语言和多种音色
- 自动计算音频时长
- 支持并发生成

> 注意：VIDEO_GEN 和 TTS 可以并行执行（当前实现为串行，但架构支持并行）。

---

#### 步骤 12：ASSEMBLY（合成）

**目的**：使用 FFmpeg 将所有素材合成为最终视频。

**输入**：`scenes`（含 assetUrl, audioUrl）

**输出**：`finalVideoPath`（最终 MP4 文件路径）

**合成流程**：
1. 归一化所有视频/图片到统一分辨率
2. 按场景顺序拼接视频片段
3. 叠加旁白音轨
4. 添加字幕（如果有）
5. 混合背景音乐（如果有）
6. 输出最终 MP4

---

#### 步骤 13：REFINEMENT（精修）

**目的**：检查完整性，自动重试失败的场景。

**输入**：`scenes`, `maxRetries`（默认 2）

**输出**：`RefinementResult`
- `allComplete`：是否所有场景都成功
- `failedScenes[]`：失败的场景 ID
- `retriedScenes[]`：已重试的场景 ID
- `retryCount`：重试次数

**行为**：
- 扫描所有场景，找出状态为 `error` 的场景
- 对每个失败场景自动重试（最多 2 次）
- 重试成功后重新合成视频
- 即使有场景失败，流水线仍会标记为完成

---

## 暂停与恢复机制

### 暂停点配置

在 `orchestrator.createProject()` 中通过 `pauseAfterStages` 数组配置：

```typescript
pauseAfterStages: ['QA_REVIEW', 'STORYBOARD', 'REFERENCE_IMAGE']
```

### 暂停时用户可执行的操作

| 暂停点 | 可用操作 |
|--------|----------|
| QA_REVIEW 后 | 编辑脚本、手动通过 QA、查看评分/问题 |
| REFERENCE_IMAGE 后 | 编辑分镜、批准/驳回场景、批准参考图 |

### 恢复流程

```
POST /api/pipeline/:id/resume
    │
    ▼
orchestrator.resumePipeline()
    │
    ▼
找到最后一个已完成的阶段 → 从下一个阶段继续执行
```

---

## 质量路由详解

### 路由表（完整版）

| # | 阶段 | 任务类型 | free | balanced | premium |
|---|------|----------|------|----------|---------|
| 1 | CAPABILITY_ASSESSMENT | safety_check | chat | chat | chat |
| 2 | STYLE_EXTRACTION | video_analysis | chat(gemini) | chat(gemini) | API(gemini-pro) |
| 3 | RESEARCH | fact_research | chat(gemini) | chat(gemini) | API(gemini-pro) |
| 3 | RESEARCH | claim_verification | chat | chat | API |
| 4 | NARRATIVE_MAP | calibration | chat | chat | chat |
| 5 | NARRATIVE_MAP | narrative_map | chat | chat | API |
| 6 | SCRIPT_GENERATION | script_generation | chat | chat | API(gemini-pro) |
| 7 | QA_REVIEW | quality_review | chat | chat | API |
| 8 | STORYBOARD | visual_prompts | chat | chat | API |
| 9 | REFERENCE_IMAGE | image_generation | chat(gemini) | chat→Fallback | API(imagen-3-pro) |
| 10 | KEYFRAME_GEN | image_generation | chat(gemini) | chat→Fallback | API(imagen-3-pro) |
| 11 | VIDEO_GEN | video_generation | chat(gemini) | API(veo) | API(veo) |
| 12 | TTS | speech | chat/edge-tts | chat/edge-tts | API |

### FallbackAdapter 降级策略

```
请求 → ChatAdapter
         │
         ├── 成功 → 返回结果
         │
         └── 失败（额度耗尽/超时/错误）
              │
              ▼
         GeminiAdapter（付费 API）
              │
              ├── 成功 → 返回结果
              │
              └── 失败 → 抛出错误
```

---

## 产物存储

每个项目的产物保存在 `data/projects/{projectId}/` 目录下：

```
data/projects/proj_1234567890/
├── project.json              # 项目元数据 + 状态
├── capability-assessment.json # 安全检查结果
├── style-profile.json         # 风格 DNA
├── research.json              # 事实研究数据
├── calibration.json           # 校准数据
├── narrative-map.json         # 叙事地图
├── script.json                # 脚本
├── qa-review.json             # QA 审查结果
├── scenes.json                # 场景列表（含所有素材 URL）
├── refinement.json            # 精修结果
└── assets/                    # 生成的素材文件
    ├── scene_1_ref.png        # 参考图
    ├── scene_1_keyframe.png   # 关键帧
    ├── scene_1_video.mp4      # 视频片段
    ├── scene_1_audio.mp3      # TTS 语音
    └── final.mp4              # 最终合成视频
```

---

## 错误处理与重试

### 阶段级重试

```bash
POST /api/pipeline/:id/retry/KEYFRAME_GEN
```

- 将指定阶段状态重置为 `pending`
- 从该阶段重新开始执行
- 后续阶段会自动跟上

### 场景级重新生成

```bash
POST /api/pipeline/:id/scenes/:sceneId/regenerate
```

- 仅重新生成单个场景的素材
- 不影响其他场景
- 适用于个别场景质量不满意的情况

### 自动精修

REFINEMENT 阶段会自动检测失败场景并重试（最多 2 次），无需人工干预。

---

## 会话管理

### 会话分组

SessionManager 将 13 个阶段分为 4 个会话组，同组阶段共享 AI 聊天上下文（同一个聊天线程）：

| 会话组 | 阶段 | 绑定提供者 | 复用方式 |
|--------|------|-----------|---------|
| **Analysis** | ①CAPABILITY_ASSESSMENT → ②STYLE_EXTRACTION → ③RESEARCH | Gemini（需文件上传+搜索） | 同一聊天线程，①发消息后②③以 continueChat 模式发送 |
| **Creation** | ④NARRATIVE_MAP → ⑤SCRIPT_GENERATION → ⑥QA_REVIEW | 任意文本提供者 | 同一聊天线程，共享叙事结构 |
| **Visual** | ⑦STORYBOARD → ⑧REFERENCE_IMAGE → ⑨KEYFRAME_GEN | 需图片生成能力 | 同一聊天线程，共享视觉风格 |
| **Production** | ⑩VIDEO_GEN、⑪TTS、⑫ASSEMBLY、⑬REFINEMENT | 各自独立 | 不共享上下文 |

### 会话生命周期

```
阶段 X 开始执行
    │
    ├── SessionManager.getSession(projectId, stage)
    │     → 查找或创建 ${projectId}:${group} 的会话
    │     → 返回 { sessionId, useSameChat }
    │
    ├── SessionManager.shouldContinueChat(projectId, stage)
    │     → 该组已有消息记录? → true (复用)
    │     → 该组首次执行?     → false (新建)
    │
    ├── ChatAdapter.submitAndWait(prompt, { sessionId, continueChat })
    │     → continueChat=true:  在同一页面继续发送
    │     → continueChat=false: 打开新的聊天页面
    │
    └── SessionManager.recordMessage(projectId, stage)
          → 更新计数
```

### 会话清理

- **单阶段重试**：`SessionManager.clearGroup()` 清除该组会话，让重试从新聊天开始
- **项目删除**：`SessionManager.clearProject()` 清除所有关联会话
- **配额耗尽**：切换提供者时自动创建新会话

---

## 资源规划

### 执行前预检

在用户点击"开始"前，ResourcePlanner 生成完整的资源分配计划：

```
GET /api/pipeline/:id/resource-plan
    │
    ▼
ResourcePlanner.generateResourcePlan(qualityTier, registry, sessionManager, projectId)
    │
    ├── 遍历 13 个阶段
    │     ├── 查询 QualityRouter 获取默认分配
    │     ├── 检查 ProviderRegistry 中是否有满足能力需求的提供者
    │     ├── 计算成本分类 (free/low/medium/high)
    │     └── 标记是否复用聊天上下文
    │
    ├── 汇总会话组分配
    │     ├── analysis:  {provider: 'gemini', stages: 3, reuseChat: true}
    │     ├── creation:  {provider: 'chatgpt', stages: 3, reuseChat: true}
    │     ├── visual:    {provider: 'gemini', stages: 3, reuseChat: true}
    │     └── production: {provider: 'mixed', stages: 4, reuseChat: false}
    │
    └── 输出 ResourcePlan
          ├── stages[]: 13 步每步的分配方案
          ├── feasibleCount / allFeasible
          ├── blockers[]: 不可满足的阶段列表
          ├── overallCost: 总体成本等级
          └── summary: 人类可读摘要
```

### 每步需求矩阵

| 阶段 | 需要文本 | 需要图片生成 | 需要视频生成 | 需要文件上传 | 需要搜索 |
|------|---------|------------|------------|------------|---------|
| ① CAPABILITY_ASSESSMENT | ✅ | | | | |
| ② STYLE_EXTRACTION | ✅ | | | ✅ | |
| ③ RESEARCH | ✅ | | | | ✅ |
| ④ NARRATIVE_MAP | ✅ | | | | |
| ⑤ SCRIPT_GENERATION | ✅ | | | | |
| ⑥ QA_REVIEW | ✅ | | | | |
| ⑦ STORYBOARD | ✅ | | | | |
| ⑧ REFERENCE_IMAGE | | ✅ | | | |
| ⑨ KEYFRAME_GEN | | ✅ | | | |
| ⑩ VIDEO_GEN | | | ✅ | | |
| ⑪ TTS | — | — | — | — | — |
| ⑫ ASSEMBLY | — | — | — | — | — |
| ⑬ REFINEMENT | ✅ | | | | |

> ⑪TTS 使用 edge-tts（免费，无需 AI 提供者），⑫ASSEMBLY 使用 FFmpeg。

### 成本分类表

| 适配器:任务类型 | 成本 |
|----------------|------|
| chat:* (文本) | free |
| chat:image_generation | free |
| chat:video_generation | low |
| api:fact_research | low |
| api:script_generation | medium |
| api:image_generation | medium |
| api:video_generation | **high** |
