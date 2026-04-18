# Multimodal Content Compiler — 后端架构文档

本文档用于快速理解编译器后端 (`src/`) 的代码结构、核心职责和扩展方式。

## 1. 总体架构

本系统是一个 **多模态内容编译器 (Multimodal Content Compiler)**，将输入源（topic + 参考视频）通过 15-pass 编译流水线编译为输出二进制（.mp4）。

分层架构：

1. HTTP 接入层：`server.ts` + `routes/*`
2. 编译器门面服务：`pipeline/pipelineService.ts`（CompilerService）
3. 编译编排与基础设施：`pipeline/orchestrator.ts`（CompilationOrchestrator）+ `projectStore / runLock / stageRegistry`
4. 编译 Pass 执行层：`pipeline/stages/*`
5. 编译器后端适配层：`adapters/*`（codegen backends）
6. 中间表示系统：`cir/*`（Canonical Intermediate Representations）

核心设计原则：

- 路由不直接操作编排器内部细节，统一通过 `CompilerService`（PipelineService）门面调用。
- 编译 Pass 通过 `PassRegistry`（stageRegistry）声明式注册，避免在 orchestrator 中硬编码流程。
- `ProjectStore` 是编译产物（Artifact）的原子存储层，每个 project 是一个编译单元。
- `RunLock` 保证同一编译单元同一时刻只运行一次编译。
- `shared/types.ts` 作为前后端共享类型源，减少协议漂移。

## 2. 目录与职责概览（编译器视角）

### 2.1 顶层核心文件

- `server.ts`
  - 后端入口。HTTP 服务器，实例化 Workbench、CompilerService、路由表、SSE 推送。

- `workbench.ts`
  - 自动化工作台主引擎（任务队列、账号轮换、浏览器会话 — 为 chat 后端提供底层支持）。

- `configStore.ts`
  - 编译器配置持久化（质量档位、API Key、TTS 与视频后端配置）。

- `providers.ts` / `providerPresets.ts`
  - 内建编译器后端定义、模型信息与站点自动化预设。

- `dataDir.ts`
  - 编译产物目录解析（跨平台路径与子目录管理）。

### 2.2 路由层（`routes/`）

- `routes/pipeline.ts`
  - 编译器 REST API 集合（当前主入口为 `pipelineRoutesV2`）。
  - 所有操作经由 `CompilerService`，不暴露 orchestrator 内部结构。

- `routes/workbench.ts`
  - Workbench 相关 API（任务、账号、后端管理、上传等）。

- `routes/setup.ts`
  - 首次启动配置 API（初始化状态、配置落盘）。

- `routes/helpers.ts`
  - 通用 HTTP 工具：JSON 输出、body 解析、超大请求保护。

### 2.3 编译器核心层（`pipeline/`）

- `pipelineService.ts`（CompilerService）
  - 编译器门面服务。对路由提供稳定 API，隐藏 orchestrator 与底层依赖。

- `orchestrator.ts`（CompilationOrchestrator）
  - 15-pass 编译编排核心。
  - 负责 Pass 执行、状态推进、事件广播、暂停/恢复、重试、后置质量关卡。

- `stageRegistry.ts`（PassRegistry）
  - Pass 注册中心。
  - 通过 `registerStage/getStageDefinitions/getStageOrder` 管理编译 Pass 执行顺序与实现。

- `projectStore.ts`（编译产物存储）
  - 编译单元（Project）与产物持久化。
  - 采用原子写方式降低异常中断导致的数据损坏风险。

- `runLock.ts`（编译并发锁）
  - 保证同一编译单元同一时刻只有一个编译运行。

- `qualityRouter.ts`（BackendRouter）
  - 编译后端路由策略。
  - 按 `free/balanced/premium` 与任务类型选择后端（chat / API）与模型策略。

- `sessionManager.ts`（后端会话池）
  - 会话分组管理（analysis / creation / visual / production）。
  - 为 LLM 后端提供跨 Pass 上下文复用。

