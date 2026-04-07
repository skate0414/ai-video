# 架构设计文档

## 目录

- [设计理念](#设计理念)
- [系统总览](#系统总览)
- [后端架构](#后端架构)
  - [HTTP 服务器](#1-http-服务器)
  - [路由层](#2-路由层)
  - [流水线引擎](#3-流水线引擎)
  - [AI 资源管理](#4-ai-资源管理)
  - [适配器层](#5-适配器层)
- [前端架构](#前端架构)
  - [路由结构](#1-路由结构)
  - [4 页向导设计](#2-4-页向导设计)
  - [核心组件](#3-核心组件)
  - [状态管理](#4-状态管理)
- [数据流](#数据流)
- [安全设计](#安全设计)
- [可扩展性](#可扩展性)

---

## 设计理念

**核心目标**：把握 AI 生成视频的质量（将视频生成分为多个可控步骤，而不是盲目交给 AI 全包），同时利用 AI 网站聊天的免费额度尽量降低生产成本。

**关键决策**：
1. **13 步细粒度流水线**：每步可独立重试、审查、覆盖，人工可在任意步骤介入
2. **双适配器 + 自动降级**：免费聊天（Playwright 自动化）+ 付费 API（Gemini），FallbackAdapter 在免费额度耗尽时自动切换
3. **质量路由按资源稀缺度排序**：视频 > 图片 > TTS > 文本，稀缺资源优先分配付费额度
4. **会话上下文复用**：4 组聊天会话在相关阶段间共享上下文，减少重复说明
5. **4 页向导式 UI**：在 QA 审查 / 参考图生成后暂停让用户介入审查

---

## 系统总览

```
┌─────────────────────────────────────────────────────────────┐
│                    前端 (React 19 + Vite 8)                  │
│                                                              │
│   PipelinePage ──→ ProjectLayout (4 页向导)                   │
│     (项目列表)        ├── StylePage       (风格初始化)          │
│                       ├── ScriptPage      (脚本创作)           │
│                       ├── StoryboardPage  (视觉设计)           │
│                       └── ProductionPage  (制作交付)           │
│                                                              │
│   NavStepper (步骤导航) ←→ SubStageProgress (子步骤进度)       │
│   SettingsModal (账号/提供者管理)                               │
└──────────────────────────┬──────────────────────────────────┘
                           │ HTTP + SSE
                           ▼
┌─────────────────────────────────────────────────────────────┐
│                    后端 (Node.js + TypeScript)                │
│                                                              │
│   server.ts ──→ 路由匹配 ──→ routes/pipeline.ts              │
│   (HTTP/SSE)                  routes/workbench.ts             │
│                                                              │
│   PipelineOrchestrator                                       │
│     ├── 13 个阶段 (stages/)                                   │
│     ├── QualityRouter (质量路由)                               │
│     └── 产物持久化 (data/projects/)                            │
│                                                              │
│   适配器层                                                    │
│     ├── ChatAdapter    (Playwright 浏览器自动化)               │
│     ├── GeminiAdapter  (Gemini API)                           │
│     ├── FallbackAdapter(自动降级)                              │
│     ├── TTS Provider   (edge-tts)                             │
│     ├── Video Provider (浏览器端视频生成)                       │
│     └── FFmpeg Assembler(视频合成)                             │
└─────────────────────────────────────────────────────────────┘
```

---

## 后端架构

### 1. HTTP 服务器 (`src/server.ts`)

使用 Node.js 原生 `http.createServer`（无框架），保持最小依赖。

**职责**：
- CORS 白名单管理 (`ALLOWED_ORIGINS`)
- API Key 认证 (`Authorization: Bearer`)
- SSE 事件推送（最大 50 连接）
- 路由匹配与分发
- 优雅关闭（SIGTERM / SIGINT / uncaughtException）
- 健康检查端点 (`/health`)

### 2. 路由层 (`src/routes/`)

| 文件 | 职责 |
|------|------|
| `helpers.ts` | 通用工具：`json()` 响应、`readBody()` 带大小限制、`parseJsonBody()` 安全解析、文件上传常量 |
| `pipeline.ts` | 所有流水线 API（CRUD、启动/停止/重试/恢复、脚本/场景编辑、QA 覆盖、参考图批准） |
| `workbench.ts` | 工作台 API（账号管理、任务队列、提供者管理、聊天模式） |
| `setup.ts` | 首次运行检测 API（FFmpeg/Playwright/API Key 可用性检查） |

路由使用正则匹配模式，轻量且无第三方依赖：
```typescript
interface Route {
  method: string;
  pattern: RegExp;      // 如 /^\/api\/pipeline\/(?<id>[^/]+)$/
  handler: RouteHandler;
}
```

### 3. 流水线引擎 (`src/pipeline/`)

#### 编排器 (`orchestrator.ts`)

`PipelineOrchestrator` 是核心类，管理完整的视频生成流水线：

- **项目管理**：创建、加载、列表、删除项目（磁盘持久化至 `data/projects/{id}/`）
- **阶段执行**：按顺序执行 13 个阶段，每阶段可独立重试
- **暂停/恢复**：在 QA_REVIEW、STORYBOARD、REFERENCE_IMAGE 后自动暂停
- **会话感知**：通过 SessionManager 为每个阶段获取/创建会话，支持上下文复用
- **资源规划**：通过 ResourcePlanner 在执行前生成资源分配矩阵
- **产物持久化**：每阶段结果保存到磁盘 JSON 文件，支持服务重启后断点续行
- **事件发射**：通过 SSE 实时推送进度到前端

#### 质量路由器 (`qualityRouter.ts`)

根据 `(阶段, 任务类型, 质量级别)` 三元组决定使用哪个适配器：

```
                    free            balanced          premium
─────────────────────────────────────────────────────────────
视频生成           chat(seedance)   API(veo-3.1)      API(veo-3.1)
图片生成           chat(gemini)     chat→FallbackAPI   API(imagen-3-pro)
语音合成           edge-tts(免费)   edge-tts(免费)     API(gemini-tts)
脚本/分析等文本     chat             chat               API(gemini-pro)
安全检查           chat             chat               chat
```

**核心函数**：
- `routeTask(stage, taskType, qualityTier, overrides)` → 返回 `QualityDecision`
- `selectAdapter(decision, chatAdapter, apiAdapter, tier)` → 返回实际适配器实例

**设计原则**：
- 按资源稀缺度优先分配付费额度：视频 > 图片 > TTS > 文本
- `FallbackAdapter` 在免费额度耗尽时自动降级到付费 API
- 用户可通过 `modelOverrides` 覆盖任何阶段的适配器选择（优先级最高）

#### 阶段实现 (`stages/`)

每个阶段是一个独立模块，导出 `runXxx()` 函数，接受适配器和参数，返回结构化结果：

| 文件 | 阶段 | 输入 | 输出 |
|------|------|------|------|
| `capabilityAssessment.ts` | ①能力评估 | topic, providerRegistry | safetyCheck + providerProbe |
| `styleExtraction.ts` | ②风格提取 | videoFilePath, topic | StyleProfile（Style DNA） |
| `research.ts` | ③事实研究 | topic, styleProfile | ResearchData（事实+来源） |
| `calibration.ts` | ④a语速校准 | topic, styleProfile, researchData | CalibrationData |
| `narrativeMap.ts` | ④b叙事地图 | topic, styleProfile, calibrationData | NarrativeMap + GenerationPlan |
| `scriptGeneration.ts` | ⑤脚本生成 | topic, styleProfile, researchData, narrativeMap | ScriptOutput |
| `qaReview.ts` | ⑥QA 审查 | scriptOutput, topic, styleProfile | QaReviewResult（3 维评分） |
| `storyboard.ts` | ⑦分镜 | topic, styleProfile, scriptOutput | Scene[]（visual prompt） |
| `referenceImage.ts` | ⑧参考图 | scenes, styleProfile, assetsDir | Scene[]（referenceImageUrl） |
| `keyframeGen.ts` | ⑨关键帧 | scenes, styleProfile, assetsDir | Scene[]（keyframeUrl） |
| `videoGen.ts` | ⑩视频生成 | scenes, assetsDir, concurrency | Scene[]（assetUrl） |
| `tts.ts` | ⑪TTS | scenes, ttsConfig | Scene[]（audioUrl, audioDuration） |
| `refinement.ts` | ⑬精修 | scenes, maxRetries(2) | RefinementResult |

所有阶段模块使用 `stageLog.ts` 导出的 `createStageLog()` 工厂函数生成统一格式的日志回调，避免每个阶段重复定义 `log()` 函数。

> ⑫ASSEMBLY 阶段由 `ffmpegAssembler.ts` 适配器直接执行，不是独立阶段文件。

### 4. AI 资源管理

#### 会话管理器 (`sessionManager.ts`)

将 13 步流水线分为 4 个会话组，同组阶段共享 AI 聊天上下文：

```
┌─ Analysis ─────────────────────────────────────────┐
│  CAPABILITY_ASSESSMENT → STYLE_EXTRACTION → RESEARCH│
│  共享视频分析上下文，使用同一个 Gemini 聊天线程       │
└────────────────────────────────────────────────────┘
┌─ Creation ─────────────────────────────────────────┐
│  NARRATIVE_MAP → SCRIPT_GENERATION → QA_REVIEW      │
│  共享叙事结构，保持脚本风格一致                       │
└────────────────────────────────────────────────────┘
┌─ Visual ───────────────────────────────────────────┐
│  STORYBOARD → REFERENCE_IMAGE → KEYFRAME_GEN        │
│  共享视觉风格，保持场景画面一致                       │
└────────────────────────────────────────────────────┘
┌─ Production ───────────────────────────────────────┐
│  VIDEO_GEN, TTS, ASSEMBLY, REFINEMENT                │
│  各自独立执行（不共享上下文）                         │
└────────────────────────────────────────────────────┘
```

**关键方法**：
- `getSession(projectId, stage)` → 获取/创建会话（含 sessionId）
- `shouldContinueChat(projectId, stage)` → 判断是开新聊天还是复用
- `recordMessage(projectId, stage)` → 记录消息，标记后续应复用
- `clearProject(projectId)` → 清除项目所有会话（重试时用）

#### 提供者能力注册表 (`providerRegistry.ts`)

动态追踪 AI 提供者的能力，包含 5 大内置提供者（gemini/chatgpt/deepseek/kimi/seedance）：

```typescript
interface ProviderCapability {
  providerId: string;
  text: boolean;          // 文本生成
  imageGeneration: boolean; // 图片生成
  videoGeneration: boolean; // 视频生成
  fileUpload: boolean;    // 文件上传
  webSearch: boolean;     // 内置搜索
  tts: boolean;           // 语音合成
  models: string[];       // 可用模型列表
  quotaExhausted: boolean; // 额度是否耗尽
  dailyLimits?: { textQueries?: number; imageGenerations?: number; videoGenerations?: number };
}
```

**关键方法**：
- `findProviders(need)` → 查找满足特定能力需求的提供者（额度未耗尽优先）
- `markQuotaExhausted(id)` → 标记额度耗尽
- `register(id, cap)` → 注册/更新提供者能力（支持运行时动态探测）

#### 资源规划器 (`resourcePlanner.ts`)

在流水线执行前生成完整的资源分配计划：

```typescript
interface ResourcePlan {
  qualityTier: QualityTier;
  stages: StageResourcePlan[];  // 13 步每步的分配方案
  feasibleCount: number;        // 可满足的阶段数
  allFeasible: boolean;         // 是否全部可满足
  blockers: string[];           // 不可满足的阶段
  sessionSummary: Record<SessionGroup, { provider, stageCount, reuseChat }>;
  overallCost: 'free' | 'low' | 'medium' | 'high';
  summary: string;              // 人类可读摘要
}
```

每步的分配方案包含：提供者、适配器类型（chat/api）、成本分类、是否复用聊天上下文、可行性检查。

### 5. 适配器层 (`src/adapters/`)

| 适配器 | 文件 | 说明 |
|--------|------|------|
| **ChatAdapter** | `chatAdapter.ts` | 通过 Playwright 控制浏览器访问 AI 聊天网站，模拟人工操作获取免费额度。支持 sessionId 参数实现聊天上下文复用 |
| **GeminiAdapter** | `geminiAdapter.ts` | 直接调用 Google Gemini API（`@google/genai` SDK），需 API Key |
| **FallbackAdapter** | `fallbackAdapter.ts` | 包装 ChatAdapter + GeminiAdapter，免费失败时自动降级到付费（错误/超时/额度耗尽触发） |
| **TTS Provider** | `ttsProvider.ts` | 调用 edge-tts 命令行工具进行免费 TTS，支持多语言和多音色 |
| **Video Provider** | `videoProvider.ts` | 通过 Playwright 控制浏览器访问视频生成网站（Seedance 等） |
| **FFmpeg Assembler** | `ffmpegAssembler.ts` | 调用 FFmpeg 合成最终视频：归一化 → 拼接 → 字幕 → BGM → 输出 MP4 |
| **Image Extractor** | `imageExtractor.ts` | 从 AI 聊天响应 HTML 中提取图片 URL |
| **Response Parser** | `responseParser.ts` | 解析 AI 聊天响应中的结构化数据（JSON / Markdown → 对象） |

---

## 前端架构

### 1. 路由结构 (`ui/src/App.tsx`)

```
HashRouter
└── Layout (顶部栏 + SettingsModal)
    ├── / → PipelinePage (项目列表 + 搜索/排序/删除)
    └── /:projectId → ProjectLayout (项目头 + NavStepper + LogPanel)
        ├── style → StylePage        (资源规划 + 风格初始化)
        ├── script → ScriptPage      (脚本创作 + QA 审查)
        ├── storyboard → StoryboardPage  (分镜 + 参考图审阅)
        └── production → ProductionPage  (制作 + 视频播放)
```

### 2. 4 页向导设计

**NavStepper 组件**将 13 步流水线映射为 4 个用户可理解的步骤：

| 步骤 | 页面 | 涵盖阶段 | 解锁条件 | 用户可执行操作 |
|------|------|----------|----------|----------------|
| 1. 风格初始化 | StylePage | ①②③ | 始终可用 | 上传参考视频、手动粘贴分析、查看资源规划 |
| 2. 脚本创作 | ScriptPage | ④⑤⑥ | RESEARCH 完成 | 编辑脚本、通过/拒绝 QA、查看评分报告 |
| 3. 视觉设计 | StoryboardPage | ⑦⑧ | QA_REVIEW 完成 | 编辑分镜、批准/驳回参考图 |
| 4. 制作交付 | ProductionPage | ⑨⑩⑪⑫⑬ | REFERENCE_IMAGE 完成 | 查看进度、播放/下载视频 |

每页使用 `SubStageProgress` 组件显示该页内各子步骤的实时进度（pending → running → completed / error）。

### 3. 核心组件

| 组件 | 文件 | 说明 |
|------|------|------|
| `Layout` | `components/Layout.tsx` | 全局顶部栏（logo + 标题 + ⚙️ 设置按钮），包裹 Outlet |
| `ProjectLayout` | `components/ProjectLayout.tsx` | 项目级布局：项目头 + NavStepper + 子页面 + 可折叠 LogPanel |
| `NavStepper` | `components/NavStepper.tsx` | 4 步水平导航，显示完成/进行中/锁定状态 |
| `SubStageProgress` | `components/SubStageProgress.tsx` | 每页的子步骤进度条（对应多个 PipelineStage） |
| `ResourcePlannerPanel` | `components/ResourcePlannerPanel.tsx` | 13 步资源分配矩阵，含成本标签和会话组汇总 |
| `ModelOverridePanel` | `components/ModelOverridePanel.tsx` | 模型覆盖配置面板（用户可覆盖任意阶段的适配器选择） |
| `SceneGrid` | `components/SceneGrid.tsx` | 场景网格展示（分镜/参考图/关键帧缩略图） |
| `StageTimeline` | `components/StageTimeline.tsx` | 完整 13 步进度时间线 |
| `VideoPlayer` | `components/VideoPlayer.tsx` | 最终视频播放器（HTML5 video） |
| `SettingsModal` | `components/SettingsModal.tsx` | 账号管理、提供者配置、登录浏览器操作（ESC 关闭） |
| `ErrorBoundary` | `components/ErrorBoundary.tsx` | React 错误边界，防止白屏 |
| `LogPanel` | `components/LogPanel.tsx` | 日志面板，按 info/success/error/warning 过滤 |
| `PipelinePage` | `pages/PipelinePage.tsx` | 项目列表首页，支持搜索、排序、删除 |
| `SetupPage` | `pages/SetupPage.tsx` | 首次运行向导（环境检测 + 引导配置） |

### 4. 状态管理

```
URL 参数 (/:projectId)
    ▼
ProjectContext (提供 project 数据 + refresh 方法)
    ▼
子页面 (StylePage / ScriptPage / StoryboardPage / ProductionPage)
    │
    ├── 调用 api.getProject() 刷新数据
    ├── 调用 api.startPipeline() / resumePipeline() 控制流水线
    └── 监听 SSE /api/events 接收实时事件
```

- **ProjectContext**（`ui/src/context/ProjectContext.tsx`）：通过 React Context 提供项目数据和刷新方法给所有子页面
- **SSE 实时推送**：通过 `/api/events` 接收 `pipeline_stage`、`pipeline_log`、`pipeline_artifact` 等事件
- **无全局状态库**：不依赖 Redux / Zustand，通过 URL 参数 + Context + API 调用管理状态，保持简洁
- **自定义 Hooks**：`usePipeline`（流水线状态管理）、`useWorkbench`（工作台状态管理）、`useSetup`（首次运行检测）
- **SSE 客户端**：`api/sse.ts` 封装 SSE 连接管理，自动重连和事件分发

---

## 数据流

### 完整执行流

```
用户创建项目
    │
    ▼
POST /api/pipeline ──→ orchestrator.createProject()
    │                      │
    ▼                      ▼
StylePage 查看资源规划    GET /:id/resource-plan → resourcePlanner.generateResourcePlan()
    │
    ▼
POST /:id/start    ──→ orchestrator.run()
                           │
                           ├── sessionManager.getSession()  → 获取/创建会话
                           ├── qualityRouter.routeTask()    → 决定适配器
                           ├── selectAdapter()              → 实例化适配器
                           │
     ┌─────────────────────┼─────────────────────┐
     ▼                     ▼                     ▼
  阶段 1~9 顺序执行     阶段 10+11 可并行     阶段 12~13 顺序
  (文本/图片任务)       (VIDEO_GEN ∥ TTS)     (合成+精修)
     │                     │                     │
     ├── 每阶段 → saveArtifact() → data/projects/:id/*.json
     └── 每阶段 → emit() → SSE → broadcastEvent() → 前端更新
                           │
     暂停点 (QA_REVIEW / REFERENCE_IMAGE)
     │
     ▼
用户审查/编辑 ──→ PUT /:id/script 或 POST /:id/qa-override
     │
     ▼
POST /:id/resume ──→ 从暂停阶段继续
```

### 适配器选择流

```
routeTask(stage, taskType, qualityTier, overrides)
    │
    ├── 有 modelOverrides? → 使用用户覆盖
    │
    └── 查询 ROUTE_TABLE → 获取 QualityDecision { adapter, provider, model }
         │
         ├── adapter='chat' + tier='balanced' → FallbackAdapter(chat, api)
         ├── adapter='chat' + tier='free'     → ChatAdapter
         └── adapter='api'                    → GeminiAdapter
```

### 会话复用流

```
orchestrator.run() 开始阶段 X
    │
    ├── sessionManager.getSession(projectId, stage)
    │     → 返回 { sessionId, group, useSameChat }
    │
    ├── sessionManager.shouldContinueChat(projectId, stage)
    │     → true: 同组前面的阶段已执行过 (continueChat=true)
    │     → false: 该组第一个阶段 (开新聊天)
    │
    ├── chatAdapter.submitAndWait(prompt, { sessionId, continueChat })
    │     → Playwright 在同一页面/新页面发送消息
    │
    └── sessionManager.recordMessage(projectId, stage)
          → 更新消息计数，标记 useSameChat=true
```

---

## 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 后端运行时 | Node.js | ≥ 20.9.0 |
| 后端语言 | TypeScript (strict) | 5.8+ |
| HTTP 服务器 | Node.js 原生 `http`（零框架依赖） | — |
| 浏览器自动化 | Playwright | 1.55+ |
| AI API | Google GenAI SDK (`@google/genai`) | 1.47+ |
| TTS | edge-tts（微软免费） | 最新 |
| 视频合成 | FFmpeg | 6.x+ |
| 前端框架 | React | 19 |
| 前端构建 | Vite | 8 |
| 前端路由 | React Router (HashRouter) | 7 |
| 桌面应用 | Tauri | 2.x |
| 测试 | Vitest | 4.1+ |
| CI | GitHub Actions (Node 20/22) | — |
| 容器化 | Docker 多阶段构建 | — |

---

## 安全设计

| 层 | 措施 | 实现 |
|----|------|------|
| 网络层 | CORS 白名单 | `ALLOWED_ORIGINS` 环境变量，逗号分隔 |
| 认证 | API Key | `Authorization: Bearer <key>`，`API_KEY` 环境变量 |
| 输入校验 | 请求体大小限制 | `readBody()` 强制 10MB 上限 |
| 输入校验 | JSON 安全解析 | `parseJsonBody()` 捕获 SyntaxError |
| 上传安全 | 文件类型白名单 | 仅允许 `.mp4/.mov/.jpg/.png` 等 14 种扩展名 |
| 上传安全 | 文件大小限制 | 单文件 50MB，请求体 200MB |
| 内容安全 | 主题安全分类 | CAPABILITY_ASSESSMENT 阶段自动检测有害内容 |
| 连接限制 | SSE 最大连接数 | `MAX_SSE_CLIENTS=50`，超限返回 503 |
| 错误隔离 | 前端错误边界 | `ErrorBoundary` 组件防止白屏 |
| 错误隔离 | 后端兜底处理 | `uncaughtException` / `unhandledRejection` 处理 |
| 进程管理 | 优雅关闭 | SIGTERM/SIGINT 信号 → 10s 超时强制退出 |
| 环境校验 | 启动时验证 | PORT 范围检查，无效则 `process.exit(1)` |

---

## 可扩展性

### 新增流水线阶段

1. 在 `src/pipeline/stages/` 下创建阶段模块（导出 `runXxx()` 函数）
2. 在 `src/pipeline/types.ts` 的 `PipelineStage` 类型中添加新值
3. 在 `src/pipeline/orchestrator.ts` 的 `STAGES` 数组和 `run()` 方法中注册
4. 在 `src/pipeline/qualityRouter.ts` 的 `ROUTE_TABLE` 中添加路由规则
5. 在 `src/pipeline/resourcePlanner.ts` 的 `STAGE_TASK_MAP` 和 `STAGE_REQUIREMENTS` 中注册
6. 在 `shared/types.ts` 中同步更新 `PipelineStage` 类型

### 新增 AI 适配器

1. 实现 `AIAdapter` 接口（`submitAndWait(prompt, options)`）
2. 在 `src/pipeline/qualityRouter.ts` 的 `selectAdapter()` 中注册
3. 在 `src/pipeline/providerRegistry.ts` 的 `BUILTIN_CAPABILITIES` 中添加能力信息

### 新增 AI 提供者

- **通过 UI**：设置面板 → 添加提供者 → 输入聊天 URL → 系统自动推断选择器
- **通过 API**：`POST /api/providers/from-url` 传入聊天页面 URL
- **能力注册**：`PUT /api/providers/:id/capabilities` 更新提供者能力

### 自定义暂停点

修改 `orchestrator.createProject()` 中的 `pauseAfterStages` 数组：

```typescript
// 默认暂停点
pauseAfterStages: ['QA_REVIEW', 'STORYBOARD', 'REFERENCE_IMAGE']

// 自定义：在每个阶段后都暂停
pauseAfterStages: ['CAPABILITY_ASSESSMENT', 'STYLE_EXTRACTION', ..., 'REFINEMENT']
```
