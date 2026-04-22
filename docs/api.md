# API Reference

Base URL: `http://localhost:3220` (configurable via `PORT`).

All endpoints except `/health` and `POST /api/ui-crash` require the `Authorization: Bearer <API_KEY>` header when `API_KEY` is set in the environment. Responses are JSON unless otherwise noted.

---

## Table of Contents

1. [Health & Observability](#1-health--observability)
2. [Pipeline — Projects](#2-pipeline--projects)
3. [Pipeline — Control](#3-pipeline--control)
4. [Pipeline — Artifacts & Assets](#4-pipeline--artifacts--assets)
5. [Pipeline — Scenes](#5-pipeline--scenes)
6. [Configuration](#6-configuration)
7. [Workbench — Tasks](#7-workbench--tasks)
8. [Workbench — Accounts (legacy)](#8-workbench--accounts-legacy)
9. [Workbench — Resources](#9-workbench--resources)
10. [Workbench — Providers](#10-workbench--providers)
11. [Workbench — Models](#11-workbench--models)
12. [Workbench — Control & State](#12-workbench--control--state)
13. [File Upload](#13-file-upload)
14. [BGM Library](#14-bgm-library)
15. [SSE Event Stream](#15-sse-event-stream)
16. [Error Responses](#16-error-responses)

---

## 1. Health & Observability

### `GET /health`

Liveness probe. Does **not** require authentication.

**Response 200**
```json
{
  "status": "ok",
  "uptime": 142.3,
  "version": "0.1.0",
  "providers": 3,
  "browserResources": 2,
  "apiResources": 1,
  "ready": true
}
```

---

### `GET /metrics`

Prometheus-format plain-text metrics. Requires authentication.

**Response 200** — `text/plain; version=0.0.4`

---

### `GET /api/observability/snapshot`

JSON snapshot of key runtime metrics. Requires authentication.

**Response 200**
```json
{
  "generatedAt": "2026-04-22T05:00:00.000Z",
  "sse": { "active": 2, "max": 50 },
  "retries": [
    { "label": "Gemini API request", "reason": "rate limit", "count": 3 }
  ],
  "quotaErrors": [
    { "provider": "gemini", "count": 1 }
  ],
  "stages": [
    {
      "stage": "VIDEO_GEN", "status": "completed",
      "count": 5, "sumSeconds": 320.4,
      "avgSeconds": 64.1, "p50Seconds": 60, "p95Seconds": 120,
      "buckets": [...]
    }
  ]
}
```

---

## 2. Pipeline — Projects

### `GET /api/pipeline`

List all projects.

**Response 200** — array of `PipelineProject` objects.

---

### `POST /api/pipeline`

Create a new project.

**Request body**
```json
{
  "topic": "The water cycle",
  "title": "Water Cycle Explainer",
  "modelOverrides": { "SCRIPT_GENERATION": "gemini-2.5-pro" }
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `topic` | string | ✅ | The subject matter for the video |
| `title` | string | — | Human-readable project title |
| `modelOverrides` | object | — | Per-stage model name overrides |

**Response 201** — `PipelineProject` object.

---

### `POST /api/pipeline/batch`

Create multiple projects in one request.

**Request body**
```json
{
  "topics": ["Topic A", "Topic B"],
  "titlePrefix": "Series",
  "modelOverrides": {}
}
```

**Response 201**
```json
{ "ok": true, "count": 2, "projects": [...] }
```

---

### `GET /api/pipeline/:id`

Get a single project.

**Response 200** — `PipelineProject` | **404** if not found.

---

### `DELETE /api/pipeline/:id`

Delete a project and all its artifacts.

**Response 200** `{ "ok": true }` | **404** if not found.

---

## 3. Pipeline — Control

### `POST /api/pipeline/:id/start`

Start (or restart) the full pipeline for a project.

**Request body** (optional)
```json
{ "videoFilePath": "/absolute/path/to/video.mp4" }
```

**Response 200** `{ "ok": true, "projectId": "<id>" }` | **400/409** on error.

---

### `POST /api/pipeline/batch/start`

Enqueue multiple projects for sequential execution.

**Request body**
```json
{ "projectIds": ["id1", "id2", "id3"] }
```

**Response 200/207**
```json
{
  "ok": false,
  "started": ["id1"],
  "queued": ["id2"],
  "failed": [{ "projectId": "id3", "error": "Project not found", "status": 404 }]
}
```

---

### `POST /api/pipeline/:id/stop`

Abort a running pipeline (graceful cancel).

**Response 200** `{ "ok": true }`.

---

### `POST /api/pipeline/:id/pause`

Request a pause after the current stage completes.

**Response 200** `{ "ok": true, "projectId": "<id>" }` | **400/409** on error.

---

### `POST /api/pipeline/:id/resume`

Resume a paused pipeline from where it left off.

**Response 200** `{ "ok": true, "projectId": "<id>" }` | **400** on error.

---

### `POST /api/pipeline/:id/retry/:stage`

Retry a specific stage (e.g. after manual artifact edits).

`:stage` must be a valid `PipelineStage` name (e.g. `VIDEO_GEN`).

**Request body** (optional)
```json
{ "directive": "regenerate with higher quality" }
```

**Response 200** `{ "ok": true, "projectId": "<id>", "stage": "VIDEO_GEN" }` | **400/404** on error.

---

### `GET /api/pipeline/running`

Get the current run-queue snapshot.

**Response 200**
```json
{
  "running": "proj_abc",
  "queued": ["proj_def", "proj_ghi"],
  "maxConcurrent": 1
}
```

---

### `GET /api/pipeline/:id/eta`

Estimate time remaining for a running pipeline.

**Response 200**
```json
{ "etaMs": 120000, "remainingStages": 3 }
```
Returns `{ "etaMs": null }` when no estimate is available.

---

## 4. Pipeline — Artifacts & Assets

### `GET /api/pipeline/:id/video`

Stream or download the final assembled video (MP4).

- Supports `Range` requests for seeking.
- Append `?dl` to force `Content-Disposition: attachment`.

**Response 200/206** — `video/mp4` binary stream | **404** if not yet produced.

---

### `GET /api/pipeline/:id/artifacts/:filename`

Read a pipeline JSON artifact. `:filename` must be a value from the `ARTIFACT` constant map (e.g. `script.json`, `scenes.json`).

**Response 200** — parsed JSON object | **400** invalid name | **404** not found.

---

### `PUT /api/pipeline/:id/artifacts/:filename`

Overwrite an editable artifact. Only `research.json` and `narrative-map.json` are editable.

**Request body** — the new JSON object.

**Response 200** `{ "ok": true }` | **400** if not editable.

---

### `GET /api/pipeline/:id/assets/:filename`

Serve a project-level asset file (image, audio clip, etc.).

**Response 200** — binary file with appropriate `Content-Type` | **403** path traversal | **404** not found.

---

### `GET /api/assets/:path`

Serve global data-dir assets.

**Response 200** — binary | **403** | **404**.

---

### `GET /api/pipeline/:id/resource-plan`

Get the AI resource plan for a project (which provider/model is mapped to each stage).

**Response 200** — resource plan object.

---

### `GET /api/pipeline/:id/export`

Export project + all artifacts as a portable JSON bundle.

**Response 200** — `application/json` attachment.

---

### `POST /api/pipeline/import`

Import a previously exported bundle.

**Request body** — the export bundle JSON.

**Response 201** — `PipelineProject` | **400** on invalid bundle.

---

### `GET /api/data-dir`

Returns the resolved server data directory path.

**Response 200** `{ "dataDir": "/path/to/data" }`.

---

## 5. Pipeline — Scenes

### `POST /api/pipeline/:id/scenes/:sceneId/regenerate`

Regenerate a single scene (image + video).

**Request body** (optional)
```json
{ "feedback": "Make the colors warmer" }
```

**Response 200** — updated scene object | **400** on error | **409** if already regenerating.

---

## 6. Configuration

### `GET /api/config`

Get full pipeline configuration.

**Response 200**
```json
{
  "aivideomakerApiKey": "...last4",
  "productionConcurrency": 2
}
```

---

### `POST /api/config`

Update pipeline configuration.

**Request body**
```json
{
  "aivideomakerApiKey": "your-key",
  "productionConcurrency": 3
}
```

**Response 200** — updated config object.

---

### `GET /api/config/environment`

Diagnose tool availability on the server.

**Response 200**
```json
{
  "ffmpegAvailable": true,
  "edgeTtsAvailable": false,
  "playwrightAvailable": true,
  "chromiumAvailable": true,
  "nodeVersion": "v22.14.0",
  "platform": "linux",
  "dataDir": "/data"
}
```

---

### `GET /api/config/tts`

Get TTS (text-to-speech) configuration.

### `POST /api/config/tts`

Update TTS configuration.

**Request body** — `TTSSettings` object.

### `GET /api/config/tts/voices?locale=zh-CN`

List available TTS voices, optionally filtered by locale.

**Response 200** `{ "voices": [...] }`.

---

### `GET /api/config/video-provider`

Get video-provider configuration (API keys, model selection, etc.).

### `POST /api/config/video-provider`

Update video-provider configuration. Send `null` to clear.

---

### `GET /api/config/queue-detection`

Get queue-detection presets (timing overrides per provider).

### `POST /api/config/queue-detection`

Add or update a queue-detection preset.

### `DELETE /api/config/queue-detection/:id`

Remove a queue-detection preset.

---

### `GET /api/config/route-table`

Current adapter routing decisions — which provider/adapter is used for each stage + task type.

---

### `GET /api/presets`

List all available provider presets.

### `GET /api/presets/:id`

Get a single preset by ID.

---

### `GET /api/sessions`

List active browser sessions.

---

### `GET /api/style-templates`

List saved style templates.

### `POST /api/style-templates`

Save a style template.

**Request body**
```json
{
  "name": "Documentary Dark",
  "topic": "science",
  "styleProfile": { ... },
  "formatSignature": { ... }
}
```

**Response 201** — template object.

### `GET /api/style-templates/:id`

Get a style template by ID.

### `DELETE /api/style-templates/:id`

Delete a style template.

---

### `GET /api/costs`

Get the global cost summary across all providers.

### `GET /api/pipeline/:id/costs`

Get cost summary for a specific project.

---

### `GET /api/providers/video-health`

Current health status of all video providers.

### `GET /api/providers/video-health/:id/recommendation`

Routing recommendation for a specific video provider.

---

### `GET /api/providers/capabilities`

Get capability flags for all registered providers.

### `PUT /api/providers/:id/capabilities`

Update capability flags for a provider.

**Request body** — partial capabilities object.

### `GET /api/providers/summary`

Provider summary for the setup dashboard.

---

## 7. Workbench — Tasks

### `GET /api/state`

Get full workbench state (accounts, queue, running status, chat mode).

---

### `POST /api/tasks`

Add one or more questions to the task queue.

**Request body**
```json
{
  "questions": ["What is quantum entanglement?"],
  "preferredProvider": "gemini",
  "preferredModel": "gemini-2.0-flash",
  "attachments": ["/data/uploads/image.png"]
}
```

**Response 201** — array of `TaskItem` objects.

---

### `DELETE /api/tasks/:id`

Remove a task from the queue.

**Response 200** `{ "ok": true }` | **404** if not found.

---

### `POST /api/tasks/clear`

Clear all tasks from the queue.

**Response 200** `{ "ok": true }`.

---

## 8. Workbench — Accounts (legacy)

These endpoints are kept for backward compatibility. Prefer `/api/resources` for new integrations.

### `POST /api/accounts`

Add a browser-automation account.

**Request body**
```json
{
  "provider": "gemini",
  "label": "My Gemini account",
  "profileDir": "/data/profiles/gemini-1"
}
```

**Response 201** — account object.

---

### `DELETE /api/accounts/:id`

Remove an account.

**Response 200** `{ "ok": true }` | **404**.

---

### `POST /api/accounts/reset-quotas`

Reset all quota flags to `available`.

**Response 200** `{ "ok": true }`.

---

### `POST /api/accounts/:id/login`

Open a browser window for the account (allows manual login).

**Response 200** `{ "ok": true }` | **400** on error.

---

### `POST /api/accounts/:id/close-login`

Close the login browser window.

**Response 200** `{ "ok": true }`.

---

## 9. Workbench — Resources

Unified resource model (supports `api`, `video`, and `image` resource types in addition to `browser`).

### `GET /api/resources`

List all resources.

### `GET /api/resources/by-type/:type`

List resources filtered by type (`api` | `video` | `image` | `browser`).

### `POST /api/resources`

Add a new resource.

**Request body**
```json
{
  "type": "api",
  "provider": "gemini",
  "label": "Gemini API key 1",
  "siteUrl": "https://generativelanguage.googleapis.com",
  "profileDir": "",
  "capabilities": { "text": true, "image": true, "video": false }
}
```

| Field | Required | Description |
|-------|----------|-------------|
| `type` | ✅ | Resource type: `api`, `video`, `image`, or `browser` |
| `provider` | ✅ | Provider identifier |
| `label` | ✅ | Human-readable label |
| `siteUrl` | ✅ | Target URL |
| `profileDir` | — | Playwright profile directory (browser resources) |
| `capabilities` | — | Feature flags for this resource |

**Response 201** — resource object.

### `DELETE /api/resources/:id`

Remove a resource.

**Response 200** `{ "ok": true }` | **404**.

### `POST /api/resources/:id/login`

Open login browser for resource.

### `POST /api/resources/:id/close-login`

Close login browser.

### `POST /api/resources/reset-quotas`

Reset all resource quota flags.

---

## 10. Workbench — Providers

### `GET /api/providers`

List all providers with their selectors and available models.

### `POST /api/providers`

Register a custom provider.

**Request body**
```json
{
  "id": "my-provider",
  "label": "My AI",
  "selectors": {
    "chatUrl": "https://my-ai.example.com/chat",
    "promptInput": "textarea.prompt",
    "sendButton": "button[type=submit]"
  }
}
```

**Response 201** — provider info.

### `POST /api/providers/from-url`

Auto-detect and register a provider from its chat URL.

**Request body**
```json
{ "chatUrl": "https://klingai.com/video", "type": "video" }
```

**Response 201** — provider info.

### `DELETE /api/providers/:id`

Remove a custom provider.

**Response 200** `{ "ok": true }` | **404**.

---

## 11. Workbench — Models

### `GET /api/models/:provider`

Get available models for a provider.

### `POST /api/models/:provider`

Auto-detect models for a provider (triggers browser navigation).

**Response 200** — array of model descriptors | **400** on error.

---

## 12. Workbench — Control & State

### `POST /api/chat-mode`

Set chat mode for new tasks.

**Request body**
```json
{ "mode": "new" }
```

`mode` must be `"new"` (start a fresh chat) or `"continue"` (keep existing context).

**Response 200** `{ "ok": true }`.

---

### `POST /api/start`

Start the workbench processing loop.

**Response 200** `{ "ok": true }`.

---

### `POST /api/stop`

Stop the workbench processing loop.

**Response 200** `{ "ok": true }`.

---

## 13. File Upload

### `POST /api/upload`

Upload one or more files (base64-encoded). Maximum 50 MB per file; maximum total request 50 MB. Allowed extensions: `.png`, `.jpg`, `.jpeg`, `.gif`, `.webp`, `.bmp`, `.mp4`, `.mov`, `.avi`, `.mkv`, `.mp3`, `.wav`, `.ogg`.

**Request body**
```json
{
  "files": [
    { "name": "reference.png", "data": "<base64>" }
  ]
}
```

**Response 200**
```json
{ "paths": ["/absolute/path/to/timestamp_reference.png"] }
```

**Errors**
- `400` — no files, unsupported extension, file too large
- `413` — request body too large

---

## 14. BGM Library

### `GET /api/bgm`

List all BGM (background music) tracks.

### `POST /api/bgm`

Add a BGM track.

### `DELETE /api/bgm/:id`

Remove a BGM track.

---

## 15. SSE Event Stream

### `GET /api/events`

Subscribe to the real-time event stream. Returns a `text/event-stream` response. A full state snapshot is sent immediately on connect.

**Event envelope**
```json
{ "type": "<event_type>", "payload": { ... } }
```

| Event type | Source | Description |
|------------|--------|-------------|
| `state` | Workbench | Full workbench state snapshot |
| `task_updated` | Workbench | Single task status change |
| `stage` | Pipeline | Stage transition (`processing` / `completed` / `error`) |
| `artifact` | Pipeline | Artifact produced for a stage |
| `error` | Pipeline | Stage failure details |
| `log` | Both | Structured log entry |
| `selector_health_warning` | HealthMonitor | CSS selector degradation alert |

Maximum concurrent SSE clients: `MAX_SSE_CLIENTS` (default 50). Returns `503` when the limit is reached.

---

## 16. Error Responses

All error responses use the envelope:
```json
{ "error": "<human-readable message>" }
```

| Status | Meaning |
|--------|---------|
| `400` | Bad request / validation failure |
| `401` | Missing or invalid `Authorization` header |
| `403` | Path traversal / forbidden resource |
| `404` | Resource not found |
| `409` | Conflict (e.g. stage already running) |
| `413` | Request body too large |
| `429` | Rate limit exceeded — `Retry-After` header is set |
| `500` | Internal server error |
| `503` | SSE client limit reached |

Rate limiting: 120 requests per 60-second window per IP (configurable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW_MS`).
