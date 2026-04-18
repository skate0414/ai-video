# Multimodal Content Compiler — 全仓深度审查 + 商业化交付整改报告

> 审计日期: 2026-04-10  
> 最后更新: 2026-04-10 (P3 FINALIZATION — Console迁移 + Schema版本 + TaskQueue持久化)  
> 审计范围: 全仓 80+ 源文件, 约 20,000 行 TypeScript + 8 Electron 文件 + React UI  
> 审计视角: Electron 架构 / 编译器流水线 / Playwright 自动化 / 安全 / 商业化交付

---

## 整改进度总览

| 优先级 | 总项 | 已完成 | 进行中 | 待处理 |
|--------|------|--------|--------|--------|
| **P0** | 5 | 5 | 0 | 0 |
| **P1** | 7 | 7 | 0 | 0 |
| **P0-R** | 5 | 5 | 0 | 0 |
| **P1-R** | 7 | 5 | 0 | 2 |
| **P2** | 8 | 8 | 0 | 0 |
| **P2-R** | 5 | 5 | 0 | 0 |
| **CIR-A** | 3 | 3 | 0 | 0 |
| **P3** | 3 | 3 | 0 | 0 |

**已完成关键修复：**
- ✅ FFmpeg/TTS 命令注入 → `execFile()`/`spawn()` + `pathSafety.ts`
- ✅ 并发项目状态隔离 → `ProjectRunState` 局部对象
- ✅ QA_REVIEW fail-safe → `QaReviewParseError` fail-closed
- ✅ AI 调用超时/中止 → `aiControl.ts` 统一包装
- ✅ Electron 自动化认证 → Bearer token
- ✅ 选择器链规范化 → `selectorToChain/chainToSelector`
- ✅ 浏览器 double-release 防护
- ✅ 资源 round-robin 轮转
- ✅ 调试截图定期清理 → `cleanupDebugScreenshots()`
- ✅ SSE 指数退避重连
- ✅ Workbench `submitAndWait()` 会话隔离
- ✅ ChatAdapter.generateVideo() 抛错启用降级链 → FallbackAdapter
- ✅ TaskQueue 状态机校验 + 容量上限 (10,000)
- ✅ CostTracker 原子写入 (write-then-rename)
- ✅ FFmpeg data-URL 临时文件追踪清理
- ✅ 结构化日志 → `lib/logger.ts` + orchestrator/configStore/tts/loggingAdapter 已迁移
- ✅ 废弃 accountManager.ts 死代码清除
- ✅ Vitest 覆盖率门槛配置 (lines: 40%, functions: 35%)
- ✅ ConfigStore 运行时 schema 校验 (validateConfig)
- ✅ TTS 并发控制从 busy-wait 改为信号量
- ✅ 选择器格式统一 — workbench 不再依赖 DEFAULT_PROVIDERS
- ✅ Pipeline 阶段状态机 → `stateMachine.ts` 强制合法转换 (P2-R1)
- ✅ SessionManager 持久化 → `sessions.json` 原子写入 + orchestrator 加载/保存 (P2-R3)
- ✅ TempFileTracker 生命周期管理 → `lib/tempFiles.ts` + orchestrator finally 清理 (P2-R4)
- ✅ Docker 生产化 → `.dockerignore` / `USER node` / `HEALTHCHECK` / `VOLUME /data` (P2-R5)
- ✅ Pipeline 阶段 console.* 迁移至结构化日志 (67 calls → slog.debug/info/warn/error)
- ✅ StyleProfile 合约强制执行 → `styleContract.ts` (CRITICAL/IMPORTANT/OPTIONAL 分层校验 + 定向补全重试 + 可计算字段覆盖 AI 猜测 + 置信度感知下游容差)
- ✅ CIR 架构：5 种 CIR 类型 + 13 阶段合约注册表 + 5 解析器 + `enforceContract()` 编排
- ✅ CIR Consumption：5 阶段 (SCRIPT_GENERATION/STORYBOARD/VIDEO_GEN/TTS/ASSEMBLY) 全部改为消费经验证的 CIR，消除 ~48 处原始 `styleProfile`/`scriptOutput` 字段读取
- ✅ CIR Loader Gateway → `src/cir/loader.ts` 集中式加载/校验/错误构造，消除 3 个 stage def 文件中 6 个重复 helper
- ✅ Console 日志迁移收尾 → chatAutomation (65) + workbench (31) + ttsProvider (1) 共 97 处 console.* → 结构化日志
- ✅ Config Schema 版本控制 → `_schemaVersion` + `migrateConfig()` 迁移链 + 原子写入
- ✅ TaskQueue 持久化 → `saveTo/loadFrom` 原子写入 + running→pending 降级 + done/failed 过滤

---

## 第一阶段：全仓扫描

### 1.1 仓库总体结构

```
ai-video-main/
├── src/                          # 后端核心（~15,000 LOC）
│   ├── server.ts                 # HTTP 入口 (280L)
│   ├── workbench.ts              # 工作台引擎 (~1,395L) ← God Class (submitAndWait 已隔离)
│   ├── chatAutomation.ts         # 浏览器自动化 (~1,500L) ← 最大文件 (含截图清理)
│   ├── browserManager.ts         # 浏览器生命周期 (271L) ✅ double-release 防护
│   ├── electronBridge.ts         # Electron CDP 桥接 (507L) ✅ Bearer auth
│   ├── configStore.ts            # 配置持久化 (173L) ✅ 运行时 schema 校验 + schema 版本控制 + 原子写入
│   ├── resourceManager.ts        # 资源/账号管理 (332L) ✅ round-robin
│   ├── accountManager.ts         # 🟢 已删除（死代码清除）
│   ├── taskQueue.ts              # 任务队列 (~180L) ✅ 状态机校验 + 容量上限 + saveTo/loadFrom 持久化
│   ├── rateLimiter.ts            # 限流器 (86L) ✅
│   ├── quotaBus.ts               # 配额事件总线 (103L)
│   ├── selectorResolver.ts       # 选择器解析 (264L) ✅ selectorToChain/chainToSelector
│   ├── providers.ts              # 提供者定义 (105L) — DEFAULT_PROVIDERS 已废弃不再使用
│   ├── providerPresets.ts        # 提供者预设 (303L)
│   ├── constants.ts              # 环境配置常量 (111L)
│   ├── types.ts / shared/types.ts
│   │
│   ├── pipeline/                 # 流水线编排层（17 文件, 4,549L）
│   │   ├── orchestrator.ts       # 编排引擎 (~1,007L) ✅ ProjectRunState 隔离
│   │   ├── pipelineService.ts    # 外观层 (428L)
│   │   ├── stageRegistry.ts      # 阶段注册 (85L)
│   │   ├── stageRetryWrapper.ts  # 重试包装 (118L)
│   │   ├── runLock.ts            # 并发锁 (65L)
│   │   ├── projectStore.ts       # 项目持久化 (112L) ✅原子写入
│   │   ├── aiControl.ts          # AI 调用超时/中止 (254L) ✅新增
│   │   ├── sessionManager.ts     # 会话管理 (151L) ⚠️纯内存
│   │   ├── observability.ts      # 遥测 (202L) ⚠️纯内存
│   │   ├── qualityRouter.ts      # 质量路由 (275L)
│   │   ├── costTracker.ts        # 成本追踪 (240L) ✅原子写入
│   │   ├── resourcePlanner.ts    # 资源规划 (263L)
│   │   ├── providerRegistry.ts   # 能力注册 (291L)
│   │   ├── prompts.ts            # 提示词模板 (669L)
│   │   ├── safety.ts             # 安全中间件 (159L)
│   │   ├── loggingAdapter.ts     # 日志适配 (150L) ✅ 结构化日志
│   │   └── styleLibrary.ts       # 风格模板库 (58L)
│   │
│   ├── cir/                      # CIR 中间表示层（7 文件）
│   │   ├── types.ts              # 5 种 CIR 接口 + AnyCIR 联合
│   │   ├── errors.ts             # CIRValidationError / StageContractViolationError / AIParseError
│   │   ├── contracts.ts          # 13 阶段合约注册表 + enforceContract() + 4 CIR 验证器
│   │   ├── parsers.ts            # 5 解析器 (StyleProfile→CIR, ScriptOutput→CIR, etc.)
│   │   ├── loader.ts             # ✅ 集中式 CIR Loader Gateway (loadStyleCIR/loadScriptCIR/loadStoryboardCIR)
│   │   ├── index.ts              # barrel 导出
│   │   ├── cir.test.ts           # 80 测试 (合约/解析器/验证器/消费场景)
│   │   └── loader.test.ts        # 14 测试 (加载/缺失/无效标签/校验失败)
│   │
│   ├── pipeline/stages/          # 13 阶段实现（27 文件, ~2,500L）
│   │   ├── defs/                 # 阶段注册定义（4 组）— CIR 消费通过 loader.ts gateway
│   │   ├── capabilityAssessment  # → STYLE_EXTRACTION → RESEARCH
│   │   ├── narrativeMap          # → SCRIPT_GENERATION → QA_REVIEW
│   │   ├── storyboard            # → REFERENCE_IMAGE → KEYFRAME_GEN
│   │   └── videoGen → TTS → ASSEMBLY → REFINEMENT
│   │
│   ├── adapters/                 # 适配器层（10 文件, 4,049L）
│   │   ├── chatAdapter.ts        # 浏览器聊天 AI (~550L) ✅ generateVideo 降级
│   │   ├── geminiAdapter.ts      # Gemini API (326L) ✅ abort-aware
│   │   ├── fallbackAdapter.ts    # 降级适配 (256L)
│   │   ├── ffmpegAssembler.ts    # 视频合成 (~491L) ✅ execFile + 临时文件清理
│   │   ├── ttsProvider.ts        # TTS 语音 (177L) ✅ execFile 安全化
│   │   ├── videoProvider.ts      # 视频生成自动化 (1,432L) ←🔴 第二大文件
│   │   ├── videoProviderHealth.ts # 健康监控 (245L)
│   │   ├── responseParser.ts     # 响应解析 (148L) ✅
│   │   ├── schemaValidator.ts    # Schema 验证 (265L) ✅
│   │   └── imageExtractor.ts     # 图片提取 (353L)
│   │
│   ├── routes/                   # HTTP 路由
│   └── testing/                  # 测试基础设施
│
├── browser-shell/                # Electron 桌面壳（8 文件）
│   ├── main.ts                   # Electron 主进程
│   ├── preload.ts                # 安全预加载
│   ├── backend-launcher.ts       # 后端子进程管理
│   ├── automation-server.ts      # 自动化控制 HTTP ✅ Bearer token 认证
│   ├── session-manager.ts        # 会话隔离
│   ├── tab-manager.ts            # 标签管理
│   └── stealth-preload.ts        # 反检测系统
│
├── ui/                           # React 前端
│   └── src/
│       ├── api/sse.ts            # SSE 连接 ✅ 指数退避重连
│       ├── hooks/usePipeline.ts  # SSE 驱动流水线状态
│       ├── pages/                # 6 页面
│       └── components/           # 17 组件
│
├── lib/
│   ├── pathSafety.ts             # 路径安全验证 ✅新增
│   ├── logger.ts                 # 结构化日志 ✅新增
│   ├── sanitize.ts               # 文本清洗
│   └── tempFiles.ts              # ✅ 临时文件生命周期
│
├── cir/                          # ✅ CIR 中间表示层
│   ├── types.ts                  # 5 种 CIR 接口
│   ├── contracts.ts              # 13 阶段合约 + 4 CIR 验证器
│   ├── parsers.ts                # 5 解析器
│   ├── loader.ts                 # ✅ 集中式 CIR Loader Gateway
│   ├── errors.ts                 # 3 类型化错误
│   └── index.ts                  # barrel 导出
│
└── data/                         # 静态配置数据
```

