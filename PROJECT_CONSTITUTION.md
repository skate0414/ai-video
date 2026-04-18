<!--
生成日期：2026-04-17
基于代码版本：当前 main 分支
本文档由 AI 生成，项目所有者已审核
-->

# ai-video-main 项目宪法

## 一、项目定位

**一句话定义**：一个将 LLM 视为不可信编译器前端的 15 阶段视频生成编译器，通过浏览器自动化最大化利用免费 AI 额度，实现质量可控、成本最低的 AI 视频生产。

**目标用户**：
- 个人内容创作者
- 希望低成本探索 AI 视频生成的开发者

**核心使用场景**：
1. 输入一个主题 + 参考视频 → 输出一部风格一致的 MP4 视频
2. 批量创建多个主题项目，自动排队编译
3. 在关键节点（脚本审核、参考图审批）进行人工干预

## 二、这个项目不是什么

| 不是 | 原因 |
|------|------|
| 商业 SaaS 平台 | 无用户认证系统，无计费逻辑，单用户设计 |
| 多用户协作系统 | 无权限管理，项目文件直接存储在本地 `data/projects/` |
| 一键出片魔法工具 | 刻意设计暂停点，强调人机协作 |
| 付费 API 封装器 | 核心理念是免费优先，API 仅作降级备选 |
| 通用 AI Agent 框架 | 专注视频生成领域，不追求通用性 |
| 云端部署服务 | 本地运行优先，依赖 Playwright 浏览器自动化 |

## 三、核心原则

### 原则 1：人机协作优于全自动

