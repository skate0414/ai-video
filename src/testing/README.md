# 后端测试工具目录

该目录用于统一收拢 `ai-video-main` 的后端测试、验收与调试入口。

目标：

- 团队以后只需要查看 `src/testing` 与 `src/docs`
- 将历史测试脚本彻底收敛为 `src` 下的标准入口
- 统一通过 `accept-backend` 与 `package.json scripts` 调用

## 目录结构

- `lib/`
  - 复用工具层
- `scripts/`
  - 标准测试/验收脚本入口
- `reports/`
  - `accept-backend.mjs` 自动生成的验收报告输出目录

## 当前推荐入口

标准验收主流程：

```bash
npm run test:backend
npm run accept:backend -- "验收主题"
npm run accept:backend:ci -- "验收主题"
```

验收完成后会自动在 `src/testing/reports/` 下生成：

- Markdown 验收报告
- JSON 结构化报告

也支持自定义归档参数：

```bash
npm run accept:backend -- "验收主题" --report-name release-smoke-build-1842
npm run accept:backend -- "验收主题" --report-dir artifacts/backend-acceptance
npm run accept:backend:ci -- "验收主题"
```

其中 `accept:backend:ci` 默认把报告输出到 `artifacts/backend-acceptance/`，方便 CI 直接收集 artifact。

或拆分执行：

```bash
npm run accept:preflight
npm run accept:create-project -- "验收主题"
npm run accept:auto-run -- <projectId>
npm run accept:check-progress -- <projectId>
```

## 说明

当前 `src/testing/scripts/*` 已作为正式实现入口使用。

推荐口径：

- `npm run test:backend`：正式自动化测试
- `npm run accept:backend -- "主题"`：标准后端验收流程
- `npm run accept:backend:ci -- "主题"`：CI / 批量执行时的标准验收入口
- `npm run accept:recover-video -- <projectId>`：视频阶段恢复
- `npm run auth:seedance` / `npm run auth:kling`：账号登录准备
- `npm run debug:config` / `npm run debug:provider-login` / `npm run debug:provider-dom`：环境与第三方页面调试

配套文档：

- [SCRIPT_RESPONSIBILITY_MATRIX.md](SCRIPT_RESPONSIBILITY_MATRIX.md)
- [REPORT_TEMPLATE.md](REPORT_TEMPLATE.md)
- [reports/README.md](reports/README.md)
