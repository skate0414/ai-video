
---

## Part A：反馈与记录

### A1：用户编辑追踪

**A1.** **有保存。** `updateScript()` 在 orchestrator.ts 会将编辑前的版本 push 到独立的版本历史文件 `script-history.json`（通过 `ARTIFACT.SCRIPT_HISTORY` 常量引用），存储在 `data/projects/<id>/script-history.json`。每条记录包含 `{ version, scriptText, timestamp, source: 'ai_generated' | 'user_edit' }`。第一条标记为 `ai_generated`，后续为 `user_edit`。**不在 `project.json` 中，而是单独的 artifact 文件。**

**A2.** **数据具备，但无 diff 实现。** 系统通过 `getScriptHistory()` (orchestrator.ts) 可获取全量版本快照列表，还支持 `restoreScriptVersion()` (orchestrator.ts) 回滚。但**没有任何 diff 计算函数或 diff UI**——数据足以计算 diff，但需要自己实现。

**A3.** 编辑后点击"保存并继续"的完整数据流路径：
1. **UI:** `ScriptPage.handleSaveScript()` (ScriptPage.tsx) → `updateScript()`
2. **Hook:** `usePipeline.updateScript()` (usePipeline.ts) → `api.updateScript()`
3. **API:** `PUT /api/pipeline/:id/script` (client.ts)
4. **Route:** pipeline.ts → `svc.updateScript()`
5. **Orchestrator:** `updateScript()` (orchestrator.ts):
   - L903-L912: 保存旧版本到 `script-history.json`
   - L914-L917: 更新 `project.scriptOutput.scriptText`
   - L919: `saveProject()` 持久化
   - L923-L926: 更新 `script.json` artifact
   - **L930-L934: 通过 `parseScriptCIR()` 重建 ScriptCIR** 并保存到 `script.cir.json` — 这是关键步骤，使下游 TEMPORAL_PLANNING、STORYBOARD 能读到编辑后的版本

### A2：审批理由记录

**A4.** **不可以。** 拒绝场景时**无法输入理由**：
- UI: SceneGrid.tsx `onReject(scene.id)` 无理由参数
- API: client.ts `rejectScene()` 发送空 POST
- Orchestrator: `rejectScene()` (orchestrator.ts) 仅设置 `reviewStatus = 'rejected'`，**无任何 reason 字段**

**A5.** **部分实现。** 
- Route: `POST /api/pipeline/:id/qa-override` (pipeline.ts) 接受 `{ feedback?: string }` — **可选字段**
- 但 UI: ScriptPage.tsx 使用**硬编码字符串** `'用户手动覆盖审查结果'`，用户无法输入自定义理由
- Orchestrator: orchestrator.ts L1082 保存 `feedback` 到 `qa-review.json`，标记 `source: 'human'`
- **结论：理由被记录但始终是同一个硬编码字符串，无自由文本输入**

**A6.** **不存在。** `PipelineProject` 接口 (types.ts) 无 `notes`/`summary` 字段。仅有场景级的 `ProductionSpecs.notes`（镜头/灯光/音效注释），无项目级总结。

### A3：跨项目数据

**A7.** data 目录下跨项目共享文件清单：

| 文件 | 用途 |
|------|------|
| config.json | 全局配置（API Key、质量等级、并发数） |
| models.json | 各提供者的模型选择步骤定义 |
| resources.json | AI 资源账号（ChatGPT/Gemini/DeepSeek 等） |
| provider-presets.json | 提供者能力预设（文本/图片/视频标记） |
| queue-detection-presets.json | 视频站排队检测关键词和 ETA 正则 |
| selector-cache.json | 运行时检测到的 DOM 选择器缓存 |
| `style-templates/` | 可复用的 StyleProfile+FormatSignature 模板 |
| `profiles/` | 各提供者的浏览器 Profile 目录 |
| `cost-audit/` | 成本追踪 JSONL（`global-audit.json` + 各项目） |
| `logs/` | 日志目录 |
| `uploads/` | 用户上传的参考视频 |

**A8.** **仅限成本统计。** `CostTracker.getGlobalSummary()` (costTracker.ts) 跨所有项目聚合成本数据（`totalCostUsd`, `totalCalls`, `totalFallbackCalls`, `byProject`, `dailyTotals`）。但**不聚合质量指标、完成率、平均耗时等**。

**A9.** **支持跨项目共享。** `StyleLibrary` (styleLibrary.ts) 提供 `save()`/`load()`/`list()` 方法，将 StyleProfile + FormatSignature 保存到 style-templates，可跨项目复用。第二个同系列视频可以通过 StylePage 选择已保存的模板来读取第一个视频的 FormatSignature。

### A4：Prompt 可修改性

**A10.** **全部硬编码在 TypeScript 源码中。** prompts.ts 所有 prompt 都是 `export const` 模板字符串。`fillTemplate()` (L12-17) 做 `{key}` 占位符替换，但模板本身是代码内嵌。**不从外部文件/配置/数据库加载。**

**A11.** 必须编辑 prompts.ts 源码 → 重新构建 → 重启服务。无运行时修改路径。

