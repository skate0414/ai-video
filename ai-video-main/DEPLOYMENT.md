# 部署指南

## 目录

- [系统要求](#系统要求)
- [环境变量](#环境变量)
- [安装步骤](#安装步骤)
- [启动服务](#启动服务)
- [使用流程](#使用流程)
- [安全配置](#安全配置)
- [目录说明](#目录说明)
- [CI / CD](#ci--cd)
- [故障排查](#故障排查)

## 系统要求

| 依赖 | 版本 | 用途 |
|------|------|------|
| Node.js | ≥ 20.9.0 | 后端运行时 |
| FFmpeg | ≥ 6.x | 视频合成（ASSEMBLY 阶段） |
| Chromium | 最新 | Playwright 浏览器自动化（免费聊天模式） |
| edge-tts | 最新 | 免费 TTS 语音合成（`pip install edge-tts`） |

## 环境变量

复制环境变量模板：

```bash
cp .env.example .env
```

| 变量 | 必需 | 说明 |
|------|------|------|
| `GEMINI_API_KEY` | 否 | Gemini API 密钥。设置后自动切换到 `balanced` 模式。获取地址：https://aistudio.google.com/apikey |
| `PORT` | 否 | 服务端口，默认 `3220` |
| `DATA_DIR` | 否 | 数据存储目录。默认按优先级：Tauri APPDATA → OS 应用数据目录 → `./data` |
| `ALLOWED_ORIGINS` | 否 | CORS 白名单，逗号分隔。留空则允许所有域（开发模式） |
| `API_KEY` | 否 | API 认证密钥。设置后所有请求需携带 `Authorization: Bearer <key>` |
| `MAX_SSE_CLIENTS` | 否 | SSE 最大连接数，默认 `50` |

## 安装步骤

### 1. 安装系统依赖

```bash
# Ubuntu / Debian
sudo apt-get update && sudo apt-get install -y ffmpeg

# macOS
brew install ffmpeg

# 验证
ffmpeg -version
```

### 2. 安装 Node.js 依赖

```bash
npm install
cd ui && npm install && cd ..
```

### 3. 安装 Playwright 浏览器

```bash
npx playwright install chromium
```

> 首次运行会下载 Chromium 浏览器二进制文件（约 150MB）。

### 4. 安装 TTS 引擎

```bash
pip install edge-tts
```

> edge-tts 是微软免费的 TTS 引擎，支持多语言高质量语音合成，无需 API Key。

### 5. （可选）配置 Gemini API

```bash
export GEMINI_API_KEY=your_key_here
```

设置后，系统自动切换到 `balanced` 模式：
- 视频生成 → 使用付费 Gemini API（Veo）
- 图片/TTS/文本 → 优先使用免费聊天，额度耗尽自动切换 API

不设置 API Key 时，系统以 `free` 模式运行，所有任务通过 Playwright 聊天自动化完成。

## 启动服务

### 开发模式

```bash
# 终端 1：启动后端（默认端口 3220）
npm run dev

# 终端 2：启动前端（默认端口 5173）
npm run dev:ui
```

然后打开 http://localhost:5173

### 桌面应用模式（Tauri）

```bash
cd ui && npx tauri dev
```

### 生产构建

```bash
# 前端构建
npm run build:ui

# 全量类型检查
npm run typecheck
```

### Docker 部署

```bash
# 构建镜像
docker build -t ai-video .

# 运行容器
docker run -p 3220:3220 \
  -e GEMINI_API_KEY=your_key \
  -e API_KEY=your_auth_key \
  -v $(pwd)/data:/app/data \
  ai-video
```

## 使用流程

### 首次使用

1. 启动后端和前端服务
2. 点击右上角 ⚙️ 按钮打开**设置面板**
3. 为至少一个 AI 提供者（ChatGPT / Gemini / DeepSeek / Kimi）完成登录
4. 登录状态自动保存到浏览器配置文件

### 创建视频项目

1. 在首页点击「新建项目」
2. 输入视频主题和标题，选择质量级别（free / balanced / premium）
3. 点击「开始」— 进入 4 页向导流程

### 4 页向导流程

**第 1 页 · 风格初始化**
- 自动执行：能力评估 → 风格提取 → 事实研究
- 可上传参考视频或手动输入风格描述

**第 2 页 · 脚本创作**
- 自动执行：叙事地图 → 脚本生成 → QA 审查
- QA 审查完成后自动暂停，可审阅/编辑脚本后恢复

**第 3 页 · 视觉设计**
- 自动执行：分镜规划 → 参考图生成
- 参考图生成后自动暂停，可审阅/编辑分镜和参考图后恢复

**第 4 页 · 制作交付**
- 自动执行：关键帧生成 → 视频生成 → TTS → FFmpeg 合成 → 精修
- 完成后可直接播放或下载 MP4 文件

## API 接口一览

> 完整 API 文档见 [API.md](API.md)

### 快速参考

| 分类 | 端点数 | 前缀 |
|------|--------|------|
| 健康检查 | 1 | `/health` |
| 工作台（账号/任务/提供者） | 22 | `/api/*` |
| 流水线（CRUD/控制/编辑） | 21 | `/api/pipeline/*` |
| 资源管理（会话/能力/规划） | 4 | `/api/sessions`, `/api/providers/capabilities` |
| 配置 | 2 | `/api/config` |
| 首次运行 | 2 | `/api/setup/*` |

## 流水线阶段说明

```
CAPABILITY_ASSESSMENT → STYLE_EXTRACTION → RESEARCH → NARRATIVE_MAP
         ↓                     ↓               ↓            ↓
      能力评估              风格提取         事实研究      叙事地图
      (安全分类)            (视频理解)       (联网搜索)    (校准+结构)

→ SCRIPT_GENERATION → QA_REVIEW → STORYBOARD → REFERENCE_IMAGE
         ↓                ↓            ↓              ↓
      脚本生成          QA 审查       分镜规划       参考图生成
      (创意写作)        (★ 暂停)     (视觉描述)     (★ 暂停)

→ KEYFRAME_GEN → VIDEO_GEN → TTS → ASSEMBLY → REFINEMENT
       ↓             ↓         ↓        ↓           ↓
    关键帧生成     视频生成    语音合成  FFmpeg拼接   自动精修
    (图片生成)     (img2video) (edge-tts)(合成MP4)   (重试失败)
```

### 各阶段详解

| # | 阶段 | 说明 | 暂停 |
|---|------|------|------|
| 1 | **CAPABILITY_ASSESSMENT** | 对主题进行安全分类，检测有害/敏感内容 | |
| 2 | **STYLE_EXTRACTION** | 分析参考视频或主题，提取风格特征（时长、色调、节奏等） | |
| 3 | **RESEARCH** | 基于主题进行事实研究，使用 Google Search grounding 收集可靠数据 | |
| 4 | **NARRATIVE_MAP** | 语速校准 + 叙事结构规划，计算目标字数和节奏 | |
| 5 | **SCRIPT_GENERATION** | 基于叙事地图和风格生成完整视频脚本 | |
| 6 | **QA_REVIEW** | 安全 + 事实一致性 + 质量评分三合一审查 | ★ |
| 7 | **STORYBOARD** | 将脚本拆分为场景分镜，生成视觉描述 | |
| 8 | **REFERENCE_IMAGE** | 生成全局风格锚定参考图 | ★ |
| 9 | **KEYFRAME_GEN** | 为每个场景生成关键帧图片 | |
| 10 | **VIDEO_GEN** | 从关键帧生成视频片段（img2video） | |
| 11 | **TTS** | 使用 edge-tts 生成旁白语音 | |
| 12 | **ASSEMBLY** | FFmpeg 合成（归一化 → 拼接 → 字幕 → BGM → 输出 MP4） | |
| 13 | **REFINEMENT** | 检查完整性，自动重试失败的场景（最多 2 次） | |

> ★ = 阶段完成后自动暂停，等待用户审阅/编辑后调用 `/resume` 恢复。

## 安全措施

| 措施 | 说明 |
|------|------|
| CORS 白名单 | `ALLOWED_ORIGINS` 环境变量限制跨域请求来源 |
| API Key 认证 | `API_KEY` 环境变量，请求需携带 `Authorization: Bearer <key>` |
| 请求体大小限制 | 普通请求 10MB，上传请求 200MB |
| 单文件大小限制 | 上传文件解码后最大 50MB |
| 文件类型白名单 | 仅允许视频/音频/图片/文本格式 |
| SSE 连接限制 | 最大 50 个并发 SSE 连接 |
| 内容安全检查 | CAPABILITY_ASSESSMENT 阶段自动进行主题安全分类 |
| 优雅关闭 | SIGTERM/SIGINT 信号处理，确保连接正常关闭 |

## 目录说明

| 目录 | 说明 |
|------|------|
| `src/` | Node.js 后端源码 |
| `ui/` | React 前端源码 |
| `shared/` | 前后端共享类型定义 |
| `data/` | 运行时数据（项目 JSON、上传文件） |
| `data/projects/` | 各项目的数据和产物 |
| `data/uploads/` | 用户上传的文件 |
| `browser/` | Playwright 浏览器配置文件 |
| `.github/workflows/` | GitHub Actions CI 配置 |

## CI / CD

项目配置了 GitHub Actions CI（`.github/workflows/ci.yml`），在 `push` 和 `pull_request` 到 `main` 分支时自动执行：

1. 后端类型检查（`tsc --noEmit`）
2. 前端类型检查（`tsc -b`）
3. 单元测试（`vitest run`）
4. 支持 Node.js 20 / 22 多版本矩阵

## 故障排查

### FFmpeg 未安装

```
Error: FFmpeg is not available
```

安装 FFmpeg 后重启后端。

### Playwright 浏览器未安装

```
Error: browserType.launch: Executable doesn't exist
```

运行 `npx playwright install chromium`。

### 免费额度耗尽

系统会自动检测额度状态，通过以下方式应对：
1. **多账号轮换**: 切换到下一个有额度的账号
2. **FallbackAdapter** (balanced 模式): 自动切换到付费 Gemini API
3. **跨提供者切换**: ChatGPT 额度完 → 切换到 DeepSeek

### API Key 无效

```
POST /api/config { "geminiApiKey": "your_new_key" }
```

支持运行时动态更新 API Key，无需重启服务。
