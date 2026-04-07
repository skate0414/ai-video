# API 接口文档

> 服务默认运行在 `http://localhost:3220`，所有路径均以此为基础。

## 目录

- [通用说明](#通用说明)
- [健康检查](#健康检查)
- [SSE 事件流](#sse-事件流)
- [工作台接口](#工作台接口)
  - [状态](#状态)
  - [任务管理](#任务管理)
  - [账号管理](#账号管理)
  - [提供者管理](#提供者管理)
  - [模型管理](#模型管理)
  - [处理控制](#处理控制)
- [流水线接口](#流水线接口)
  - [项目 CRUD](#项目-crud)
  - [流水线控制](#流水线控制)
  - [脚本编辑](#脚本编辑)
  - [场景管理](#场景管理)
  - [审查操作](#审查操作)
  - [风格配置](#风格配置)
  - [视频下载](#视频下载)
- [资源管理接口](#资源管理接口)
- [配置接口](#配置接口)
  - [环境诊断](#get-apiconfigenvironment)
  - [TTS 配置](#get-apiconfigtts)
  - [视频提供者配置](#get-apiconfigvideo-provider)
  - [数据目录](#get-apidata-dir)
  - [项目导入/导出](#项目导入导出)
- [首次运行接口](#首次运行接口)
- [SSE 事件类型](#sse-事件类型)
- [错误格式](#错误格式)

---

## 通用说明

### 认证

如果配置了 `API_KEY` 环境变量，所有请求（除 `/health`）需要携带认证头：

```
Authorization: Bearer <your_api_key>
```

未配置 API_KEY 时跳过认证。

### 请求格式

- **Content-Type**: `application/json`
- **请求体大小限制**: 10MB（普通请求），200MB（上传请求）
- **方法**: 遵循 RESTful 约定（GET 读取、POST 创建/操作、PUT 更新、DELETE 删除）

### 响应格式

所有响应均为 JSON 格式：

```json
// 成功
{ "id": "proj_123", "title": "...", ... }

// 成功（操作类）
{ "ok": true }

// 错误
{ "error": "错误描述" }
```

### CORS

- 未配置 `ALLOWED_ORIGINS` 时：`Access-Control-Allow-Origin: *`（开发模式）
- 配置后：仅允许白名单内的域名

---

## 健康检查

### `GET /health`

> 无需认证

返回服务器健康状态。

**响应** `200`：
```json
{
  "status": "ok",
  "uptime": 3600.5,
  "version": "0.1.0"
}
```

---

## SSE 事件流

### `GET /api/events`

建立 SSE（Server-Sent Events）连接，接收实时事件推送。

- **Content-Type**: `text/event-stream`
- **最大连接数**: 50（超限返回 `503`）
- 连接建立时自动推送当前工作台状态

**事件格式**：
```
data: {"type":"pipeline_stage","payload":{...}}\n\n
```

详见 [SSE 事件类型](#sse-事件类型) 章节。

---

## 工作台接口

### 状态

#### `GET /api/state`

获取工作台完整状态（任务队列、账号列表、运行状态等）。

**响应** `200`：
```json
{
  "running": false,
  "chatMode": "new",
  "tasks": [],
  "accounts": [],
  "currentTaskId": null
}
```

---

### 任务管理

#### `POST /api/tasks`

添加问题到任务队列。

**请求体**：
```json
{
  "questions": ["问题1", "问题2"],
  "preferredProvider": "gemini",
  "preferredModel": "gemini-3.1-pro-preview",
  "attachments": ["/path/to/file.mp4"]
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `questions` | `string[]` | ✅ | 问题列表 |
| `preferredProvider` | `string` | | 指定提供者 ID |
| `preferredModel` | `string` | | 指定模型 |
| `attachments` | `string[]` | | 附件文件路径 |

**响应** `201`：任务对象数组

---

#### `DELETE /api/tasks/:id`

删除指定任务。

**响应** `200`：`{ "ok": true }`

---

#### `POST /api/tasks/clear`

清空所有任务。

**响应** `200`：`{ "ok": true }`

---

### 账号管理

#### `POST /api/accounts`

添加 AI 聊天账号。

**请求体**：
```json
{
  "provider": "gemini",
  "label": "我的 Gemini 账号",
  "profileDir": "/home/user/.config/chromium/Profile 1"
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `provider` | `string` | ✅ | 提供者 ID（gemini/chatgpt/deepseek/kimi 等） |
| `label` | `string` | ✅ | 账号显示名称 |
| `profileDir` | `string` | ✅ | Chromium 浏览器配置文件目录 |

**响应** `201`：账号对象

---

#### `DELETE /api/accounts/:id`

删除指定账号。

---

#### `POST /api/accounts/reset-quotas`

重置所有账号的配额计数器。

---

#### `POST /api/accounts/:id/login`

为指定账号打开 Playwright 浏览器窗口，用于手动登录 AI 聊天网站。

---

#### `POST /api/accounts/:id/close-login`

关闭指定账号的登录浏览器窗口。

---

### 提供者管理

#### `GET /api/providers`

获取所有已注册的 AI 提供者列表（内置 + 自定义）。

**响应** `200`：
```json
[
  {
    "id": "gemini",
    "selectors": { "chatUrl": "https://gemini.google.com/...", ... },
    "models": [{ "id": "gemini-3.1-pro", "label": "Gemini 3.1 Pro" }]
  }
]
```

---

#### `POST /api/providers`

添加自定义 AI 提供者。

**请求体**：
```json
{
  "id": "my-provider",
  "label": "自定义提供者",
  "selectors": {
    "chatUrl": "https://example.com/chat",
    "inputSelector": "textarea",
    "submitSelector": "button[type=submit]",
    "responseSelector": ".message"
  }
}
```

---

#### `POST /api/providers/from-url`

从 AI 聊天网站 URL 自动推断提供者配置。

**请求体**：
```json
{
  "chatUrl": "https://chat.deepseek.com/"
}
```

**响应** `200`：
```json
{
  "providerId": "deepseek",
  "accountId": "acc_123456"
}
```

---

#### `DELETE /api/providers/:id`

删除自定义提供者。

---

### 模型管理

#### `GET /api/models/:provider`

获取指定提供者的已知模型列表。

---

#### `POST /api/models/:provider`

自动检测指定提供者的可用模型（通过 Playwright 打开聊天页面抓取）。

---

### 处理控制

#### `POST /api/start`

开始处理任务队列中的任务。

---

#### `POST /api/stop`

停止处理。

---

#### `POST /api/chat-mode`

设置聊天模式。

**请求体**：
```json
{
  "mode": "new"
}
```

| 值 | 说明 |
|----|------|
| `new` | 每次开启新聊天 |
| `continue` | 在现有聊天中继续 |

---

#### `POST /api/upload`

上传文件（Base64 编码）。

**请求体**（大小限制 200MB）：
```json
{
  "files": [
    {
      "name": "reference.mp4",
      "data": "base64_encoded_content..."
    }
  ]
}
```

**限制**：
- 单文件解码后最大 50MB
- 文件类型白名单：`.mp4` `.mov` `.avi` `.mkv` `.webm` `.mp3` `.wav` `.ogg` `.m4a` `.flac` `.jpg` `.jpeg` `.png` `.gif` `.webp` `.bmp` `.svg` `.txt` `.srt` `.vtt` `.json`

**响应** `200`：
```json
{
  "paths": ["/absolute/path/to/data/uploads/reference.mp4"]
}
```

---

## 流水线接口

### 项目 CRUD

#### `GET /api/pipeline`

列出所有项目（按创建时间降序）。

**响应** `200`：`PipelineProject[]`

---

#### `POST /api/pipeline`

创建新项目。

**请求体**：
```json
{
  "topic": "量子计算的前世今生",
  "title": "量子计算科普视频",
  "qualityTier": "balanced",
  "modelOverrides": {
    "script_generation": {
      "adapter": "api",
      "model": "gemini-3.1-pro-preview"
    }
  }
}
```

| 字段 | 类型 | 必需 | 说明 |
|------|------|------|------|
| `topic` | `string` | ✅ | 视频主题（核心输入） |
| `title` | `string` | | 项目标题（默认取 topic 前 50 字） |
| `qualityTier` | `'free'\|'balanced'\|'premium'` | | 质量级别（默认根据是否有 API Key 自动选择） |
| `modelOverrides` | `ModelOverrides` | | 每种任务类型的适配器/模型覆盖 |

**响应** `201`：完整 `PipelineProject` 对象

---

#### `GET /api/pipeline/:id`

获取项目详情。

**响应** `200`：`PipelineProject` 对象（含所有阶段状态、脚本、场景、日志等）

---

#### `DELETE /api/pipeline/:id`

删除项目及其所有产物文件。

**响应** `200`：`{ "ok": true }`

---

### 流水线控制

#### `POST /api/pipeline/:id/start`

启动流水线执行。异步执行 — 立即返回，通过 SSE 获取进度。

**请求体**（可选）：
```json
{
  "videoFilePath": "/path/to/reference-video.mp4"
}
```

**响应** `200`：`{ "ok": true, "projectId": "proj_xxx" }`

---

#### `POST /api/pipeline/:id/stop`

停止正在运行的流水线。

---

#### `POST /api/pipeline/:id/retry/:STAGE`

重试指定阶段。阶段名使用大写蛇形命名：

```
CAPABILITY_ASSESSMENT | STYLE_EXTRACTION | RESEARCH | NARRATIVE_MAP
SCRIPT_GENERATION | QA_REVIEW | STORYBOARD | REFERENCE_IMAGE
KEYFRAME_GEN | VIDEO_GEN | TTS | ASSEMBLY | REFINEMENT
```

**示例**：`POST /api/pipeline/proj_123/retry/KEYFRAME_GEN`

---

#### `POST /api/pipeline/:id/resume`

恢复在暂停点（QA_REVIEW / STORYBOARD / REFERENCE_IMAGE）暂停的流水线。

---

### 脚本编辑

#### `PUT /api/pipeline/:id/script`

更新项目脚本内容（通常在 QA 审查后、恢复前编辑）。

**请求体**：
```json
{
  "scriptText": "《量子计算的前世今生》\n\n第一段：开场\n在 20 世纪初..."
}
```

---

### 场景管理

#### `PUT /api/pipeline/:id/scenes`

批量更新场景列表（编辑分镜内容）。

**请求体**：
```json
{
  "scenes": [
    {
      "id": "scene_1",
      "number": 1,
      "narrative": "量子计算的起源...",
      "visualPrompt": "一个实验室，复古色调...",
      "estimatedDuration": 15
    }
  ]
}
```

---

#### `POST /api/pipeline/:id/scenes/:sceneId/approve`

批准单个场景的参考图。

---

#### `POST /api/pipeline/:id/scenes/:sceneId/reject`

驳回单个场景的参考图（将标记为需要重新生成）。

---

#### `POST /api/pipeline/:id/scenes/:sceneId/regenerate`

重新生成单个场景的素材（参考图、关键帧或视频）。

**响应** `200`：更新后的场景对象

---

### 审查操作

#### `POST /api/pipeline/:id/qa-override`

手动通过 QA 审查（跳过自动 QA 或覆盖 QA 结果）。

**请求体**（可选）：
```json
{
  "feedback": "脚本整体OK，但第3段需要缩短"
}
```

---

#### `POST /api/pipeline/:id/approve-reference`

批准所有参考图，允许流水线继续到关键帧生成阶段。

---

### 风格配置

#### `POST /api/pipeline/:id/style-profile`

手动设置风格配置（跳过自动风格提取，或粘贴手动分析的文本）。

**请求体**（三选一）：
```json
// 方式 1：粘贴文本（系统自动解析）
{
  "pastedText": "风格：科技感，冷色调，节奏：中速...",
  "topic": "量子计算"
}

// 方式 2：直接传入结构化配置
{
  "styleProfile": {
    "targetDuration": 180,
    "visualStyle": "科技感",
    "colorPalette": ["#1a1a2e", "#16213e"],
    "pace": "medium"
  }
}
```

---

#### `PUT /api/pipeline/:id/overrides`

更新项目的模型覆盖配置。

**请求体**：
```json
{
  "modelOverrides": {
    "video_analysis": {
      "adapter": "chat",
      "provider": "gemini"
    },
    "script_generation": {
      "adapter": "api",
      "model": "gemini-3.1-pro-preview"
    },
    "video_generation": {
      "adapter": "api",
      "model": "veo-3.1"
    }
  }
}
```

**ModelOverride 结构**：

| 字段 | 类型 | 说明 |
|------|------|------|
| `adapter` | `'chat' \| 'api'` | 使用免费聊天还是付费 API |
| `model` | `string` | 指定 API 模型名称 |
| `provider` | `string` | 指定聊天提供者 ID |

---

### 视频下载

#### `GET /api/pipeline/:id/video`

下载最终合成视频文件。

- **Content-Type**: `video/mp4`
- **Content-Disposition**: `attachment; filename="final.mp4"`
- 如果视频尚未生成，返回 `404`

---

## 资源管理接口

#### `GET /api/pipeline/:id/resource-plan`

获取项目的资源分配计划（13 步每步的提供者、适配器、成本预估）。

**响应** `200`：
```json
{
  "qualityTier": "balanced",
  "stages": [
    {
      "stage": "CAPABILITY_ASSESSMENT",
      "taskType": "safety_check",
      "provider": "gemini",
      "adapter": "chat",
      "sessionGroup": "analysis",
      "reusesChatContext": false,
      "feasible": true,
      "reason": "Safety check is simple classification",
      "costCategory": "free"
    }
  ],
  "feasibleCount": 13,
  "totalCount": 13,
  "allFeasible": true,
  "blockers": [],
  "sessionSummary": {
    "analysis": { "provider": "gemini", "stageCount": 3, "reuseChat": true },
    "creation": { "provider": "chatgpt", "stageCount": 3, "reuseChat": true },
    "visual": { "provider": "gemini", "stageCount": 3, "reuseChat": true },
    "production": { "provider": "mixed", "stageCount": 4, "reuseChat": false }
  },
  "overallCost": "low",
  "summary": "13/13 阶段可执行，总体成本: low",
  "createdAt": "2026-03-31T12:00:00.000Z"
}
```

---

#### `GET /api/providers/capabilities`

获取所有提供者的能力信息。

**响应** `200`：
```json
{
  "gemini": {
    "providerId": "gemini",
    "text": true,
    "imageGeneration": true,
    "videoGeneration": false,
    "fileUpload": true,
    "webSearch": true,
    "tts": false,
    "models": [],
    "quotaExhausted": false,
    "dailyLimits": { "textQueries": 50, "imageGenerations": 10 }
  },
  "seedance": {
    "providerId": "seedance",
    "text": false,
    "imageGeneration": false,
    "videoGeneration": true,
    "fileUpload": true,
    "webSearch": false,
    "tts": false,
    "models": [],
    "quotaExhausted": false,
    "dailyLimits": { "videoGenerations": 5 }
  }
}
```

---

#### `PUT /api/providers/:id/capabilities`

更新指定提供者的能力信息（运行时动态更新）。

**请求体**：
```json
{
  "imageGeneration": true,
  "quotaExhausted": false,
  "dailyLimits": { "imageGenerations": 20 }
}
```

---

#### `GET /api/sessions`

获取所有活跃的会话信息（用于调试和 UI 显示）。

**响应** `200`：
```json
[
  {
    "group": "analysis",
    "sessionId": "session_proj_123_analysis_1711900000000",
    "stages": ["CAPABILITY_ASSESSMENT", "STYLE_EXTRACTION", "RESEARCH"],
    "useSameChat": true,
    "messageCount": 3,
    "createdAt": "2026-03-31T12:00:00.000Z"
  }
]
```

---

## 配置接口

#### `GET /api/config`

获取当前系统配置。

**响应** `200`：
```json
{
  "qualityTier": "balanced",
  "hasApiKey": true
}
```

---

#### `POST /api/config`

动态更新 API Key 和质量级别（无需重启服务）。

**请求体**：
```json
{
  "geminiApiKey": "AIza...",
  "qualityTier": "premium"
}
```

---

#### `GET /api/config/environment`

获取环境诊断信息（检测 FFmpeg、edge-tts、Playwright 等依赖是否可用）。

**响应** `200`：
```json
{
  "ffmpegAvailable": true,
  "edgeTtsAvailable": true,
  "playwrightAvailable": true,
  "nodeVersion": "v20.11.0",
  "platform": "linux",
  "dataDir": "/home/user/.local/share/ai-video-pipeline"
}
```

---

#### `GET /api/config/tts`

获取当前 TTS 语音合成配置。

**响应** `200`：
```json
{
  "voice": "zh-CN-XiaoxiaoNeural",
  "rate": "+0%",
  "pitch": "+0Hz"
}
```

---

#### `POST /api/config/tts`

更新 TTS 语音合成配置。

**请求体**：
```json
{
  "voice": "zh-CN-YunxiNeural",
  "rate": "+10%",
  "pitch": "-5Hz"
}
```

**响应** `200`：`{ "ok": true, "ttsConfig": { ... } }`

---

#### `GET /api/config/tts/voices`

获取可用的 TTS 语音列表。

**查询参数**：

| 参数 | 类型 | 说明 |
|------|------|------|
| `locale` | `string` | 按语言区域过滤（如 `zh-CN`） |

**响应** `200`：
```json
{
  "voices": [
    { "Name": "zh-CN-XiaoxiaoNeural", "Gender": "Female", "Locale": "zh-CN" }
  ]
}
```

---

#### `GET /api/config/video-provider`

获取当前浏览器端视频生成提供者配置。

**响应** `200`：视频提供者配置对象或 `null`

---

#### `POST /api/config/video-provider`

设置浏览器端视频生成提供者配置（如 Seedance）。

**请求体**：
```json
{
  "url": "https://seedance.ai",
  "promptInput": "textarea",
  "generateButton": "button.generate",
  "videoResult": "video",
  "profileDir": "/path/to/profile"
}
```

**响应** `200`：`{ "ok": true, "videoProviderConfig": { ... } }`

---

#### `GET /api/data-dir`

获取当前数据存储目录路径。

**响应** `200`：
```json
{
  "dataDir": "/home/user/.local/share/ai-video-pipeline"
}
```

---

### 项目导入/导出

#### `GET /api/pipeline/:id/export`

导出项目为 JSON 包（包含项目数据和所有阶段产物）。

- **Content-Type**: `application/json`
- **Content-Disposition**: `attachment; filename="proj_xxx.json"`

**响应** `200`：JSON 包含项目数据、所有阶段产物、导出时间和版本号

---

#### `POST /api/pipeline/import`

导入项目 JSON 包。

**请求体**：导出的 JSON 包

**响应** `201`：导入后的项目对象（会分配新的项目 ID）

---

## 首次运行接口

#### `GET /api/setup/status`

获取首次运行检测状态（环境依赖+配置检查）。

**响应** `200`：
```json
{
  "needsSetup": true,
  "dataDir": "/home/user/.local/share/ai-video-pipeline",
  "hasApiKey": false,
  "accountCount": 0,
  "ffmpegAvailable": true,
  "playwrightAvailable": true,
  "nodeVersion": "v20.11.0",
  "platform": "linux"
}
```

| 字段 | 说明 |
|------|------|
| `needsSetup` | 如果没有 API Key 且没有账号，则为 `true` |
| `ffmpegAvailable` | FFmpeg 是否已安装 |
| `playwrightAvailable` | Playwright 是否已安装 |

---

#### `POST /api/setup/complete`

完成首次设置，保存配置。

**请求体**：
```json
{
  "geminiApiKey": "AIza..."
}
```

**响应** `200`：
```json
{
  "ok": true,
  "hasApiKey": true
}
```

---

## SSE 事件类型

通过 `/api/events` 推送的事件类型：

### `state`

工作台状态更新（连接建立时推送一次完整状态）。

```json
{
  "type": "state",
  "payload": { "running": false, "chatMode": "new", "tasks": [], ... }
}
```

### `pipeline_created`

新项目已创建。

```json
{
  "type": "pipeline_created",
  "payload": { "projectId": "proj_123" }
}
```

### `pipeline_stage`

流水线阶段状态变化。

```json
{
  "type": "pipeline_stage",
  "payload": {
    "projectId": "proj_123",
    "stage": "STYLE_EXTRACTION",
    "status": "processing",
    "progress": 0.5
  }
}
```

`status` 可选值：`pending` | `processing` | `completed` | `error`

### `pipeline_artifact`

阶段产物已生成。

```json
{
  "type": "pipeline_artifact",
  "payload": {
    "projectId": "proj_123",
    "stage": "RESEARCH",
    "artifactType": "research_data",
    "summary": "找到 15 条相关事实"
  }
}
```

### `pipeline_log`

流水线日志条目。

```json
{
  "type": "pipeline_log",
  "payload": {
    "projectId": "proj_123",
    "entry": {
      "id": "log_1",
      "timestamp": "2026-03-31T12:00:00.000Z",
      "message": "开始风格提取...",
      "type": "info",
      "stage": "STYLE_EXTRACTION"
    }
  }
}
```

`entry.type` 可选值：`info` | `success` | `error` | `warning`

### `pipeline_paused`

流水线在暂停点暂停。

```json
{
  "type": "pipeline_paused",
  "payload": {
    "projectId": "proj_123",
    "stage": "QA_REVIEW"
  }
}
```

### `pipeline_completed`

流水线执行完成。

```json
{
  "type": "pipeline_completed",
  "payload": {
    "projectId": "proj_123",
    "finalVideoPath": "/data/projects/proj_123/assets/final.mp4"
  }
}
```

### `pipeline_error`

流水线执行出错。

```json
{
  "type": "pipeline_error",
  "payload": {
    "projectId": "proj_123",
    "stage": "VIDEO_GEN",
    "error": "Provider quota exhausted"
  }
}
```

---

## 错误格式

### HTTP 状态码

| 状态码 | 说明 |
|--------|------|
| 200 | 成功 |
| 201 | 创建成功 |
| 400 | 请求参数错误 |
| 401 | 未认证（API Key 无效或缺失） |
| 404 | 资源不存在 |
| 413 | 请求体过大（超过 10MB / 200MB） |
| 500 | 服务器内部错误 |
| 503 | SSE 连接数已满（超过 50） |

### 错误响应格式

```json
{
  "error": "具体错误描述"
}
```

### 常见错误

| 错误 | 触发条件 | 解决方式 |
|------|----------|----------|
| `topic is required` | POST /api/pipeline 缺少 topic | 补充 topic 字段 |
| `Project not found` | 项目 ID 不存在 | 检查 ID 是否正确 |
| `scriptText is required` | PUT script 缺少内容 | 补充 scriptText |
| `Unauthorized` | API_KEY 已配置但未提供 Bearer token | 添加 Authorization 头 |
| `Request body exceeds...` | 请求体超过大小限制 | 减小请求体或使用上传 API |
| `Invalid JSON in request body` | 请求体不是合法 JSON | 检查 JSON 格式 |
| `Too many SSE connections` | SSE 连接数超过 50 | 关闭空闲连接 |