**A12.** **不存在 prompt 覆盖机制。** 现有覆盖机制（`ModelOverrides`/`StageProviderOverrides`）仅覆盖模型/提供者，不涉及 prompt 内容。最接近的是 `validationFeedback`（QA 反馈追加到重试 prompt），但这不是用户可控的覆盖。

**A13.** **SettingsPage 无任何 prompt 相关配置项。** `AccountSettings` 中的 `advPromptInput` 是 DOM 选择器（聊天输入框的 CSS selector），不是 AI prompt 覆盖。

---

## Part B：重新生成能力

### B1：流水线重跑能力

**B14.** **支持从任意阶段重启。** `retryStage()` (orchestrator.ts):

```typescript
async retryStage(projectId: string, stage: PipelineStage): Promise<PipelineProject> {
    const project = this.loadProject(projectId);
    const stages = getStageOrder();
    const stageIdx = stages.indexOf(stage);
    for (let i = stageIdx; i < stages.length; i++) {
      if (project.stageStatus[stages[i]] !== 'pending') {
        transitionStage(project.stageStatus, stages[i], 'pending');
      }
    }
    project.error = undefined;
    this.sessionManager.clearGroup(projectId, stage);
    this.saveProject(project);
    return this.run(projectId);
}
```

API: `POST /api/pipeline/:id/retry/:stage` (pipeline.ts)。重置该阶段及所有后续阶段为 `pending`，保留上游已完成的结果。

**B15.** **从磁盘上的项目 artifact JSON 文件读取。** 每个阶段通过 `ctx.loadArtifact<T>(filename)` 读取上游数据，对应文件在 `data/projects/<projectId>/` 下（如 `style-profile.json`, `research.json`, `script.json`, `scenes.json`）。纯文件持久化，无内存缓存依赖。

**B16.** N/A — 支持部分重跑（见 B14）。

### B2：逐阶段重新生成汇总表

| 阶段 | UI 按钮 | API 端点 | 备注 |
|------|---------|---------|------|
| STYLE_EXTRACTION | ✅ "开始风格分析" + "手动粘贴" + "保存风格修改" | `POST /start` + `POST /style-profile` + `POST /retry/STYLE_EXTRACTION` | 可重跑分析或手动设置 |
| RESEARCH | ❌ 无专用按钮 | `POST /retry/RESEARCH` | API 可用但 UI 缺失 |
| NARRATIVE_MAP | ❌ 无专用按钮 | `POST /retry/NARRATIVE_MAP` | API 可用但 UI 缺失 |
| SCRIPT_GENERATION | ❌ 无重新生成按钮（仅文本编辑） | `POST /retry/SCRIPT_GENERATION` | **关键缺口**：API 可用但 UI 缺失 |
| QA_REVIEW | ✅ "覆盖 QA 审查" | `POST /qa-override` + `POST /retry/QA_REVIEW` | 可覆盖或重跑 |
| STORYBOARD | ❌ 无专用按钮 | `POST /retry/STORYBOARD` | API 可用但 UI 缺失 |
| 单个场景参考图 | ✅ SceneGrid/ScenePreviewModal "重新生成" | `POST /scenes/:sceneId/regenerate` | 支持 feedback 参数 |
| 单个场景视频 | ✅ ProductionPage 场景卡片 "重新生成" | `POST /scenes/:sceneId/regenerate` | 同一端点，级联重做 |
| TTS（全部） | ❌ 无专用按钮（仅在报错时有 retry） | `POST /retry/TTS` | API 可用但 UI 缺失 |
| TTS（单个场景） | ❌ 无 | **无端点** | **不可重新生成** |
| ASSEMBLY | ✅ 报错时 "重试" + "重新运行全部" | `POST /retry/ASSEMBLY` | 可重跑 |

### B3：脚本重新生成缺口

**B17.** **ScriptPage 无"重新生成脚本"按钮。** 仅有文本编辑（textarea）、保存并继续、跳过、覆盖 QA。无 AI 重新调用能力。

**B18.** **最小改动：约 3 行 UI 代码。** `POST /api/pipeline/:id/retry/SCRIPT_GENERATION` 后端已完全可用。仅需在 ScriptPage FAB 中添加一个按钮：
```tsx
{ label: '重新生成脚本', onClick: () => retryStage(current.id, 'SCRIPT_GENERATION') }
```
`retryStage` 函数已通过 `useProject()` context 可用（StoryboardPage 和 ProductionPage 已在使用）。

**B19.** **不可带参数。** `retryStage` API (pipeline.ts) **不解析请求体**，`orchestrator.retryStage()` 仅接受 `(projectId, stage)` 两个参数。与之对比，`regenerateScene` 接受 `feedback` 参数。要支持参数化重新生成需要：修改路由解析 body → 传递到 orchestrator → 存储到 project → 注入到 prompt。

---

## Part C：UI 交互

### C20. PipelinePage（项目仪表盘）

**输入框：** 视频主题文本框、项目标题文本框、搜索框、排序选择器（时间/标题/状态）、参考视频文件上传、项目导入文件选择

