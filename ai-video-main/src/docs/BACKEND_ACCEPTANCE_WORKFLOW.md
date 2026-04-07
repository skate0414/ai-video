# 后端标准验收流程与执行顺序

本文档的目标不是再增加一份“原则说明”，而是把仓库根目录里分散的 `.mjs/.cjs/.sh` 脚本整理成一套可执行、可复用、可交接的标准验收流程。

适用场景：

- 后端提测
- 联调前自检
- 全流程回归
- 发布前验收
- 故障复盘后的复测

本文档与 [BACKEND_TEST_ACCEPTANCE.md](BACKEND_TEST_ACCEPTANCE.md) 的关系是：

- `BACKEND_TEST_ACCEPTANCE.md` 负责定义“什么叫验收成功”
- 本文档负责定义“具体按什么顺序执行哪些脚本去完成验收”

## 1. 脚本分层与角色定义

为了避免团队成员随意挑脚本执行，先把脚本分成 4 类。

## 1.1 一级脚本：标准验收主流程

这类脚本应优先使用，是标准验收路径的一部分。

- `src/testing/scripts/start-server.mjs`
  - 启动本地后端服务
- `src/testing/scripts/preflight-health-check.mjs`
  - 开跑前健康检查
- `src/testing/scripts/create-new-project.mjs`
  - 创建验收项目
- `src/testing/scripts/auto-run-project.mjs`
  - 自动处理暂停点并持续跑到完成
- `src/testing/scripts/check-progress.mjs`
  - 查看视频阶段进度

## 1.2 二级脚本：补充验收与恢复脚本

这类脚本不是每次都要跑，但在出现特定问题时应按规范使用。

- `src/testing/scripts/retry-video-gen.mjs`
- `src/testing/scripts/check-scenes.mjs`
- `src/testing/scripts/probe-account.mjs`
- `src/testing/scripts/check-config.mjs`

## 1.3 三级脚本：账号与环境准备脚本

- `src/testing/scripts/open-seedance-login.mjs`
- `src/testing/scripts/open-kling-login.mjs`
- `src/testing/scripts/provision-accounts.mjs`

## 1.4 四级脚本：调试与探索脚本

这类脚本不属于标准验收链路，只在问题定位时使用。

- `src/testing/scripts/check-video-provider-login.mjs`
- `src/testing/scripts/inspect-provider-dom.mjs`

说明：根目录历史测试脚本已清理，统一以 `src/testing/scripts/*` 为唯一测试脚本来源。

## 2. 标准验收总顺序

推荐所有人统一按以下顺序执行。

### Stage A：静态基线验收

先确认代码本身是干净的。

```bash
npm run test:backend
```

通过标准：

- 类型检查 0 error
- 现有正式测试全部通过

如果这一步不通过，不进入后续集成验收。

### Stage B：服务启动

```bash
npm run start:backend:test
```

或备用：

```bash
./start-server.sh
```

通过标准：

- `/health` 返回正常
- 服务能加载本地 `DATA_DIR`
- 没有启动即崩溃

### Stage C：环境与账号预检查

```bash
npm run accept:preflight
```

建议在发布前使用强验证：

```bash
npm run accept:preflight
```

通过标准：

- ChatGPT 可用账号数量满足预期
- Gemini 可用账号数量满足预期
- VIDEO_GEN 通道可用
- 关键 provider 未出现明显 quota / login 失效

如果失败，按以下顺序修复：

1. `src/testing/scripts/provision-accounts.mjs`
2. `src/testing/scripts/open-seedance-login.mjs`
3. `src/testing/scripts/open-kling-login.mjs`
4. `src/testing/scripts/probe-account.mjs <accountId>`

### Stage D：创建验收项目

```bash
npm run accept:create-project -- "验收主题"
```

通过标准：

- 返回 201
- 获得新的 `projectId`
- 项目主题、标题正确

### Stage E：执行标准全流程验收

推荐直接使用总控脚本：

```bash
npm run accept:backend -- "验收主题"
```

如果已经有现成 `projectId`，再执行分步版本：

```bash
npm run accept:auto-run -- <projectId>
```

可选附带参考视频：

```bash
npm run accept:auto-run -- <projectId> --video-file /abs/path/video.mp4
```

该脚本会自动处理：

- 启动 pipeline
- 轮询项目状态
- 在 `QA_REVIEW` 自动 override
- 在 `REFERENCE_IMAGE` 自动 approve
- 自动 resume
- 在 `REFINEMENT` 完成后退出

通过标准：

- 无失败阶段
- `REFINEMENT` 为 `completed`
- 如有 `finalVideoPath`，路径可输出

### Stage F：检查关键生成质量