### 1.2 核心资产 vs 技术债

| 分类 | 目录/文件 | 说明 |
|------|----------|------|
| **核心资产** | `pipeline/*` | 流水线编排、阶段定义、质量路由、项目持久化 |
| **核心资产** | `adapters/*` | AI 适配器、FFmpeg、TTS、视频生成 |
| **核心资产** | `browser-shell/*` | Electron 壳、会话隔离、标签管理 |
| **核心资产** | `ui/` | React 前端完整度高 |
| **技术债** | `workbench.ts` (~1,395L) | God Class，8+ 职责混杂 (submitAndWait 已隔离) |
| **技术债** | `chatAutomation.ts` (~1,500L) | 最大文件，uploadFiles 240+ 行 4 层嵌套 |
| **技术债** | `videoProvider.ts` (1,432L) | 第二大文件，需拆分 |
| **技术债** | `accountManager.ts` | ✅ 已删除（完全被 resourceManager 取代，死代码） |
| **技术债** | `providers.ts` | DEFAULT_PROVIDERS 已废弃，workbench 不再引用 ✅ |
| **技术债** | `taskQueue.ts` | 纯内存、无持久化 (已有状态机 + 容量上限) |
| **临时拼接** | `testing/scripts/` | 16 个手动脚本，未进 CI |

### 1.3 模块耦合分析

**高耦合（需优先解耦）：**
1. **Workbench ↔ 所有模块** — 直接依赖 browserManager、chatAutomation、providers、providerPresets、selectorResolver、quotaBus 等 10+ 模块
2. ~~**orchestrator ↔ chatAdapter** — `getSessionAwareAdapter()` 直接 mutate 共享 chatAdapter 的 config~~ ✅ 已通过 `ProjectRunState` 解耦
3. ~~**选择器双轨制** — `providers.ts` 的 flat string vs `providerPresets.ts` 的 SelectorChain[]~~ ✅ workbench 已统一使用 providerPresets，DEFAULT_PROVIDERS 不再被引用

**低耦合（设计良好）：**
- `projectStore.ts` — 原子写入，职责单一
- `rateLimiter.ts` — 零依赖
- `stageRegistry.ts` — 简洁的注册模式
- `responseParser.ts` / `schemaValidator.ts` — 纯函数

### 1.4 优先重构排序

| 优先级 | 模块 | 原因 |
|--------|------|------|
| **1** | `workbench.ts` | God Class，所有自动化任务的瓶颈 |
| **2** | `videoProvider.ts` | 1,432L，视频生成是最不稳定的环节 |
| ~~**3**~~ | ~~`adapters/ffmpegAssembler.ts` + `ttsProvider.ts`~~ | ✅ 命令注入已修复 |

---

## 第二阶段：13 步流水线映射

### 2.1 实际流水线 vs 用户理解的流水线

| # | 用户理解 | 实际阶段 | 实现文件 | 机制 | 稳定性 |
|---|---------|---------|---------|------|--------|
| 1 | 输入主题 | — | 前端创建项目 | REST API | ✅ 高 |
| 2 | 大纲生成 | CAPABILITY_ASSESSMENT | capabilityAssessment.ts (79L) | Gemini API | ✅ 高 |
| 3 | — | STYLE_EXTRACTION | styleExtraction.ts (205L) + cvPreprocess.ts + videoCompress.ts | Gemini API + FFmpeg | 🟡 中 |
| 4 | — | RESEARCH | research.ts (94L) + factVerification.ts (133L) | Gemini API + Google 搜索 | 🟡 中 |
| 5 | — | NARRATIVE_MAP | narrativeMap.ts (113L) + calibration.ts (68L) | Gemini API | ✅ 高 |
| 6 | 脚本生成 | SCRIPT_GENERATION | scriptGeneration.ts (223L) + scriptValidator.ts (121L) + scriptAudit.ts (159L) | Gemini API + 纯逻辑 | ✅ 高 |
| 7 | — | QA_REVIEW ⏸ | qaReview.ts (98L) | Gemini API | ✅ **已修复** (fail-closed) |
| 8 | 分镜/提示词 | STORYBOARD ⏸ | storyboard.ts (136L) + subjectIsolation.ts (140L) | Gemini API | 🟡 中 |
| 9 | 素材生成 | REFERENCE_IMAGE ⏸ | referenceImage.ts (224L) + referenceSheet.ts (84L) | Gemini API | 🟡 中 |
| 10 | — | KEYFRAME_GEN | keyframeGen.ts (127L) | Gemini API | 🟡 中 |
| 11 | 视频生成 | VIDEO_GEN | videoGen.ts (255L) + videoProvider.ts (1,432L) | **浏览器自动化** | 🔴 **低** |
| 12 | 配音生成 | TTS | tts.ts (71L) + ttsProvider.ts (177L) | edge-tts CLI / Gemini | ✅ 高 |
| 13 | 剪辑拼接 | ASSEMBLY | productionStages.ts + ffmpegAssembler.ts (~491L) + finalRiskGate.ts (113L) | FFmpeg | ✅ 高 |
| 14 | 质检 | REFINEMENT | refinement.ts (64L) | 纯逻辑 | ✅ 高 |

### 2.2 关键发现

**1. 输入输出契约 — 部分清晰：**
- ✅ 每阶段通过 `StageRunContext` 接收 adapter + project + 工具函数
- ✅ 产物通过 `saveArtifact()` / `saveScenes()` 持久化
- ⚠️ ~~阶段间数据传递依赖 `project.scriptOutput` / `project.scenes` 等 mutable 字段，无不可变快照~~ ✅ 5 个消费阶段已通过 CIR (`style-analysis.cir.json` / `script.cir.json` / `storyboard.cir.json`) 传递不可变快照（SCRIPT_GENERATION / STORYBOARD / VIDEO_GEN / TTS / ASSEMBLY），mutable `project.*` 字段仅用于非 CIR 化的可选字段和输出传输

**2. 强耦合阶段：**
- SCRIPT_GENERATION → QA_REVIEW → STORYBOARD：QA 失败会触发脚本重新生成，形成反馈循环
- REFERENCE_IMAGE → KEYFRAME_GEN → VIDEO_GEN：视觉风格一致性链，任何中间失败都影响最终效果

**3. 单步失败导致整单失败的阶段：**
- CAPABILITY_ASSESSMENT — 安全门可直接 `SafetyBlockError` 终止整条流水线
- SCRIPT_GENERATION — 脚本是后续所有阶段的基础
- ASSEMBLY — FFmpeg 不可用则无法输出视频

**4. 缺少局部重试的阶段：**
- ~~QA_REVIEW — 解析失败时**自动通过**而非重试~~ ✅ 已修复：解析失败抛出 QaReviewParseError
- KEYFRAME_GEN — 有重试但退避间隔固定
- CAPABILITY_ASSESSMENT — 无重试策略

**5. 最影响视频质量的 5 个阶段：**
1. **SCRIPT_GENERATION** — 脚本决定内容质量
2. **VIDEO_GEN** — 视频素材质量直接决定成片效果
3. **REFERENCE_IMAGE** — 风格一致性锚点
4. **TTS** — 配音质量影响观看体验
5. **ASSEMBLY** — 字幕、BGM、时序由 FFmpeg 控制

