<!--
生成日期：2026-04-17
基于代码版本：当前 main 分支
本文档由 AI 生成，项目所有者已审核
-->

# 功能边界

本文档定义 ai-video-main 项目的功能边界，明确已实现、计划实现和明确不做的功能。

---

## 已实现功能（仅维护，不重写）

### 核心编译流水线

| 功能 | 核心文件 | 状态 |
|------|---------|------|
| 15 阶段流水线编排 | [src/pipeline/orchestrator.ts](src/pipeline/orchestrator.ts) | 稳定 |
| 阶段注册表 | [src/pipeline/stageRegistry.ts](src/pipeline/stageRegistry.ts) | 稳定 |
| 阶段状态机 | [src/pipeline/stateMachine.ts](src/pipeline/stateMachine.ts) | 稳定 |
| 项目存储（原子写入） | [src/pipeline/projectStore.ts](src/pipeline/projectStore.ts) | 稳定 |
| 运行锁（防止并发编译） | [src/pipeline/runLock.ts](src/pipeline/runLock.ts) | 稳定 |
| 编译器门面服务 | [src/pipeline/pipelineService.ts](src/pipeline/pipelineService.ts) | 稳定 |

### 编译阶段实现

| 阶段 | 核心文件 | 状态 |
|------|---------|------|
| CAPABILITY_ASSESSMENT | [src/pipeline/stages/capabilityAssessment.ts](src/pipeline/stages/capabilityAssessment.ts) | 稳定 |
| STYLE_EXTRACTION | [src/pipeline/stages/styleExtraction.ts](src/pipeline/stages/styleExtraction.ts) | 稳定 |
| RESEARCH | [src/pipeline/stages/research.ts](src/pipeline/stages/research.ts) | 稳定 |
| NARRATIVE_MAP | [src/pipeline/stages/narrativeMap.ts](src/pipeline/stages/narrativeMap.ts) | 稳定 |
| SCRIPT_GENERATION | [src/pipeline/stages/scriptGeneration.ts](src/pipeline/stages/scriptGeneration.ts) | 稳定 |
| QA_REVIEW | [src/pipeline/stages/qaReview.ts](src/pipeline/stages/qaReview.ts) | 稳定 |
| TEMPORAL_PLANNING | [src/pipeline/stages/temporalPlanning.ts](src/pipeline/stages/temporalPlanning.ts) | 稳定 |
| STORYBOARD | [src/pipeline/stages/storyboard.ts](src/pipeline/stages/storyboard.ts) | 稳定 |
| VIDEO_IR_COMPILE | [src/pipeline/stages/videoIRCompile.ts](src/pipeline/stages/videoIRCompile.ts) | 稳定 |
| REFERENCE_IMAGE | [src/pipeline/stages/referenceImage.ts](src/pipeline/stages/referenceImage.ts) | 稳定 |
| KEYFRAME_GEN | [src/pipeline/stages/keyframeGen.ts](src/pipeline/stages/keyframeGen.ts) | 稳定 |
| VIDEO_GEN | [src/pipeline/stages/videoGen.ts](src/pipeline/stages/videoGen.ts) | 稳定 |
| TTS | [src/pipeline/stages/tts.ts](src/pipeline/stages/tts.ts) | 稳定 |
| ASSEMBLY | [src/adapters/ffmpegAssembler.ts](src/adapters/ffmpegAssembler.ts) | 稳定 |
| REFINEMENT | [src/pipeline/stages/refinement.ts](src/pipeline/stages/refinement.ts) | 稳定 |

### 中间表示系统（CIR）

| 功能 | 核心文件 | 状态 |
|------|---------|------|
| CIR 类型定义 | [src/cir/types.ts](src/cir/types.ts) | 稳定 |
| CIR 契约验证 | [src/cir/contracts.ts](src/cir/contracts.ts) | 稳定 |
| CIR 加载器 | [src/cir/loader.ts](src/cir/loader.ts) | 稳定 |
| CIR 解析器 | [src/cir/parsers.ts](src/cir/parsers.ts) | 稳定 |

### AI 适配器

| 功能 | 核心文件 | 状态 |
|------|---------|------|
| Chat 自动化适配器 | [src/adapters/chatAdapter.ts](src/adapters/chatAdapter.ts) | 稳定 |
| Gemini API 适配器 | [src/adapters/geminiAdapter.ts](src/adapters/geminiAdapter.ts) | 稳定 |
| 降级适配器 | [src/adapters/fallbackAdapter.ts](src/adapters/fallbackAdapter.ts) | 稳定 |
| TTS 提供者（edge-tts） | [src/adapters/ttsProvider.ts](src/adapters/ttsProvider.ts) | 稳定 |
| 视频提供者 | [src/adapters/videoProvider.ts](src/adapters/videoProvider.ts) | 稳定 |
| FFmpeg 组装器 | [src/adapters/ffmpegAssembler.ts](src/adapters/ffmpegAssembler.ts) | 稳定 |
| 响应解析器 | [src/adapters/responseParser.ts](src/adapters/responseParser.ts) | 稳定 |

### 浏览器自动化

