# AI Video — 端到端 AI 视频生成平台

> **核心理念**：把握 AI 生成视频的质量（将视频生成分为 15 个编译器式可控步骤，而非盲目交给 AI 一键生成），同时利用 AI 网站聊天的免费额度最大限度降低生产成本。

AI Video 是一个全栈自动化视频生产平台，从输入一个主题到输出一部完整的 MP4 视频，由 **15 步编译器式流水线**驱动。系统将 LLM 视为不可信的编译器前端（parser），通过 7 种类型化中间表示（CIR）和一个不可变的 VideoIR 编译屏障，确保下游代码生成阶段的确定性和可审计性。系统通过 Playwright 浏览器自动化利用各大 AI 聊天平台的免费额度（Gemini、ChatGPT、DeepSeek），在关键资源（视频生成）消耗较大时自动切换至付费 API，实现**质量可控、成本最低**的 AI 视频生产。

---

## 目录

- [项目架构](#项目架构)
- [核心功能](#核心功能)
- [快速开始](#快速开始)
- [质量级别](#质量级别)
- [编译器架构](#编译器架构)
- [15 步流水线概览](#15-步流水线概览)
- [AI 资源管理](#ai-资源管理)
- [4 页向导 UI](#4-页向导-ui)
- [NPM 脚本](#npm-脚本)
- [文档索引](#文档索引)
- [技术栈](#技术栈)
- [许可证](#许可证)

---

## 项目架构

```
ai-video/
├── src/                          # Node.js 后端（TypeScript strict）
│   ├── server.ts                 # HTTP + SSE 服务器（CORS / API Key / 优雅关闭）
│   ├── dataDir.ts                # 跨平台数据目录解析（DATA_DIR / Electron APPDATA / OS）
│   ├── workbench.ts              # Playwright 浏览器自动化引擎
│   ├── chatAutomation.ts         # 聊天自动化核心逻辑
│   ├── resourceManager.ts        # 统一 AI 资源管理（聊天/视频/图片账号轮换与配额追踪）
│   ├── browserManager.ts         # Playwright 浏览器标签页/会话管理
│   ├── configStore.ts            # 配置持久化存储
│   ├── constants.ts              # 应用常量
│   ├── electronBridge.ts         # Electron IPC 桥接
│   ├── providerPresets.ts        # 提供者选择器预设（运行时可更新）
│   ├── quotaBus.ts               # 配额耗尽事件总线
│   ├── rateLimiter.ts            # 请求限速
│   ├── selectorResolver.ts       # DOM 选择器动态解析
│   ├── taskQueue.ts              # 异步任务队列
│   ├── providers.ts              # 内置 AI 提供者定义（选择器/URL/模型）
│   ├── types.ts                  # 后端公共类型
│   ├── routes/
│   │   ├── helpers.ts            # 安全工具：readBody 大小限制、JSON 解析、上传白名单
│   │   ├── pipeline.ts           # 流水线 CRUD + 控制 + 配置 API
│   │   ├── workbench.ts          # 工作台 API（资源/任务/提供者管理）
│   │   ├── setup.ts              # 首次运行检测（FFmpeg / Playwright / API Key）
│   │   └── __tests__/            # 路由单元测试
│   ├── pipeline/                 # 15 步编译器式流水线引擎
│   │   ├── orchestrator.ts       # 编排器：项目管理、阶段调度、暂停/恢复
│   │   ├── pipelineService.ts    # 流水线服务层
│   │   ├── projectStore.ts       # 项目持久化存储
│   │   ├── stateMachine.ts       # 流水线状态机
│   │   ├── stageRegistry.ts      # 阶段注册表
│   │   ├── stageRetryWrapper.ts  # 阶段重试包装器
│   │   ├── qualityRouter.ts      # 质量路由（free / balanced / premium 三级分配）
│   │   ├── sessionManager.ts     # 会话管理：4 组聊天上下文复用
│   │   ├── providerRegistry.ts   # 提供者能力注册表（4 大内置提供者）
│   │   ├── resourcePlanner.ts    # 资源规划器：执行前预估资源分配与成本
│   │   ├── costTracker.ts        # 成本追踪
│   │   ├── aiControl.ts          # AI 请求控制
│   │   ├── runLock.ts            # 运行锁
│   │   ├── safety.ts             # 内容安全检测模块
│   │   ├── prompts.ts            # 各阶段 AI Prompt 模板
│   │   ├── styleContract.ts      # 风格契约
│   │   ├── styleLibrary.ts       # 风格库
│   │   ├── loggingAdapter.ts     # 日志适配器
│   │   ├── observability.ts      # 可观测性
│   │   ├── types.ts              # 流水线类型定义
│   │   ├── __tests__/            # 流水线单元测试（12 个测试文件）
│   │   └── stages/               # 15 个阶段实现 + 质量子步骤（每阶段独立模块）
│   │       ├── stageLog.ts              # 共享日志工厂（createStageLog）
│   │       ├── defs/                    # 阶段定义（按编译器分组）
│   │       │   ├── analysisStages.ts    #   Analysis 组 ①②③（HIR 生产者）
│   │       │   ├── creationStages.ts    #   Creation 组 ④⑤⑥⑦（HIR → CIR 编译）
│   │       │   ├── visualStages.ts      #   Visual 组 ⑧⑨⑩⑪（CIR → VideoIR + 代码生成）
│   │       │   └── productionStages.ts  #   Production 组 ⑫⑬⑭⑮（代码生成 + 链接）
│   │       ├── capabilityAssessment.ts  # 1. 能力评估（安全检查）
│   │       ├── cvPreprocess.ts          #    └─ CV 预处理子步骤
│   │       ├── styleExtraction.ts       # 2. 风格提取（→ StyleAnalysisCIR）
│   │       ├── research.ts              # 3. 事实研究（→ ResearchCIR）
│   │       ├── calibration.ts           # 4a. 语速校准
│   │       ├── narrativeMap.ts          # 4b. 叙事地图
│   │       ├── scriptGeneration.ts      # 5. 脚本生成（→ ScriptCIR）
│   │       ├── scriptAudit.ts           #    └─ 脚本自审子步骤
│   │       ├── scriptValidator.ts       #    └─ 脚本验证
│   │       ├── qaReview.ts              # 6. QA 三合一审查
│   │       ├── temporalPlanning.ts      # 7. 时序规划（→ TemporalPlanCIR）
│   │       ├── storyboard.ts            # 8. 分镜规划（→ StoryboardCIR）
│   │       ├── subjectIsolation.ts      #    └─ 主体隔离验证子步骤
│   │       ├── videoIRCompile.ts        # 9. ═══ VideoIR 编译屏障 ═══（deepFreeze）
│   │       ├── videoIRPromptSemantics.ts #    └─ 统一生成 Prompt 构建器
│   │       ├── referenceImage.ts        # 10. 参考图生成（读 VideoIR）
│   │       ├── referenceSheet.ts        #    └─ 参考表
│   │       ├── keyframeGen.ts           # 11. 关键帧生成（读 VideoIR）
│   │       ├── videoGen.ts              # 12. 视频生成（读 VideoIR）
│   │       ├── videoCompress.ts         #    └─ 视频压缩
│   │       ├── tts.ts                   # 13. TTS 语音合成（读 VideoIR）
│   │       ├── factVerification.ts      #    └─ 事实验证
│   │       ├── refinement.ts            # 15. 自动精修（失败重试）
│   │       └── finalRiskGate.ts         #    └─ 终审风控门子步骤
│   ├── adapters/                 # AI 适配器层
│   │   ├── chatAdapter.ts        # 免费聊天（Playwright 浏览器自动化）
│   │   ├── geminiAdapter.ts      # 付费 Gemini API（@google/genai）
│   │   ├── fallbackAdapter.ts    # 自动降级：免费 → 付费
│   │   ├── ffmpegAssembler.ts    # FFmpeg 视频合成（14. ASSEMBLY 阶段 — 链接器）
│   │   ├── ttsProvider.ts        # edge-tts 免费语音合成
│   │   ├── videoProvider.ts      # 浏览器端视频生成（即梦 Seedance / 可灵 Kling）
│   │   ├── videoProviderHealth.ts # 视频提供者健康检查
│   │   ├── imageExtractor.ts     # AI 回复中提取图片 URL
│   │   ├── responseParser.ts     # AI 回复结构化解析
│   │   └── schemaValidator.ts    # Schema 验证
│   ├── cir/                      # CIR 编译器中间表示层（7 种类型化 IR）
│   │   ├── index.ts              # CIR 导出
│   │   ├── types.ts              # 7 种 CIR 类型定义（StyleAnalysis → VideoIR）
│   │   ├── contracts.ts          # 15 阶段合约注册表 + fail-closed 验证器
│   │   ├── errors.ts             # 编译器错误模型 + deepFreeze() 权威锁
│   │   ├── loader.ts             # CIR 加载器网关（类型化 + 访问控制）
│   │   └── parsers.ts            # CIR 解析器 + VideoIR 构建器
│   ├── lib/                      # 公共工具库
│   │   ├── logger.ts             # 日志工具
│   │   ├── pathSafety.ts         # 路径安全校验
│   │   ├── sanitize.ts           # 输入净化
│   │   └── tempFiles.ts          # 临时文件管理
│   └── testing/                  # 验收测试与调试脚本
│       ├── canary-run.ts         # 金丝雀运行
│       ├── loadTest.ts           # 负载测试
│       ├── production-dryrun.ts  # 生产预演
│       └── scripts/              # 验收/调试/认证脚本（17 个）
├── ui/                           # React 19 前端（Tailwind CSS 4）
│   ├── src/
│   │   ├── App.tsx               # HashRouter 路由定义
│   │   ├── pages/                # 6 个页面
│   │   │   ├── PipelinePage.tsx  # 首页：项目列表（搜索/排序/删除）
│   │   │   ├── StylePage.tsx     # 第 1 页：风格初始化 + 资源规划
│   │   │   ├── ScriptPage.tsx    # 第 2 页：脚本创作 + QA 审阅
│   │   │   ├── StoryboardPage.tsx # 第 3 页：分镜 + 参考图审阅
│   │   │   ├── ProductionPage.tsx # 第 4 页：制作交付 + 视频播放
│   │   │   └── SettingsPage.tsx  # 设置页：环境检测 + 资源/提供者管理
│   │   ├── components/           # UI 组件
│   │   │   ├── Layout.tsx        # 全局布局（顶部栏 + SettingsModal）
│   │   │   ├── ProjectLayout.tsx # 项目布局（NavStepper + 日志面板）
│   │   │   ├── NavStepper.tsx    # 4 步导航条
│   │   │   ├── SubStageProgress.tsx # 子步骤进度条
│   │   │   ├── ResourcePlannerPanel.tsx # 资源规划面板
│   │   │   ├── ResourceStatusBanner.tsx # 资源状态横幅
│   │   │   ├── ModelOverridePanel.tsx # 模型覆盖配置
│   │   │   ├── AnchorModal.tsx   # 锚点弹窗
│   │   │   ├── FloatingActionBar.tsx # 浮动操作栏
│   │   │   ├── SceneGrid.tsx     # 场景网格（分镜/参考图）
│   │   │   ├── ScenePreviewModal.tsx # 场景预览弹窗
│   │   │   ├── StageTimeline.tsx # 阶段时间线
│   │   │   ├── VideoPlayer.tsx   # 视频播放器
│   │   │   ├── LogPanel.tsx      # 日志面板（按级别过滤）
│   │   │   ├── SettingsModal.tsx # 设置弹窗（资源/提供者管理）
│   │   │   ├── ErrorBoundary.tsx # 错误边界（防白屏）
│   │   │   ├── ui/              # 基础 UI 组件（Badge/Button/Card/Modal 等）
│   │   │   └── script/          # 脚本编辑组件（NarrativePanel/ScriptEditor 等）
│   │   ├── api/
│   │   │   ├── client.ts         # 后端 API 客户端
│   │   │   └── sse.ts            # SSE 事件流连接
│   │   ├── hooks/
│   │   │   ├── usePipeline.ts    # 流水线状态 Hook
│   │   │   ├── useWorkbench.ts   # 工作台状态 Hook
│   │   │   └── useAutoSave.ts    # 自动保存 Hook
│   │   ├── lib/                  # 前端工具库
│   │   │   ├── assetUrl.ts       # 素材 URL 工具
│   │   │   ├── logger.ts         # 前端日志
│   │   │   └── utils.ts          # 通用工具
│   │   └── context/
│   │       └── ProjectContext.tsx # 项目上下文（共享 pipeline 状态）
├── browser-shell/                # Electron 桌面浏览器外壳
│   ├── src/
│   │   ├── main.ts              # Electron 主进程入口
│   │   ├── tab-manager.ts       # 标签页生命周期管理
│   │   ├── session-manager.ts   # 账号会话隔离（Electron partition）
│   │   ├── backend-launcher.ts  # 后端进程启动/监控
│   │   ├── automation-server.ts # 自动化服务器
│   │   ├── ipc-handlers.ts      # IPC 处理器（标签页/导航/自动化）
│   │   ├── preload.ts           # 安全 IPC 桥接
│   │   └── stealth-preload.ts   # 反检测预加载脚本
│   └── electron-builder.json    # Electron Builder 打包配置
├── shared/types.ts               # 前后端共享类型（PipelineStage / PipelineProject / PipelineEvent 等）
├── data/
│   ├── models.json               # 模型定义
│   └── provider-presets.json     # 提供者能力预设
├── scripts/
│   ├── build-sidecar.sh          # Electron sidecar 构建脚本
│   ├── generate-icons.sh         # 应用图标生成脚本
│   ├── health-check.mjs          # 健康检查
│   └── start.sh                  # 启动脚本
├── .env.example                  # 环境变量模板
├── Dockerfile                    # 多阶段构建（Node.js + FFmpeg + Chromium）
├── .github/workflows/
│   ├── ci.yml                    # GitHub Actions CI（Node 20/22 × typecheck × test）
│   └── release.yml               # 发布工作流
└── vitest.workspace.ts           # Vitest 工作区配置
```

---

## 核心功能

| 功能 | 说明 |
|------|------|
| **15 步编译器式流水线** | 能力评估 → 风格提取 → 事实研究 → 叙事地图 → 脚本生成 → QA 审查 → 时序规划 → 分镜 → **VideoIR 编译** → 参考图 → 关键帧 → 视频生成 → TTS → 合成 → 精修 |
| **编译器架构** | LLM 作为不可信前端、7 种类型化 CIR 中间表示、VideoIR 编译屏障（deepFreeze）、下游阶段纯投影 |
| **3 级质量路由** | 按资源稀缺度智能分配付费额度：视频 > 图片 > TTS > 文本 |
| **双适配器 + 自动降级** | ChatAdapter（免费 Playwright）+ GeminiAdapter（付费 API），FallbackAdapter 额度耗尽自动切换 |
| **会话上下文复用** | 4 组会话（分析/创作/视觉/制作），同组阶段共享聊天上下文 |
| **资源预规划** | 执行前生成资源分配矩阵 + 成本预估 + 可行性检查 |
| **提供者能力注册** | 动态追踪 4 大内置提供者的能力（文本/图片/视频/搜索/上传/TTS） |
| **人在回路** | QA 审查和参考图后自动暂停，用户可审阅/编辑/覆盖后恢复 |
| **断点续行** | 所有中间产物持久化到磁盘 JSON，服务重启可从上次完成的阶段继续 |
| **4 页向导式 UI** | 风格 → 脚本 → 分镜 → 制作，步骤解锁机制 |
| **多资源轮换** | ResourceManager 统一管理聊天/视频/图片资源，自动检测配额并轮换 |
| **安全审查** | 能力评估阶段自动进行内容安全分类 |
| **实时状态** | SSE 事件驱动的 React 前端 |
| **桌面应用** | Electron Browser Shell 打包支持跨平台桌面运行 |

---

## 快速开始

### 前置依赖

| 依赖 | 版本 | 用途 | 安装 |
|------|------|------|------|
| Node.js | ≥ 20.9.0 | 后端运行时 | https://nodejs.org |
| FFmpeg | ≥ 6.x | 视频合成 | `apt install ffmpeg` / `brew install ffmpeg` |
| Chromium | 最新 | Playwright 浏览器自动化 | `npx playwright install chromium` |
| edge-tts | 最新 | 免费 TTS | `pip install edge-tts` |

### 一键启动

```bash
# 1. 克隆仓库
git clone https://github.com/he18718143986-design/ai-video.git
cd ai-video-main

# 2. 安装依赖
npm install
cd ui && npm install && cd ..

# 3. 安装 Playwright 浏览器
npx playwright install chromium

# 4.（可选）设置 Gemini API Key 启用 balanced/premium 模式
export GEMINI_API_KEY=your_key_here

# 5. 启动桌面应用（Electron 一体化模式）
npm run dev:desktop
```

应用启动后，在设置页为至少一个 AI 提供者完成登录 → 新建项目开始使用。

> 所有浏览器自动化操作在 Electron 内部标签页完成，不会打开外部浏览器。

---

## 质量级别

| 级别 | 描述 | 成本 | 要求 |
|------|------|------|------|
| `free` | 全部通过 Playwright 聊天自动化完成 | $0 | 仅需已登录的 AI 聊天账号 |
| `balanced` | 视频→付费 API，其他→免费优先+自动降级 | $0.1~0.5/视频 | `GEMINI_API_KEY` |
| `premium` | 全部使用付费 API，最高质量 | $1~5/视频 | `GEMINI_API_KEY` |

**分配原则**（按资源稀缺度）：

```
视频生成 ←── 最优先分配付费额度（生成成本最高，免费额度最少）
  ▼
图片生成 ←── 免费优先 + FallbackAdapter 自动降级
  ▼
TTS 语音 ←── edge-tts 完全免费，不消耗任何 AI 额度
  ▼
文本任务 ←── 免费聊天即可满足（安全检查/脚本/分析等）
```

---

## 编译器架构

系统采用编译器架构：LLM 是不可信的编译器前端（parser），CIR 是类型化中间表示，VideoIR 是编译屏障后冻结的代码生成 IR，FFmpeg 是最终链接器。

```
源输入（参考视频 + 主题）
        │
        ▼
┌─ LLM 前端（不可信解析器）──────────────────────────────────────┐
│  ① CAPABILITY_ASSESSMENT                                       │
│  ② STYLE_EXTRACTION   → StyleAnalysisCIR                       │
│  ③ RESEARCH            → ResearchCIR                            │
│  ④ SCRIPT_GENERATION   → ScriptCIR                              │
│  ⑤ NARRATIVE_MAP                                                │
│  ⑥ QA_REVIEW                                                   │
│  ⑦ TEMPORAL_PLANNING   → TemporalPlanCIR                       │
│  ⑧ STORYBOARD          → StoryboardCIR                         │
└────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ ⑨ VIDEO_IR_COMPILE ═══ 编译屏障 ═══ ─────────────────────────┐
│  合并所有上游 CIR → VideoIR（deepFreeze 冻结，不可变）         │
│  每场景 16 个 readonly 字段：时序/语音/风格/资产类型全预解析    │
└────────────────────────────────────────────────────────────────┘
        │
        ▼
┌─ 代码生成 + 链接器（只读 VideoIR）─────────────────────────────┐
│  ⑩ REFERENCE_IMAGE  → 参考图                                   │
│  ⑪ KEYFRAME_GEN     → 关键帧                                   │
│  ⑫ VIDEO_GEN        → 视频片段                                 │
│  ⑬ TTS              → 语音音频                                 │
│  ⑭ ASSEMBLY          → .mp4（FFmpeg 链接器）                   │
│  ⑮ REFINEMENT        → 后链接验证                              │
└────────────────────────────────────────────────────────────────┘
        │
        ▼
   输出二进制（.mp4）
```

**7 种类型化 CIR（编译器中间表示）**：

| CIR | 生产者 | 内容 |
|-----|--------|------|
| StyleAnalysisCIR | STYLE_EXTRACTION | 视觉风格、配色、节奏、色温 |
| ResearchCIR | RESEARCH | 经验证的事实、术语表 |
| ScriptCIR | SCRIPT_GENERATION | 句子级脚本 + 叙事节拍标注 |
| TemporalPlanCIR | TEMPORAL_PLANNING | 每场景时序 + API 量化时长 |
| StoryboardCIR | STORYBOARD | 每场景视觉/叙事结构 |
| VideoPlanCIR | TTS | 生产就绪快照 |
| **VideoIR** | **VIDEO_IR_COMPILE** | **冻结的生产计划 — 下游唯一权威** |

> 详细架构文档见 [`docs/COMPILER_ARCHITECTURE.md`](docs/COMPILER_ARCHITECTURE.md)

---

## 15 步流水线概览

```
┌─ 第 1 页 · 风格初始化 ─────────────────────────────────────────┐
│ ① CAPABILITY_ASSESSMENT → ② STYLE_EXTRACTION → ③ RESEARCH     │
└────────────────────────────────────────────────────────────────┘
                              ▼
┌─ 第 2 页 · 脚本创作 ──────────────────────────────────────────┐
│ ④ NARRATIVE_MAP → ⑤ SCRIPT_GENERATION → ⑥ QA_REVIEW ★暂停    │
│                              → ⑦ TEMPORAL_PLANNING             │
└────────────────────────────────────────────────────────────────┘
                              ▼
┌─ 第 3 页 · 视觉设计 ──────────────────────────────────────────┐
│ ⑧ STORYBOARD → ⑨ VIDEO_IR_COMPILE ═══ → ⑩ REFERENCE_IMAGE ★暂停 │
└────────────────────────────────────────────────────────────────┘
                              ▼
┌─ 第 4 页 · 制作交付 ──────────────────────────────────────────┐
│ ⑪ KEYFRAME_GEN → ⑫ VIDEO_GEN ∥ ⑬ TTS → ⑭ ASSEMBLY → ⑮ REFINEMENT │
└────────────────────────────────────────────────────────────────┘
```

═══ = 编译屏障（VideoIR 冻结，下游只读）  
★ = 暂停审查点，流水线自动暂停等待用户审阅/编辑后恢复

---

## AI 资源管理

### 会话管理（SessionManager）

将 15 个阶段分为 4 组，同组阶段共享 AI 聊天上下文：

| 会话组 | 阶段 | 说明 |
|--------|------|------|
| Analysis | ①②③ | 分析会话：能力评估 → 风格提取 → 研究共享上下文 |
| Creation | ④⑤⑥⑦ | 创作会话：叙事 → 脚本 → QA → 时序规划共享上下文 |
| Visual | ⑧⑨⑩⑪ | 视觉会话：分镜 → VideoIR 编译 → 参考图 → 关键帧 |
| Production | ⑫⑬⑭⑮ | 制作阶段：视频生成/TTS/合成/精修（只读 VideoIR） |

### 提供者能力注册表（ProviderCapabilityRegistry）

动态追踪 4 大内置提供者的能力（基于 `data/provider-presets.json`）：

| 提供者 | 文本 | 图片生成 | 视频生成 | 文件上传 | 搜索 | TTS |
|--------|------|----------|----------|----------|------|-----|
| Gemini | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| ChatGPT | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| DeepSeek | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Kimi | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |

视频生成通过独立的 `videoProvider`（即梦 Seedance / 可灵 Kling）驱动，不属于内置聊天提供者。

### 资源规划器（ResourcePlanner）

执行前生成 15 步资源分配矩阵，包括：
- 每步使用的提供者和适配器（chat/api）
- 成本分类（free / low / medium / high）
- 可行性检查 + 不可满足的阶段告警
- 会话组汇总

---

## 4 页向导 UI

| 步骤 | 页面 | 阶段 | 解锁条件 |
|------|------|------|----------|
| 1. 风格初始化 | StylePage | ①②③ + 资源规划面板 | 始终可用 |
| 2. 脚本创作 | ScriptPage | ④⑤⑥⑦ + 脚本编辑器 | RESEARCH 已完成 |
| 3. 视觉设计 | StoryboardPage | ⑧⑨⑩ + 场景审阅 | QA_REVIEW 已完成 |
| 4. 制作交付 | ProductionPage | ⑪⑫⑬⑭⑮ + 视频播放器 | REFERENCE_IMAGE 已完成 |

---

## NPM 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev:desktop` | **推荐** — 启动 Electron 桌面应用 + Vite 热更新 |
| `npm run dev` | 仅启动后端（`node --import tsx src/server.ts`） |
| `npm run dev:ui` | 仅启动前端 Vite 开发服务器 |
| `npm run dev:electron` | 启动 Electron 桌面应用（使用已构建的 UI） |
| `npm test` | 运行测试（Vitest） |
| `npm run test:backend` | 类型检查 + 运行测试 |
| `npm run test:watch` | 测试监听模式 |
| `npm run typecheck` | 后端 + 前端全量类型检查 |
| `npm run build:ui` | 构建前端生产版本 |
| `npm run build:sidecar` | 构建 Electron sidecar（Node.js → 可执行文件） |
| `npm run build:electron` | 构建 Electron browser-shell |
| `npm run package:electron` | 打包 Electron 桌面应用（含 sidecar） |
| `npm run accept:backend` | 运行后端验收测试 |
| `npm run lint` | 与 typecheck 相同 |

---

## 技术栈

| 层 | 技术 | 版本 |
|----|------|------|
| 后端运行时 | Node.js | ≥ 20.9.0 |
| 后端语言 | TypeScript (strict) | 5.8+ |
| HTTP 服务器 | Node.js 原生 `http`（零框架） | — |
| 浏览器自动化 | Playwright | 1.55+ |
| AI API | Google GenAI SDK (`@google/genai`) | 1.47+ |
| TTS | edge-tts（微软免费） | 最新 |
| 视频合成 | FFmpeg | 6.x+ |
| 前端框架 | React | 19 |
| 前端构建 | Vite | 8 |
| 前端样式 | Tailwind CSS | 4 |
| 前端路由 | React Router | 7 |
| 桌面应用 | Electron | 41.x |
| 测试 | Vitest | 4.1+ |
| CI | GitHub Actions | Node 20/22 |
| 容器化 | Docker 多阶段构建 | — |

---

## 数据目录

`data/` 目录下包含提供者能力预设（`provider-presets.json`）和模型定义（`models.json`）。运行时产生的项目数据（浏览器 Profile、生成的素材）保存在跨平台数据目录中（由 `dataDir.ts` 解析），不会提交到版本库。

---

## 许可证

MIT — 详见 [LICENSE](LICENSE)

请对当前 AI 视频生成代码仓库做一次“高质量视频生成能力审计”：
1) 当前已实现的方法（结构、视觉、时序、一致性、成本）
2) 与行业最佳实践相比缺失的方法
3) 当前质量瓶颈 Top 5
4) 100 分制评分
5) 从当前分数提升到 100 分的最短实施路径