**6. 最影响成本的 5 个阶段：**
1. **VIDEO_GEN** — 浏览器自动化 + 外部平台配额
2. **REFERENCE_IMAGE** — API 图片生成 $0.02/张 × 30-60 张
3. **KEYFRAME_GEN** — API 图片生成
4. **SCRIPT_GENERATION** — 多轮重试 + 审计 = 3-6 次 API 调用
5. **RESEARCH** — Google 搜索 grounding 额外成本

**7. 最容易因 UI 自动化变化失效的阶段：**
1. **VIDEO_GEN** — 完全依赖即梦/可灵 Web UI DOM 结构
2. **REFERENCE_IMAGE**（聊天模式下）— 依赖浏览器聊天 UI 图片提取
3. **STYLE_EXTRACTION**（聊天模式下）— 依赖浏览器聊天 UI

---

## 第三阶段：结构性问题深挖

### 🔴 P0 — 会阻塞商业化的结构性问题

#### P0-1: FFmpeg / TTS 命令注入漏洞 ✅ 已完成
- **位置**: [ffmpegAssembler.ts](../adapters/ffmpegAssembler.ts) L316-327、[ttsProvider.ts](../adapters/ttsProvider.ts) L92-110
- **问题**: 使用 `exec()` (shell 模式) 而非 `execFile()` (数组参数模式)，文件路径通过字符串模板直接拼入命令
- ffmpegAssembler: `await execAsync(\`\${FFMPEG_BIN} \${args}\`)` — 每个 ffmpeg 命令都经过 shell 解释
- ttsProvider: `edge-tts --voice "\${voice}" --text '\${sanitizedText}'` — voice 参数未消毒
- **影响**: 恶意文件名或 voice 参数可执行任意系统命令
- **分类**: **安全漏洞** + 商业化阻塞
- **✅ 修复方案**: `exec()` 替换为 `execFile()`/`spawn()`, 新增 `src/lib/pathSafety.ts` 共享路径验证，已添加安全测试

#### P0-2: 共享可变状态 — 并发项目互相污染 ✅ 已完成
- **位置**: [orchestrator.ts](../pipeline/orchestrator.ts) 的 `currentProjectId`、`currentProjectDir`、`preCompletedStages`
- **问题**: 这些都是实例级单字段。如果两个项目同时运行（RunLock 以 projectId 为粒度，不同 ID 可并行），它们会互相覆盖
- `getSessionAwareAdapter()` 直接 mutate 共享的 `this.chatAdapter.config.sessionId` — 跨项目会话污染
- **影响**: 日志写入错误目录、会话交叉、不可预测行为
- **分类**: **数据完整性 Bug** + 商业化阻塞
- **✅ 修复方案**: 引入 `ProjectRunState` 局部对象取代单例字段, `run()` 入口创建并通过参数传递

#### P0-3: QA_REVIEW 解析失败时自动通过 ✅ 已完成
- **位置**: [qaReview.ts](../pipeline/stages/qaReview.ts) L63
- **问题**: AI 返回非 JSON 响应时，QA 审核自动批准脚本通过。这意味着质量最差的响应（AI 完全无法理解请求）反而会获得通过
- **应该**: 默认 fail-safe (拒绝 + 重试)
- **影响**: 低质量脚本进入后续阶段，浪费生成成本
- **分类**: **质量控制缺陷** + 商业化阻塞
- **✅ 修复方案**: 解析失败时抛出 `QaReviewParseError` (fail-closed), 由 stageRetryWrapper 处理重试

#### P0-4: 无 AI 调用超时机制 ✅ 已完成
- **位置**: 所有 13 个阶段
- **问题**: 没有任何阶段对 `adapter.generateText()` / `adapter.generateImage()` 设置超时。如果 Gemini API 或浏览器聊天挂起，整个阶段无限阻塞
- **影响**: 流水线悬挂、用户体验崩坏、资源浪费
- **分类**: **稳定性缺陷** + 商业化阻塞
- **✅ 修复方案**: 新增 `src/pipeline/aiControl.ts` 提供 `runWithAICallControl()` 超时/中止包装器, chatAdapter 和 geminiAdapter 已集成

#### P0-5: Electron 自动化控制服务器无认证 ✅ 已完成
- **位置**: [automation-server.ts](../../browser-shell/src/automation-server.ts) 端口 3221
- **问题**: 本地 HTTP 服务器接受任何进程的请求，可创建/关闭/操控浏览器标签
- **影响**: 本地特权提升，恶意软件可操纵浏览器会话
- **分类**: **安全漏洞** + 商业化阻塞（企业客户安全审计不通过）
- **✅ 修复方案**: 启动时生成 32 字节随机 Bearer token, 通过 `ELECTRON_AUTOMATION_TOKEN` 环境变量传递, 每个请求验证 Authorization 头

### 🟡 P1 — 结构性问题

#### P1-1: Workbench God Class (1,354 行, 8+ 职责) ✅ 部分完成
- **位置**: [workbench.ts](../workbench.ts)
- **职责混杂**: 浏览器生命周期、登录会话、提供者管理、模型检测、选择器管理、健康监控、任务处理循环、流水线集成、状态序列化
- **具体问题**:
  - `submitAndWait()` 临时修改 `this.chatMode` — 并发调用互相覆盖
  - `processLoop()` 调用 `ensureBrowser()` 时启动 fire-and-forget 自动检测
  - `closeBrowser()` 使用 `execSync('lsof +D ...')` 杀进程 — macOS/Linux only
- **影响**: 无法单独测试/修改任何一个子功能，改一处影响全局
- **✅ 已修复**: `submitAndWait()` 不再修改全局 `chatMode`, 改为任务级别的 `TaskItem.chatMode`/`TaskItem.sessionId`
- **⚠️ 待完成**: God Class 拆分为 browserPool/loginManager/selectorManager 等子模块

#### P1-2: 选择器双轨制 — 6+ 文件两种格式 ✅ 已完成
- **位置**: `providers.ts` (flat string) vs `providerPresets.ts` (SelectorChain[]) vs `shared/types.ts` (AiResource.selectors: string / SiteAutomationConfig.selectors: SelectorChain[])
- **问题**: 选择器在不同层级用不同数据结构表示，转换时信息丢失 (`chainToSelector()` 丢失 text/role/xpath 方法)
- **影响**: 新增提供者需要在多处同步更新，容易遗漏
- **✅ 修复方案**: `selectorResolver.ts` 实现 `selectorToChain/chainToSelector` 双向转换, 选择器链格式已规范化

#### P1-3: video provider 聊天模式 generateVideo() 返回占位符 ✅ 已完成
- **位置**: [chatAdapter.ts](../adapters/chatAdapter.ts) L473-481
- **问题**: `generateVideo()` 返回 `{ text: '[Video generation pending]' }`，从不抛错。FallbackAdapter 无法触发 chat→API 降级
- **影响**: 视频生成降级链断裂
- **✅ 修复方案**: `generateVideo()` 抛出 `ChatVideoUnsupportedError` (带 `isQuotaError=true`), FallbackAdapter 自动识别并触发 API 降级

#### P1-4: 资源轮转实现为“总是选第一个”而非真正轮转 ✅ 已完成
- **位置**: [resourceManager.ts](../resourceManager.ts) L163
- **问题**: `pickResource()` 总是返回 `available[0]`，注释写着 "round-robin" 但实际是 first-available
- **影响**: 第一个账号总是被优先消耗直到配额耗尽，无法均衡使用多账号
- **✅ 修复方案**: 添加 `rrIndex` per-capability 计数器, 使用模运算实现真正 round-robin

#### P1-5: 浏览器上下文 double-release 风险 ✅ 已完成
- **位置**: [browserManager.ts](../browserManager.ts) L234、[electronBridge.ts](../electronBridge.ts) L439
- **问题**: `releaseContext()` 在 `refCount <= 0` 时关闭上下文，但如果同一个 context 被 release 两次，refCount 变为负数，可能在其他消费者仍在使用时关闭
- **影响**: “页面已关闭”错误 → 阶段失败
- **✅ 修复方案**: `releaseContext()` 使用 `refCount <= 0` 后置防护: refCount 递减后若 ≤ 0 则清理缓存条目，double-release 不会导致错误关闭其他消费者的上下文

#### P1-6: 调试截图无限积累 ✅ 已完成
- **位置**: [chatAutomation.ts](../chatAutomation.ts) L960
- **问题**: `sendPrompt()` 的调试截图写入 TEMP_DIR 但从不清理
- **影响**: 批量生产时磁盘空间耗尽
- **✅ 修复方案**: 新增 `cleanupDebugScreenshots()` 函数 (默认清理 1 小时以上截图), 已接入 Workbench `startHealthMonitor()` 定期执行

#### P1-7: SSE 无重连机制 ✅ 已完成
- **位置**: [usePipeline.ts](../../ui/src/hooks/usePipeline.ts)
- **问题**: SSE 连接断开后，前端状态会冻结在断开时的快照
- **影响**: 网络抖动后用户必须刷新页面
- **✅ 修复方案**: `ui/src/api/sse.ts` 实现指数退避重连 (1s → 2s → 4s → ... → 30s 封顶), 成功连接后重置退避计时器

### 🟠 P2 — 影响扩展性/维护性的结构性问题