**操作按钮：**
- 5 个项目模板快捷按钮（科普/产品/深度/新闻/自定义）→ 填充主题
- 风格模板选择按钮（动态列表）→ 设置 `selectedTemplateId`
- **"创建项目"** → `POST /api/pipeline` + 可选 `POST /start`
- 项目卡片"进入" → 导航
- 项目卡片"导出" → `GET /api/pipeline/:id/export`
- 项目卡片"删除" → ConfirmModal → `DELETE /api/pipeline/:id`
- "导入项目" → `POST /api/pipeline/import`
- 设置面板切换 → 内嵌 `DashboardSettingsPanel`

### C21. StylePage（风格配置）

**可编辑字段（StyleProfileView 组件）：**
- 核心摘要：`visualStyle`, `pacing`, `tone`, `colorPalette`（调色板增删）, `narrativeStructure`（列表增删）, `emotionalIntensity`（滑块 0-1）, `hookType`, `callToActionType`, `wordCount`, `wordsPerMinute`
- Track A 脚本风格（12 字段）：`hook_strategy`, `hook_example`, `narrative_arc`, `emotional_tone_arc`, `rhetorical_core`, `sentence_length_avg/max/unit`, `interaction_cues_count`, `cta_pattern`, `metaphor_count`, `jargon_treatment`
- Track B 视觉风格（9 字段）：`base_medium`, `lighting_style`, `camera_motion`, `color_temperature`, `scene_avg_duration_sec`, `transition_style`, `visual_metaphor_mapping`, `b_roll_ratio`, `composition_style`
- Track C 音频风格（5 字段）：`bgm_genre`, `bgm_mood`, `bgm_tempo`, `bgm_relative_volume`, `voice_style`, `audio_visual_sync_points`

**操作按钮：**
- "保存风格修改" → `POST /api/pipeline/:id/style-profile`
- "手动粘贴分析结果" → 文本区 → "应用并跳过自动分析" → `POST /style-profile`
- "停止分析" → `POST /api/pipeline/:id/stop`
- "编辑完整风格" / "返回概览" → 本地状态切换
- "保存为风格模板" → `POST /api/style-templates`
- **FAB "开始风格分析"** → `POST /api/pipeline/:id/start`
- **FAB "继续到脚本"** → 导航

### C22. ScriptPage（脚本审查）

**布局：**
- **左栏** `ScriptEditorPanel`：逐场景 `SceneCard`（可编辑 textarea）+ QA banner（确认/覆盖按钮）
- **右栏** `ScriptQualityPanel`：QA 评分（折叠）、脚本验证指标、污染检测、风格置信度告警、研究事实（可编辑）、叙事节拍（可编辑）
- **底部** `ScriptAuditSection`（折叠）：修正建议、风格一致性分数、问题列表

**操作清单：**
- 逐场景文本编辑 → `useAutoSave` 本地状态
- "保存脚本" → `PUT /api/pipeline/:id/script`
- "恢复流水线" → `POST /api/pipeline/:id/resume`
- 编辑研究事实 → `PUT /api/pipeline/:id/artifacts/research.json`
- 删除研究事实 → 同上
- 编辑叙事节拍 → `PUT /api/pipeline/:id/artifacts/narrative-map.json`
- "覆盖 QA 审查" → `POST /api/pipeline/:id/qa-override`
- FAB（SCRIPT_GENERATION 暂停时）："保存并继续" / "跳过"
- FAB（QA_REVIEW 暂停时）："确认脚本"
- FAB（全部完成后）："编辑脚本" / "继续到视觉"

### C23. StoryboardPage（分镜审批）

**逐场景操作（SceneGrid + ScenePreviewModal）：**
- ✅ 通过场景 / ❌ 拒绝场景 → `POST /scenes/:sceneId/approve|reject`
- 🔄 重新生成场景（可带 feedback）→ `POST /scenes/:sceneId/regenerate`
- 🖼️ 仅重新生成关键帧 → 同端点（硬编码 feedback 文本）
- 全选 / 批量通过 / 批量重新生成
- ScenePreviewModal：编辑叙事文本、编辑 visualPrompt、带修改后 prompt 重新生成、人脸修复、下载图片、前后翻页
- "确认参考图" → `POST /api/pipeline/:id/approve-reference`
- AnchorModal：参考图详情 + 风格编辑
- **FAB "确认分镜，生成参考图"** → 保存场景 `PUT /scenes` + `POST /resume`
- **FAB "风格满意，生成全部场景"** → `POST /approve-reference`
- **FAB "不满意，重新生成参考图"** → `POST /retry/REFERENCE_IMAGE`
- **FAB "继续到制作"** → 导航

### C24. ProductionPage（生产监控）

- **"开始生产"** → `POST /api/pipeline/:id/start`（仅当 KEYFRAME_GEN 已完成且未运行时可用）
- **"停止"** → ConfirmModal → `POST /api/pipeline/:id/stop`
- **"重试 {stage}"**（报错时）→ `POST /retry/:failedStage`（仅重试失败阶段）
- **"重新运行全部"**（报错时）→ ConfirmModal → `POST /start`（重跑全部制作阶段）
- 逐场景"重新生成" → `POST /scenes/:sceneId/regenerate`
- 展开/折叠场景网格
- **VideoPlayer**：`<video>` 播放 + **"下载视频"按钮** → `api.getVideoDownloadUrl()`（仅 ASSEMBLY 完成后可用）
- "回到仪表盘" → 导航

