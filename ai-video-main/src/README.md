# ai-video-main/src 后端介绍文档

本文档用于快速理解 `ai-video-main/src` 的后端代码结构、核心职责和扩展方式，帮助你在后续迭代中保持可维护、可扩展、可并发运行的工程质量。

## 1. 总体架构

当前后端采用分层架构：

1. HTTP 接入层：`server.ts` + `routes/*`
2. 应用服务层：`pipeline/pipelineService.ts`
3. 编排与基础设施层：`pipeline/orchestrator.ts` + `projectStore/runLock/stageRegistry`
4. 领域执行层：`pipeline/stages/*`
5. 外部适配层：`adapters/*`

核心设计原则：

- 路由不直接操作编排器内部细节，统一通过 `PipelineService` 门面调用。
- 流水线阶段通过 `stageRegistry` 声明式注册，避免在 orchestrator 中硬编码大段流程。
- `ProjectStore` 负责原子写盘，`RunLock` 负责按项目维度并发隔离。
- `shared/types.ts` 作为前后端共享类型源，减少协议漂移。

## 2. 目录与职责概览

### 2.1 顶层核心文件

- `server.ts`
  - 后端入口。
  - 负责实例化 Workbench、PipelineService、路由表、SSE 推送、鉴权和 CORS。

- `workbench.ts`
  - 自动化工作台主引擎（任务队列、账号轮换、浏览器会话协作）。

- `configStore.ts`
  - 配置持久化（如质量档位、API Key、TTS 与视频配置）。

- `providers.ts` / `providerPresets.ts`
  - 提供内建 Provider 定义、模型信息与站点自动化预设。

- `dataDir.ts`
  - 数据目录解析（跨平台路径与子目录管理）。

### 2.2 路由层（`routes/`）

- `routes/pipeline.ts`
  - Pipeline REST API 集合（当前主入口为 `pipelineRoutesV2`）。
  - 所有操作经由 `PipelineService`，不暴露 orchestrator 内部结构。

- `routes/workbench.ts`
  - Workbench 相关 API（任务、账号、Provider、上传等）。

- `routes/setup.ts`
  - 首次启动配置相关 API（初始化状态、配置落盘）。

- `routes/helpers.ts`
  - 通用 HTTP 工具：JSON 输出、body 解析、超大请求保护。

### 2.3 Pipeline 核心层（`pipeline/`）

- `pipelineService.ts`
  - Pipeline 门面服务。
  - 对路由提供稳定 API，隐藏 orchestrator 与底层依赖。

- `orchestrator.ts`
  - 13 阶段流水线编排核心。
  - 负责阶段执行、状态推进、事件广播、暂停/恢复、重试、后置质量关卡。

- `stageRegistry.ts`
  - 阶段注册中心。
  - 通过 `registerStage/getStageDefinitions/getStageOrder` 管理执行顺序与阶段实现。

- `projectStore.ts`
  - 项目与产物持久化。
  - 采用原子写方式降低异常中断导致的数据损坏风险。

- `runLock.ts`
  - 并发控制。
  - 保证同一项目同一时刻只有一个 pipeline run。

- `qualityRouter.ts`
  - 质量策略路由。
  - 按 `free/balanced/premium` 与任务类型选择 adapter 与模型策略。

- `sessionManager.ts`
  - 会话分组管理（analysis/creation/visual/production）。
  - 提供多阶段上下文复用能力。

- `providerRegistry.ts`
  - Provider 能力注册与查询（可动态更新能力和配额状态）。

- `resourcePlanner.ts`
  - 执行前资源规划（阶段级 provider 可行性、成本类别、阻塞项）。

- `observability.ts`
  - 运行观测与指标统计（阶段耗时、调用计数、质量得分等）。

- `types.ts`
  - Pipeline 域模型与 AIAdapter 契约定义。

### 2.4 流水线阶段实现（`pipeline/stages/`）

阶段采用「实现文件 + defs 注册文件」模式：

- 实现文件：`stages/*.ts`
  - 例如 capabilityAssessment、styleExtraction、research、narrativeMap、scriptGeneration、storyboard、videoGen、tts、refinement 等。

- 注册文件：`stages/defs/*.ts`
  - 按阶段分组注册到 `stageRegistry`。
  - `defs/index.ts` 通过副作用 import 完成统一注册。

当前主流程阶段顺序：

1. CAPABILITY_ASSESSMENT
2. STYLE_EXTRACTION
3. RESEARCH
4. NARRATIVE_MAP
5. SCRIPT_GENERATION
6. QA_REVIEW
7. STORYBOARD
8. REFERENCE_IMAGE
9. KEYFRAME_GEN
10. VIDEO_GEN
11. TTS
12. ASSEMBLY
13. REFINEMENT

### 2.5 适配器层（`adapters/`）