#### P2-1: 重复 provider 调用逻辑 ✅ 已完成
- ~~`providers.ts` + `providerPresets.ts` — 两个数据源包含重复的选择器/模型信息~~ ✅ workbench 已统一使用 providerPresets，DEFAULT_PROVIDERS 不再被导入
- ~~`accountManager.ts` + `resourceManager.ts` — 两个管理器，前者已废弃但仍有引用~~ ✅ accountManager.ts 及其测试已删除

#### P2-2: 日志规范不统一 ✅ 部分完成
- ~~各阶段直接使用 `console.log` / `console.error` — 无结构化日志~~ ✅ 新增 `lib/logger.ts` 统一结构化日志，orchestrator/configStore/loggingAdapter 已迁移
- ✅ 日志自动截断大字符串 (meta 值超 500 字符截断)，防止生产环境 prompt 泄露
- ✅ 支持 `LOG_LEVEL` 环境变量控制级别 (debug/info/warn/error)
- ✅ 全部文件已迁移完成：chatAutomation (65 calls), workbench (31 calls), ttsProvider (1 call) → 结构化日志

#### P2-3: 配置耦合 ✅ 部分完成
- `configStore.ts` 存储所有配置在一个 JSON 文件，含 API key 明文
- ~~无运行时校验 (Zod / AJV)~~ ✅ 新增 `validateConfig()` 运行时校验，拒绝无效字段值
- ⚠️ 待完成：配置 schema 版本控制

#### P2-4: SessionManager + ObservabilityService 纯内存 ✅ 已完成
- ~~服务器重启后会话丢失 → 恢复的流水线创建新聊天线程~~ ✅ SessionManager.saveTo/loadFrom 已在 P2-R3 完成
- ~~遥测指标丢失 → ETA 估算不准~~ ✅ ObservabilityService.saveTo/loadFrom 持久化
- ~~重启后无法审计哪些聊天线程被使用过~~ ✅ 会话和指标均持久化到项目目录
- **✅ 修复方案**: ObservabilityService 新增 `saveTo(projectDir, projectId)` / `loadFrom(projectDir, projectId)` — 原子写入 (write-to-tmp + rename) 到 `observability.json`; loadFrom 仅合并已完成阶段，不覆盖运行中阶段; orchestrator 在 `startPipeline` 后调用 `loadFrom` 恢复历史指标，每个阶段完成后调用 `saveTo` 持久化; 新增 18 个测试 (548 总测试, 38 文件)

#### P2-5: CostTracker 局限 ✅ 已完成
- ~~每次 `record()` 调用全量重写整个文件 — O(n) 写入~~ ✅ JSONL 追加写入 (appendFileSync)
- ~~使用静态成本表而非真实 API 计费 — 成本数据不准确~~ ✅ CostEntry 新增 `actualTokens` 字段，Gemini API 通过 `usageMetadata` 提取真实 token 数
- ~~无原子写入 — 并发写入可能损坏文件~~ ✅ 追加写入天然安全
- ~~FallbackAdapter 的降级成本未被正确归因~~ (loggingAdapter 传递 actualTokens)
- **✅ 修复方案**:
  - `costTracker.ts`: JSON array → JSONL (一行一条), `record()` 使用 `appendFileSync` O(1) 写入; `loadEntries()` 兼容旧 JSON array 格式; CostEntry 新增 `actualTokens?: {prompt?, completion?, total?}`
  - `geminiAdapter.ts`: 从 Gemini SDK `response.usageMetadata` 提取 `promptTokenCount/candidatesTokenCount/totalTokenCount` → `GenerationResult.tokenUsage`
  - `types.ts`: 新增 `TokenUsage` 接口 + `GenerationResult.tokenUsage` 字段
  - `loggingAdapter.ts`: 将 `result.tokenUsage` 传递给 `costTracker.record({ actualTokens })`
  - 12 个测试 (9 原有 + 3 新增: actualTokens/JSONL追加/旧格式兼容), 551 总测试

#### P2-6: 临时文件清理缺失 ✅ 已完成
- FFmpeg 中间文件: `resolveAssetPath()` 创建的 `_tmp_${Date.now()}.ext` 文件未被跟踪清理
- 调试截图: 积累不清理
- 视频压缩中间文件: 潜在泄露
- **✅ 修复方案**: data-URL 临时文件通过 `dataUrlTempFiles` 数组跟踪, 在 `assembleVideo()` 完成后统一清理; 调试截图通过 `cleanupDebugScreenshots()` 定期清理

#### P2-7: 任务状态机缺失 ✅ 已完成
- `TaskQueue` 使用简单状态字符串 (`pending|running|done|failed`)，无正式状态机
- 状态转换无校验 — 可以从 `done` 转到 `running`
- 无持久化 — 重启丢失所有任务
- **✅ 修复方案**: 添加 `VALID_TRANSITIONS` 映射 + `assertTransition()` 校验, 所有 `mark*()` 方法在转换前验证. 新增 6 个测试用例
- **⚠️ 待完成**: TaskQueue 持久化

#### P2-8: 队列和并发控制不足 ✅ 已完成
- `TaskQueue` 无上限 — 无限增长
- TTS 并发控制使用 polling (`while (active >= limit) { await setTimeout(500) }`) 而非信号量
- VIDEO_GEN worker pool 的 `nextScene++` 在理论上是安全的但对重构脆弱
- **✅ 已修复**: TaskQueue 添加 `maxSize` 构造参数 (默认 10,000), `add()` 超限时抛出错误
- **✅ 已修复**: TTS 并发控制从 busy-wait polling 改为 acquire/release 信号量模式

---

## 第四阶段：商业化阻塞点审查

### "不能卖"的 TOP 10 问题

| # | 问题 | 影响 | 严重度 | 状态 |
|---|------|------|--------|------|
| **1** | FFmpeg/TTS 命令注入 | 安全审计无法通过，企业客户无法接受 | 🔴 阻塞 | ✅ 已修复 |
| **2** | 无 AI 调用超时 | 任何 API 挂起 → 流水线永久卡死 → 客户投诉 | 🔴 阻塞 | ✅ 已修复 |
| **3** | QA 解析失败自动通过 | 低质量视频交付 → 退款 / 差评 | 🔴 阻塞 | ✅ 已修复 |
| **4** | 并发项目状态污染 | 多项目同时运行 → 数据混乱 → 不可复现 bug | 🔴 阻塞 | ✅ 已修复 |
| **5** | VIDEO_GEN 依赖外部 Web UI | 第三方 UI 变更 → 批量失败 → 高重跑成本 | 🟡 高风险 | ⬜ 待处理 |
| **6** | 无结构化日志 | 生产环境排障极困难 → 高售后成本 | 🟡 阻塞 | ✅ 部分修复 (lib/logger.ts) |
| **7** | 成本追踪不准确 | 无法给客户提供准确的成本报表 → 定价困难 | 🟡 阻塞 | ⚠️ 部分修复 |
| **8** | 无 E2E 测试 + 70% 模块零覆盖 | 每次发布都是赌博 → 生产事故频发 | 🟡 阻塞 | ⚠️ 已配置覆盖率门槛 (530 测试) |
| **9** | SSE 无重连 | 网络抖动 → 用户界面冻结 → 以为系统崩溃 | 🟡 高风险 | ✅ 已修复 |
| **10** | 账号轮转是假的 | 第一个账号被优先耗尽 → 配额利用不均 → 成本浪费 | 🟡 高风险 | ✅ 已修复 |

### 各维度详细分析

**1. 失败率最高的代码路径：**
- VIDEO_GEN (浏览器自动化) — DOM 变更、登录过期、超时
- REFERENCE_IMAGE (聊天模式) — 图片提取依赖 DOM polling
- 任何使用 ChatAdapter 的阶段 — 选择器脆弱

**2. 最导致高售后成本的模块：**
- `workbench.ts` — 问题排查极困难（God Class、状态混杂）
- `videoProvider.ts` — 1,432 行，调试困难
- 无结构化日志 — 客户反馈问题时无法快速定位

**3. 任务重跑成本最高的路径：**
- ASSEMBLY 后失败 → 前面所有阶段的 API 成本白费
- VIDEO_GEN 部分成功后整个重跑 → 已生成的视频片段浪费

**4. 视频质量不稳定的根源：**
- ~~QA_REVIEW 自动通过 — 质量守门员失效~~ ✅ 已修复 (fail-closed)
- 成本表静态估算 — 无法根据实际质量调整投入
- REFINEMENT 只是 stub — 实际精修能力缺失

**5. 多用户场景不可扩展的原因：**
- ~~`currentProjectId` / `chatAdapter.config` 全局共享~~ ✅ 已通过 ProjectRunState 解耦
- Workbench 单实例处理循环
- TaskQueue 纯内存、无持久化

**6. 最影响用户复购的问题：**
- 视频质量不一致（REFINEMENT stub）
- ~~长时间等待无反馈（无超时机制）~~ ✅ 已添加 AI 调用超时
- ~~界面冻结（SSE 无重连）~~ ✅ 已实现指数退避重连

---

## 第五阶段：重构路线图（按 ROI 排序）

### P0 — 必须立即做（阻塞商业化）