### C25. ReplayPage（最终预览）

- Trace 选择下拉框 → `GET /api/pipeline/:id/traces`
- SpanGraphView 点击 span → 本地滚动高亮
- 展示组件：TraceHeader、FailureDetail、TraceTimeline、CostLatencyView、AiCallDiffView、SpanGraphView、ProviderSwitchView
- **无导出/下载操作。** ReplayPage 是纯诊断分析视图。视频下载在 ProductionPage 的 VideoPlayer 中。

### C26. SettingsPage（设置）

1. **资源概览仪表盘**：5 个状态卡片（AI 聊天/API Key/视频资源/TTS/FFmpeg）— 只读
2. **AI 账号管理**（AccountSettings）：
   - 资源表格（类型/名称/能力/配额/登录状态）
   - 每个资源：登录/关闭登录/删除
   - 重置所有配额 → `POST /api/resources/reset-quotas`
   - 从 URL 添加 → `POST /api/providers/from-url`
   - 手动添加提供者（6 字段）→ `POST /api/providers`
   - AIVideoMaker API Key → `POST /api/config`
   - 生产并发数（1-5）→ `POST /api/config`
3. **TTS 配置**：语音选择下拉框、加载全部语言、语速/音调调整、保存 → `POST /api/config/tts`
4. **排队检测**：各提供者关键词/ETA 模式编辑、添加/删除、保存 → `POST /api/config/queue-detection`
5. **高级**：环境状态显示 + 安装 Chromium/edge-tts 按钮

### C2：数据流断点检查

**C27.** **自动使用编辑后版本。** 用户点击"保存并继续"时，`handleSaveScript()` 先保存 → `handleResume()` 恢复流水线 → `orchestrator.updateScript()` 重建 ScriptCIR → STORYBOARD 阶段读取已更新的 `project.scriptOutput.scriptText`。无需手动触发。

**C28.** **自动使用修改后的 prompt。** FAB "确认分镜，生成参考图" 的 `handleConfirmAndContinue()` (StoryboardPage.tsx) 先调用 `updateScenes()` (`PUT /api/pipeline/:id/scenes`) 持久化编辑后的场景（含修改后的 `visualPrompt`），然后 `resumePipeline()` 继续到 REFERENCE_IMAGE — 读取已持久化的场景。

**C29.** **仅影响未执行 TTS 的项目。** TTS 配置保存到全局 config。TTS 阶段执行时读取当前 config。已完成 TTS 的项目不受影响。要用新语音重做 TTS，需手动调用 `retryStage('TTS')` — 但 UI 上仅在报错时才显示 retry 按钮，无主动 retry TTS 的入口。

### C3：错误恢复

**C30.** 阶段报错时 UI 显示：
- ProjectLayout 头部：红色错误徽章 + 截断错误信息 + **"重试"按钮**（重试失败阶段）
- ProductionPage：红色错误横幅 + FAB "重试 {stage}" / "重新运行全部"
- 逐场景错误：场景卡片红色指示器 + "重新生成"
- **可用选项：** ✅ 重试（特定失败阶段）、✅ 重跑全部（制作阶段）、✅ 重新生成单个场景
- **不可用：** ❌ 跳过阶段、❌ 中止/取消项目（只能删除）

**C31.** **可以。** 所有项目状态持久化到磁盘（projects）。重新打开后：
- `usePipeline` hook 通过 `api.getProject()` 获取项目状态
- `usePageGuard` 根据完成状态重定向到正确页面
- `isPaused: true` 时 FAB 显示恢复操作
- 报错状态时可使用 retry
- **限制：** 如果后端进程也重启了且流水线正在 `processing` 中，可能会卡在 processing 状态需要手动 retry

**C32.** **不存在"重置项目"功能。** 搜索 `resetProject`/`clearProject`/`clearResults` 无匹配。仅有替代方案：删除项目后重建、或逐阶段 retryStage。

---

## Part D：配置与参数

### D33. 影响生成质量的参数清单