| 功能 | 核心文件 | 状态 |
|------|---------|------|
| Workbench 主引擎 | [src/workbench.ts](src/workbench.ts) | 稳定 |
| 聊天自动化核心 | [src/chatAutomation.ts](src/chatAutomation.ts) | 稳定 |
| 浏览器管理 | [src/browserManager.ts](src/browserManager.ts) | 稳定 |
| 资源管理器 | [src/resourceManager.ts](src/resourceManager.ts) | 稳定 |
| 任务队列 | [src/taskQueue.ts](src/taskQueue.ts) | 稳定 |
| 配额追踪 | [src/quotaBus.ts](src/quotaBus.ts) | 稳定 |
| 限流器 | [src/rateLimiter.ts](src/rateLimiter.ts) | 稳定 |

### 质量与安全

| 功能 | 核心文件 | 状态 |
|------|---------|------|
| 内容安全检查 | [src/pipeline/safety.ts](src/pipeline/safety.ts) | 稳定 |
| 质量路由器 | [src/pipeline/qualityRouter.ts](src/pipeline/qualityRouter.ts) | 稳定 |
| 场景质量评分 | [src/pipeline/sceneQuality.ts](src/pipeline/sceneQuality.ts) | 稳定 |
| 最终风险门 | [src/pipeline/stages/finalRiskGate.ts](src/pipeline/stages/finalRiskGate.ts) | 稳定 |
| 事实验证 | [src/pipeline/stages/factVerification.ts](src/pipeline/stages/factVerification.ts) | 稳定 |

### 可观测性

| 功能 | 核心文件 | 状态 |
|------|---------|------|
| 编译诊断服务 | [src/pipeline/observability.ts](src/pipeline/observability.ts) | 稳定 |
| 成本追踪器 | [src/pipeline/costTracker.ts](src/pipeline/costTracker.ts) | 稳定 |
| 追踪系统 | [src/pipeline/trace/](src/pipeline/trace/) | 稳定 |
| 日志系统 | [src/lib/logger.ts](src/lib/logger.ts) | 稳定 |
| 健康监控 | [src/healthMonitor.ts](src/healthMonitor.ts) | 稳定 |

### 配置与存储

| 功能 | 核心文件 | 状态 |
|------|---------|------|
| 配置存储 | [src/configStore.ts](src/configStore.ts) | 稳定 |
| 数据目录解析 | [src/dataDir.ts](src/dataDir.ts) | 稳定 |
| 提供者预设 | [src/providerPresets.ts](src/providerPresets.ts) | 稳定 |
| 模型存储 | [src/modelStore.ts](src/modelStore.ts) | 稳定 |
| 选择器服务 | [src/selectorService.ts](src/selectorService.ts) | 稳定 |

### HTTP 服务

| 功能 | 核心文件 | 状态 |
|------|---------|------|
| HTTP 服务器入口 | [src/server.ts](src/server.ts) | 稳定 |
| 流水线 API | [src/routes/pipeline.ts](src/routes/pipeline.ts) | 稳定 |
| Workbench API | [src/routes/workbench.ts](src/routes/workbench.ts) | 稳定 |
| 设置 API | [src/routes/setup.ts](src/routes/setup.ts) | 稳定 |
| SSE 事件推送 | [src/server.ts](src/server.ts) | 稳定 |

### 桌面应用

| 功能 | 核心文件 | 状态 |
|------|---------|------|
| Electron 主进程 | [browser-shell/src/main.ts](browser-shell/src/main.ts) | 稳定 |
| Electron 桥接 | [src/electronBridge.ts](src/electronBridge.ts) | 稳定 |
| 登录浏览器管理 | [src/loginBrowserManager.ts](src/loginBrowserManager.ts) | 稳定 |

### CLI 工具

| 功能 | 核心文件 | 状态 |
|------|---------|------|
| 追踪回放 | [src/cli/replay.ts](src/cli/replay.ts) | 稳定 |
| 追踪查找 | [src/cli/findTrace.ts](src/cli/findTrace.ts) | 稳定 |
| 流水线脚本 | [scripts/run-pipeline.mjs](scripts/run-pipeline.mjs) | 稳定 |
| 免费流水线脚本 | [scripts/run-free-pipeline.mjs](scripts/run-free-pipeline.mjs) | 稳定 |

### 前端 UI

| 功能 | 核心文件 | 状态 |
|------|---------|------|
| React 应用入口 | [ui/src/App.tsx](ui/src/App.tsx) | 稳定 |
| 页面组件 | [ui/src/pages/](ui/src/pages/) | 稳定 |
| API 客户端 | [ui/src/api/](ui/src/api/) | 稳定 |
| UI 组件 | [ui/src/components/](ui/src/components/) | 稳定 |

---

## 计划实现功能

基于代码中的未完成接口、TODO 注释和已有但 UI 未暴露的 API：