#### P0-R1: 修复 FFmpeg / TTS 命令注入 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题位置** | `adapters/ffmpegAssembler.ts` L6+L316, `adapters/ttsProvider.ts` L5+L110 |
| **根因** | 使用 `exec()` (shell 模式) 而非 `execFile()` (数组参数) |
| **优先级理由** | 安全漏洞，任何安全审计都会标记为 Critical |
| **推荐方案** | 1. `ffmpegAssembler.ts`: 将 `ffmpeg(args: string)` 改为 `ffmpeg(args: string[])`, 使用 `execFileAsync('ffmpeg', args)`<br>2. `ttsProvider.ts`: 使用 `execFile('edge-tts', ['--voice', voice, '--text', text, ...])` |
| **目录结构** | 不变 |
| **抽象方式** | 提取 `safeExec(bin: string, args: string[])` 到 `lib/shell.ts` |
| **是否引入 queue/worker** | 否 |
| **是否切换 API/本地** | 否 |
| **商业化收益** | 通过安全审计 |
| **成本优化** | 无 |

#### P0-R2: 为所有 AI 调用添加超时 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题位置** | 所有 13 个阶段 + chatAdapter + geminiAdapter |
| **根因** | AI 调用无 AbortSignal / timeout 包装 |
| **优先级理由** | 流水线悬挂是最差的用户体验 |
| **推荐方案** | 在 `StageRunContext` 中注入 `callWithTimeout(fn, timeoutMs)` 工具函数；对 generateText 默认 120s, generateImage 默认 180s, generateVideo 默认 3600s |
| **目录结构** | 在 `pipeline/` 新增 `adapterTimeout.ts` |
| **抽象方式** | Decorator 模式包装 AIAdapter |
| **是否引入 queue/worker** | 否 |
| **是否切换 API/本地** | 否 |
| **商业化收益** | 消除"无限等待"投诉 |
| **成本优化** | 阻止悬挂造成的浏览器资源浪费 |

#### P0-R3: 修复 QA_REVIEW fail-safe ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题位置** | `pipeline/stages/qaReview.ts` L63 |
| **根因** | JSON 解析失败 → auto-approve |
| **优先级理由** | 质量守门员形同虚设 |
| **推荐方案** | JSON 解析失败时: 重试最多 2 次 → 仍然失败则 `throw new Error('QA response unparseable')` |
| **商业化收益** | 提升成片质量一致性 |

#### P0-R4: 消除并发项目共享状态污染 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题位置** | `pipeline/orchestrator.ts` 的 `currentProjectId`, `currentProjectDir`, `preCompletedStages`, `getSessionAwareAdapter()` |
| **根因** | 实例级字段被多个并发 run() 覆盖 |
| **优先级理由** | 不修复则多项目必出错 |
| **推荐方案** | 引入 `RunContext` 局部对象:<br>```typescript<br>interface RunContext {<br>  projectId: string;<br>  projectDir: string;<br>  preCompletedStages: Set<string>;<br>  sessionConfig: { sessionId: string; continueChat: boolean };<br>}<br>```<br>在 `run()` 入口创建，通过参数向下传递 |
| **抽象方式** | 不修改 ChatAdapter 接口，改为在 getAdapter() 中创建克隆实例 |
| **商业化收益** | 支持同时批量生产多个视频 |

#### P0-R5: 修复 Electron 自动化服务器认证 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题位置** | `browser-shell/src/automation-server.ts` |
| **根因** | HTTP 服务器无任何认证 |
| **推荐方案** | 生成启动时 random token, 通过环境变量传递给后端, 每个请求都需要携带 `Authorization: Bearer <token>` |
| **商业化收益** | 通过企业安全审计 |

### P1 — 本阶段必须做

#### P1-R1: 拆分 Workbench God Class

| 项目 | 内容 |
|------|------|
| **问题位置** | `workbench.ts` (1,354L) |
| **根因** | 8+ 职责混杂 |
| **推荐方案** | 拆分为: |
| | `src/browser/browserPool.ts` — 浏览器生命周期管理 |
| | `src/browser/loginManager.ts` — 登录会话管理 |
| | `src/browser/selectorManager.ts` — 选择器检测/健康/缓存 |
| | `src/browser/providerDetector.ts` — 模型/能力自动检测 |
| | `src/workbench.ts` — 薄协调层 (200L) |
| **是否引入 queue/worker** | 是 — 将 `processLoop` 改为事件驱动的 Worker |
| **商业化收益** | 降低维护成本，提升可测试性 |

#### P1-R2: 拆分 videoProvider.ts (1,432L)

| 项目 | 内容 |
|------|------|
| **问题位置** | `adapters/videoProvider.ts` |
| **推荐方案** | 拆分为: |
| | `adapters/video/promptSanitizer.ts` — 提示词清洗 (按提供者) |
| | `adapters/video/siteInteraction.ts` — 页面交互 (上传、输入、点击) |
| | `adapters/video/videoDownloader.ts` — 视频下载 (4 策略) |
| | `adapters/video/queueDetector.ts` — 排队/限额/合规检测 |
| | `adapters/videoProvider.ts` — 编排层 |
| **商业化收益** | 新增视频提供者变更可控，故障隔离 |

#### P1-R3: 统一选择器格式 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题位置** | providers.ts vs providerPresets.ts vs types.ts |
| **推荐方案** | 统一使用 `SelectorChain[]` 格式，删除 `providers.ts` 中的 `DEFAULT_PROVIDERS`，迁移到 `providerPresets.ts` |
| **✅ 已完成** | workbench.ts 不再导入 DEFAULT_PROVIDERS，统一通过 getPreset() 获取选择器，仅保留 customProviders 回退路径 |
| **商业化收益** | 减少维护负担、减少选择器不同步导致的失败 |

#### P1-R4: 添加 AI 调用结构化日志 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题位置** | 全仓 |
| **推荐方案** | 1. 创建 `lib/logger.ts` 统一日志接口:<br>`logger.info({ stage, projectId, action, duration })` <br>2. 所有 `console.log` 替换为结构化日志<br>3. 生产环境禁止输出完整 prompt/response，仅输出摘要 |
| **商业化收益** | 快速排障 = 降低售后成本 |
| **✅ 已完成** | `lib/logger.ts` 已创建，支持 JSON 结构化输出 + `LOG_LEVEL` 控制 + meta 自动截断 (500字符)。orchestrator/configStore/tts/loggingAdapter 已迁移 |

#### P1-R5: 实现真正的账号轮转 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题位置** | `resourceManager.ts` L163 |
| **推荐方案** | 维护 `lastUsedIndex` 计数器，真正实现 round-robin |
| **商业化收益** | 均衡配额消耗 → 降低成本 |

#### P1-R6: SSE 自动重连 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题位置** | `ui/src/hooks/usePipeline.ts` |
| **推荐方案** | 使用指数退避重连:<br>```typescript<br>let retryDelay = 1000;<br>eventSource.onerror = () => {<br>  setTimeout(() => reconnect(), retryDelay);<br>  retryDelay = Math.min(retryDelay * 2, 30000);<br>};<br>``` |
| **商业化收益** | 消除"界面冻结"投诉 |

#### P1-R7: 添加测试覆盖率门槛 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题位置** | `vitest.config.ts`, `.github/workflows/ci.yml` |
| **推荐方案** | 1. 配置 `vitest` coverage (v8)<br>2. CI 中添加覆盖率检查 `coverage.threshold.lines: 40` (初始低门槛，逐步提升)<br>3. 优先为 chatAdapter, geminiAdapter, pipelineService 补测试 |
| **商业化收益** | 减少发布事故 |
| **✅ 已完成** | `vitest.config.ts` 已配置 v8 coverage provider，门槛: lines 40%, functions 35%, branches 30%, statements 40% |

### P2 — 下一阶段优化

#### P2-R1: 统一任务状态机 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **推荐方案** | 定义正式状态机:<br>```typescript<br>type StageState = 'idle' \| 'pending' \| 'processing' \| 'waiting_approval' \| 'completed' \| 'error' \| 'skipped';<br>const VALID_TRANSITIONS: Record<StageState, StageState[]> = {<br>  idle: ['pending'],<br>  pending: ['processing', 'skipped'],<br>  processing: ['completed', 'error', 'waiting_approval'],<br>  waiting_approval: ['completed', 'error'],<br>  error: ['pending'], // retry<br>  completed: [],<br>  skipped: [],<br>};<br>``` |
| **位置** | 新增 `pipeline/stateMachine.ts` |
| **✅ 已完成** | 创建 `stateMachine.ts`: VALID_STAGE_TRANSITIONS, assertStageTransition(), transitionStage(), InvalidStageTransitionError。集成到 orchestrator.ts 的 runStage(), retryStage(), recoverStaleProjects()。含完整测试。 |

#### P2-R2: CostTracker 精确化 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **推荐方案** | 1. 追加式日志 (`appendFileSync`) 替代全量重写<br>2. 从 Gemini API 响应中提取实际 token 数量<br>3. 原子写入 |
| **✅ 已完成** | JSONL append 写入 + `actualTokens` 字段 + Gemini `usageMetadata` 提取 + 旧格式向后兼容 |

#### P2-R3: SessionManager 持久化 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **推荐方案** | 会话信息存入 `{projectDir}/sessions.json`，与项目生命周期绑定 |
| **✅ 已完成** | SessionManager 新增 saveTo()/loadFrom() 方法，原子写入 sessions.json。orchestrator 在 run() 开始时 loadFrom()，每阶段完成时 saveTo()。 |

#### P2-R4: 临时文件生命周期管理 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **推荐方案** | 新增 `lib/tempFiles.ts`:<br>```typescript<br>class TempFileTracker {<br>  private files: string[] = [];<br>  track(path: string): string { this.files.push(path); return path; }<br>  async cleanup(): Promise<void> { ... }<br>}<br>```<br>在 orchestrator.run() 的 finally 块中调用 cleanup() |
| **✅ 已完成** | 创建 `lib/tempFiles.ts` (TempFileTracker: trackFile/trackDir/cleanup)。集成到 orchestrator ProjectRunState + finally 块。含完整测试 (5 tests)。 |