| 参数 | 文件 | 默认值 | 修改方式 |
|------|------|--------|----------|
| **N-gram 去重错误阈值** | scriptValidator.ts `deduplicationErrorMin` | `0.70` | 硬编码 |
| **N-gram 去重告警阈值** | 同上 `deduplicationWarnMin` | `0.80` | 硬编码 |
| **污染检测 N-gram 大小** | contamination.ts `NGRAM_SIZE` | `4` | 硬编码 |
| **污染检测阈值** | 同上 `CONTAMINATION_THRESHOLD` | `0.3` | 硬编码 |
| **骨架-写作对齐容差** | scriptGeneration.ts | `±30%` (0.7-1.3) | 硬编码 |
| **骨架-写作漂移告警** | 同上 | `>30%` 槽位超标 | 硬编码 |
| **QA B2: 子分拒绝** | qaReview.ts | `minSub < 5 && overall >= 8` | 硬编码 |
| **QA B2: 分差告警** | 同上 L160 | `maxSub - minSub > 4` | 硬编码 |
| **QA B2: 正向覆盖** | 同上 | `overall >= 8 && minSub >= 5` | 硬编码 |
| **QA 审批阈值** | 同上 | `overall_score >= 8` | 硬编码 |
| **QA 污染阻断** | 同上 L218 | `score > 0.3` | 硬编码 |
| **参考图一致性阈值** | referenceImage.ts `CONSISTENCY_THRESHOLD` | `40` | 硬编码 |
| **相邻 SSIM 阈值** | 同上 L47 `ADJACENT_SSIM_THRESHOLD` | `0.3` | 硬编码 |
| **一致性最大重试** | 同上 L44 `CONSISTENCY_MAX_RETRIES` | `2` (via `getRetryBudget()`) | 环境变量 `SCENE_MAX_RETRIES` |
| **视觉一致性 retry 阈值** | sceneQuality.ts | `65` | 硬编码 |
| **整体降级阈值** | 同上 L66 | `70` | 硬编码 |
| 视觉一致性权重 | visualConsistency.ts | color:0.45/brightness:0.15/temp:0.15/style:0.25 | 硬编码 |
| **参考转录截取长度** | scriptGeneration.ts | `300` 字符 | 硬编码 |
| QA 转录截取长度 | qaReview.ts | `500` 字符 | 硬编码 |
| **视频生成最大重试** | videoGen.ts `VIDEO_MAX_RETRIES` | `2` | 环境变量 `SCENE_MAX_RETRIES` |
| **TTS 并发数** | tts.ts | `2` (from `productionConcurrency`) | **UI + API** (`POST /api/config`) |
| **节奏相关性错误阈值** | scriptValidator.ts `rhythmCorrelationErrorMin` | **`0.30`** ⚠️（文档称 0.6，代码为 0.3） | 硬编码 |
| **节奏相关性告警阈值** | 同上 `rhythmCorrelationWarnMin` | `0.50` | 硬编码 |
| 最短场景时长 | temporalPlanning.ts | `3` 秒 | 硬编码 |
| 最长场景时长 | 同上 L18 | `20` 秒 | 硬编码 |
| 节奏混合因子 | 同上 | `0.3` (30%) | 硬编码 |
| 最小视频场景数 | videoIRCompile.ts | `2` | 硬编码 |
| 最小 visualPrompt 长度 | storyboard.ts | `80` 字符 | 硬编码 |
| 视频压缩目标码率 | videoCompress.ts | `1000k` | 硬编码 |
| TTS 静音检测阈值 | tts.ts | `-60` dB | 硬编码 |
| 断路器失败阈值 | retryResilience.ts | `3` 次连续失败 | 硬编码 |
| 断路器重置超时 | 同上 | `30,000` ms | 硬编码 |

**D34.** 可通过 UI/API 修改（不改代码）：

| 参数 | 修改方式 |
|------|----------|
| TTS 语音/语速/音调 | SettingsPage → TTS + `POST /api/config/tts` |
| 生产并发数 | SettingsPage → 高级 + `POST /api/config` |
| 模型覆盖（按任务类型） | ModelOverridePanel + 项目 API |
| 阶段提供者覆盖 | StageProviderPanel + 项目 API |
| 视频模型偏好 | `POST /api/config { videoModel }` |
| 降级策略 | `POST /api/config { fallbackPolicy }` |
| 排队检测规则 | SettingsPage + `POST /api/config/queue-detection` |
| 视频重试次数 | 环境变量 `SCENE_MAX_RETRIES`（非 UI） |

**其余全部硬编码** — 所有脚本验证阈值、QA 阈值、视觉一致性阈值、时序参数、压缩设置均需改代码。

### D35. 各阶段实际使用模型映射

| 阶段/任务 | 适配器 | 提供者 | 模型 |
|-----------|--------|--------|------|
| safety_check | chat | 任意 | 默认 |
| video_analysis | chat | **gemini** | Gemini 3.1 Pro |
| fact_research | chat | **gemini** | Gemini 3.1 Pro (+ Google Search) |
| claim_verification | chat | 任意（与 research 不同提供者） | 默认 |
| calibration | chat | 任意 | 默认 |
| narrative_map | chat | 任意 | Gemini 3.1 Pro |
| script_skeleton | chat | **claude** | 默认 |
| script_writing | chat | **claude** | 默认 |
| quality_review | chat | **chatgpt** | 默认（交叉模型 QA，避免自审） |
| temporal_planning | chat | 任意 | 无（纯计算） |
| visual_prompts | chat | 任意 | Gemini 3.1 Pro |
| image_generation | chat | **chatgpt** | 默认（ChatGPT 免费图片生成） |
| video_generation | **api** | **aivideomaker** | 默认 |
| tts | — | edge-tts | 免费 TTS |
| assembly | — | FFmpeg | 非 AI |

（以上为 `DEFAULT_ROUTES` 定义，qualityRouter.ts。实际运行时可被 stageProviderOverrides 和 modelOverrides 覆盖。）

**D36.** 模型覆盖优先级链 (orchestrator.ts)：

```
stageProviderOverrides[stage] > modelOverrides[taskType] > DEFAULT_ROUTES[taskType] > 提供者注册表降级
```

**确认：`stageProviderOverrides` > `modelOverrides` > `DEFAULT_ROUTES`**。

