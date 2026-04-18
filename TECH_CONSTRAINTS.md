<!--
生成日期：2026-04-17
基于代码版本：当前 main 分支
本文档由 AI 生成，项目所有者已审核
-->

# 技术约束

本文档定义 ai-video-main 项目的技术栈约束，防止在后续开发中引入不兼容的技术选型。

---

## 锁定的技术栈

### 核心运行时

| 层级 | 技术 | 版本 | 锁定原因 |
|------|------|------|---------|
| 运行时 | Node.js | ≥20.9.0 | ESM 模块支持、顶级 await、现代 API |
| 语言 | TypeScript | ^5.8.3 | 类型安全、严格模式、ES2023 目标 |
| 模块系统 | ESM | - | `"type": "module"`，全项目统一 |

### 后端框架

| 层级 | 技术 | 版本 | 锁定原因 |
|------|------|------|---------|
| HTTP 服务器 | Node.js 原生 http | - | 无框架依赖，`src/server.ts` 直接使用 `http.createServer` |
| HTTP 客户端 | undici | ^7.24.7 | Node.js 官方推荐的 HTTP 客户端 |
| AI SDK | @google/genai | ^1.47.0 | Gemini API 付费降级选项 |

### 前端框架

| 层级 | 技术 | 版本 | 锁定原因 |
|------|------|------|---------|
| UI 框架 | React | ^19.2.4 | 组件化 UI，hooks 足够 |
| 路由 | react-router-dom | ^7.13.2 | 标准 React 路由方案 |
| 构建工具 | Vite | ^8.0.1 | 快速开发、ESM 原生支持 |
| 样式 | Tailwind CSS | ^4.2.2 | 原子化 CSS，快速开发 |
| 图标 | lucide-react | ^0.468.0 | 轻量图标库 |
| 样式工具 | clsx + tailwind-merge | - | 条件样式合并 |

### 测试框架

| 层级 | 技术 | 版本 | 锁定原因 |
|------|------|------|---------|
| 测试运行器 | Vitest | ^4.1.2 | Vite 原生支持、ESM 兼容 |
| 覆盖率 | @vitest/coverage-v8 | ^4.1.4 | V8 原生覆盖率收集 |
| DOM 测试 | @testing-library/react | ^16.3.2 | React 组件测试标准 |
| DOM 环境 | jsdom | ^29.0.2 | 浏览器环境模拟 |

### 浏览器自动化

| 层级 | 技术 | 版本 | 锁定原因 |
|------|------|------|---------|
| 浏览器自动化 | Playwright | ^1.55.1 | 跨浏览器、持久化上下文、隐身模式 |
| 目标浏览器 | Chromium | - | Electron 集成、稳定性 |

### 桌面应用

| 层级 | 技术 | 版本 | 锁定原因 |
|------|------|------|---------|
| 桌面框架 | Electron | ^41.0.0 | 跨平台桌面应用、浏览器自动化集成 |
| 打包工具 | electron-builder | ^26.0.0 | 跨平台打包分发 |

### 媒体处理

| 层级 | 技术 | 版本 | 锁定原因 |
|------|------|------|---------|
| 视频处理 | FFmpeg | 系统安装 | 本地命令行工具，免费开源 |
| TTS | edge-tts | 系统安装 | 微软 Edge TTS CLI，免费高质量中文语音 |

### 开发工具

| 层级 | 技术 | 版本 | 锁定原因 |
|------|------|------|---------|
| TypeScript 运行器 | tsx | ^4.19.2 | 直接运行 TS 文件，无需预编译 |
| 并发运行 | concurrently | ^9.2.1 | 同时启动多个开发服务 |

---

## 不引入的技术

### 数据层

| 技术类别 | 不引入 | 原因 |
|---------|-------|------|
| 关系数据库 | MySQL / PostgreSQL / SQLite | JSON 文件足够，单用户本地工具 |
| NoSQL 数据库 | MongoDB / Redis / DynamoDB | 不需要复杂查询或缓存 |
| ORM | Prisma / TypeORM / Drizzle | 不用数据库 |
| 数据库迁移 | Knex / migrate | 不用数据库 |

### 后端框架

| 技术类别 | 不引入 | 原因 |
|---------|-------|------|
| Web 框架 | Express / Fastify / Koa / Hono | Node.js 原生 http 足够 |
| API 框架 | tRPC / GraphQL | REST + SSE 足够 |
| 验证库 | Zod（运行时） | CIR 契约验证已有，TypeScript 编译时足够 |

### 前端生态

| 技术类别 | 不引入 | 原因 |
|---------|-------|------|
| 状态管理 | Redux / MobX / Zustand / Jotai | React hooks + Context 足够 |
| CSS-in-JS | styled-components / Emotion | Tailwind 足够 |
| 表单库 | React Hook Form / Formik | 简单表单，原生足够 |
| 数据获取 | TanStack Query / SWR | 简单 fetch + 状态足够 |

### 构建/部署

| 技术类别 | 不引入 | 原因 |
|---------|-------|------|
| 容器化 | Docker / Podman | 本地开发工具，不需要容器 |
| 编排 | Kubernetes / Docker Compose | 单进程应用 |
| CI/CD | GitHub Actions（复杂流程） | 本地开发为主 |
| 云服务 SDK | AWS SDK / GCP SDK / Azure SDK | 本地运行 |
| Serverless | Vercel / Netlify / Cloudflare | 桌面应用 |