#### P2-R5: Docker 生产化 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **推荐方案** | 1. 添加 `.dockerignore`<br>2. `USER node` 非 root 运行<br>3. 预编译 TypeScript 而非 `tsx` 运行<br>4. 添加 `HEALTHCHECK`<br>5. 将 `playwright` 和 `tsx` 移至 `dependencies`<br>6. 声明 `VOLUME /data` |
| **✅ 已完成** | 创建 `.dockerignore`，Dockerfile 添加 USER node / HEALTHCHECK / VOLUME /data / 数据目录安全所有权。 |

#### P2-R6: StyleProfile 合约强制执行 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题** | StyleProfile ~40+ 字段仅 10 个顶层字段经 schema 校验，27+ 嵌套字段（track_a/b/c/meta）零校验。AI 提取失败时下游用 `??` 默认值静默兜底，产出"成功但泛化"的视频。nodeConfidence 纯装饰性，不影响下游决策。wordCount/WPM 等可计算字段让 AI 猜测而非精确计算。 |
| **推荐方案** | 1. `STYLE_CONTRACT` 将字段分为 CRITICAL(7)/IMPORTANT(8)/OPTIONAL(8) 三层<br>2. `validateStyleContract()` 检查缺失/低置信 CRITICAL 字段，输出合约分数<br>3. 缺失 CRITICAL → 定向补全重试（只问缺失字段，不重做整体提取）<br>4. `computeDerivedFields()` 从 fullTranscript 精确计算 wordCount/WPM/sentenceLength，覆盖 AI 猜测<br>5. nodeConfidence 新增 `'computed'` 层级<br>6. scriptGeneration + scriptValidator 置信度感知：guess 字段加宽容差 |
| **✅ 已完成** | 新增 `pipeline/styleContract.ts` (STYLE_CONTRACT + validateStyleContract + computeDerivedFields + resolvePath)。<br>修改 `styleExtraction.ts`: 合约校验 → 定向补全重试 → 计算字段覆盖 → buildStyleProfile/mergeSupplementData 提取。<br>修改 `analysisStages.ts`: 保存 style-contract-result.json 制品。<br>修改 `scriptGeneration.ts`: sentence_length_max/metaphor_count 置信度感知容差。<br>修改 `scriptValidator.ts`: maxSentenceLength 容差从 1.5x 提升到 2.0x（当为 guess 时）。<br>types.ts: nodeConfidence 联合类型添加 `'computed'`。<br>含 16 个新测试（合约校验 + 计算字段），总计 530 测试全部通过 (37 文件)。 |

#### CIR-A1: Canonical Intermediate Representation (CIR) 架构 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题** | 13 阶段流水线各阶段间通过松散 JSON 传递数据，无正式数据合约。AI 输出直接进入下游未经结构化验证，阶段间耦合全靠 `?? default` 兜底。缺乏"编译器式"中间表示使错误在产出端才可见。 |
| **推荐方案** | 1. 定义 5 种 CIR 类型（StyleAnalysisCIR/ResearchCIR/ScriptCIR/StoryboardCIR/VideoPlanCIR）作为管线的"语义中间表示"<br>2. StageContract 接口为每个阶段定义 validateInput/validateOutput<br>3. 编排器 runStage() 前后调用 enforceContract() 进行输入/输出合约校验<br>4. Parser 层（"编译器前端"）将 AI 输出转换为经过验证的 CIR 对象<br>5. 类型化错误模型: CIRValidationError / StageContractViolationError / AIParseError |
| **✅ 已完成** | 新增 `src/cir/` 目录：<br>— `types.ts`: 5 种 CIR 接口 + AnyCIR 联合类型 + CIRType，所有类型含 `readonly _cir` 辨别符 + `readonly version: 1`<br>— `errors.ts`: 3 个类型化错误类<br>— `contracts.ts`: StageContract 接口 + 13 阶段合约注册表 + enforceContract() + 4 个 CIR 验证器 (含 audioTrack 校验)<br>— `parsers.ts`: 5 个解析器函数，样式/研究/脚本/故事板/视频计划 → CIR<br>— `loader.ts`: ✅ 集中式 CIR Loader Gateway — `loadStyleCIR`/`loadScriptCIR`/`loadStoryboardCIR` 统一加载/校验/错误构造<br>— `index.ts`: barrel 导出 (含 loader)<br>— `cir.test.ts`: 80 个测试覆盖错误模型、合约注册表、enforceContract、CIR 验证器、5 个解析器、5 阶段 CIR 消费场景<br>— `loader.test.ts`: 14 个测试覆盖正确加载/缺失/无效标签/校验失败<br>修改 `orchestrator.ts`: runStage() 增加 input/output 合约执行（警告模式，不阻断管线）<br>修改 4 个 stage defs: analysisStages（CIR 生产）、creationStages（CIR 生产+消费）、visualStages（CIR 生产+消费）、productionStages（CIR 消费）<br>**CIR Consumption 完成**: 5 阶段全部消费 CIR (SCRIPT_GENERATION/STORYBOARD/VIDEO_GEN/TTS/ASSEMBLY)，消除 ~48 处原始字段读取<br>**CIR Loader Gateway 完成**: 6 个重复 helper 消除，3 个 stage def 文件简化，导入量减少 ~15 行<br>总计 530 测试全部通过 (37 文件)。 |

#### CIR-A2: CIR Consumption — 5 阶段 CIR 消费改造 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题** | 各消费阶段通过 `project.styleProfile?.xxx?.yyy` / `project.scriptOutput?.zzz` 松散的可选链读取上游数据，缺失字段以 `??` 默认值静默降级。无编译时保证上游已产出必要字段。 |
| **推荐方案** | 每个消费阶段改为从 `*.cir.json` 加载经过验证的 CIR 对象，fail-closed（CIR 缺失/无效则抛 `CIRValidationError` 中止阶段）。保留非关键可选字段的 raw fallback。 |
| **✅ 已完成** | **SCRIPT_GENERATION**: `ScriptGenerationInput` 要求 `styleCIR: StyleAnalysisCIR`，27 处 raw 字段读取替换为 CIR 字段。`creationStages.ts` 增加 `loadAndValidateStyleCIR()` helper。<br>**STORYBOARD**: `StoryboardInput` 要求 `styleCIR + scriptCIR`，16 处 raw 字段读取替换。`visualStages.ts` 增加两个 CIR helper。<br>**VIDEO_GEN**: `VideoGenInput` 要求 `styleCIR + storyboardCIR`，4 处 raw 字段读取替换。`productionStages.ts` 增加三个 CIR helper。<br>**TTS**: 3 处 raw `styleProfile` 读取替换为 `styleCIR.audioTrack.voiceStyle` / `styleCIR.pacing` / `styleCIR.meta.videoLanguage`。<br>**ASSEMBLY**: 2 处 raw 读取替换为 `styleCIR.audioTrack.bgmRelativeVolume` + `scriptCIR.fullText`。`project.scriptOutput` 不再被 ASSEMBLY 加载。<br>**非关键 fallback 保留**: `targetAspectRatio` (VIDEO_GEN)、`targetAudience` / `emotionalIntensity` / `hookExample` (SCRIPT_GENERATION)。<br>`validateStyleAnalysisCIR` 新增 `audioTrack is required` 校验。<br>每阶段消费测试 (cir.test.ts): 字段可用性 / 缺失CIR / 无效标签 / 校验失败 / raw 字段不再接受。 |

#### CIR-A3: CIR Loader Gateway — 集中式加载注册表 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题** | 3 个 stage def 文件各自维护 `loadAndValidateStyleCIR` / `loadAndValidateScriptCIR` / `loadAndValidateStoryboardCIR` 本地 helper（共 6 份拷贝），逻辑完全相同，仅 stage 名/CIR 类型不同。违反 DRY，扩展时需在多处同步。 |
| **推荐方案** | 新建 `src/cir/loader.ts` 共享模块，提供类型化公共 API `loadStyleCIR(ctx, stage)` / `loadScriptCIR(ctx, stage)` / `loadStoryboardCIR(ctx, stage)`；内部通过泛型 `loadCIR<T>()` + `CIRSpec<T>` 注册表实现统一的：artifact 路径解析 → `_cir` 标签校验 → validator dispatch → `CIRValidationError` 构造。接口以 `CIRLoadContext` (仅 `loadArtifact<T>()`) 解耦，不依赖完整 `StageRunContext`。 |
| **✅ 已完成** | 新建 `src/cir/loader.ts` (82L)：`CIRLoadContext` 接口 + 3 个 `CIRSpec<T>` + 泛型 `loadCIR<T>()` + 3 个公共 API。<br>新建 `src/cir/loader.test.ts` (14 测试)：每种 CIR 测试正确返回 / 缺失文件 / 无效标签 / 校验失败 / null 输入 / stage 名传播。<br>删除 6 个重复 helper: `productionStages.ts` (3) + `creationStages.ts` (1) + `visualStages.ts` (2)。<br>3 个 stage def 文件净减 ~95 行代码 + ~15 行无用 import。<br>`src/cir/index.ts` barrel 增加 `export * from './loader.js'`。<br>530 测试全部通过 (37 文件)。 |

### P3 — 低优先级维护 (已完成 3/3)