**D37.** SettingsPage 上的模型相关配置：
- **SettingsPage 本身不直接暴露模型选择。** 它管理的是提供者账号、API Key、TTS、并发数。
- **模型覆盖在项目级别配置**，通过 `ModelOverridePanel` (ModelOverridePanel.tsx)：
  - 按任务类型覆盖：image_generation, video_generation, tts, script_generation
  - 按阶段路由表查看（只读）
  - 适配器选择：default / free chat / paid API
  - API 模式下可指定模型名称

---

## 发现的关键缺口

| # | 缺口 | 影响 | 严重度 |
|---|------|------|--------|
| 1 | **ScriptPage 无"重新生成脚本"按钮** — 后端 API 完全就绪，UI 仅缺 1 个按钮 | 用户无法快速让 AI 重写脚本，只能手动编辑 | **高** |
| 2 | **所有 prompt 硬编码，无运行时覆盖机制** — 30+ 个 prompt 模板全在 prompts.ts 中，修改需改源码重启 | 无法快速迭代 prompt 调优，实验成本极高 | **高** |
| 3 | **场景拒绝无理由输入** — 拒绝按钮直接执行，无反馈文本框 | AI 重新生成时缺乏方向指引，可能反复犯同样错误 | **高** |
| 4 | **retryStage 不支持参数/指令** — 重跑时无法附带用户意图（如"Hook 要更有冲击力"） | 重跑只能重复相同输入，无法针对性改进 | **高** |
| 5 | **30+ 质量阈值全部硬编码** — 脚本验证、QA、视觉一致性等阈值无 UI/API 配置路径 | 调优需改代码重启，无法按项目/风格灵活调整 | **中-高** |
| 6 | **单场景 TTS 不可重新生成** — 无 API 端点 | 一个场景语音有问题需重跑全部 TTS | **中** |
| 7 | **无"重置项目"功能** — 保留配置重头跑需删除后重建 | 迭代调试流程繁琐 | **中** |
| 8 | **QA 覆盖理由硬编码，用户无法输入自定义理由** | 审计追溯时无法知道覆盖原因 | **中** |
| 9 | **文档与代码不一致** — Pearson 节奏阈值文档写 ≥ 0.6，代码实际为 error=0.3/warn=0.5 | 误导后续开发和调优 | **中** |
| 10 | **无跨项目质量统计聚合** — 仅有成本统计，无完成率/平均耗时/常见错误 | 无法数据驱动地改进系统 | **低-中** |
| 11 | **无脚本 diff 视图** — 版本历史数据已存在但无 diff 计算和 UI | 用户看不到 AI 原始版本和编辑版本的差异 | **低** |
| 12 | **无项目级备注/总结字段** | 项目完成后缺乏复盘记录能力 | **低** |

---

## 好消息：基础设施比预期好

| 能力 | 状态 | 意义 |
|------|------|------|
| 脚本版本历史 | ✅ 已有 `script-history.json` | 不需要新建，diff 数据已就绪 |
| 从任意阶段重跑 | ✅ `POST /retry/:stage` 全部可用 | 反馈闭环的"改了→重跑"路径后端已通 |
| 风格模板跨项目复用 | ✅ StyleLibrary 已有 | 同系列视频一致性有基础 |
| 成本追踪 | ✅ CostTracker 已有 | 只需补质量维度 |
| 项目持久化到磁盘 | ✅ 全量 artifact 文件 | 历史数据可追溯 |

## 关键瓶颈：只有 2 个真正阻塞反馈闭环

审计发现了 12 个缺口，但对"反馈闭环"来说，**真正阻塞的只有 2 个**：

**瓶颈 1：Prompt 不可运行时修改**

你发现脚本 Hook 弱 → 想改 prompt → 必须改源码 → 重启服务 → 重建项目 → 重跑。这个摩擦力太大，实际操作中你会放弃迭代。

**瓶颈 2：重跑不能带指令**

`retryStage('SCRIPT_GENERATION')` 只能用相同输入重跑。你没办法说"这次 Hook 要用反直觉事实开头"。等于重跑是碰运气，不是定向改进。

其他 10 个缺口（脚本重新生成按钮、场景拒绝理由、阈值硬编码等）都是**有用但不阻塞**——没有它们闭环也能转，只是体验差一点。

---

## 实施方案：给项目 AI 的 prompt

---

# 任务：实现反馈闭环系统（4 项改动）

## 优先级说明

按依赖顺序实现。第 1 项解锁 prompt 迭代能力，第 2 项解锁定向重跑，第 3 项补 UI 缺口让闭环可操作，第 4 项记录迭代历史供追溯。

---

## 1. 🔴 Prompt 运行时覆盖机制

### 问题

`prompts.ts` 中 30+ 个 prompt 全部硬编码，修改需改源码重启。这是反馈闭环最大的瓶颈——用户发现问题后无法快速调整 prompt 重跑对比。

### 设计

复用已有的 override 模式（`modelOverrides`、`stageProviderOverrides`），新增 `promptOverrides`：

