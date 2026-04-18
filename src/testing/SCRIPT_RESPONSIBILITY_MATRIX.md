# 测试脚本职责矩阵

本文档用于回答 4 个问题：

1. 每个脚本负责什么
2. 输入是什么
3. 输出是什么
4. 什么时候应该运行它

推荐与 [README.md](README.md) 和 [../docs/BACKEND_ACCEPTANCE_WORKFLOW.md](../docs/BACKEND_ACCEPTANCE_WORKFLOW.md) 一起使用。

## 1. 主流程脚本矩阵

| 脚本 | 主要职责 | 关键输入 | 主要输出 | 适用场景 |
|---|---|---|---|---|
| `scripts/accept-backend.mjs` | 一键执行标准后端验收流程 | `topic`、`--server-url`、`--project-id`、`--video-file` | 控制台执行日志、`src/testing/reports/*.md`、`src/testing/reports/*.json` | 发布前验收、联调前全流程自检 |
| `scripts/start-server.mjs` | 启动后端服务 | 可选 `DATA_DIR` 环境变量 | 本地服务进程 | 本地联调、验收前准备 |
| `scripts/preflight-health-check.mjs` | 检查服务、账号、provider 配置是否可用 | `--server-url`、`--strong` | 预检查结果日志 | 开跑前检查、发布前检查 |
| `scripts/create-new-project.mjs` | 创建新的验收项目 | `topic`、`title`、`qualityTier`、`--server-url` | `projectId`、项目基本信息 | 手动分步验收 |
| `scripts/auto-run-project.mjs` | 对指定项目自动执行、自动处理暂停点 | `projectId`、`--video-file`、`--server-url` | 完整运行日志、最终 `finalVideoPath`（若有） | 单项目全流程执行 |
| `scripts/check-progress.mjs` | 检查视频场景阶段进度 | `projectId`、`--server-url` | 视频数量、降级数量、待处理数量 | 验收后查看视频阶段状态 |
| `scripts/check-scenes.mjs` | 直接检查 `scenes.json` 落盘内容 | `projectId` | scene 清单、asset 状态、关键帧/音频状态 | 深入排查场景状态 |

## 2. 恢复与支持脚本矩阵

| 脚本 | 主要职责 | 关键输入 | 主要输出 | 适用场景 |
|---|---|---|---|---|
| `scripts/retry-video-gen.mjs` | 恢复被降级的视频场景并重触发 `VIDEO_GEN` | `projectId`、`--server-url` | 场景恢复数量、重试触发结果 | `VIDEO_GEN` 失败或降级过多 |
| `scripts/probe-account.mjs` | 对单账号做真实页面级可用性探测 | `accountId`、`--server-url` | 账号是否可用、响应预览或失败原因 | 账号异常、登录态问题 |
| `scripts/provision-accounts.mjs` | 补齐 ChatGPT/Gemini/Seedance 账号基础配置 | `--server-url` | 新建账号结果与汇总 | 新环境初始化、账号数量不足 |
| `scripts/check-config.mjs` | 检查本地 `config.json` 关键字段 | 无 | 配置存在性与关键字段摘要 | 环境配置怀疑异常时 |

## 3. 登录与调试脚本矩阵

| 脚本 | 主要职责 | 关键输入 | 主要输出 | 适用场景 |
|---|---|---|---|---|
| `scripts/auth-browser.mjs` | 打开指定 provider 的持久化浏览器供人工登录 | `--provider`、`--account` | 登录后的 profile/cookie 保存 | 第三方站点登录准备 |
| `scripts/open-seedance-login.mjs` | 即梦登录快捷入口 | 账号编号 | 浏览器登录过程 | 即梦账号登录 |
| `scripts/open-kling-login.mjs` | 可灵登录快捷入口 | 账号编号 | 浏览器登录过程 | 可灵账号登录 |
| `scripts/check-video-provider-login.mjs` | 快速检查视频 provider 登录状态 | `--provider` | 各 profile 登录结果 | 登录态复核 |
| `scripts/inspect-provider-dom.mjs` | 采集 provider 页面 DOM 信号并截图 | `--provider`、`--account` | DOM 摘要 JSON、截图路径 | 页面结构变化、选择器失效 |

## 4. 推荐执行顺序映射

| 场景 | 推荐脚本 |
|---|---|
| 日常自动化测试 | `npm run test:backend` |
| 一键标准验收 | `npm run accept:backend -- "主题"` |
| 手动分步验收 | `start-server` → `preflight-health-check` → `create-new-project` → `auto-run-project` → `check-progress` |
| 视频生成故障恢复 | `check-progress` → `check-scenes` → `retry-video-gen` |
| 登录态排查 | `check-video-provider-login` → `probe-account` → `auth-browser` |
| 页面结构排查 | `inspect-provider-dom` |

## 5. 输入输出口径说明

为了减少协作歧义，统一约定：

- “输入”
  - 指命令行参数、环境变量、服务状态、项目 ID、账号 ID 等
- “输出”
  - 指控制台结果、生成的报告、写入的项目状态、截图等
- “适用场景”
  - 指团队什么时候应该主动选择这个脚本，而不是泛泛地“都可以试试”

## 6. 最重要的统一认知

- 日常跑后端测试：优先 `npm run test:backend`
- 要做完整后端验收：优先 `npm run accept:backend -- "主题"`
- 不要跳过主流程直接跑调试脚本，除非你已经知道问题发生在外部依赖层