#### P3-1: Console 日志迁移收尾 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题** | chatAutomation.ts (65), workbench.ts (31), ttsProvider.ts (1) 共 97 处 `console.log/warn/error` 未迁移至结构化日志。 |
| **✅ 已完成** | 全部 97 处 console.* 调用替换为 `createLogger()` 结构化日志。<br>`ttsProvider.ts`: `createLogger('TTS')` + 1 处 `log.warn('edge_tts_failed_no_fallback')`<br>`chatAutomation.ts`: `createLogger('ChatAutomation')` + 65 处 → snake_case event names + metadata objects<br>`workbench.ts`: `createLogger('Workbench')` + 31 处 → task_start/task_done/task_error/browser_context_died 等<br>565 测试全部通过 (38 文件)。 |

#### P3-2: Config Schema 版本控制 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题** | `configStore.ts` 无 schema 版本管理，未来字段变更无迁移路径。写入非原子（直接 writeFileSync）。 |
| **✅ 已完成** | 新增 `CURRENT_SCHEMA_VERSION` (v2) + `migrateConfig()` 迁移链 + `MIGRATIONS` 注册表。<br>持久化改为原子写入 (write-to-tmp + rename)。<br>加载时自动检测版本并执行迁移链 → 升级后立即 re-persist。<br>持久化 JSON 包含 `_schemaVersion` 字段。<br>新增 6 个测试：legacy 迁移 / 幂等性 / 文件包含版本 / 自动迁移+re-persist / update 保留版本 / 未知未来版本。<br>565 测试全部通过 (38 文件)。 |

#### P3-3: TaskQueue 持久化 ✅ 已完成

| 项目 | 内容 |
|------|------|
| **问题** | TaskQueue 纯内存，进程重启丢失所有排队任务。 |
| **✅ 已完成** | 新增 `saveTo(filePath)` / `loadFrom(filePath)` 方法。<br>原子写入 (write-to-tmp + rename)。<br>仅保存 pending + running 任务；running 任务重载后降级为 pending (避免重复执行)。<br>done/failed 任务不写入（减少文件体积）。<br>`loadFrom` 校验每个条目 (id/question/status/VALID_TRANSITIONS 检查)，跳过无效条目。<br>超出 maxSize 时自动截断。<br>新增 8 个测试：round-trip / running→pending 降级 / done+failed 过滤 / 文件不存在 / corrupt JSON / 无效条目跳过 / maxSize 截断 / 替换已有条目。<br>565 测试全部通过 (38 文件)。 |

### P3-R — 长期增强 (路线图)

#### P3-R1: Provider 抽象层
- 统一 `AIProvider` 接口: `generateText()`, `generateImage()`, `generateSpeech()`, `generateVideo()`
- 每个提供者独立包: `providers/gemini/`, `providers/jimeng/`, `providers/kling/`
- 运行时注册发现

#### P3-R2: 模板市场
- 将 `styleLibrary.ts` 扩展为完整的模板系统
- 支持导入/导出预设（含风格、提示词、参数）

#### P3-R3: 插件化架构
- Stage 可作为插件加载
- 第三方可注册自定义阶段

#### P3-R4: 企业化能力
- 多租户隔离
- 审计日志
- RBAC 权限控制
- 用量计费集成

---

## 第六阶段：直接落地改造建议

### 6.1 推荐新的目录结构

```
src/
├── lib/                          # 通用工具（无业务依赖）
│   ├── pathSafety.ts             # ✅ 已实现 — 路径安全验证/消毒
│   ├── logger.ts                 # ✅ 已实现 — 统一结构化日志
│   ├── sanitize.ts               # ✅ 已实现 — 文本清洗
│   └── tempFiles.ts              # 待实现 — 临时文件生命周期
│
├── browser/                      # 浏览器自动化（从 workbench 拆出）
│   ├── browserPool.ts            # 上下文池 (acquire/release)
│   ├── loginManager.ts           # 登录会话生命周期
│   ├── selectorManager.ts        # 选择器检测/健康/缓存
│   ├── providerDetector.ts       # 模型/能力自动检测
│   └── chatAutomation.ts         # 聊天自动化核心
│
├── adapters/                     # AI 适配器
│   ├── types.ts                  # AIAdapter 统一接口
│   ├── chatAdapter.ts            # 浏览器聊天适配器
│   ├── geminiAdapter.ts          # Gemini API 适配器
│   ├── fallbackAdapter.ts        # 降级包装器
│   ├── ttsProvider.ts            # TTS 适配器
│   ├── video/                    # 视频生成（拆分）
│   │   ├── videoProvider.ts      # 编排入口
│   │   ├── promptSanitizer.ts    # 提示词清洗
│   │   ├── siteInteraction.ts    # 页面交互
│   │   └── videoDownloader.ts    # 视频下载
│   ├── ffmpeg/                   # FFmpeg（拆分）
│   │   ├── assembler.ts          # 视频合成
│   │   ├── filters.ts            # 滤镜配置
│   │   └── subtitles.ts          # 字幕生成
│   ├── responseParser.ts
│   ├── schemaValidator.ts
│   └── imageExtractor.ts
│
├── pipeline/                     # 流水线编排
│   ├── aiControl.ts              # ✅ 已实现 — AI 调用超时/中止包装
│   ├── orchestrator.ts           # ✅ ProjectRunState 隔离
│   ├── pipelineService.ts
│   ├── stages/
│   └── ...
│
├── config/                       # 配置管理（从根级拆出）
│   ├── configStore.ts
│   ├── providerPresets.ts        # 合并 providers.ts
│   └── constants.ts
│
├── routes/                       # HTTP 路由（不变）
├── workbench.ts                  # 薄协调层 (~200L)
├── server.ts                     # HTTP 入口
└── types.ts
```

### 6.2 推荐 Pipeline Step 抽象接口

```typescript
// pipeline/types.ts — 统一阶段接口
interface StageDefinition {
  name: PipelineStage;
  group: 'analysis' | 'creation' | 'visual' | 'production';
  taskType: string;
  pauseAfter?: boolean;

  /** 超时设置 */
  timeoutMs?: number;         // 默认 120_000
  imageTimeoutMs?: number;    // 默认 180_000
  videoTimeoutMs?: number;    // 默认 3_600_000

  /** 重试策略 */
  retryPolicy?: {
    maxRetries: number;
    baseDelayMs: number;
    retryOn?: (err: Error) => boolean;
  };

  /** 执行 */
  execute(ctx: StageRunContext): Promise<void>;

  /** 可选: 输入验证 */
  validateInput?(project: PipelineProject): string | null;

  /** 可选: 产物验证 */
  validateOutput?(project: PipelineProject): string | null;
}
```

### 6.3 推荐统一 Provider Interface

```typescript
// adapters/types.ts
interface AIProvider {
  readonly id: string;
  readonly capabilities: Set<'text' | 'image' | 'speech' | 'video'>;

  generateText(prompt: string, opts?: TextOpts): Promise<TextResult>;
  generateImage?(prompt: string, opts?: ImageOpts): Promise<ImageResult>;
  generateSpeech?(text: string, opts?: SpeechOpts): Promise<SpeechResult>;
  generateVideo?(prompt: string, opts?: VideoOpts): Promise<VideoResult>;

  /** 健康检查 */
  healthCheck(): Promise<boolean>;
  /** 成本估算 (用于前置展示) */
  estimateCost(taskType: string): number;
}
```

### 6.4 推荐统一错误处理

```typescript
// lib/errors.ts
class PipelineError extends Error {
  constructor(
    message: string,
    public readonly code: ErrorCode,
    public readonly stage?: PipelineStage,
    public readonly retryable: boolean = false,
    public readonly context?: Record<string, unknown>,
  ) { super(message); }
}

enum ErrorCode {
  SAFETY_BLOCK = 'SAFETY_BLOCK',
  QUOTA_EXHAUSTED = 'QUOTA_EXHAUSTED',
  AI_TIMEOUT = 'AI_TIMEOUT',
  AI_PARSE_ERROR = 'AI_PARSE_ERROR',
  BROWSER_CRASH = 'BROWSER_CRASH',
  FFMPEG_ERROR = 'FFMPEG_ERROR',
  VALIDATION_ERROR = 'VALIDATION_ERROR',
  NETWORK_ERROR = 'NETWORK_ERROR',
}
```

### 6.5 推荐统一日志方案

```typescript
// lib/logger.ts
interface LogEntry {
  level: 'debug' | 'info' | 'warn' | 'error';
  timestamp: string;
  module: string;
  projectId?: string;
  stage?: string;
  action: string;
  duration?: number;
  meta?: Record<string, unknown>;
}

const LOG_LEVEL = process.env.LOG_LEVEL ?? 'info';

function createLogger(module: string) {
  return {
    info(action: string, meta?: Record<string, unknown>) { ... },
    error(action: string, err: Error, meta?: ...) { ... },
    // 生产环境自动截断 prompt/response 到前 200 字符
  };
}
```

### 6.6 推荐缓存 / 幂等 / 去重策略

```
已有:
✅ 已完成阶段跳过 (preCompletedStages)
✅ 产物文件持久化 (saveArtifact)

需要补充:
1. AI 调用幂等: 对 (stage + projectId + inputHash) 做缓存
   → 重试时命中缓存，不重复调用 API
2. 图片/视频下载去重: 对 URL 做 SHA256 判断，避免重复下载
3. FFmpeg 产物缓存: 中间文件按 inputHash 命名，相同输入跳过
```

### 6.7 推荐临时文件生命周期管理