```typescript
// 在 PipelineProject 接口中新增
interface PipelineProject {
  // ...现有字段
  promptOverrides?: Record<string, string>;  
  // key = prompt 常量名（如 "WRITING_SYSTEM_PROMPT"）
  // value = 完整替换文本，或 null 表示使用默认
}
```

### 实现

**Step 1：修改 prompt 读取逻辑**

在 `prompts.ts` 或新建 `promptResolver.ts` 中：

```typescript
import * as defaults from './prompts';

export function resolvePrompt(
  promptName: string, 
  project: PipelineProject
): string {
  // 项目级覆盖优先
  const override = project.promptOverrides?.[promptName];
  if (override) return override;
  
  // 回退到默认
  return (defaults as Record<string, string>)[promptName] ?? '';
}
```

**Step 2：修改所有使用 prompt 的地方**

找到所有直接引用 `WRITING_SYSTEM_PROMPT`、`SKELETON_SYSTEM_PROMPT` 等常量的代码位置（主要在 `scriptGeneration.ts`、`qaReview.ts`、`storyboard.ts` 等 stage 实现中），改为通过 `resolvePrompt()` 读取。

示例改法：
```typescript
// 改前：
const systemPrompt = fillTemplate(WRITING_SYSTEM_PROMPT, vars);

// 改后：
const systemPrompt = fillTemplate(
  resolvePrompt('WRITING_SYSTEM_PROMPT', project), 
  vars
);
```

**Step 3：新增 API 端点**

```typescript
// 读取当前项目的所有 prompt（含默认值和覆盖）
GET /api/pipeline/:id/prompts
// 返回：{ [promptName]: { default: string, override: string | null, active: string } }

// 覆盖特定 prompt
PUT /api/pipeline/:id/prompts/:promptName
// Body: { content: string }
// 保存到 project.promptOverrides[promptName]

// 重置为默认
DELETE /api/pipeline/:id/prompts/:promptName
// 删除 project.promptOverrides[promptName]

// 查看所有可覆盖的 prompt 名称和默认内容
GET /api/prompts/defaults
// 返回所有 prompt 常量名和对应文本
```

**Step 4：持久化**

`promptOverrides` 保存在 `project.json` 中（与 `modelOverrides` 同级）。每次 `saveProject()` 自动持久化。

### 不做什么

- 不做 UI 编辑器（先用 API，跑通闭环后再加 UI）
- 不做 prompt 全局覆盖（只做项目级，避免影响其他项目）
- 不做 prompt 变量（`{topic}` 等占位符）的覆盖——只覆盖模板本身，变量替换逻辑不变

---

## 2. 🔴 retryStage 支持用户指令

### 问题

`retryStage(projectId, stage)` 不接受任何参数。重跑脚本生成时无法附带用户意图（如"Hook 要用反直觉事实""语气更口语化"）。

### 设计

在重跑时接受一个可选的 `userDirective` 文本，注入到对应阶段的 prompt 中。

### 实现

**Step 1：修改 retryStage API**

```typescript
// pipeline.ts 路由
// 改前：
router.post('/:id/retry/:stage', ...);
// req.body 不解析

// 改后：
router.post('/:id/retry/:stage', ...);
// req.body: { directive?: string }
```

**Step 2：修改 orchestrator.retryStage()**

```typescript
async retryStage(
  projectId: string, 
  stage: PipelineStage, 
  directive?: string  // 新增参数
): Promise<PipelineProject> {
  const project = this.loadProject(projectId);
  
  // 存储指令，供下次执行该阶段时读取
  if (directive) {
    project.retryDirective = { stage, directive, timestamp: new Date().toISOString() };
  }
  
  // ...原有的重置逻辑不变
  this.saveProject(project);
  return this.run(projectId);
}
```

**Step 3：在脚本生成中消费指令**

在 `scriptGeneration.ts` 的 prompt 组装逻辑中，检查 `project.retryDirective`：

```typescript
// 在构建 WRITING_USER_PROMPT 变量时
let additionalGuidance = '';
if (project.retryDirective?.stage === 'SCRIPT_GENERATION' && project.retryDirective.directive) {
  additionalGuidance = `\n\n## User Directive for This Generation\n${project.retryDirective.directive}\n`;
  // 使用后清除，避免影响后续重跑
}

