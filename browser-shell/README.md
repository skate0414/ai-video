# Browser Shell — 标签页式浏览器体验

将 AI Video Pipeline 集成为一个浏览器软件，自动化页面作为标签页而非独立窗口弹出。

## 架构概览

```
┌─────────────────────────────────────────────────────────────────┐
│  Electron BrowserWindow                                         │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │  Tab Bar (renderer/index.html)                            │  │
│  │  [🏠 Dashboard] [💬 ChatGPT] [🤖 Claude] [+ New Tab]    │  │
│  ├───────────────────────────────────────────────────────────┤  │
│  │                                                           │  │
│  │  Active Tab Content (WebContentsView)                     │  │
│  │                                                           │  │
│  │  每个标签页有独立的 session partition                       │  │
│  │  实现多账户 cookie 隔离                                    │  │
│  │                                                           │  │
│  └───────────────────────────────────────────────────────────┘  │
│                                                                 │
│  Backend: Node.js child process (port 3220)                     │
└─────────────────────────────────────────────────────────────────┘
```

## 核心组件

| 文件 | 职责 |
|------|------|
| `src/main.ts` | Electron 主进程入口，创建窗口和标签栏 |
| `src/tab-manager.ts` | 标签页生命周期管理（创建/切换/关闭） |
| `src/session-manager.ts` | 每账户 session 隔离（Electron partition） |
| `src/backend-launcher.ts` | 启动/管理 Node.js 后端子进程 |
| `src/ipc-handlers.ts` | IPC 通信处理（渲染进程 ↔ 主进程） |
| `src/preload.ts` | 安全的 IPC 桥接（contextBridge） |
| `src/renderer/` | 标签栏 UI（HTML/CSS/JS） |

## 多账户 Session 隔离

```typescript
// 每个账户获得独立的 Electron session
const session = electron.session.fromPartition(`persist:account-${accountId}`);

// "persist:" 前缀确保 session 数据持久化到磁盘
// Cookie、localStorage、IndexedDB 完全隔离
```

## 开发步骤

### 1. 安装依赖

```bash
cd browser-shell
npm install
```

### 2. 开发模式

```bash
# 推荐：从根目录一键启动（含 Vite 热更新）
cd .. && npm run dev:desktop

# 或从 browser-shell 目录单独启动 Electron
npm run dev
```

### 3. 构建发布包

```bash
# 先构建前端 UI
cd ../ui && npm run build && cd ../browser-shell

# 打包 Electron 应用
npm run package
```

## 自动化适配

### 当前: Playwright（用于 CI/测试/非桌面环境）

```typescript
const context = await chromium.launchPersistentContext(profileDir, {
  headless: false,
  args: STEALTH_ARGS,
});
const page = await context.newPage();
await page.goto(chatUrl);
await page.fill(selector, prompt);
```

### Electron WebContents API

```typescript
// 主进程中
const view = new WebContentsView({ webPreferences: { session: accountSession } });
window.contentView.addChildView(view);
await view.webContents.loadURL(chatUrl);

// 使用 executeJavaScript 进行页面操作
await view.webContents.executeJavaScript(`
  document.querySelector('${selector}').value = '${prompt}';
`);
```

### CDP 协议方案（推荐）

Electron 支持通过 Chrome DevTools Protocol (CDP) 进行自动化，
可以用 Playwright 连接到 Electron 内的 WebContents：

```typescript
// 启用 CDP
app.commandLine.appendSwitch('remote-debugging-port', '9222');

// Playwright 连接到 Electron 的 CDP 端口
const browser = await chromium.connectOverCDP('http://127.0.0.1:9222');
```

这种方案可以最大限度复用现有的 Playwright 自动化代码。

## 文件结构

```
browser-shell/
├── package.json              # Electron 项目配置
├── tsconfig.json             # TypeScript 配置
├── electron-builder.json     # 打包配置
├── README.md                 # 本文件
└── src/
    ├── main.ts               # 主进程入口
    ├── preload.ts            # 预加载脚本
    ├── tab-manager.ts        # 标签页管理
    ├── session-manager.ts    # Session 隔离
    ├── backend-launcher.ts   # 后端进程管理
    ├── ipc-handlers.ts       # IPC 通信
    └── renderer/
        ├── index.html        # 标签栏 HTML
        ├── styles.css        # 标签栏样式
        └── tabs.ts           # 标签栏逻辑
```