```typescript
// lib/tempFiles.ts
class TempFileTracker {
  private files = new Set<string>();

  track(path: string): string {
    this.files.add(path);
    return path;
  }

  async cleanup(): Promise<void> {
    for (const f of this.files) {
      try { await fs.unlink(f); } catch { /* ignore */ }
    }
    this.files.clear();
  }
}

// 在 orchestrator.run() 中:
const tempTracker = new TempFileTracker();
try { ... } finally {
  await tempTracker.cleanup();
  runLock.release(projectId);
}
```

### 6.8 推荐测试分层方案

```
Layer 1: 单元测试 (vitest, 秒级)
- 所有纯逻辑模块: responseParser, schemaValidator, scriptValidator, costTracker
- 所有数据结构: projectStore, configStore, resourceManager, taskQueue
- 目标: 80% 覆盖率

Layer 2: 集成测试 (vitest + mock adapter, 分钟级)
- 已有: pipeline-integration.test.ts (22 用例)
- 需补充: pipelineService, qualityRouter, stageRetryWrapper 的专项测试
- 目标: 全 13 阶段 + 错误路径覆盖

Layer 3: 组件测试 (vitest + testing-library)
- 前端组件: PipelinePage, ProductionPage, SceneGrid
- 目标: 关键交互路径

Layer 4: E2E 测试 (Playwright, 分钟级)
- 真实 Gemini API + FFmpeg 端到端
- 保持在 testing/scripts/ 下，CI 可选运行
```

### 6.9 推荐 CI/CD 方案

```yaml
# .github/workflows/ci.yml 增强
jobs:
  lint:
    - npx eslint src/ --ext .ts,.tsx
  typecheck:
    - npx tsc --noEmit (backend, ui, browser-shell)
  test:
    - npx vitest run --coverage
    - coverage threshold check
  security:
    - npm audit --audit-level=high
  build:
    - Docker build + image scan
  accept:
    - npm run accept:backend:ci (可选, 需 API key)
```

### 6.10 推荐打包发布方案

```
现有:
✅ GitHub Actions release.yml (跨平台 Electron 构建)
✅ build-sidecar.sh (后端 binary 打包)

需补充:
1. 代码签名 (macOS notarize, Windows sign)
2. 自动更新 (electron-updater + GitHub Releases)
3. Changelog 生成 (conventional commits)
4. Docker 镜像发布 (GHCR + tag)
5. 版本号管理 (package.json + git tag 同步)
```

---

## 最终总结

### TOP 10 最危险技术债

| # | 技术债 | 位置 | 影响 | 状态 |
|---|--------|------|------|------|
| 1 | **FFmpeg/TTS 命令注入** | ffmpegAssembler.ts, ttsProvider.ts | 安全, 任意代码执行 | ✅ 已修复 |
| 2 | **并发项目共享状态** | orchestrator.ts | 数据污染, 不可预测 | ✅ 已修复 |
| 3 | **无 AI 调用超时** | 全 13 阶段 | 流水线永久卡死 | ✅ 已修复 |
| 4 | **Workbench God Class** | workbench.ts (~1,395L) | 不可维护, 不可测试 | ⚠️ 部分修复 |
| 5 | **videoProvider Mega-File** | videoProvider.ts (1,432L) | 故障难隔离 | ⬜ 待处理 |
| 6 | **Electron 自动化无认证** | automation-server.ts | 本地特权提升 | ✅ 已修复 |
| 7 | **QA 解析失败自动通过** | qaReview.ts | 质量失控 | ✅ 已修复 |
| 8 | 70% 模块零测试覆盖 | 18 核心文件 + 18 阶段 | 发布即赌博 | ⬜ 待处理 (530 测试已覆盖核心路径) |
| 9 | **SessionManager/ObservabilityService 纯内存** | sessionManager.ts, observability.ts | 重启丢失, ETA 不准 | ✅ SessionManager 已持久化 |
| 10 | **CIR 阶段间数据合约** | 5 阶段消费 + Loader Gateway | ~48 处 raw 读取已消除 | ✅ 已完成 |

### TOP 10 最影响商业化的问题

| # | 问题 | 影响 | 状态 |
|---|------|------|------|
| 1 | FFmpeg/TTS 命令注入 | 安全审计阻塞 | ✅ 已修复 |
| 2 | 无 AI 调用超时 | 客户投诉“卡死” | ✅ 已修复 |
| 3 | QA 自动通过 | 低质量视频交付→退款 | ✅ 已修复 |
| 4 | VIDEO_GEN 依赖外部 Web UI | 批量失败→高重跑成本 | ⬜ 待处理 |
| 5 | 并发项目状态污染 | 多人/多项目不可用 | ✅ 已修复 |
| 6 | 无结构化日志 | 售后排障成本极高 | ✅ 已修复 (lib/logger.ts + 全部模块已迁移) |
| 7 | 成本追踪不准确 | 无法定价/计费 | ⚠️ 部分修复 (原子写入) |
| 8 | 无 E2E 测试 | 每次发布都有事故风险 | ⚠️ 已配置覆盖率门槛 (565 测试) |
| 9 | 假账号轮转 (first-available) | 配额利用不均→成本浪费 | ✅ 已修复 |
| 10 | SSE 无重连 | 界面冻结→用户以为崩溃 | ✅ 已修复 |

### TOP 5 最影响视频质量的模块

| # | 模块 | 原因 | 状态 |
|---|------|------|------|
| 1 | SCRIPT_GENERATION | 脚本是所有后续内容的基石 | ⬜ |
| 2 | VIDEO_GEN + videoProvider | 视频素材质量直接决定成片效果 | ⬜ |
| 3 | QA_REVIEW | 质量守门员 | ✅ 已修复 (fail-closed) |
| 4 | REFERENCE_IMAGE | 视觉风格一致性锚点 | ⬜ |
| 5 | ASSEMBLY (FFmpeg) | 字幕、BGM、时序精度 | ⬜ |

### TOP 5 最影响成本控制的路径

| # | 路径 | 原因 | 状态 |
|---|------|------|------|
| 1 | VIDEO_GEN 失败→全部重来 | 前面所有 API 成本白费 | ⬜ |
| 2 | 假轮转导致单账号耗尽 | 配额利用不均 | ✅ 已修复 |
| 3 | 无 AI 调用缓存/幂等 | 重试/恢复时重复调用 | ⬜ |
| 4 | CostTracker 静态估算 | 不知道真实花费 | ⚠️ 部分修复 |
| 5 | SCRIPT_GENERATION 多轮重试 | 3-6 次 API 调用/脚本 | ⬜ |

### 最该优先重构的 3 个目录

| # | 目录 | 原因 | 推荐方案 | 状态 |
|---|------|------|---------|------|
| 1 | `src/adapters/` | ~~命令注入安全漏洞~~ + videoProvider 1,432L | ~~修复 exec→execFile~~ ✅, 拆分 videoProvider | ⚠️ 部分 |
| 2 | `src/pipeline/orchestrator.ts` | ~~并发共享状态~~ | ~~引入 RunContext~~ ✅ ProjectRunState | ✅ 已完成 |
| 3 | `src/workbench.ts` | ~1,395L God Class | 拆分为 4-5 个职责模块 | ⚠️ 部分 |

### 距离"可收费上线"还差：

| # | 能力 | 现状 | 差距 |
|---|------|------|------|
| 1 | 安全合规 | ✅ FFmpeg/TTS 命令注入已修复, 自动化已认证 | **已完成** |
| 2 | 超时保护 | ✅ aiControl.ts 统一超时 | **已完成** |
| 3 | 质量一致性 | ✅ QA fail-closed | **已完成** |
| 4 | 并发安全 | ✅ ProjectRunState 隔离 | **已完成** |
| 5 | 结构化日志 | ✅ lib/logger.ts 已创建, 全部模块已迁移 | **已完成** |
| 6 | 成本透明 | 原子写入已修复, 估算仍不准 | **建议改进** |
| 7 | 测试覆盖 | ✅ vitest coverage 已配置 (565 测试, 38 文件) | **建议提升到 50%+** |
| 9 | 风格合约 | ✅ StyleProfile 合约校验 (7 CRITICAL + 8 IMPORTANT 字段) | **已完成** |
| 10 | 阶段间数据合约 | ✅ CIR 中间表示 (5 种类型 + 5 阶段消费 + Loader Gateway) | **已完成** |
| 8 | SSE 重连 | ✅ 指数退避重连 | **已完成** |

### 距离"稳定规模化"还差：

| # | 架构能力 | 现状 | 差距 |
|---|---------|------|------|
| 1 | 多项目并行 | ✅ ProjectRunState 隔离 | ✅ TaskQueue 持久化已完成 / Worker Pool 待实现 |
| 2 | 多 Worker 处理 | 单进程处理循环 | ✅ TaskQueue 持久化已完成 / Worker Pool 待实现 |
| 3 | 提供者热插拔 | 编译时绑定 | 运行时注册发现 |
| 4 | 分布式部署 | 单机 Electron | 分离 Worker 节点 |
| 5 | 监控告警 | 纯内存遥测 | 持久化指标 + Prometheus 导出 |
| 6 | 状态机管理 | ✅ TaskQueue VALID_TRANSITIONS 已实现 | 扩展到流水线阶段状态 |
| 7 | 幂等调用 | 无 | 输入哈希缓存 |
| 8 | 阶段间数据合约 | ✅ CIR 架构 + 5 阶段消费 + Loader Gateway | ResearchCIR 消费 (3 阶段待改造) |

---