| 功能 | 依据 | 优先级建议 |
|------|------|-----------|
| 分镜复制（storyboard replication） | [src/pipeline/types.ts](src/pipeline/types.ts) 中定义 `StoryboardReplicationSettings`，但 UI 未暴露 | 中 |
| 音画同步优化（avSync） | [src/pipeline/stages/avSync.ts](src/pipeline/stages/avSync.ts) 存在 | 低 |
| 节拍对齐（beatAlign） | [src/pipeline/stages/beatAlign.ts](src/pipeline/stages/beatAlign.ts) 存在，未被 defs/ 导入 | 低 |
| 摄像机运动（cameraMotion） | [src/pipeline/stages/cameraMotion.ts](src/pipeline/stages/cameraMotion.ts) 存在 | 低 |
| 音效设计（sfxDesign） | [src/pipeline/stages/sfxDesign.ts](src/pipeline/stages/sfxDesign.ts) 存在，仅在测试中引用 | 低 |
| 全局 LUT（globalLUT） | [src/pipeline/stages/globalLUT.ts](src/pipeline/stages/globalLUT.ts) 存在，未被 defs/ 导入 | 低 |
| 自定义提供者管理 | [src/customProviderStore.ts](src/customProviderStore.ts) 存在 | 中 |
| 提供者健康监控 | [src/adapters/videoProviderHealth.ts](src/adapters/videoProviderHealth.ts) 存在 | 中 |
| 队列检测预设 | [data/queue-detection-presets.json](data/queue-detection-presets.json) 存在 | 低 |

### 已集成的工具模块（非独立阶段，被其他阶段内部调用）

以下模块虽然有独立文件，但已被注册阶段代码集成使用，不需要单独规划：

| 模块 | 文件 | 被调用者 |
|------|------|---------|
| 多候选选择 | [src/pipeline/stages/multiCandidate.ts](src/pipeline/stages/multiCandidate.ts) | `referenceImage.ts`、`videoGen.ts` |
| 色彩校正 | [src/pipeline/stages/colorGrading.ts](src/pipeline/stages/colorGrading.ts) | ASSEMBLY 阶段（`productionStages.ts`） |
| 自适应转场 | [src/pipeline/stages/adaptiveTransitions.ts](src/pipeline/stages/adaptiveTransitions.ts) | ASSEMBLY 阶段（`productionStages.ts`） |
| 编码档位 | [src/pipeline/stages/encodingProfiles.ts](src/pipeline/stages/encodingProfiles.ts) | ASSEMBLY 阶段（`productionStages.ts`） |
| 格式预设 | [src/pipeline/stages/formatPresets.ts](src/pipeline/stages/formatPresets.ts) | ASSEMBLY 阶段（`productionStages.ts`） |
| 时间质量检查 | [src/pipeline/stages/temporalQuality.ts](src/pipeline/stages/temporalQuality.ts) | REFINEMENT 阶段（`productionStages.ts`） |
| 视觉一致性 | [src/pipeline/stages/visualConsistency.ts](src/pipeline/stages/visualConsistency.ts) | `videoGen.ts`、`sceneQuality.ts` |
| 主体隔离 | [src/pipeline/stages/subjectIsolation.ts](src/pipeline/stages/subjectIsolation.ts) | STORYBOARD 阶段（`visualStages.ts`） |
| 角色追踪 | [src/pipeline/stages/characterTracker.ts](src/pipeline/stages/characterTracker.ts) | STORYBOARD 阶段（`visualStages.ts`） |
| 参考图表 | [src/pipeline/stages/referenceSheet.ts](src/pipeline/stages/referenceSheet.ts) | `referenceImage.ts` |
| 视频压缩 | [src/pipeline/stages/videoCompress.ts](src/pipeline/stages/videoCompress.ts) | `styleExtraction.ts` |
| Pollinations 图片 | [src/adapters/chatAdapter.ts](src/adapters/chatAdapter.ts) | ChatAdapter 免费图片生成备选 |

---

## 明确不做的功能

基于项目定位（见 [PROJECT_CONSTITUTION.md](PROJECT_CONSTITUTION.md)）：

| 不做的功能 | 原因 |
|-----------|------|
| 多用户/权限系统 | 单用户本地工具设计 |
| 用户登录/认证 | 无需用户管理 |
| 数据库持久化 | JSON 文件足够，保持简单 |
| 云端部署/托管 | 本地运行优先 |
| 自动发布到社交媒体 | 超出范围，保持专注 |
| 付费订阅/计费 | 非商业平台 |
| 在线协作编辑 | 单用户设计 |
| "一键出片"模式 | 违反人机协作原则 |
| 移动端 App | 桌面工具定位 |
| 实时视频流处理 | 批量生成为主 |
| 多语言 UI | [有国际化计划] |
| 视频模板市场 | 非平台化设计 |
| AI 模型训练/微调 | 使用现有模型，不训练 |
| 视频直播功能 | 非实时应用 |
| 第三方插件系统 | 保持简单，不追求可扩展性 |
| Webhook 集成 | 本地工具，不需要 |
| GraphQL API | REST 足够 |
| gRPC 通信 | HTTP + SSE 足够 |

---

> **维护说明**：
> - 新功能开发前应检查是否在"明确不做"列表中
> - "计划实现"中的功能可根据用户反馈调整优先级
> - "已实现"功能的重构需谨慎评估影响范围