const vars = {
  // ...现有变量
  user_directive: additionalGuidance,
};
```

在 WRITING_USER_PROMPT 模板末尾（`{format_signature_section}` 之后）加一个占位符：
```
{user_directive}
```

**Step 4：其他阶段同理**

对 STORYBOARD、RESEARCH 等阶段做同样处理——检查 `retryDirective.stage` 是否匹配当前阶段，匹配则注入。

### 不做什么

- 不做复杂的指令解析（用户输入什么就原样注入）
- 指令用完即清除，不持久化到历史（历史由第 4 项的迭代记录负责）

---

## 3. 🟡 ScriptPage 补齐 3 个 UI 入口

### 3a. "重新生成脚本"按钮

审计确认：后端 `POST /api/pipeline/:id/retry/SCRIPT_GENERATION` 已完全可用。

在 ScriptPage FAB 区域新增按钮（与"保存并继续"并列）：

```tsx
{
  label: '重新生成脚本',
  icon: RefreshIcon,
  onClick: () => {
    // 可选：弹出文本输入框让用户输入指令
    const directive = await showDirectiveDialog();  
    retryStage(project.id, 'SCRIPT_GENERATION', directive || undefined);
  },
  variant: 'secondary'
}
```

如果 `showDirectiveDialog` 实现复杂，先做简单版——无指令直接重跑。指令输入后续补。

### 3b. "重新生成脚本"时的指令输入

新增一个简单的对话框组件（或复用现有 Modal）：

```
┌─────────────────────────────────────────┐
│  重新生成脚本                            │
│                                          │
│  给 AI 的指令（可选）：                   │
│  ┌──────────────────────────────────┐   │
│  │ 例如：Hook 要用反直觉事实开头，    │   │
│  │ 整体语气更口语化像 B 站 UP 主     │   │
│  └──────────────────────────────────┘   │
│                                          │
│  [取消]              [重新生成]           │
└─────────────────────────────────────────┘
```

### 3c. 场景拒绝时的理由输入

审计确认：`regenerateScene` 已支持 `feedback` 参数，但 `rejectScene` 不支持。

修改 StoryboardPage 的拒绝流程：

```typescript
// 改前（SceneGrid.tsx）：
onReject(scene.id)  // 无理由

// 改后：
const reason = await showReasonDialog();  // 弹出文本框
onReject(scene.id, reason);
```

同时修改 `rejectScene` API 和 orchestrator 方法接受 `reason` 参数，存储到 scene 对象中。

---

## 4. 🟡 迭代记录系统

### 问题

用户改了 prompt/参数，重跑项目，效果变好或变坏——但下次忘了改过什么。需要记录"改了什么 → 效果如何"。

### 实现

**独立文件**：`data/iterations.jsonl`

**数据结构**：

```typescript
interface IterationRecord {
  id: string;                     // 自动生成
  timestamp: string;
  // 触发源
  trigger: {
    projectId: string;
    problems: string[];           // 用户描述的问题
  };
  // 做了什么改动
  change: {
    type: 'prompt' | 'parameter' | 'model' | 'directive';
    target: string;               // 如 "WRITING_SYSTEM_PROMPT"
    before?: string;              // 改前值（prompt 文本或参数值）
    after: string;                // 改后值
    description: string;          // 一句话描述
  };
  // 效果（后填）
  result?: {
    projectId: string;            // 改后跑的项目
    resolved: boolean;            // 问题是否解决
    notes: string;                // 效果描述
  };
}
```

**API**：

```typescript
// 记录一次修改
POST /api/iterations
Body: { trigger, change }
→ 自动生成 id 和 timestamp，追加到 iterations.jsonl

// 补充效果
PATCH /api/iterations/:id
Body: { result }
→ 更新对应记录的 result 字段

// 查看所有记录
GET /api/iterations
→ 返回全部记录，最新在前

// 查看某个 prompt 的修改历史
GET /api/iterations?target=WRITING_SYSTEM_PROMPT
→ 过滤返回
```

**自动记录**：当用户通过 `PUT /api/pipeline/:id/prompts/:promptName` 修改 prompt 时，**自动创建一条迭代记录**（before = 默认文本或上一次覆盖，after = 新内容）。用户只需后续补 `result`。

---

## 不做什么（明确排除）

| 不做的事 | 原因 |
|---------|------|
| Prompt UI 编辑器 | 先用 API 验证闭环可行性。UI 后续按需加 |
| 阈值参数化 API | 30+ 个阈值全部开放配置过度了。先跑视频，哪个阈值真的需要调再单独开放 |
| 跨项目质量统计聚合 | 先积累 10+ 项目数据再说 |
| 脚本 diff UI | 版本数据已有，diff 是纯展示，不影响闭环运转 |
| 单场景 TTS 重新生成 | 优先级低，重跑全部 TTS 只要 30-50 秒 |
| 项目重置功能 | `retryStage` 从第一阶段重跑等效于重置 |

---

## 完成标准

1. `tsc --noEmit` 编译通过
2. 现有测试无回归
3. 为新增的 API 端点写基本测试（至少覆盖：prompt 覆盖读写、retryStage 带 directive、迭代记录 CRUD）
4. 输出完整 API 端点清单（新增 + 现有相关的）和请求/响应示例
5. 说明完整的用户操作流程：
   ```
   跑视频 → 审查脚本 → 发现 Hook 弱 
   → 查看当前 SKELETON_SYSTEM_PROMPT 
   → 覆盖 prompt 
   → 带指令重新生成脚本 
   → 对比效果 
   → 记录迭代结果
   ```

---

这 4 项改动完成后，你就可以用以下流程迭代视频质量了：

```
跑视频 → 脚本暂停 → 发现问题（比如 Hook 弱）
→ curl GET /api/pipeline/{id}/prompts  查看当前 prompt
→ curl PUT /api/pipeline/{id}/prompts/SKELETON_SYSTEM_PROMPT  覆盖 prompt
→ 在 ScriptPage 点"重新生成脚本"（带指令"Hook 用反直觉事实"）
→ 对比新旧脚本
→ curl PATCH /api/iterations/{id}  记录效果
→ 满意 → 批准继续
```

全程不需要改源码、不需要重启服务。   