- `providerRegistry.ts`（BackendRegistry）
  - 编译器后端能力注册与查询（可动态更新能力和配额状态）。

- `resourcePlanner.ts`（编译资源规划器）
  - 编译前资源预算（Pass 级后端可行性、成本类别、阻塞项）。

- `observability.ts`（编译诊断服务）
  - 编译过程观测与指标统计（Pass 耗时、调用计数、质量得分等）。

- `costTracker.ts`（编译成本审计）
  - 编译资源消耗跟踪（per-pass、per-backend 成本记录）。

- `safety.ts`（内容 taint analysis）
  - 编译输出安全审查：数值合理性、医疗声明、自杀检测、绝对化表述。

- `types.ts`
  - 编译器域模型与 AIAdapter（后端接口）契约定义。

### 2.4 编译 Pass 实现（`pipeline/stages/`）

编译 Pass 采用「实现文件 + defs 注册文件」模式：

- 实现文件：`stages/*.ts`
  - 每个文件实现一个编译 Pass。

- 注册文件：`stages/defs/*.ts`
  - 按编译阶段分组注册到 `PassRegistry`。
  - `defs/index.ts` 通过副作用 import 完成统一注册。

**15-Pass 编译流水线（编译器术语映射）**：

| Pass | 名称 | 编译器类比 | 输入 → 输出 |
|------|------|-----------|-------------|
| 1 | CAPABILITY_ASSESSMENT | 预编译安全检查 | topic → safety result |
| 2 | STYLE_EXTRACTION | 词法/语法分析 (Lexing) | reference video → StyleAnalysisCIR |
| 3 | RESEARCH | 源材料获取 | topic → ResearchCIR |
| 4 | NARRATIVE_MAP | 语义分析 | calibration → narrative arc |
| 5 | SCRIPT_GENERATION | IR 生成 | CIRs + constraints → ScriptCIR |
| 6 | QA_REVIEW | 优化 Pass | ScriptCIR → quality gates |
| 7 | TEMPORAL_PLANNING | 时序量化 | ScriptCIR + StyleCIR → TemporalPlanCIR |
| 8 | STORYBOARD | IR 降级 (Lowering) | ScriptCIR → StoryboardCIR |
| 9 | VIDEO_IR_COMPILE | **编译屏障 (deepFreeze)** | all CIRs → VideoIR (不可变) |
| 10 | REFERENCE_IMAGE | 视觉 Codegen | VideoIR → reference images |
| 11 | KEYFRAME_GEN | 关键帧 Codegen | VideoIR → keyframe images |
| 12 | VIDEO_GEN | 视频 Codegen | VideoIR → video clips |
| 13 | TTS | 语音 Codegen | VideoIR → audio tracks |
| 14 | ASSEMBLY | 链接 (Linking) | all assets → .mp4 binary |
| 15 | REFINEMENT | 后链接验证 | completeness check + retry |

### 2.5 CIR 系统（`cir/`）

CIR（Canonical Intermediate Representation）是编译器的中间表示层：

- `types.ts` — IR 类型定义（StyleAnalysisCIR、ScriptCIR、StoryboardCIR、ResearchCIR、TemporalPlanCIR、VideoPlanCIR、VideoIR）
- `parsers.ts` — 编译器前端：将不可信 LLM 输出转换为已验证的 CIR + VideoIR 构建器
- `contracts.ts` — Pass 契约：每个 Pass 的输入/输出 CIR 完整性验证 + fail-closed 验证器
- `loader.ts` — CIR 加载网关：fail-closed，缺失/无效 CIR 触发编译错误
- `errors.ts` — 编译错误模型（CIRValidationError、StageContractViolationError）+ deepFreeze() 权威锁

### 2.6 编译器后端层（`adapters/`）