- `chatAdapter.ts`
  - 基于浏览器自动化的通用 AIAdapter（免费站点路径）。

- `geminiAdapter.ts`
  - Gemini API 适配器（付费 API 路径）。

- `fallbackAdapter.ts`
  - 主备适配器封装，处理配额/限流场景下的降级。

- `videoProvider.ts`
  - 视频生成提供方集成（Web 自动化流程）。

- `ttsProvider.ts`
  - TTS 封装（edge-tts / web fallback）。

- `ffmpegAssembler.ts`
  - 合成最终视频（FFmpeg 调用封装）。

- `responseParser.ts` / `imageExtractor.ts`
  - 响应 JSON 提取、图片结果提取等辅助能力。

## 3. 关键运行链路（请求到产物）

以启动流水线为例：

1. 客户端调用 `POST /api/pipeline/:id/start`
2. `routes/pipeline.ts` 调用 `PipelineService.startPipeline`
3. `PipelineService` 转发到 `PipelineOrchestrator.run`
4. `Orchestrator` 从 `stageRegistry` 拉取阶段定义并顺序执行
5. 每个阶段通过 `StageRunContext` 访问 adapter、artifact 存取、事件上报
6. 阶段结果写入 `ProjectStore`，并通过 SSE 广播进度
7. 最终产出项目状态、资产文件和可下载视频

## 4. 并发与可靠性设计

- 项目级并发锁：`RunLock`
  - 避免同项目并发执行导致状态竞争。

- 原子持久化：`ProjectStore`
  - 先写临时文件再 rename，降低断电/崩溃损坏概率。

- 阶段化 artifact 存储
  - 各阶段中间产物独立落盘，便于恢复、重试、审计。

- 事件总线 + SSE
  - 后端运行状态可实时推送到前端 UI。

## 5. 扩展指南

### 5.1 新增一个流水线阶段

1. 在 `pipeline/stages/` 新增实现文件（如 `myStage.ts`）。
2. 在 `pipeline/stages/defs/` 对应分组文件中 `registerStage(...)`。
3. 补充该阶段依赖的 prompt、artifact 约定与类型。
4. 如涉及成本/可行性，更新 `resourcePlanner` 的映射规则。
5. 添加测试用例，覆盖成功/失败/边界场景。

### 5.2 新增一个 Provider

1. 在 `providers.ts` / `providerPresets.ts` 增加基础定义。
2. 在 `providerRegistry` 注册能力画像。
3. 如需新调用方式，新增/扩展 adapter。
4. 在 `qualityRouter` 中配置任务路由策略。

## 6. 测试与质量现状

- 测试框架：Vitest
- 当前后端测试覆盖：14 个测试文件，123 个测试（最近一次回归均通过）
- 建议继续补齐：adapter 集成测试、stage 级单测、pipelineService 合约测试

## 7. 维护建议（面向长期）

- 保持路由层“薄”，把业务逻辑持续收敛到 `PipelineService`。
- 避免在 orchestrator 中回退到硬编码阶段流程，优先通过 registry 扩展。
- 任何新阶段都要定义清晰输入/输出 artifact，便于重试和审计。
- 对外部依赖（浏览器、FFmpeg、第三方 API）统一加超时、重试和可观测埋点。
- 新增能力时同步更新本文档，确保架构知识与代码演进一致。

## 8. 团队协作文档索引

为便于评审、onboarding 与研发协作，已补充以下文档：

1. 接口与模块依赖图（评审版）
  - [docs/BACKEND_REVIEW_INTERFACE_DEPENDENCY.md](docs/BACKEND_REVIEW_INTERFACE_DEPENDENCY.md)
2. 新同学 10 分钟上手（Onboarding 版）
  - [docs/BACKEND_ONBOARDING_10_MIN.md](docs/BACKEND_ONBOARDING_10_MIN.md)
3. 研发规范（阶段模板、命名、测试清单）
  - [docs/BACKEND_RND_STANDARD.md](docs/BACKEND_RND_STANDARD.md)
4. 测试验收标准（什么才算后端成功）
  - [docs/BACKEND_TEST_ACCEPTANCE.md](docs/BACKEND_TEST_ACCEPTANCE.md)
5. 标准验收流程与脚本执行顺序
  - [docs/BACKEND_ACCEPTANCE_WORKFLOW.md](docs/BACKEND_ACCEPTANCE_WORKFLOW.md)
6. 测试工具入口目录
  - [testing/README.md](testing/README.md)
7. 测试脚本职责矩阵
  - [testing/SCRIPT_RESPONSIBILITY_MATRIX.md](testing/SCRIPT_RESPONSIBILITY_MATRIX.md)
8. 验收报告模板说明
  - [testing/REPORT_TEMPLATE.md](testing/REPORT_TEMPLATE.md)
9. 验收报告目录规范
  - [testing/reports/README.md](testing/reports/README.md)
