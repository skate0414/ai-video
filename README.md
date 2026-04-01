# AI Video — 端到端 AI 视频生成平台

> **核心理念**：把握 AI 生成视频的质量（将视频生成分为 13 个可控步骤，而非盲目交给 AI 一键生成），同时利用 AI 网站聊天的免费额度最大限度降低生产成本。

AI Video 是一个全栈自动化视频生产平台，从输入一个主题到输出一部完整的 MP4 视频，由 13 步精细化流水线驱动。系统通过 Playwright 浏览器自动化利用各大 AI 聊天平台的免费额度（Gemini、ChatGPT、DeepSeek、Kimi），在关键资源（视频生成）消耗较大时自动切换至付费 API，实现**质量可控、成本最低**的 AI 视频生产。

---

## 目录

- [项目架构](#项目架构)
- [核心功能](#核心功能)
- [快速开始](#快速开始)
- [质量级别](#质量级别)
- [13 步流水线概览](#13-步流水线概览)
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
│   ├── dataDir.ts                # 跨平台数据目录解析（DATA_DIR / Tauri APPDATA / OS）
│   ├── workbench.ts              # Playwright 浏览器自动化引擎
│   ├── chatAutomation.ts         # 聊天自动化核心逻辑
│   ├── accountManager.ts         # 多账号管理与轮换
│   ├── taskQueue.ts              # 异步任务队列
│   ├── providers.ts              # 内置 AI 提供者定义（选择器/URL/模型）
│   ├── types.ts                  # 后端公共类型
│   ├── routes/
│   │   ├── helpers.ts            # 安全工具：readBody 大小限制、JSON 解析、上传白名单
│   │   ├── pipeline.ts           # 流水线 CRUD + 控制 + 配置 API（~33 个端点）
│   │   ├── workbench.ts          # 工作台 API（账号/任务/提供者管理，19 个端点）
│   │   ├── setup.ts              # 首次运行检测（FFmpeg / Playwright / API Key）
│   │   └── __tests__/            # 路由单元测试
│   ├── pipeline/                 # 13 步流水线引擎
│   │   ├── orchestrator.ts       # 编排器：项目管理、阶段调度、暂停/恢复
│   │   ├── qualityRouter.ts      # 质量路由（free / balanced / premium 三级分配）
│   │   ├── sessionManager.ts     # 会话管理：4 组聊天上下文复用
│   │   ├── providerRegistry.ts   # 提供者能力注册表（5 大内置提供者）
│   │   ├── resourcePlanner.ts    # 资源规划器：执行前预估资源分配与成本
│   │   ├── safety.ts             # 内容安全检测模块
│   │   ├── prompts.ts            # 各阶段 AI Prompt 模板
│   │   ├── types.ts              # 流水线类型定义
│   │   ├── __tests__/            # 流水线单元测试（7 个测试文件）
│   │   └── stages/               # 13 个阶段实现 + 4 个质量子步骤（每阶段独立模块）
│   │       ├── stageLog.ts              # 共享日志工厂（createStageLog）
│   │       ├── capabilityAssessment.ts  # 1. 能力评估（安全检查）
│   │       ├── cvPreprocess.ts          #    └─ CV 预处理子步骤
│   │       ├── styleExtraction.ts       # 2. 风格提取（Style DNA）
│   │       ├── research.ts              # 3. 事实研究（Google Search）
│   │       ├── calibration.ts           # 4a. 语速校准
│   │       ├── narrativeMap.ts          # 4b. 叙事地图
│   │       ├── scriptGeneration.ts      # 5. 脚本生成
│   │       ├── scriptAudit.ts           #    └─ 脚本自审子步骤
│   │       ├── qaReview.ts              # 6. QA 三合一审查
│   │       ├── storyboard.ts            # 7. 分镜规划
│   │       ├── subjectIsolation.ts      #    └─ 主体隔离验证子步骤
│   │       ├── referenceImage.ts        # 8. 参考图生成
│   │       ├── keyframeGen.ts           # 9. 关键帧生成
│   │       ├── videoGen.ts              # 10. 视频生成（img2video）
│   │       ├── tts.ts                   # 11. TTS 语音合成
│   │       ├── refinement.ts            # 13. 自动精修（失败重试）
│   │       └── finalRiskGate.ts         #    └─ 终审风控门子步骤
│   └── adapters/                 # AI 适配器层
│       ├── chatAdapter.ts        # 免费聊天（Playwright 浏览器自动化）
│       ├── geminiAdapter.ts      # 付费 Gemini API（@google/genai）
│       ├── fallbackAdapter.ts    # 自动降级：免费 → 付费
│       ├── ffmpegAssembler.ts    # FFmpeg 视频合成（12. ASSEMBLY 阶段）
│       ├── ttsProvider.ts        # edge-tts 免费语音合成
│       ├── videoProvider.ts      # 浏览器端视频生成（Seedance 等）
│       ├── imageExtractor.ts     # AI 回复中提取图片 URL
│       └── responseParser.ts     # AI 回复结构化解析
├── ui/                           # React 19 前端
│   ├── src/
│   │   ├── App.tsx               # HashRouter 路由定义
│   │   ├── pages/                # 6 个页面
│   │   │   ├── PipelinePage.tsx  # 首页：项目列表（搜索/排序/删除）
│   │   │   ├── StylePage.tsx     # 第 1 页：风格初始化 + 资源规划
│   │   │   ├── ScriptPage.tsx    # 第 2 页：脚本创作 + QA 审阅
│   │   │   ├── StoryboardPage.tsx # 第 3 页：分镜 + 参考图审阅
│   │   │   ├── ProductionPage.tsx # 第 4 页：制作交付 + 视频播放
│   │   │   └── SetupPage.tsx     # 首次运行向导
│   │   ├── components/           # UI 组件
│   │   │   ├── Layout.tsx        # 全局布局（顶部栏 + SettingsModal）
│   │   │   ├── ProjectLayout.tsx # 项目布局（NavStepper + 日志面板）
│   │   │   ├── NavStepper.tsx    # 4 步导航条
│   │   │   ├── SubStageProgress.tsx # 子步骤进度条
│   │   │   ├── ResourcePlannerPanel.tsx # 资源规划面板
│   │   │   ├── ModelOverridePanel.tsx # 模型覆盖配置
│   │   │   ├── SceneGrid.tsx     # 场景网格（分镜/参考图）
│   │   │   ├── StageTimeline.tsx # 阶段时间线
│   │   │   ├── VideoPlayer.tsx   # 视频播放器
│   │   │   ├── LogPanel.tsx      # 日志面板（按级别过滤）
│   │   │   ├── SettingsModal.tsx # 设置弹窗（账号/提供者管理）
│   │   │   └── ErrorBoundary.tsx # 错误边界（防白屏）
│   │   ├── api/
│   │   │   ├── client.ts         # 后端 API 客户端
│   │   │   └── sse.ts            # SSE 事件流连接
│   │   ├── hooks/
│   │   │   ├── usePipeline.ts    # 流水线状态 Hook
│   │   │   ├── useWorkbench.ts   # 工作台状态 Hook
│   │   │   └── useSetup.ts       # 首次运行检测 Hook
│   │   └── context/
│   │       └── ProjectContext.tsx # 项目上下文（共享 pipeline 状态）
│   └── src-tauri/                # Tauri 2.x 桌面应用
│       ├── tauri.conf.json       # 窗口/CSP/sidecar 配置
│       ├── Cargo.toml            # Rust 依赖
│       ├── build.rs              # Tauri 构建脚本
│       └── src/lib.rs            # Sidecar 生命周期管理
├── shared/types.ts               # 前后端共享类型（PipelineStage / PipelineProject / PipelineEvent 等）
├── scripts/
│   ├── build-sidecar.sh          # Tauri sidecar 构建脚本
│   └── generate-icons.sh         # 应用图标生成脚本
├── .env.example                  # 环境变量模板
├── Dockerfile                    # 多阶段构建（Node.js + FFmpeg + Chromium）
├── .github/workflows/ci.yml      # GitHub Actions CI（Node 20/22 × typecheck × test）
└── vitest.workspace.ts           # Vitest 4 工作区配置
```

---

## 核心功能

| 功能 | 说明 |
|------|------|
| **13 步精细化流水线** | 能力评估 → 风格提取 → 事实研究 → 叙事地图 → 脚本生成 → QA 审查 → 分镜 → 参考图 → 关键帧 → 视频生成 → TTS → 合成 → 精修 |
| **3 级质量路由** | 按资源稀缺度智能分配付费额度：视频 > 图片 > TTS > 文本 |
| **双适配器 + 自动降级** | ChatAdapter（免费 Playwright）+ GeminiAdapter（付费 API），FallbackAdapter 额度耗尽自动切换 |
| **会话上下文复用** | 4 组会话（分析/创作/视觉/制作），同组阶段共享聊天上下文 |
| **资源预规划** | 执行前生成资源分配矩阵 + 成本预估 + 可行性检查 |
| **提供者能力注册** | 动态追踪 5 大提供者的能力（文本/图片/视频/搜索/上传/TTS） |
| **人在回路** | QA 审查和参考图后自动暂停，用户可审阅/编辑/覆盖后恢复 |
| **断点续行** | 所有中间产物持久化到磁盘 JSON，服务重启可从上次完成的阶段继续 |
| **4 页向导式 UI** | 风格 → 脚本 → 分镜 → 制作，步骤解锁机制 |
| **多账号轮换** | 自动检测配额，切换 AI 聊天账号 |
| **安全审查** | 能力评估阶段自动进行内容安全分类 |
| **实时状态** | SSE 事件驱动的 React 前端 |
| **桌面应用** | Tauri 2.x 打包支持跨平台桌面运行 |

---

## 快速开始

> 完整部署指南见 [DEPLOYMENT.md](DEPLOYMENT.md)

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
cd ai-video

# 2. 安装依赖
npm install
cd ui && npm install && cd ..

# 3. 安装 Playwright 浏览器
npx playwright install chromium

# 4.（可选）设置 Gemini API Key 启用 balanced/premium 模式
export GEMINI_API_KEY=your_key_here

# 5. 启动后端 (http://localhost:3220)
npm run dev

# 6. 启动前端 (http://localhost:5173)
npm run dev:ui
```

打开 http://localhost:5173 → 点击右上角 ⚙️ 设置 → 为至少一个 AI 提供者完成登录 → 新建项目开始使用。

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

## 13 步流水线概览

> 完整每步设计见 [PIPELINE.md](PIPELINE.md)

```
┌─ 第 1 页 · 风格初始化 ──────────────────────────────────────┐
│ ① CAPABILITY_ASSESSMENT → ② STYLE_EXTRACTION → ③ RESEARCH  │
└──────────────────────────────────────────────────────────────┘
                              ▼
┌─ 第 2 页 · 脚本创作 ────────────────────────────────────────┐
│ ④ NARRATIVE_MAP → ⑤ SCRIPT_GENERATION → ⑥ QA_REVIEW ★暂停  │
└──────────────────────────────────────────────────────────────┘
                              ▼
┌─ 第 3 页 · 视觉设计 ────────────────────────────────────────┐
│ ⑦ STORYBOARD → ⑧ REFERENCE_IMAGE ★暂停                      │
└──────────────────────────────────────────────────────────────┘
                              ▼
┌─ 第 4 页 · 制作交付 ────────────────────────────────────────┐
│ ⑨ KEYFRAME_GEN → ⑩ VIDEO_GEN ∥ ⑪ TTS → ⑫ ASSEMBLY → ⑬ REFINEMENT │
└──────────────────────────────────────────────────────────────┘
```

★ = 暂停审查点，流水线自动暂停等待用户审阅/编辑后恢复

---

## AI 资源管理

> 详情见 [ARCHITECTURE.md](ARCHITECTURE.md)

### 会话管理（SessionManager）

将 13 个阶段分为 4 组，同组阶段共享 AI 聊天上下文：

| 会话组 | 阶段 | 说明 |
|--------|------|------|
| Analysis | ①②③ | 分析会话：视频分析 → 风格 → 研究共享上下文 |
| Creation | ④⑤⑥ | 创作会话：叙事 → 脚本 → QA 共享上下文 |
| Visual | ⑦⑧⑨ | 视觉会话：分镜 → 参考图 → 关键帧保持风格一致 |
| Production | ⑩⑪⑫⑬ | 制作阶段：各自独立执行 |

### 提供者能力注册表（ProviderCapabilityRegistry）

动态追踪 5 大内置提供者的能力：

| 提供者 | 文本 | 图片生成 | 视频生成 | 文件上传 | 搜索 | TTS |
|--------|------|----------|----------|----------|------|-----|
| Gemini | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| ChatGPT | ✅ | ✅ | ❌ | ✅ | ✅ | ❌ |
| DeepSeek | ✅ | ❌ | ❌ | ❌ | ✅ | ❌ |
| Kimi | ✅ | ❌ | ❌ | ✅ | ✅ | ❌ |
| Seedance | ❌ | ❌ | ✅ | ✅ | ❌ | ❌ |

### 资源规划器（ResourcePlanner）

执行前生成 13 步资源分配矩阵，包括：
- 每步使用的提供者和适配器（chat/api）
- 成本分类（free / low / medium / high）
- 可行性检查 + 不可满足的阶段告警
- 会话组汇总

---

## 4 页向导 UI

| 步骤 | 页面 | 阶段 | 解锁条件 |
|------|------|------|----------|
| 1. 风格初始化 | StylePage | ①②③ + 资源规划面板 | 始终可用 |
| 2. 脚本创作 | ScriptPage | ④⑤⑥ + 脚本编辑器 | RESEARCH 已完成 |
| 3. 视觉设计 | StoryboardPage | ⑦⑧ + 场景审阅 | QA_REVIEW 已完成 |
| 4. 制作交付 | ProductionPage | ⑨⑩⑪⑫⑬ + 视频播放器 | REFERENCE_IMAGE 已完成 |

---

## NPM 脚本

| 命令 | 说明 |
|------|------|
| `npm run dev` | 启动后端开发服务器（端口 3220） |
| `npm run dev:ui` | 启动前端开发服务器（端口 5173） |
| `npm test` | 运行测试（Vitest，102 测试用例，12 个测试文件） |
| `npm run typecheck` | 后端 + 前端全量类型检查 |
| `npm run build:ui` | 构建前端生产版本 |
| `npm run build:sidecar` | 构建 Tauri sidecar（Node.js → 可执行文件） |
| `npm run build:tauri` | 构建 Tauri 桌面应用 |
| `npm run dev:tauri` | 启动 Tauri 开发模式 |
| `npm run lint` | 与 typecheck 相同 |

---

## 文档索引

| 文档 | 内容 |
|------|------|
| [README.md](README.md) | 项目概览、快速开始、功能一览（本文件） |
| [ARCHITECTURE.md](ARCHITECTURE.md) | 架构设计：后端/前端/适配器/资源管理详解 |
| [PIPELINE.md](PIPELINE.md) | 流水线设计：13 步详细说明、质量路由表、暂停机制 |
| [DEPLOYMENT.md](DEPLOYMENT.md) | 部署指南：安装、Docker、Tauri、使用流程 |
| [API.md](API.md) | API 接口文档：54 个端点详细说明 |

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
| 前端路由 | React Router | 7 |
| 桌面应用 | Tauri | 2.x |
| 测试 | Vitest | 4.1+ |
| CI | GitHub Actions | Node 20/22 |
| 容器化 | Docker 多阶段构建 | — |

---

## 许可证

私有项目