**代码体现**：
- [src/pipeline/projectStore.ts#L58](src/pipeline/projectStore.ts#L58)：`pauseAfterStages: ['QA_REVIEW', 'STORYBOARD', 'REFERENCE_IMAGE']` — 默认设置 3 个暂停点
- [shared/types.ts#L15-L30](shared/types.ts#L15-L30)：流水线设计为 15 个可暂停阶段
- `reviewStatus` 字段：场景需要人工审批后才能继续

**含义**：系统鼓励用户在关键节点介入审核，而非追求端到端全自动。

### 原则 2：免费优先，付费降级

**代码体现**：
- [src/adapters/chatAdapter.ts](src/adapters/chatAdapter.ts)：`ChatAdapter` 作为主力编译后端，通过 Playwright 驱动免费 AI 聊天
- [src/adapters/geminiAdapter.ts](src/adapters/geminiAdapter.ts)：`GeminiAdapter` 仅作为付费备选
- [src/pipeline/qualityRouter.ts](src/pipeline/qualityRouter.ts)：质量路由策略，`free` 档优先使用 chat 后端
- [package.json](package.json)：生产依赖仅 `@google/genai` 和 `undici`，无付费服务强依赖

**含义**：默认使用浏览器自动化获取免费 AI 额度，API 调用仅在免费资源不可用时降级使用。

### 原则 3：LLM 是不可信的编译器前端

**代码体现**：
- [src/cir/types.ts](src/cir/types.ts)：定义 7 种类型化中间表示（CIR），所有 LLM 输出必须转换为 CIR 后才能被下游使用
- [src/cir/contracts.ts](src/cir/contracts.ts)：CIR 契约验证，确保 LLM 输出符合预期结构
- [src/pipeline/stages/videoIRCompile.ts](src/pipeline/stages/videoIRCompile.ts)：VideoIR 作为编译屏障，冻结所有下游依赖的数据

**含义**：不直接信任 LLM 输出，必须经过验证和类型转换才能进入下游阶段。

### 原则 4：单次生成 + 降级策略，无复杂重试循环

**代码体现**：
- [src/pipeline/stageRetryWrapper.ts](src/pipeline/stageRetryWrapper.ts)：简单的阶段级重试，而非递归重试循环
- [src/pipeline/stateMachine.ts](src/pipeline/stateMachine.ts)：状态机只允许 `pending → processing → completed/error`，error 只能回到 pending 重试
- [src/adapters/fallbackAdapter.ts](src/adapters/fallbackAdapter.ts)：简单的备选适配器机制

**含义**：出错时优先降级或暂停等待人工处理，而非无限重试导致资源浪费。

### 原则 5：单用户、本地运行

**代码体现**：
- [src/pipeline/projectStore.ts](src/pipeline/projectStore.ts)：项目存储为本地 JSON 文件，无数据库
- [src/dataDir.ts](src/dataDir.ts)：数据目录解析优先本地路径
- 无任何用户认证/授权代码

**含义**：设计为个人桌面工具，不考虑多租户隔离。

### 原则 6：编译器隐喻统一架构

**代码体现**：
- [src/README.md](src/README.md)：明确定义为"多模态内容编译器"
- [docs/COMPILER_ARCHITECTURE.md](docs/COMPILER_ARCHITECTURE.md)：完整的编译器架构文档
- 代码命名：`CompilationOrchestrator`、`PassRegistry`、`CIR`、`VideoIR`、`codegen`

**含义**：用编译器概念统一整个架构：LLM 是 parser，CIR 是 IR，FFmpeg 是 linker，.mp4 是 binary。

## 四、不可改变的设计决策

### 4.1 流水线阶段设计（15 阶段）

定义于 [shared/types.ts#L7-L22](shared/types.ts#L7-L22)：

```
CAPABILITY_ASSESSMENT → STYLE_EXTRACTION → RESEARCH → NARRATIVE_MAP →
SCRIPT_GENERATION → QA_REVIEW → TEMPORAL_PLANNING → STORYBOARD →
VIDEO_IR_COMPILE → REFERENCE_IMAGE → KEYFRAME_GEN → VIDEO_GEN →
TTS → ASSEMBLY → REFINEMENT
```

**锁定原因**：15 个阶段被多个模块依赖（stageRegistry、stateMachine、projectStore、前端 UI），改变顺序或合并阶段会导致大范围修改。

### 4.2 暂停点设计

定义于 [src/pipeline/projectStore.ts#L58](src/pipeline/projectStore.ts#L58)：

- `QA_REVIEW` 后暂停：脚本审核
- `STORYBOARD` 后暂停：分镜审核
- `REFERENCE_IMAGE` 后暂停：参考图审批

**锁定原因**：暂停点实现了人机协作原则，是核心用户体验的一部分。

### 4.3 持久化策略

- **项目数据**：JSON 文件存储于 `data/projects/{projectId}/project.json`
- **原子写入**：[src/pipeline/projectStore.ts#L30-L35](src/pipeline/projectStore.ts#L30-L35) 使用临时文件 + rename 保证原子性
- **配置存储**：`data/config.json`
- **资源存储**：`data/resources.json`

**锁定原因**：JSON 文件存储是"无数据库"原则的实现，改为数据库会违反项目定位。

### 4.4 错误处理哲学

- 阶段状态机只允许 `pending → processing → completed/error`
- 错误后状态为 `error`，需要手动或自动触发重试回到 `pending`
- 不实现复杂的错误恢复逻辑，优先暂停等待人工处理
- 安全违规（`SafetyBlockError`）不可重试

### 4.5 AI 调用方式

- **Chat 自动化**（[src/adapters/chatAdapter.ts](src/adapters/chatAdapter.ts)）：主力后端，通过 Playwright 驱动 Gemini/ChatGPT/DeepSeek 网页
- **API 调用**（[src/adapters/geminiAdapter.ts](src/adapters/geminiAdapter.ts)）：付费降级选项，使用 `@google/genai` SDK
- **会话管理**（[src/pipeline/sessionManager.ts](src/pipeline/sessionManager.ts)）：跨阶段复用聊天上下文（analysis/creation/visual/production 四组）

### 4.6 CIR（编译中间表示）体系

定义于 [src/cir/types.ts](src/cir/types.ts)：

| CIR | 产生阶段 | 作用 |
|-----|---------|------|
| StyleAnalysisCIR | STYLE_EXTRACTION | 视觉/脚本/音频风格 |
| ResearchCIR | RESEARCH | 事实/神话/词汇表 |
| ScriptCIR | SCRIPT_GENERATION | 句子级脚本 |
| StoryboardCIR | STORYBOARD | 分镜结构 |
| TemporalPlanCIR | TEMPORAL_PLANNING | 时间规划 |
| VideoIR | VIDEO_IR_COMPILE | 冻结的生产计划（编译屏障） |

**锁定原因**：CIR 是"LLM 不可信"原则的实现，是架构的核心。

## 五、质量红线

### 5.1 测试要求

- **测试框架**：Vitest（[vitest.config.ts](vitest.config.ts)）
- **现有测试文件**：121 个 `*.test.ts` 文件
- **覆盖率阈值**（[vitest.config.ts#L11-L16](vitest.config.ts#L11-L16)）：
  - Lines: 40%
  - Functions: 35%
  - Branches: 30%
  - Statements: 40%

### 5.2 类型安全要求

- **TypeScript 严格模式**：[tsconfig.json#L6](tsconfig.json#L6) `"strict": true`
- **目标版本**：ES2023
- **构建检查**：`tsc --noEmit`（不生成 JS 文件，仅类型检查）

### 5.3 构建要求

- Node.js ≥ 20.9.0（[package.json#L8](package.json#L8)）
- `npm run build` 必须通过（类型检查）
- `npm run typecheck` 检查前后端类型

## 六、禁止事项

### 技术层面禁止

| 禁止 | 原因 |
|------|------|
| 引入数据库（MySQL/PostgreSQL/MongoDB） | JSON 文件足够，符合单用户本地运行定位 |
| 引入 ORM（Prisma/TypeORM） | 不用数据库 |
| 引入 Python | 保持单一语言栈（TypeScript） |
| 引入 Docker 强依赖 | 本地开发工具，不需要容器化 |
| 引入云服务 SDK（AWS/GCP/Azure） | 本地运行优先 |
| 引入付费依赖 | 免费优先原则 |
| 引入复杂状态管理（Redux/MobX） | React hooks + 本地状态足够 |

### 功能层面禁止

| 禁止 | 原因 |
|------|------|
| 用户登录/认证系统 | 单用户设计 |
| 多用户权限管理 | 单用户设计 |
| 自动发布到社交媒体 | 超出范围，保持专注 |
| "一键出片"功能 | 违反人机协作原则 |
| 在线协作编辑 | 单用户本地工具 |
| 付费订阅/计费逻辑 | 非商业平台 |

---

> **维护说明**：本宪法是项目的根本约束，任何重大架构变更前应先评估是否违反上述原则。如需修改宪法本身，应由项目所有者明确批准并记录变更原因。
