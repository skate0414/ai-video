# 验收报告目录说明

本目录用于存放 `src/testing/scripts/accept-backend.mjs` 自动生成的后端验收报告。

目标不是简单“存日志”，而是让多人协作、CI 跑批、问题复测都能有稳定的归档约定。

## 1. 默认输出规则

默认执行：

```bash
npm run accept:backend -- "验收主题"
```

默认会生成到当前目录：

- `src/testing/reports/<timestamp>-<topic>.md`
- `src/testing/reports/<timestamp>-<topic>.json`

说明：

- `<timestamp>` 为 ISO 时间戳安全格式，例如 `2026-04-07T09-31-18-122Z`
- `<topic>` 为主题的 slug 版本，用于保证文件名可读且可跨平台保存
- `.md` 面向人工阅读
- `.json` 面向机器归档、检索、比对
- 报告会自动附带当前仓库的 `branch` / `commit` / `isDirty` 信息，便于追溯来源

## 2. 自定义命名参数

`accept-backend.mjs` 现在支持两个报告输出参数：

- `--report-name`
  - 指定报告基础文件名，不带扩展名
- `--report-dir`
  - 指定报告输出目录

示例：

```bash
npm run accept:backend -- "发布前回归" --report-name release-smoke-build-1842
```

输出：

- `src/testing/reports/release-smoke-build-1842.md`
- `src/testing/reports/release-smoke-build-1842.json`

指定目录：

```bash
npm run accept:backend -- "发布前回归" --report-dir artifacts/backend-acceptance
```

说明：

- 相对路径按仓库根目录解析
- 绝对路径会直接使用
- 目录不存在时会自动创建

组合使用：

```bash
npm run accept:backend -- "发布前回归" --report-dir artifacts/backend-acceptance --report-name release-smoke-build-1842
```

如果是 CI，优先使用：

```bash
npm run accept:backend:ci -- "nightly-backend"
```

该命令默认输出到：

- `artifacts/backend-acceptance/`

## 3. 命名规则建议

如果是人工本地执行，建议继续使用默认命名，不需要额外参数。

如果是多人协作或 CI，建议 `--report-name` 至少带上以下信息中的 2 到 3 项：

- 场景名，例如 `release-smoke`
- 分支名或环境名，例如 `main`、`staging`
- 构建号或流水线号，例如 `build-1842`
- 日期或时间戳

推荐示例：

- `release-smoke-main-build-1842`
- `staging-regression-20260407-0930`
- `hotfix-video-gen-pr-128`

即使文件名中不带 branch / commit，报告正文和 JSON 里也会自动记录 git 元信息。

不推荐：

- `report`
- `test`
- `latest`

这类名称会导致覆盖风险高、检索价值低。

## 4. 保留策略建议

建议把报告分成 3 类保留：

1. 本地临时报告
   - 用于开发自测
   - 可以只保留最近 7 到 14 天

2. 发布验收报告
   - 用于版本上线前验证
   - 建议至少保留 1 到 2 个发布周期

3. 故障复盘报告
   - 用于问题定位、回归确认、事故追踪
   - 建议和 issue / 事故单一起长期留存

如果仓库不适合长期保存大量报告，建议把 `--report-dir` 指向外部归档目录或 CI Artifact 目录，而不是持续堆积在源码目录中。

## 5. 归档建议

### 5.1 本地协作

建议默认写到：

- `src/testing/reports/`

这样方便开发、评审和复测时快速查看历史报告结构。

### 5.2 CI 场景

建议显式指定目录：

```bash
npm run accept:backend -- "nightly-backend" --report-dir artifacts/backend-acceptance --report-name nightly-main-build-1842
```

推荐做法：

- `artifacts/backend-acceptance/` 作为 CI 收集目录
- 上传 `.md` 和 `.json` 两份文件
- 在流水线页面展示 `.md`
- 将 `.json` 作为后续统计和趋势分析输入

### 5.3 问题单 / PR 归档

建议：

- PR 中贴 `.md` 的关键信息
- 将完整 `.md` / `.json` 作为附件或 artifact
- 如需多轮复测，不覆盖原报告，按时间或构建号追加

## 6. 是否提交到 Git

默认不建议把自动生成报告直接提交进版本库，原因包括：

- 变化频繁，容易制造无意义 diff
- 报告更适合作为运行产物而不是源码
- 多人同时执行时容易产生冲突

更合理的做法：

- 本地报告只作临时留存
- CI 报告走 artifact
- 需要长期保留的关键报告，归档到外部目录、对象存储或团队知识库

## 7. 与模板文档的关系

如果你关心“报告里必须有哪些字段、Markdown 和 JSON 应该长什么样”，看：

- `src/testing/REPORT_TEMPLATE.md`

如果你关心“报告文件应该怎么命名、放在哪、保留多久、怎么归档”，看本文档。