如果执行到了视觉/视频阶段，补跑：

```bash
npm run accept:check-progress -- <projectId>
```

必要时检查场景落盘状态：

```bash
npm run accept:check-scenes -- <projectId>
```

通过标准：

- 视频场景与图片场景分布符合预期
- `keyframeUrl`、`assetUrl`、`audioUrl` 状态基本一致
- 没有大批量降级到 image 且无人知晓

## 3. 异常场景下的标准处置顺序

## 3.1 账号或登录态异常

执行顺序：

1. `npm run accept:preflight`
2. `npm run accept:probe-account -- <accountId>`
3. `npm run auth:seedance`
4. `npm run auth:kling`
5. `node src/testing/scripts/provision-accounts.mjs`

什么时候算恢复成功：

- 账号探测通过
- 预检查重新通过

## 3.2 VIDEO_GEN 异常

标准顺序：

1. `npm run accept:check-progress -- <projectId>`
2. `npm run accept:check-scenes -- <projectId>`
3. `npm run accept:recover-video -- <projectId>`

如果第一套恢复仍失败，再进入调试：

```bash
npm run debug:provider-login -- --provider seedance
npm run debug:provider-dom -- --provider seedance --account 1
npm run debug:config
```

什么时候算恢复成功：

- `VIDEO_GEN` 能重新推进
- 场景不再大量卡在 pending
- 最终进入 `TTS/ASSEMBLY/REFINEMENT`

## 3.3 第三方 API 或模型侧异常

先区分是业务问题还是外部能力问题。

可使用：

```bash
npm run debug:config
npm run debug:provider-login -- --provider kling
npm run debug:provider-dom -- --provider kling --account 1
```

注意：这些不是验收主流程脚本，只用于定界问题来源。

## 4. 推荐执行矩阵

### 4.1 日常提测

只跑这 5 步：

1. `npm run test:backend`
2. `npm run start:backend:test`
3. `npm run accept:preflight`
4. `npm run accept:auto-run -- <projectId>`

### 4.2 发布前完整验收

跑这 8 步：

1. `npm run test:backend`
2. `npm run start:backend:test`
3. `npm run accept:preflight`
4. `npm run accept:create-project -- "验收主题"`
5. `npm run accept:auto-run -- <projectId>`
6. `npm run accept:check-progress -- <projectId>`
7. 必要时 `npm run accept:check-scenes -- <projectId>`

### 4.3 问题复盘后复测

跑这 6 步：

1. `npm run test:backend`
3. `npm run start:backend:test`
4. 相关定界脚本（如 `npm run accept:probe-account -- <accountId>` / `npm run debug:provider-dom -- --provider seedance`）
5. `npm run accept:auto-run -- <projectId>` 或 `npm run accept:recover-video -- <projectId>`
6. `npm run accept:check-progress -- <projectId>`

## 5. 建议的统一执行口径

为了减少团队沟通成本，建议统一采用以下口径：

- “自动化测试”
  - 指 `tsc + vitest`
- “标准验收”
  - 指本文档中的主流程：启动服务 -> 预检查 -> 创建项目 -> 自动跑完整 pipeline -> 检查结果
- “调试脚本”
  - 指非主流程、只用于定位问题来源的脚本

不要再混用“test 脚本”“验收脚本”“调试脚本”这些概念。

## 6. 标准验收命令清单

建议团队在 issue、PR、测试记录中统一贴这组命令：

```bash
npm run test:backend
npm run start:backend:test
npm run accept:preflight
npm run accept:create-project -- "验收主题"
npm run accept:auto-run -- <projectId>
npm run accept:check-progress -- <projectId>
```

## 7. 验收记录模板

每次标准验收后，建议记录如下内容：

```text
验收时间：
验收人：
分支/提交：

静态检查：通过 / 未通过
自动化测试：通过 / 未通过
服务启动：通过 / 未通过
预检查：通过 / 未通过
项目创建：通过 / 未通过
完整流水线：通过 / 未通过
视频阶段检查：通过 / 未通过

失败点：
- 

恢复动作：
- 

结论：可提测 / 可联调 / 可发布 / 需修复后重测
```

## 8. 最终建议

从现在开始，把这些脚本按以下原则使用：

- 主流程只认一级脚本
- 恢复流程按异常分类走二级脚本
- 调试时才进入三级、四级脚本
- 任何新脚本都必须先声明属于哪一层，再允许进入团队流程

如果后续还要继续收敛，我建议下一步把这些命令进一步封装成一个统一入口，例如 `npm run accept:backend`，减少人工记忆成本。

附：标准测试脚本目录说明见 [../testing/README.md](../testing/README.md)