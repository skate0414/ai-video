# 验收报告模板说明

本文档定义 `src/testing/reports/` 下后端验收报告的标准格式，用于保证不同时间、不同同学执行出来的验收报告可以横向比较、可读、可归档。

## 1. 报告输出位置

标准后端验收命令：

```bash
npm run accept:backend -- "验收主题"
```

执行后会自动输出到：

- `src/testing/reports/<timestamp>-<topic>.md`
- `src/testing/reports/<timestamp>-<topic>.json`

如果需要 CI 或多人协作归档，也可以使用：

- `--report-name <name>`
- `--report-dir <dir>`

目录命名、保留策略、归档建议见：

- `src/testing/reports/README.md`

其中：

- `.md` 适合人看、评审、贴到 issue / PR / 周报
- `.json` 适合后续脚本化分析、归档与比较

## 2. 报告固定结构

每份报告应包含以下 6 个固定部分：

1. 基础信息
2. 步骤结果
3. 项目状态摘要
4. 运行诊断摘要
5. 失败上下文（仅失败时更关键）
6. 最终结论

## 3. Markdown 报告模板

标准结构如下：

```md
# 后端验收报告

- 报告版本：1.0
- 生成时间：
- 主题：
- 标题：
- 质量档位：
- 服务地址：
- 项目 ID：
- 总体结果：通过 / 失败
- 总耗时：
- Git Branch：
- Git Commit：
- Git Dirty：yes / no

## 步骤结果

- preflight: passed (00:12)
  - 预检查通过
- create-project: passed (00:01)
  - projectId=...
- auto-run-project: failed (03:25)
  - 具体错误...

## 项目状态摘要

- currentStage:
- currentStatus:
- isPaused:
- error:
- completedStages:
- failedStages:
- finalVideoPath:

## 运行诊断摘要

- config.qualityTier:
- config.hasApiKey:
- config.productionConcurrency:
- config.videoProfiles:

### 账号摘要

- chatgpt: total=5, available=5, exhausted=0
- gemini: total=2, available=1, exhausted=1

### 阶段统计

- completed:
- failed:
- pending:
- processing:
- paused:
- sceneTotal:
- sceneVideo:
- sceneImage:
- scenePendingAssets:

### 失败上下文

- 当前阶段: VIDEO_GEN
- 当前状态: failed
- 项目错误: ...
- 验收失败原因: ...

## 结论

- 本次标准后端验收流程已完成，主链路达到通过条件。
```

## 4. JSON 报告字段说明

建议将 JSON 报告视为结构化事实源，字段应尽量稳定。

当前关键字段：

- `reportVersion`
- `generatedAt`
- `topic`
- `title`
- `qualityTier`
- `serverUrl`
- `projectId`
- `success`
- `fatalError`
- `totalElapsed`
- `git`
- `steps[]`
- `projectSummary`
- `diagnostics`

### `git`

用于表达本次验收报告对应的仓库来源：

- `branch`
- `commit`
- `shortCommit`
- `isDirty`

其中：

### `steps[]`

每一步至少包含：

- `name`
- `status`
- `duration`
- `durationMs`
- `detail`

### `projectSummary`

用于表达最终项目状态：

- `currentStage`
- `currentStatus`
- `isPaused`
- `error`
- `completedStages`
- `failedStages`
- `finalVideoPath`

### `diagnostics`

用于表达失败时最重要的辅助诊断信息：

- `configSummary`
- `accountSummary`
- `projectStageStats`
- `failureContext`

## 5. 什么样的报告算“合格”

一份合格的验收报告至少应满足：

- 可以看出这次验收在测什么主题
- 可以知道是否成功
- 可以知道对应的是哪个 branch / commit
- 可以知道失败在哪一步
- 可以知道失败时的配置、账号、阶段状态
- 可以支持后续复测与对比

如果一份报告只写“失败了”，但看不出失败步骤、失败阶段、配置状态和账号可用性，那它不算合格报告。

## 6. 团队使用建议

- PR 验收时优先附 `.md` 报告
- 自动化归档或统计时使用 `.json` 报告
- 同一问题多次复测时，保留多份报告，不要覆盖
- 报告版本升级时更新本模板文档