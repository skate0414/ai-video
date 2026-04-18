# AI Video — Frontend (UI)

React 19 单页应用，为 AI Video Pipeline 提供 4 页向导式操作界面。

## 技术栈

| 框架 | 版本 |
|------|------|
| React | 19.2.4 |
| Vite | 8.0.1 |
| Tailwind CSS | 4.2.2 |
| React Router | 7.13.2 (HashRouter) |
| Lucide React | 0.468.0 (图标库) |

## 开发命令

> 通常不需要单独启动前端，推荐从根目录运行 `npm run dev:desktop` 一键启动 Electron 桌面应用。

```bash
npm run dev        # 单独启动前端 dev server (port 5173)
npm run build      # TypeScript 编译 + Vite 生产构建
npm run preview    # 预览生产构建
npm run typecheck  # TypeScript 类型检查
```

## 目录结构

```
src/
├── App.tsx                  # HashRouter 路由定义
├── main.tsx                 # 应用入口
├── index.css                # Tailwind 全局样式
├── types.ts                 # UI 专用类型定义
├── context/
│   └── ProjectContext.tsx   # 项目状态共享上下文
├── pages/                   # 7 个页面组件
│   ├── PipelinePage.tsx     # 首页：项目列表（搜索/排序/过滤/删除）
│   ├── StylePage.tsx        # 第 1 页：风格初始化 + 资源规划
│   ├── ScriptPage.tsx       # 第 2 页：脚本创作 + QA 审阅
│   ├── StoryboardPage.tsx   # 第 3 页：分镜规划 + 参考图审阅
│   ├── ProductionPage.tsx   # 第 4 页：制作交付 + 视频播放
│   ├── SettingsPage.tsx     # 全局设置
│   └── SetupPage.tsx        # 首次运行向导
├── components/              # 13 个 UI 组件
│   ├── Layout.tsx           # 全局布局（顶部栏 + SettingsModal）
│   ├── ProjectLayout.tsx    # 项目布局（NavStepper + 日志面板）
│   ├── NavStepper.tsx       # 4 步导航条
│   ├── SubStageProgress.tsx # 子步骤进度条
│   ├── ResourcePlannerPanel.tsx # 资源规划面板
│   ├── ModelOverridePanel.tsx   # 模型覆盖配置
│   ├── SceneGrid.tsx        # 场景网格（分镜/参考图）
│   ├── StageTimeline.tsx    # 阶段时间线
│   ├── StageBar.tsx         # 阶段进度条
│   ├── VideoPlayer.tsx      # 视频播放器
│   ├── Modal.tsx            # 通用模态框
│   ├── ErrorBoundary.tsx    # 错误边界
│   └── Panel.tsx            # 通用面板
├── hooks/                   # 4 个自定义 Hook
│   ├── useAutoSave.ts       # 自动保存
│   ├── usePipeline.ts       # Pipeline 状态管理
│   ├── useSetup.ts          # 首次运行检测
│   └── useWorkbench.ts      # 工作台状态
├── api/
│   ├── client.ts            # HTTP API 客户端
│   └── sse.ts               # SSE 事件流客户端
└── lib/
    └── utils.ts             # 工具函数（cn 样式合并等）
```

## 路由

| 路径 | 页面 | 说明 |
|------|------|------|
| `#/` | PipelinePage | 项目列表 |
| `#/project/:id/style` | StylePage | 风格设定 |
| `#/project/:id/script` | ScriptPage | 脚本创作 |
| `#/project/:id/storyboard` | StoryboardPage | 分镜规划 |
| `#/project/:id/production` | ProductionPage | 制作交付 |
| `#/settings` | SettingsPage | 全局设置 |
| `#/setup` | SetupPage | 首次引导 |

## API 通信

- **REST**: 通过 `api/client.ts` 与后端 (port 3220) 通信
- **SSE**: 通过 `api/sse.ts` 订阅实时 Pipeline 事件流 (`/api/events`)
- **上下文**: `ProjectContext` 管理当前项目状态，跨页面共享

## 样式

使用 Tailwind CSS 4 + `clsx` + `tailwind-merge` 管理样式。全局自定义样式在 `index.css` 中定义（mesh gradient 背景、动画等）。