### 其他语言

| 技术类别 | 不引入 | 原因 |
|---------|-------|------|
| Python | - | 保持单一语言栈（TypeScript） |
| Go | - | 保持单一语言栈 |
| Rust | - | 保持单一语言栈 |
| Java | - | 保持单一语言栈 |

### 通信协议

| 技术类别 | 不引入 | 原因 |
|---------|-------|------|
| gRPC | - | HTTP + SSE 足够 |
| WebSocket | - | SSE 足够（单向推送） |
| MQTT | - | 非 IoT 应用 |
| GraphQL | - | REST 足够 |

### 认证/安全

| 技术类别 | 不引入 | 原因 |
|---------|-------|------|
| 认证库 | Passport / Auth.js | 无用户系统 |
| JWT | - | 无认证需求 |
| OAuth | - | 无第三方登录 |
| 加密存储 | - | 本地配置文件足够 |

---

## 依赖添加规则

添加新依赖前必须满足以下条件：

### 必须满足

1. **免费且开源**
   - 必须是 MIT / Apache 2.0 / ISC / BSD 等宽松许可
   - 不接受 GPL（传染性）或付费许可

2. **TypeScript 支持**
   - 必须有 TypeScript 类型定义（内置或 @types/*）
   - 不接受只有 JavaScript 的库

3. **积极维护**
   - 最近 6 个月内有提交或发布
   - 有活跃的 issue 响应

4. **ESM 兼容**
   - 必须支持 ES 模块导入
   - 不接受只有 CommonJS 的库

### 优先考虑

5. **零依赖或少依赖**
   - 优先选择依赖树小的库
   - 避免引入大量传递依赖

6. **与现有技术栈兼容**
   - 不引入与 React 19 / Vite 8 / Node 20 不兼容的库
   - 不引入需要特殊配置的库

### 流程要求

7. **PR 说明**
   - 新增依赖需在 PR 中说明：
     - 为什么现有方案不够用
     - 为什么选择这个库而非其他替代
     - 依赖大小和传递依赖数量

8. **安全审计**
   - 运行 `npm audit` 确保无高危漏洞
   - 检查 Snyk / Socket 等安全报告

---

## 版本升级策略

### 主动升级

| 依赖 | 策略 |
|------|------|
| TypeScript | 跟进最新稳定版，利用新特性 |
| React | 跟进最新稳定版 |
| Vite | 跟进最新稳定版 |
| Vitest | 跟进最新稳定版 |
| Playwright | 跟进最新稳定版（浏览器兼容性） |
| Electron | 谨慎升级，测试后升级 |

### 保守升级

| 依赖 | 策略 |
|------|------|
| @google/genai | 仅在需要新功能时升级 |
| undici | 仅在有安全修复时升级 |

### 锁定

| 依赖 | 策略 |
|------|------|
| Node.js | 锁定 LTS 版本（20.x），不追新 |

---

## 环境变量约定

所有可配置值通过环境变量注入，参考 [src/constants.ts](src/constants.ts)：

| 变量 | 默认值 | 用途 |
|------|-------|------|
| `PORT` | 3220 | 后端 HTTP 端口 |
| `DATA_DIR` | 平台相关 | 数据存储目录 |
| `ELECTRON_CDP_PORT` | 9222 | Chrome DevTools 协议端口 |
| `ELECTRON_CONTROL_PORT` | 3221 | Electron 控制端口 |
| `CHAT_RESPONSE_TIMEOUT_MS` | 1200000 | 聊天响应超时 |
| `HTTP_PROXY` / `HTTPS_PROXY` | - | 代理设置 |
| `GEMINI_API_KEY` | - | Gemini API 密钥 |

---

## CI 自动化检查

PR 合并前会自动执行依赖合规检查，由 [scripts/lint-dependencies.mjs](scripts/lint-dependencies.mjs) 实现：

### 检查项

| 检查 | 规则 | 严重程度 |
|------|------|---------|
| 许可证合规 | MIT/Apache 2.0/ISC/BSD/0BSD/Unlicense | ❌ Error |
| TypeScript 支持 | 必须有 types/typings 或 @types/* | ❌ Error |
| 安全漏洞 | npm audit 无 critical/high | ❌ Error |
| ESM 兼容性 | 建议支持 ESM | ⚠️ Warning |

### 本地运行

```bash
# 检查所有依赖
npm run lint:deps

# 仅检查变更的依赖（适用于 PR 开发）
npm run lint:deps:diff

# 跳过安全审计（安全问题单独处理）
npm run lint:deps -- --skip-security

# 严格模式（warnings 也会失败）
npm run lint:deps:strict
```

### CI 行为

- **许可证/类型检查**：必须通过，否则 CI 失败
- **安全审计**：独立运行，high/critical 漏洞产生警告但不阻止合并
- **ESM 兼容性**：仅警告，不阻止合并

### 跳过检查

如果某个依赖有误报，可在 `scripts/lint-dependencies.mjs` 中添加到跳过列表：

```javascript
const LICENSE_SKIP_LIST = new Set(['package-name']);  // 跳过许可证检查
const TYPES_SKIP_LIST = new Set(['package-name']);    // 跳过类型检查
```

---

> **维护说明**：
> - 引入新依赖前检查本文档的"不引入"列表
> - 升级依赖时参考"版本升级策略"
> - 违反技术约束需要项目所有者明确批准