- `chatAdapter.ts` — 免费 chat 后端（Playwright 驱动的浏览器自动化 codegen）
- `geminiAdapter.ts` — 付费 Gemini API 后端（Google GenAI SDK）
- `fallbackAdapter.ts` — 后端故障转移：免费 → 付费自动切换 + 成本安全控制
- `videoProvider.ts` — 视频 codegen 后端（即梦 Web 自动化）
- `ttsProvider.ts` — 语音 codegen 后端（edge-tts / web fallback）
- `ffmpegAssembler.ts` — 链接器（FFmpeg：视频+音频+字幕 → 最终二进制）
- `responseParser.ts` — 后端输出结构化提取
- `imageExtractor.ts` — 从 chat DOM 提取 codegen 输出（图像）
- `schemaValidator.ts` — 后端输出运行时类型检查 + 自动修复

## 3. 关键运行链路（编译请求到输出二进制）

以启动编译为例：

1. 客户端调用 `POST /api/pipeline/:id/start`
2. `routes/pipeline.ts` 调用 `CompilerService.startPipeline`
3. `CompilerService` 转发到 `CompilationOrchestrator.run`
4. Orchestrator 从 `PassRegistry` 拉取 Pass 定义并顺序执行
5. 每个 Pass 通过 `StageRunContext` 访问后端 adapter、CIR 存取、事件上报
6. Pass 结果写入 `ProjectStore`，CIR 落盘，通过 SSE 广播编译进度
7. ASSEMBLY Pass（链接器）调用 FFmpeg 合并所有 codegen 产物
8. 最终输出：编译单元状态、CIR 中间文件、生成资产、可播放 .mp4

## 4. 并发与可靠性设计

- 编译单元级并发锁：`RunLock`
  - 避免同一编译单元并发执行导致状态竞争。

- 原子持久化：`ProjectStore`
  - 先写临时文件再 rename，降低断电/崩溃损坏概率。

- Pass 级 artifact 存储
  - 各 Pass 中间产物（CIR + raw artifacts）独立落盘，支持恢复、重编译、审计。

- 事件总线 + SSE
  - 编译运行状态可实时推送到前端 UI。

## 5. 扩展指南

### 5.1 新增一个编译 Pass

1. 在 `pipeline/stages/` 新增 Pass 实现文件（如 `myPass.ts`）。
2. 在 `pipeline/stages/defs/` 对应分组文件中 `registerStage(...)`。
3. 定义该 Pass 消费和产出的 CIR 类型，在 `cir/contracts.ts` 中添加输入/输出验证。
4. 补充所需 prompt 模板到 `prompts.ts`。
5. 如涉及成本/可行性，更新 `resourcePlanner` 的映射规则。
6. 添加测试用例，覆盖成功/失败/边界场景。

### 5.2 新增一个编译器后端

1. 在 `providers.ts` / `providerPresets.ts` 增加后端定义。
2. 在 `providerRegistry` 注册后端能力画像。
3. 如需新调用方式，新增/扩展 adapter。
4. 在 `qualityRouter`（BackendRouter）中配置任务路由策略。

## 6. 测试与质量现状

- 测试框架：Vitest
- 当前测试覆盖：62 个测试文件，916 个测试（全部通过）
- 编译器静态分析：scriptValidator 10+ 确定性约束（C1-C5 constraint migration 完成）
- 编译 Pass 契约：CIR input/output contracts，fail-closed
- 生产 dry-run：15/15 passes，8/8 验证检查通过

## 7. 维护建议（面向长期）

- 保持路由层"薄"，把业务逻辑持续收敛到 `CompilerService`。
- 避免在 orchestrator 中回退到硬编码 Pass 流程，优先通过 PassRegistry 扩展。
- 任何新 Pass 都要定义清晰的 CIR 输入/输出，便于重编译和审计。
- 对外部后端（浏览器、FFmpeg、第三方 API）统一加超时、重试和可观测埋点。

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
